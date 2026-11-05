//! 迷你播放器：隐藏到托盘时替代主窗口的常驻小条。
//!
//! 与桌面歌词共用同一套多窗口管线（独立 WebView、透明无边框、skip_taskbar、置顶），
//! 播放状态由前端 playerSync 双通道推送，控件动作也经它回传给主窗口执行。
//!
//! 这里负责窗口本体：创建/显示/隐藏、位置恢复、拖到边缘吸附、位置持久化，
//! 以及右键的原生弹出菜单（窗口只有 76px 高，HTML 菜单会被窗口边界裁掉）。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::lyric_window::ADDITIONAL_BROWSER_ARGS;

pub const MINI_PLAYER_LABEL: &str = "mini-player";

/// 一体条尺寸（逻辑像素）：封面 + 歌名/歌手 + 三个按钮 + 一条细进度。
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 76.0;
/// 拖到距屏幕（工作区）边缘这么近就吸上去。
const SNAP_DISTANCE: f64 = 24.0;
/// 吸附/默认位置与屏幕边缘留的间隙。
const EDGE_MARGIN: f64 = 16.0;
const PERSIST_DEBOUNCE_MS: u64 = 400;

static PERSIST_GENERATION: AtomicU64 = AtomicU64::new(0);
static PERSIST_THREAD_RUNNING: AtomicBool = AtomicBool::new(false);
static LAST_POSITION: Mutex<Option<(f64, f64)>> = Mutex::new(None);

async fn run_window_operation<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static WINDOW_OPERATION: Mutex<()> = Mutex::new(());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WINDOW_OPERATION
            .lock()
            .map_err(|_| "迷你播放器窗口状态锁损坏")?;
        operation()
    })
    .await
    .map_err(|err| format!("迷你播放器窗口任务失败: {}", err))?
}

fn show(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_PLAYER_LABEL) {
        return window
            .show()
            .map_err(|e| format!("显示迷你播放器失败: {}", e));
    }
    create(app)
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    match app.get_webview_window(MINI_PLAYER_LABEL) {
        Some(window) => window
            .hide()
            .map_err(|e| format!("隐藏迷你播放器失败: {}", e)),
        None => Ok(()),
    }
}

/// 切换显隐，返回切换后是否显示。
pub async fn toggle(app: &AppHandle) -> Result<bool, String> {
    let app = app.clone();
    run_window_operation(move || toggle_blocking(&app)).await
}

fn toggle_blocking(app: &AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(MINI_PLAYER_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window
                .hide()
                .map_err(|e| format!("隐藏迷你播放器失败: {}", e))?;
            return Ok(false);
        }
        window
            .show()
            .map_err(|e| format!("显示迷你播放器失败: {}", e))?;
        return Ok(true);
    }
    create(app)?;
    Ok(true)
}

/// 托盘「隐藏到托盘」时调用：只有开关打开才弹迷你播放器。
pub fn show_on_tray_hide(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_window_operation(move || {
            if !crate::config::load_settings(&app)?.mini_player_enabled {
                return Ok(());
            }
            show_while_main_hidden(|| main_window_visible(&app), || show(&app), || hide(&app))
        })
        .await;
        if let Err(err) = result {
            tauri_plugin_log::log::warn!("[mini-player] {}", err);
        }
    });
}

fn show_while_main_hidden(
    main_visible: impl Fn() -> Result<bool, String>,
    show_mini: impl FnOnce() -> Result<(), String>,
    hide_mini: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if main_visible()? {
        return Ok(());
    }
    show_mini()?;
    // WebView 创建期间用户可能已从托盘恢复主窗口；以真实窗口状态收尾。
    if main_visible()? {
        hide_mini()?;
    }
    Ok(())
}

fn main_window_visible(app: &AppHandle) -> Result<bool, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?
        .is_visible()
        .map_err(|err| format!("读取主窗口可见状态失败: {}", err))
}

fn create(app: &AppHandle) -> Result<(), String> {
    let settings = crate::config::load_settings(app)?;
    let window =
        WebviewWindowBuilder::new(app, MINI_PLAYER_LABEL, mini_webview_url("#/mini-player")?)
            .title("AuralFlow 迷你播放器")
            .additional_browser_args(ADDITIONAL_BROWSER_ARGS)
            .inner_size(WIDTH, HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .build()
            .map_err(|e| format!("创建迷你播放器失败: {}", e))?;

    // 先挂监听再摆位置：位置恢复本身也会触发 Moved，这样「被夹回工作区」的结果
    // 也会落盘（否则每次启动都会按旧坐标重新夹一遍）。
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(position) = event {
            handle_moved(&handle, *position);
        }
    });

    window
        .show()
        .map_err(|e| format!("显示迷你播放器失败: {}", e))?;
    // 位置也要在 show() 之后落：窗口显示前设置的坐标会被系统按默认级联位置覆盖。
    restore_position(&window, settings.mini_player_x, settings.mini_player_y);

    // WebView2 在「先创建后显示」的窗口里，宿主子视图可能停在 0×0 不布局，
    // 表现就是一个空的透明窗口。show() 之后再显式落一次尺寸，强制它布局
    // （桌面歌词窗口也是这么做的）。
    window
        .set_size(LogicalSize::new(WIDTH, HEIGHT))
        .map_err(|e| format!("设置迷你播放器尺寸失败: {}", e))?;

    Ok(())
}

fn mini_webview_url(hash: &str) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let url = format!("http://localhost:1420/{}", hash)
            .parse()
            .map_err(|e| format!("解析迷你播放器 dev URL 失败: {}", e))?;
        Ok(WebviewUrl::External(url))
    }

    #[cfg(not(debug_assertions))]
    {
        Ok(WebviewUrl::App(format!("index.html{}", hash).into()))
    }
}

/// 上次的位置 → 夹回当前显示器工作区；没有记录就贴右下角。
fn restore_position(window: &WebviewWindow, saved_x: Option<f64>, saved_y: Option<f64>) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let area = work_area(window);
    let (x, y) = match (saved_x, saved_y) {
        (Some(x), Some(y)) => (
            clamp(x, area.left, area.right - width),
            clamp(y, area.top, area.bottom - height),
        ),
        _ => (
            area.right - width - EDGE_MARGIN,
            area.bottom - height - EDGE_MARGIN,
        ),
    };
    let _ = window.set_position(LogicalPosition::new(x, y));
}

#[derive(Debug, Clone, Copy)]
struct WorkArea {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

fn work_area(window: &WebviewWindow) -> WorkArea {
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(Some(monitor)) = window.current_monitor() {
        // 工作区已扣掉任务栏；拿不到就退回整块屏幕（吸附会贴到任务栏后面，但至少可见）。
        let rect = monitor.work_area();
        let x = rect.position.x as f64 / scale;
        let y = rect.position.y as f64 / scale;
        return WorkArea {
            left: x,
            top: y,
            right: x + rect.size.width as f64 / scale,
            bottom: y + rect.size.height as f64 / scale,
        };
    }
    WorkArea {
        left: 0.0,
        top: 0.0,
        right: 1920.0,
        bottom: 1080.0,
    }
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        min
    } else {
        value.min(max).max(min)
    }
}

fn handle_moved(app: &AppHandle, position: PhysicalPosition<i32>) {
    let Some(window) = app.get_webview_window(MINI_PLAYER_LABEL) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let mut x = position.x as f64 / scale;
    let mut y = position.y as f64 / scale;

    if let Ok(size) = window.outer_size() {
        let area = work_area(&window);
        let width = size.width as f64 / scale;
        let height = size.height as f64 / scale;
        let mut snapped = false;
        if (x - area.left).abs() < SNAP_DISTANCE {
            x = area.left + EDGE_MARGIN;
            snapped = true;
        } else if (area.right - (x + width)).abs() < SNAP_DISTANCE {
            x = area.right - width - EDGE_MARGIN;
            snapped = true;
        }
        if (y - area.top).abs() < SNAP_DISTANCE {
            y = area.top + EDGE_MARGIN;
            snapped = true;
        } else if (area.bottom - (y + height)).abs() < SNAP_DISTANCE {
            y = area.bottom - height - EDGE_MARGIN;
            snapped = true;
        }
        // 吸附本身会再触发一次 Moved：只有真的偏离目标超过半像素才回写，避免自激。
        if snapped
            && ((x - position.x as f64 / scale).abs() > 0.5
                || (y - position.y as f64 / scale).abs() > 0.5)
        {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
    }

    schedule_persist(app, x, y);
}

/// 拖动中每帧都会来一次 Moved：攒 400ms 不再动才落盘，避免把配置写爆。
fn schedule_persist(app: &AppHandle, x: f64, y: f64) {
    if let Ok(mut slot) = LAST_POSITION.lock() {
        *slot = Some((x, y));
    }
    PERSIST_GENERATION.fetch_add(1, Ordering::SeqCst);
    if PERSIST_THREAD_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || loop {
        let generation = PERSIST_GENERATION.load(Ordering::SeqCst);
        std::thread::sleep(std::time::Duration::from_millis(PERSIST_DEBOUNCE_MS));
        if PERSIST_GENERATION.load(Ordering::SeqCst) != generation {
            continue;
        }
        let position = LAST_POSITION.lock().ok().and_then(|slot| *slot);
        if let Some((x, y)) = position {
            let _ = crate::config::patch_settings(
                &handle,
                serde_json::json!({ "miniPlayerX": x, "miniPlayerY": y }),
            );
        }
        PERSIST_THREAD_RUNNING.store(false, Ordering::SeqCst);
        return;
    });
}

/// 右键弹出原生菜单（窗口太矮，HTML 菜单会被边界裁掉）。
pub fn show_context_menu(app: &AppHandle) -> Result<(), String> {
    use tauri::menu::{ContextMenu, Menu, MenuItem};

    // 原生弹出菜单要的是 Window（WebviewWindow 通过宿主 Webview 取）。
    let window = app
        .get_webview_window(MINI_PLAYER_LABEL)
        .ok_or_else(|| "迷你播放器未打开".to_string())?
        .as_ref()
        .window();
    let show_main = MenuItem::with_id(app, "mini-show-main", "显示主窗口", true, None::<&str>)
        .map_err(|e| format!("创建菜单项失败: {}", e))?;
    let hide_mini = MenuItem::with_id(app, "mini-hide", "关闭迷你播放器", true, None::<&str>)
        .map_err(|e| format!("创建菜单项失败: {}", e))?;
    let quit = MenuItem::with_id(app, "mini-quit", "退出 AuralFlow", true, None::<&str>)
        .map_err(|e| format!("创建菜单项失败: {}", e))?;
    let menu = Menu::with_items(app, &[&show_main, &hide_mini, &quit])
        .map_err(|e| format!("创建迷你播放器菜单失败: {}", e))?;
    menu.popup(window)
        .map_err(|e| format!("弹出迷你播放器菜单失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_show_does_not_reopen_mini_after_main_is_restored() {
        show_while_main_hidden(
            || Ok(true),
            || panic!("过期 show 不能执行"),
            || panic!("无需隐藏"),
        )
        .unwrap();
    }

    #[test]
    fn restoring_main_during_creation_hides_the_new_mini() {
        let visible = std::cell::Cell::new(false);
        let hidden = std::cell::Cell::new(false);
        show_while_main_hidden(
            || Ok(visible.get()),
            || {
                visible.set(true);
                Ok(())
            },
            || {
                hidden.set(true);
                Ok(())
            },
        )
        .unwrap();
        assert!(hidden.get());
    }

    #[test]
    fn window_creation_operation_leaves_the_calling_thread() {
        let caller = std::thread::current().id();
        let worker =
            tauri::async_runtime::block_on(run_window_operation(
                || Ok(std::thread::current().id()),
            ))
            .unwrap();
        assert_ne!(caller, worker, "WebView 创建不能阻塞 IPC/事件所在线程");
    }
}
