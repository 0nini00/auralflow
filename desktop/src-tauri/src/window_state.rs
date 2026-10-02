//! 主窗口几何持久化
//!
//! 目标：重启后恢复上次的尺寸 / 位置 / 最大化状态。
//!
//! 与歌词窗（`lyric_window.rs`）同一套做法：
//! - 逻辑像素落盘（物理值 ÷ 当前缩放系数），跨 DPI 显示器拖动后下次启动仍落在原处；
//! - 移动/缩放走 debounce 落盘，拖拽期间不每个事件写一次 JSON；
//! - 只在非最大化时记录尺寸/位置，「上次是不是最大化」单独记一个布尔；
//! - 保存的位置已不在任何显示器可见区域内（拔显示器 / 改分辨率）时回退到居中；
//! - 任何一步失败只记日志：不阻断启动、不让窗口不出现。

use serde_json::json;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::async_runtime::{spawn, JoinHandle};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WindowEvent};
use tauri_plugin_log::log;

const MAIN_LABEL: &str = "main";
/// 移动/缩放的落盘节流：事件停下这么久之后才写一次，而不是每个事件都写盘。
const PERSIST_DEBOUNCE_MS: u64 = 500;
/// 默认与最小尺寸逐字对齐 tauri.conf.json 的 width/height/minWidth/minHeight：
/// 读不到设置、或设置里的值不可用时，恢复结果与首次启动完全一致。
const DEFAULT_WIDTH: f64 = 1200.0;
const DEFAULT_HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 900.0;
const MIN_HEIGHT: f64 = 600.0;
/// 判定「位置还算看得见」的最小重叠尺寸：只搭上一两个像素的窗口用户既看不到标题栏，
/// 也没法把它拖回来，等同于丢在屏幕外。
const MIN_VISIBLE_WIDTH: f64 = 120.0;
const MIN_VISIBLE_HEIGHT: f64 = 40.0;

/// 矩形（左上角 + 尺寸），逻辑像素。显示器与窗口共用。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct MainWindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MainWindowGeometry {
    fn rect(self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// 物理坐标 + 缩放系数 → 逻辑像素矩形。
/// 缩放系数或尺寸无效时返回 None：除零会算出 inf 坐标，宁可放弃这台显示器也不要写进设置。
fn logical_rect(x: f64, y: f64, width: f64, height: f64, scale: f64) -> Option<Rect> {
    let valid = scale.is_finite()
        && scale > 0.0
        && x.is_finite()
        && y.is_finite()
        && width.is_finite()
        && height.is_finite()
        && width > 0.0
        && height > 0.0;
    if !valid {
        return None;
    }
    Some(Rect {
        x: x / scale,
        y: y / scale,
        width: width / scale,
        height: height / scale,
    })
}

/// 窗口与单台显示器的重叠尺寸；完全不相交时返回 None。
fn overlap_extent(window: Rect, monitor: Rect) -> Option<(f64, f64)> {
    let left = window.x.max(monitor.x);
    let top = window.y.max(monitor.y);
    let right = (window.x + window.width).min(monitor.x + monitor.width);
    let bottom = (window.y + window.height).min(monitor.y + monitor.height);
    if right <= left || bottom <= top {
        None
    } else {
        Some((right - left, bottom - top))
    }
}

/// 窗口在这台显示器上是否还有足够的可见区域。
fn reachable_on(window: Rect, monitor: Rect) -> bool {
    match overlap_extent(window, monitor) {
        Some((width, height)) => width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT,
        None => false,
    }
}

/// 恢复尺寸：非法值（NaN / 无穷）退回默认值，其余一律夹进 [min, 所有显示器里最大的那台]。
///
/// 上界取「最大的一台显示器」而不是居中目标那台：跨屏拉宽的窗口只要显示器没变小就不该被收窄，
/// 而分辨率变小之后又必须能收回来。
fn clamp_length(value: Option<f64>, fallback: f64, min: f64, largest_monitor: f64) -> f64 {
    let raw = match value {
        Some(v) if v.is_finite() => v,
        _ => fallback,
    };
    // 显示器比最小尺寸还小时以 min 为准，保证 clamp 的上下界不反转。
    raw.clamp(min, largest_monitor.max(min))
}

/// 决定主窗口本次启动的几何。
///
/// `anchor` 是回退居中用的显示器（主显示器），`monitors` 是全部显示器（用于判定已保存的位置
/// 是否还看得见；允许为空，此时只按 `anchor` 判定）。位置不可见时回退到 `anchor` 居中，
/// 而不是把窗口留在屏幕外。
fn resolve_main_window_geometry(
    saved_x: Option<f64>,
    saved_y: Option<f64>,
    saved_width: Option<f64>,
    saved_height: Option<f64>,
    anchor: Rect,
    monitors: &[Rect],
) -> MainWindowGeometry {
    let widest = monitors.iter().fold(anchor.width, |acc, m| acc.max(m.width));
    let tallest = monitors.iter().fold(anchor.height, |acc, m| acc.max(m.height));
    let width = clamp_length(saved_width, DEFAULT_WIDTH, MIN_WIDTH, widest);
    let height = clamp_length(saved_height, DEFAULT_HEIGHT, MIN_HEIGHT, tallest);

    let centered = MainWindowGeometry {
        x: anchor.x + ((anchor.width - width) / 2.0).max(0.0),
        y: anchor.y + ((anchor.height - height) / 2.0).max(0.0),
        width,
        height,
    };

    let (Some(x), Some(y)) = (saved_x, saved_y) else {
        return centered;
    };
    if !x.is_finite() || !y.is_finite() {
        return centered;
    }

    let restored = MainWindowGeometry {
        x,
        y,
        width,
        height,
    };
    let reachable = std::iter::once(anchor)
        .chain(monitors.iter().copied())
        .any(|monitor| reachable_on(restored.rect(), monitor));
    if reachable {
        restored
    } else {
        centered
    }
}

/// 接上主窗口的几何持久化：先恢复上次状态，再监听移动 / 缩放 / 最大化 / 关闭。
/// 失败只记日志——窗口照旧按 tauri.conf.json 的默认尺寸居中显示。
pub fn attach(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        log::warn!("[window] 找不到主窗口，跳过窗口几何恢复");
        return;
    };

    restore(app, &window);

    let app_for_event = app.clone();
    let pending: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
    window.on_window_event(move |event| match event {
        // 拖拽缩放时这两个事件每秒几十次：只登记一个落盘任务，事件停下之后才真正写盘。
        // 最大化/还原在 Windows 上同样会走这两个事件，状态由落盘时的实时查询判定。
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_persist(&app_for_event, &pending);
        }
        // 关闭（最小化到托盘）与真正退出之前记录最终状态，
        // 免得最后一次拖动还压在 debounce 里就没了。
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            persist_now(&app_for_event);
        }
        _ => {}
    });
}

/// 读取上次保存的状态并应用。任何一步失败都只记日志，窗口继续用配置里的默认几何。
fn restore(app: &AppHandle, window: &tauri::WebviewWindow) {
    let settings = match crate::config::load_settings(app) {
        Ok(settings) => settings,
        Err(err) => {
            log::warn!("[window] 读取窗口几何设置失败，本次用默认尺寸居中显示: {}", err);
            return;
        }
    };

    let Some(anchor) = anchor_monitor(app) else {
        log::warn!("[window] 读不到显示器信息，跳过窗口几何恢复");
        return;
    };
    let geometry = resolve_main_window_geometry(
        settings.main_window_x,
        settings.main_window_y,
        settings.main_window_width,
        settings.main_window_height,
        anchor,
        &monitor_rects(app),
    );

    if let Err(err) = window.set_size(LogicalSize::new(geometry.width, geometry.height)) {
        log::warn!("[window] 恢复主窗口尺寸失败: {}", err);
    }
    if let Err(err) = window.set_position(LogicalPosition::new(geometry.x, geometry.y)) {
        log::warn!("[window] 恢复主窗口位置失败: {}", err);
    }
    // 最大化放在最后：先摆好还原态的尺寸/位置，再交给系统最大化。
    // 此刻窗口还是隐藏的（tauri.conf.json 的 visible: false），设置最大化不会让它提前露出来。
    if settings.main_window_maximized {
        if let Err(err) = window.maximize() {
            log::warn!("[window] 恢复主窗口最大化状态失败: {}", err);
        }
    }
}

/// 居中回退的目标显示器：系统的主显示器；认不出主显示器时退回列表里的第一台。
fn anchor_monitor(app: &AppHandle) -> Option<Rect> {
    let primary = app.primary_monitor().ok().flatten();
    if let Some(monitor) = primary.as_ref() {
        return monitor_rect(monitor);
    }
    let monitors = app.available_monitors().ok()?;
    monitors.first().and_then(monitor_rect)
}

/// 全部显示器的逻辑矩形。取不到时返回空列表：只影响「位置是否还看得见」的判定，
/// 居中回退仍然可用，所以不值得为此中断恢复。
fn monitor_rects(app: &AppHandle) -> Vec<Rect> {
    let Ok(monitors) = app.available_monitors() else {
        log::warn!("[window] 枚举显示器失败，仅按主显示器判定窗口位置");
        return Vec::new();
    };
    monitors.iter().filter_map(monitor_rect).collect()
}

fn monitor_rect(monitor: &tauri::Monitor) -> Option<Rect> {
    let position = monitor.position();
    let size = monitor.size();
    logical_rect(
        position.x as f64,
        position.y as f64,
        size.width as f64,
        size.height as f64,
        monitor.scale_factor(),
    )
}

/// 取 debounce 句柄锁。锁只保护一个 JoinHandle，中毒不会让数据本身失去意义，
/// 所以沿用内部值继续工作；静默 return 会让几何落盘永久失效且无任何迹象。
fn lock_pending(pending: &Mutex<Option<JoinHandle<()>>>) -> MutexGuard<'_, Option<JoinHandle<()>>> {
    pending.lock().unwrap_or_else(|err| err.into_inner())
}

fn schedule_persist(app: &AppHandle, pending: &Mutex<Option<JoinHandle<()>>>) {
    let app = app.clone();
    let mut guard = lock_pending(pending);
    if let Some(handle) = guard.take() {
        handle.abort();
    }
    *guard = Some(spawn(async move {
        tokio::time::sleep(Duration::from_millis(PERSIST_DEBOUNCE_MS)).await;
        persist_now(&app);
    }));
}

/// 把主窗口当前状态写回设置。
///
/// 每次都在任务醒来时重新读窗口，而不是用事件里那份快照：拖拽结束前状态还会再变，
/// 读实时值才能落到最终结果上，也才能判定此刻是不是最大化。
fn persist_now(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    // 最小化时系统会把窗口矩形报成屏幕外的哨兵值，写下去下次启动只能靠居中兜底：
    // 直接跳过，保留上一次可见时的状态。
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let maximized = window.is_maximized().unwrap_or(false);
    let mut patch = serde_json::Map::new();
    patch.insert("mainWindowMaximized".to_string(), json!(maximized));
    // 最大化时不记尺寸/位置：记的是系统给的最大化矩形，还原后窗口就再也回不到用户调的大小。
    if !maximized {
        match window_pixel_state(&window) {
            Some((x, y, width, height)) => {
                patch.insert("mainWindowX".to_string(), json!(x));
                patch.insert("mainWindowY".to_string(), json!(y));
                patch.insert("mainWindowWidth".to_string(), json!(width));
                patch.insert("mainWindowHeight".to_string(), json!(height));
            }
            None => log::warn!("[window] 读取主窗口位置/尺寸失败，本次只记录最大化状态"),
        }
    }

    if let Err(err) = crate::config::patch_settings(app, serde_json::Value::Object(patch)) {
        log::warn!("[window] 保存主窗口几何失败: {}", err);
    }
}

/// 窗口当前状态 → 逻辑像素 (x, y, width, height)。缩放系数无效或任一值取不到时返回 None。
fn window_pixel_state(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let rect = logical_rect(
        position.x as f64,
        position.y as f64,
        size.width as f64,
        size.height as f64,
        scale,
    )?;
    Some((rect.x, rect.y, rect.width, rect.height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn saved_geometry_inside_monitor_is_restored_as_is() {
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            Some(120.0),
            Some(80.0),
            Some(1000.0),
            Some(700.0),
            primary,
            &[],
        );
        assert_eq!(
            geometry,
            MainWindowGeometry {
                x: 120.0,
                y: 80.0,
                width: 1000.0,
                height: 700.0,
            }
        );
    }

    #[test]
    fn geometry_on_secondary_monitor_survives_restart() {
        // 副屏摆在主屏左边时 x 为负：只要还看得见就原样恢复，不能把它拉回主屏。
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let secondary = rect(-1920.0, 0.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            Some(-1800.0),
            Some(60.0),
            Some(1200.0),
            Some(800.0),
            primary,
            &[secondary],
        );
        assert_eq!(geometry.x, -1800.0);
        assert_eq!(geometry.y, 60.0);
    }

    #[test]
    fn geometry_on_removed_monitor_falls_back_to_center() {
        // 副屏被拔掉：保存的位置不再落在任何显示器上 → 居中，而不是丢在屏幕外。
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            Some(-1800.0),
            Some(60.0),
            Some(1200.0),
            Some(800.0),
            primary,
            &[],
        );
        assert_eq!(
            geometry,
            MainWindowGeometry {
                x: 360.0,
                y: 140.0,
                width: 1200.0,
                height: 800.0,
            }
        );
    }

    #[test]
    fn barely_visible_geometry_falls_back_to_center() {
        // 只搭上 20px 宽：用户看不到标题栏也拖不回来，等同于屏幕外。
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            Some(1900.0),
            Some(100.0),
            Some(1200.0),
            Some(800.0),
            primary,
            &[],
        );
        assert_eq!(geometry.x, 360.0);
        assert_eq!(geometry.y, 140.0);
    }

    #[test]
    fn missing_position_falls_back_to_center() {
        // 主屏不落在原点时，居中也要带上它的偏移。
        let primary = rect(100.0, 50.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            None,
            None,
            Some(1200.0),
            Some(800.0),
            primary,
            &[],
        );
        assert_eq!(geometry.x, 460.0);
        assert_eq!(geometry.y, 190.0);
    }

    #[test]
    fn non_finite_position_falls_back_to_center() {
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        for (x, y) in [
            (f64::NAN, 0.0),
            (0.0, f64::INFINITY),
            (f64::NEG_INFINITY, f64::NAN),
        ] {
            let geometry = resolve_main_window_geometry(
                Some(x),
                Some(y),
                Some(1200.0),
                Some(800.0),
                primary,
                &[],
            );
            assert_eq!(geometry.x, 360.0);
            assert_eq!(geometry.y, 140.0);
        }
    }

    #[test]
    fn oversized_saved_size_is_clamped_to_largest_monitor() {
        // 换了更小的显示器：不该按旧的大尺寸恢复。
        let primary = rect(0.0, 0.0, 1280.0, 720.0);
        let geometry = resolve_main_window_geometry(
            Some(0.0),
            Some(0.0),
            Some(4000.0),
            Some(3000.0),
            primary,
            &[],
        );
        assert_eq!(geometry.width, 1280.0);
        assert_eq!(geometry.height, 720.0);
    }

    #[test]
    fn too_small_saved_size_is_raised_to_minimum() {
        // 比最小尺寸还小的存量值夹到最小尺寸，而不是跳到默认尺寸。
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let geometry = resolve_main_window_geometry(
            Some(0.0),
            Some(0.0),
            Some(200.0),
            Some(100.0),
            primary,
            &[],
        );
        assert_eq!(geometry.width, MIN_WIDTH);
        assert_eq!(geometry.height, MIN_HEIGHT);
    }

    #[test]
    fn invalid_saved_size_uses_default() {
        // NaN / 无穷不是「用户的意图」，退回默认尺寸。
        let primary = rect(0.0, 0.0, 2560.0, 1440.0);
        for (width, height) in [
            (Some(f64::NAN), Some(f64::INFINITY)),
            (Some(f64::NEG_INFINITY), None),
            (None, None),
        ] {
            let geometry = resolve_main_window_geometry(None, None, width, height, primary, &[]);
            assert_eq!(geometry.width, DEFAULT_WIDTH);
            assert_eq!(geometry.height, DEFAULT_HEIGHT);
        }
    }

    #[test]
    fn spanning_size_uses_largest_monitor_not_anchor() {
        // 两台显示器并排、窗口比主屏还宽：只要另一台装得下就不该被收窄。
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        let secondary = rect(1920.0, 0.0, 2560.0, 1440.0);
        let geometry = resolve_main_window_geometry(
            Some(0.0),
            Some(0.0),
            Some(2400.0),
            Some(1200.0),
            primary,
            &[secondary],
        );
        assert_eq!(geometry.width, 2400.0);
        assert_eq!(geometry.height, 1200.0);
    }

    #[test]
    fn reachable_requires_meaningful_overlap() {
        let primary = rect(0.0, 0.0, 1920.0, 1080.0);
        // 220px 搭在屏幕内：算可见。
        assert!(reachable_on(rect(1700.0, 0.0, 1200.0, 800.0), primary));
        // 只有 20×40 露在外面：不算可见。
        assert!(!reachable_on(rect(1900.0, 1040.0, 1200.0, 800.0), primary));
        // 完全在屏幕外。
        assert!(!reachable_on(rect(1920.0, 0.0, 1200.0, 800.0), primary));
        // 屏幕上边缘之上。
        assert!(!reachable_on(rect(0.0, -1080.0, 1200.0, 800.0), primary));
    }

    #[test]
    fn logical_rect_divides_by_scale_factor() {
        // 200% 缩放的 3840×2160 屏 = 逻辑 1920×1080；副屏在主屏左边的负偏移要保留。
        assert_eq!(
            logical_rect(-3840.0, 0.0, 3840.0, 2160.0, 2.0),
            Some(rect(-1920.0, 0.0, 1920.0, 1080.0))
        );
        assert_eq!(
            logical_rect(0.0, 0.0, 1920.0, 1080.0, 1.0),
            Some(rect(0.0, 0.0, 1920.0, 1080.0))
        );
    }

    #[test]
    fn invalid_scale_or_size_yields_no_rect() {
        assert_eq!(logical_rect(0.0, 0.0, 1920.0, 1080.0, 0.0), None);
        assert_eq!(logical_rect(0.0, 0.0, 1920.0, 1080.0, f64::NAN), None);
        assert_eq!(logical_rect(0.0, 0.0, 1920.0, 1080.0, -1.0), None);
        assert_eq!(logical_rect(0.0, 0.0, 0.0, 1080.0, 1.0), None);
        assert_eq!(logical_rect(f64::NAN, 0.0, 1920.0, 1080.0, 1.0), None);
    }
}
