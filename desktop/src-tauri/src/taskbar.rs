//! Windows 任务栏缩略图按钮与悬浮预览封面
//!
//! 目的：鼠标悬停任务栏图标时，缩略图上出现「上一首 / 播放暂停 / 下一首」三个按钮，
//! 并把默认的窗口快照预览换成当前曲目封面。
//!
//! 钩窗口过程只能用**子类化**（`SetWindowSubclass` + `DefSubclassProc`）：
//! 未处理的消息一律原样交给 `DefSubclassProc`，它会继续走子类链上的下一个处理者，
//! 最终回到 Tauri/tao 自己的窗口过程。**绝不用 `SetWindowLongPtrW` 替换窗口过程** ——
//! 那会掐断 Tauri 的消息处理，窗口基本功能会坏掉。
//!
//! 安全阀（见设置项「任务栏缩略图按钮与封面预览」，默认开）：关闭时**不安装任何钩子**
//! （不调用 `SetWindowSubclass`），已安装的则 `RemoveWindowSubclass` 卸掉、
//! 按钮用 `THBF_HIDDEN` 收起、DWM 属性复位，悬浮预览退回系统默认。
//!
//! 失败即降级：HWND 未就绪、消息注册失败、Win32/COM 调用报错 → `log::warn!` 后放弃本次操作，
//! 窗口基本功能与播放完全不受影响；所有 GDI/COM 对象在不再需要时释放，不留泄漏。
//!
//! 线程模型：COM 对象（`ITaskbarList3`）、图标、窗口句柄都只能在主线程用（存在 `thread_local`），
//! 因此所有需要它们的操作都排在 `AppHandle::run_on_main_thread` 上；封面解码走 IPC 线程
//! （磁盘 I/O 不占 UI 线程），只把像素数据交给主线程。

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::AppHandle;
use tauri_plugin_log::log;

/// `THBN_CLICKED`：任务栏缩略图按钮的点击通知码。
///
/// Windows SDK 里是 `THBN_FIRST` = `0x1800`（6144），但 `windows` crate 没有导出这个常量，
/// 所以这里按 SDK 定义写死；`WM_COMMAND` 的高 16 位就是它。
const THBN_CLICKED: u32 = 0x1800;

/// 反向控制事件名。前端 bridge 导出的同名常量必须与此一致。
const ACTION_EVENT: &str = "taskbar-action";

/// 缩略图按钮数量（上一首 / 播放暂停 / 下一首）。
pub const BUTTON_COUNT: usize = 3;

/// 字形数量：上一首 / 播放 / 暂停 / 下一首。
pub const GLYPH_COUNT: usize = 4;

/// 按钮图标边长（像素）。任务栏缩略图按钮按 16~24px 显示，32px 缩下去也清晰。
const ICON_SIZE: u32 = 32;

/// 封面像素的内存上限（最长边）：预览最大也就几百像素，留着原图只是白占内存。
pub const COVER_MAX_EDGE: u32 = 1024;

// ─── 纯函数层（不碰 Win32/COM，可单测） ─────────────────────────

/// 缩略图按钮能发的动作。前端映射到 `playerStore` 的既有动作，不新建状态机。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskbarAction {
    Previous,
    PlayPause,
    Next,
}

/// 按钮字形。播放 / 暂停是同一个按钮的两副面孔。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

impl Glyph {
    /// 字形在 `icons` 数组里的下标（与枚举声明顺序一致：上一首 / 播放 / 暂停 / 下一首）。
    pub fn index(&self) -> usize {
        *self as usize
    }
}

/// 三个按钮的动作顺序：**按钮 id 就是这个下标**（0 / 1 / 2）。
pub const BUTTON_ACTIONS: [TaskbarAction; BUTTON_COUNT] = [
    TaskbarAction::Previous,
    TaskbarAction::PlayPause,
    TaskbarAction::Next,
];

/// 动作在按钮栏里的下标（也就是按钮 id）。
pub fn action_index(action: TaskbarAction) -> usize {
    match action {
        TaskbarAction::Previous => 0,
        TaskbarAction::PlayPause => 1,
        TaskbarAction::Next => 2,
    }
}

/// 动作 → 按钮 id。
pub fn button_id(action: TaskbarAction) -> u32 {
    action_index(action) as u32
}

/// 按钮 id → 动作；别人的按钮（未知 id）返回 `None`。
pub fn action_for_button_id(id: u32) -> Option<TaskbarAction> {
    BUTTON_ACTIONS.get(id as usize).copied()
}

/// 动作 → 事件里的动作名（前端 bridge 的联合类型必须与此一致）。
pub fn action_name(action: TaskbarAction) -> &'static str {
    match action {
        TaskbarAction::Previous => "previous",
        TaskbarAction::PlayPause => "playPause",
        TaskbarAction::Next => "next",
    }
}

/// 播放状态 → 播放暂停按钮该画哪个图标。
///
/// `loading` 与 `playing` 一致按「可暂停」处理：切歌解析期间把图标翻成播放，
/// 用户会以为播放断了（与 smtc 的状态映射保持一致）。
pub fn play_pause_glyph(status: &str) -> Glyph {
    match status {
        "playing" | "loading" => Glyph::Pause,
        _ => Glyph::Play,
    }
}

/// 三个按钮各自该用的字形（顺序与 [`BUTTON_ACTIONS`] 一致）。
pub fn button_glyphs(status: &str) -> [Glyph; BUTTON_COUNT] {
    [
        Glyph::Previous,
        play_pause_glyph(status),
        Glyph::Next,
    ]
}

/// `WM_COMMAND` 的 wparam 解码：低 16 位是按钮 id，高 16 位是通知码。
///
/// 只有任务栏按钮的点击通知（`THBN_CLICKED` = 6144）才算我们的消息。
pub fn command_action(wparam: u32) -> Option<TaskbarAction> {
    if wparam >> 16 != THBN_CLICKED {
        return None;
    }
    action_for_button_id(wparam & 0xffff)
}

/// `WM_DWMSENDICONICTHUMBNAIL` 的 lparam：低 16 位是宽、高 16 位是高。
///
/// 系统偶尔会给 0（尺寸还没算出来），这里按 1 兜住，避免生成非法位图。
pub fn thumbnail_size(lparam: u32) -> (u32, u32) {
    ((lparam & 0xffff).max(1), (lparam >> 16).max(1))
}

/// 播放暂停按钮的提示文案（供真机核对用）。
pub fn play_pause_tooltip(status: &str) -> &'static str {
    match play_pause_glyph(status) {
        Glyph::Pause => "暂停",
        _ => "播放",
    }
}

/// 把封面限制到最长边之内（等比缩放，至少 1 像素）。
pub fn fit_within(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let longest = width.max(height);
    if longest <= max_edge {
        return (width, height);
    }
    let scaled_w = ((width as u64 * max_edge as u64) / longest as u64).max(1);
    let scaled_h = ((height as u64 * max_edge as u64) / longest as u64).max(1);
    (scaled_w as u32, scaled_h as u32)
}

/// 双线性缩放预乘 BGRA 像素。
///
/// 预乘 alpha 的数据直接做线性插值就是对的（颜色与 alpha 一起淡化），
/// 不需要先反预乘再插值。尺寸不合法 / 数据长度不匹配时返回 `None`。
pub fn scale_bgra(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Option<Vec<u8>> {
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return None;
    }
    if src.len() != src_w as usize * src_h as usize * 4 {
        return None;
    }
    if src_w == dst_w && src_h == dst_h {
        return Some(src.to_vec());
    }

    let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
    let max_x = (src_w - 1) as f32;
    let max_y = (src_h - 1) as f32;
    for y in 0..dst_h {
        // 目标像素中心映射回源坐标，再取相邻四个像素插值
        let src_y = (((y as f32 + 0.5) * src_h as f32 / dst_h as f32) - 0.5).clamp(0.0, max_y);
        let y0 = src_y.floor() as u32;
        let y1 = (y0 + 1).min(src_h - 1);
        let fy = src_y - y0 as f32;
        for x in 0..dst_w {
            let src_x = (((x as f32 + 0.5) * src_w as f32 / dst_w as f32) - 0.5).clamp(0.0, max_x);
            let x0 = src_x.floor() as u32;
            let x1 = (x0 + 1).min(src_w - 1);
            let fx = src_x - x0 as f32;

            let index = |px: u32, py: u32| (py as usize * src_w as usize + px as usize) * 4;
            let (tl, tr) = (index(x0, y0), index(x1, y0));
            let (bl, br) = (index(x0, y1), index(x1, y1));
            let out_index = (y as usize * dst_w as usize + x as usize) * 4;
            for channel in 0..4 {
                let top = src[tl + channel] as f32 * (1.0 - fx) + src[tr + channel] as f32 * fx;
                let bottom = src[bl + channel] as f32 * (1.0 - fx) + src[br + channel] as f32 * fx;
                out[out_index + channel] = (top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0)
                    as u8;
            }
        }
    }
    Some(out)
}

/// 字形颜色（BGRA）：浅灰，兼顾深色与浅色任务栏。
const GLYPH_COLOR: [u8; 3] = [0xE8, 0xE8, 0xE8];

/// 每个输出像素的采样倍率（抗锯齿用）。
const SUPERSAMPLE: u32 = 4;

/// 用纯 Rust 光栅化按钮图标 → 直通 alpha 的 BGRA 像素。
///
/// **按钮只画字形笔画，不铺底色**：除笔画覆盖到的像素外 alpha 全为 0，
/// 任务栏底色透过按钮显示，不会出现一块实心方块。
pub fn render_glyph(glyph: Glyph, size: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; size as usize * size as usize * 4];
    if size == 0 {
        return pixels;
    }
    let samples = (SUPERSAMPLE * SUPERSAMPLE) as f32;
    for y in 0..size {
        for x in 0..size {
            let mut hits = 0u32;
            for sub_y in 0..SUPERSAMPLE {
                for sub_x in 0..SUPERSAMPLE {
                    let px = (x as f32 + (sub_x as f32 + 0.5) / SUPERSAMPLE as f32) / size as f32;
                    let py = (y as f32 + (sub_y as f32 + 0.5) / SUPERSAMPLE as f32) / size as f32;
                    if glyph_hit(glyph, px, py) {
                        hits += 1;
                    }
                }
            }
            if hits == 0 {
                continue;
            }
            let index = (y as usize * size as usize + x as usize) * 4;
            pixels[index] = GLYPH_COLOR[0];
            pixels[index + 1] = GLYPH_COLOR[1];
            pixels[index + 2] = GLYPH_COLOR[2];
            pixels[index + 3] = (hits as f32 / samples * 255.0).round() as u8;
        }
    }
    pixels
}

/// 归一化坐标（0~1）是否落在字形笔画内。
fn glyph_hit(glyph: Glyph, x: f32, y: f32) -> bool {
    match glyph {
        // 上一首：左侧竖条 + 向左的三角形
        Glyph::Previous => {
            rect_hit(x, y, 0.28, 0.30, 0.38, 0.70)
                || tri_hit(x, y, (0.70, 0.30), (0.70, 0.70), (0.42, 0.50))
        }
        // 下一首：向右的三角形 + 右侧竖条
        Glyph::Next => {
            tri_hit(x, y, (0.30, 0.30), (0.30, 0.70), (0.58, 0.50))
                || rect_hit(x, y, 0.62, 0.30, 0.72, 0.70)
        }
        // 播放：向右的三角形
        Glyph::Play => tri_hit(x, y, (0.34, 0.28), (0.34, 0.72), (0.72, 0.50)),
        // 暂停：两根竖条
        Glyph::Pause => {
            rect_hit(x, y, 0.34, 0.28, 0.44, 0.72) || rect_hit(x, y, 0.56, 0.28, 0.66, 0.72)
        }
    }
}

/// 点是否在矩形内。
fn rect_hit(x: f32, y: f32, left: f32, top: f32, right: f32, bottom: f32) -> bool {
    x >= left && x <= right && y >= top && y <= bottom
}

/// 点是否在三角形内（重心符号测试）。
fn tri_hit(x: f32, y: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
    let edge = |p: (f32, f32), q: (f32, f32)| (p.0 - x) * (q.1 - y) - (q.0 - x) * (p.1 - y);
    let d1 = edge(a, b);
    let d2 = edge(b, c);
    let d3 = edge(c, a);
    let has_negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_negative && has_positive)
}

// ─── 对外载荷 ─────────────────────────────────────────────────

/// 推给任务栏的播放快照（由前端播放快照填充）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarTrack {
    /// `playerStore.status`：idle / loading / playing / paused / error
    pub status: String,
    /// 已落盘的封面文件路径（取自本地封面缓存）；None / 空串 = 这次没有封面
    pub cover_path: Option<String>,
}

/// 点击事件载荷（事件名与前端 bridge 的 `TASKBAR_ACTION_EVENT` 一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarActionEvent {
    /// previous / playPause / next
    pub action: String,
}

// ─── 跨线程共享状态 ────────────────────────────────────────────

/// 封面像素（预乘 BGRA）+ 尺寸。普通数据，主线程拿它造 DIB。
#[derive(Clone)]
struct Cover {
    pixels: Arc<Vec<u8>>,
    width: u32,
    height: u32,
}

struct Shared {
    /// 设置开关「任务栏缩略图按钮与封面预览」
    enabled: bool,
    /// 最近一次的播放状态（决定播放暂停按钮的图标）
    status: String,
    /// 已解码的封面路径；与上一次相同就不重复解码
    cover_path: Option<String>,
    /// 当前封面像素；None = 没有封面，预览保持系统默认
    cover: Option<Cover>,
}

/// 跨线程共享的普通数据（开关 + 播放快照 + 封面像素）。
/// 主线程独占的 COM / GDI 对象不放在这里，见 `platform::HOOK`。
static SHARED: Mutex<Shared> = Mutex::new(Shared {
    enabled: false,
    status: String::new(),
    cover_path: None,
    cover: None,
});

/// 取共享状态锁。锁只保护普通数据，中毒后数据仍然有意义，沿用内部值继续工作。
fn shared() -> MutexGuard<'static, Shared> {
    SHARED.lock().unwrap_or_else(|err| err.into_inner())
}

/// 把操作排到主线程执行；调度失败只记日志 —— 任务栏按钮是附加能力，不能反过来影响播放。
fn run_on_main<F: FnOnce(AppHandle) + Send + 'static>(app: &AppHandle, task: F) {
    let handle = app.clone();
    if let Err(err) = app.run_on_main_thread(move || task(handle)) {
        log::warn!("[taskbar] 主线程调度失败: {}", err);
    }
}

// ─── 对外的三个入口 ────────────────────────────────────────────

/// 启动时调用一次：只做「登记窗口消息 + 建任务栏 COM 对象」的准备，**不安装钩子**。
///
/// 真正的子类化在设置项确认打开后才发生（见 [`set_enabled`]），
/// 这样「关闭」的用户在本次运行里根本碰不到窗口过程。
pub fn setup(app: &AppHandle) {
    run_on_main(app, |app| platform::prepare(&app));
}

/// 设置开关：启用 / 卸载任务栏缩略图按钮与封面预览。
///
/// 关闭 = 卸载子类化 + 收起按钮 + DWM 属性复位，窗口回到完全原生的行为。
pub fn set_enabled(app: &AppHandle, enabled: bool) {
    {
        let mut state = shared();
        state.enabled = enabled;
        if !enabled {
            // 关闭后不再持有封面像素：内存与「换歌才解码」的判断都从干净状态重新开始
            state.cover = None;
            state.cover_path = None;
        }
    }
    run_on_main(app, move |app| platform::apply_enabled(&app, enabled));
}

/// 推送播放状态 / 封面（切歌、暂停恢复、封面落盘后调用）。
pub fn update_track(app: &AppHandle, track: TaskbarTrack) {
    let cover_changed = {
        let mut state = shared();
        if !state.enabled {
            // 安全阀：关闭时连解码都不做
            return;
        }
        state.status = track.status.clone();
        let requested = track
            .cover_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty());
        if requested == state.cover_path.as_deref() {
            false
        } else {
            state.cover_path = requested.map(str::to_string);
            // 路径变了先丢掉旧像素：解码失败就是「这次没有封面」，不能拿着上一首的封面充数
            state.cover = None;
            true
        }
    };

    if cover_changed {
        // 磁盘 I/O 与图像解码留在当前线程（IPC 线程），不占主线程
        if let Some(path) = shared().cover_path.clone() {
            match platform::decode_cover(&path) {
                Ok(cover) => {
                    let mut state = shared();
                    // 期间用户可能关了开关：关了就不留像素，也谈不上预览
                    if state.enabled {
                        state.cover = Some(cover);
                    }
                }
                Err(err) => log::warn!(
                    "[taskbar] 封面不可用，悬浮预览保持系统默认: {} ({})",
                    path,
                    err
                ),
            }
        }
    }

    run_on_main(app, |app| platform::apply_track(&app));
}

// ─── Windows 实现 ─────────────────────────────────────────────

#[cfg(windows)]
mod platform {
    use super::*;
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{copy_nonoverlapping, null, null_mut};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{w, BOOL, IUnknown, PCWSTR};
    use windows::Win32::Foundation::{GENERIC_READ, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{
        DwmSetIconicLivePreviewBitmap, DwmSetIconicThumbnail, DwmSetWindowAttribute,
        DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
    };
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::Graphics::Imaging::{
        IWICImagingFactory, IWICPalette, CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA,
        WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom,
        WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Shell::{
        DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, TaskbarList, ITaskbarList3,
        THBF_ENABLED, THBF_HIDDEN, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, DestroyIcon, GetClientRect, RegisterWindowMessageW, HICON, ICONINFO,
        WM_COMMAND, WM_DESTROY, WM_DWMSENDICONICLIVEPREVIEWBITMAP, WM_DWMSENDICONICTHUMBNAIL,
    };

    /// 子类化 id：本模块只挂一份，卸载时按同一个 id 摘。
    const SUBCLASS_ID: usize = 0x4154;


    /// 主线程独占状态：COM 对象、GDI 图标、窗口句柄都不能跨线程。
    struct Hook {
        app: AppHandle,
        hwnd: HWND,
        /// "TaskbarButtonCreated" 的消息 id；0 = 尚未注册 / 注册失败
        taskbar_message: u32,
        /// 失败即为 None，所有按钮操作自动退化成 no-op
        list: Option<ITaskbarList3>,
        /// 四个字形各自的 HICON（按 [`Glyph`] 顺序）；缓存在这里统一释放
        icons: Option<[HICON; GLYPH_COUNT]>,
        /// 是否已经装上子类化钩子（= 安全阀打开）
        installed: bool,
        /// 已经应用到按钮上的播放状态，避免同一状态重复更新
        applied_status: String,
        /// 已用于 DWM 预览的封面路径，避免重复重建位图
        applied_cover_path: Option<String>,
        /// DWM 最近一次要过的缩略图尺寸：换封面时按它主动重推一张
        thumb_size: Option<(u32, u32)>,
    }

    impl Hook {
        fn new(app: AppHandle, hwnd: HWND) -> Self {
            Self {
                app,
                hwnd,
                taskbar_message: 0,
                list: None,
                icons: None,
                installed: false,
                applied_status: String::new(),
                applied_cover_path: None,
                thumb_size: None,
            }
        }
    }

    thread_local! {
        /// 主线程独占状态。窗口消息在触发它的线程上派发，因此窗口过程里也能直接取到。
        static HOOK: RefCell<Option<Hook>> = const { RefCell::new(None) };
    }

    /// 借出主线程状态；正在被借出（重入）或还没建立时返回 `None`，调用方按「什么都不做」处理。
    fn with_hook<R>(task: impl FnOnce(&mut Hook) -> R) -> Option<R> {
        HOOK.with(|slot| match slot.try_borrow_mut() {
            Ok(mut guard) => guard.as_mut().map(task),
            Err(_) => None,
        })
    }

    /// windows crate 的错误不带「哪一步失败」，这里补上上下文。
    fn step(what: &'static str) -> impl Fn(windows::core::Error) -> String {
        move |err| format!("{}: {}", what, err)
    }

    // ─── 准备 / 启用 / 卸载 ───────────────────────────────────

    /// 主线程：登记窗口消息并建好任务栏 COM 对象（**不安装钩子**）。
    pub fn prepare(app: &AppHandle) {
        let Some(hwnd) = main_window_hwnd(app) else {
            log::warn!("[taskbar] 主窗口句柄不可用，跳过任务栏缩略图准备");
            return;
        };
        HOOK.with(|slot| {
            let Ok(mut guard) = slot.try_borrow_mut() else {
                return;
            };
            let hook = guard.get_or_insert_with(|| Hook::new(app.clone(), hwnd));
            hook.hwnd = hwnd;
            if hook.taskbar_message == 0 {
                // 这条消息是「任务栏按钮就绪」的信号：建窗后与 explorer 重启后各会来一次，
                // 注册失败不致命（启用时会先直接挂一次按钮），只记日志。
                hook.taskbar_message = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
                if hook.taskbar_message == 0 {
                    log::warn!("[taskbar] 注册 TaskbarButtonCreated 消息失败，按钮只在启用时挂一次");
                }
            }
            if hook.list.is_none() {
                hook.list = create_taskbar_list();
            }
        });
    }

    /// 主线程：应用设置开关。
    pub fn apply_enabled(app: &AppHandle, enabled: bool) {
        if enabled {
            // 之前准备失败（窗口还没就绪等）时，这里再补一次
            prepare(app);
        }
        let applied = with_hook(|hook| {
            if enabled {
                install(hook);
            } else {
                uninstall(hook);
            }
        });
        if applied.is_none() && enabled {
            log::warn!("[taskbar] 主线程状态不可用，本次启用不生效");
        }
    }

    /// 装钩子：子类化 + DWM 属性 + 挂按钮（fail-soft，任一步失败都只记日志）。
    fn install(hook: &mut Hook) {
        if hook.installed {
            return;
        }
        // 只做子类化：未处理的消息全部原样交给 DefSubclassProc（继续走链条上原有的窗口过程）
        let ok = unsafe { SetWindowSubclass(hook.hwnd, Some(hook_proc), SUBCLASS_ID, 0) };
        if !ok.as_bool() {
            log::warn!("[taskbar] 子类化主窗口失败，本次不启用任务栏缩略图按钮");
            return;
        }
        hook.installed = true;
        apply_dwm_attributes(hook, true);
        // 任务栏按钮通常在建窗时就已就绪（那条消息早于本次启用），先直接挂一次；
        // 晚到的 TaskbarButtonCreated 消息会再补一次，explorer 重启后也靠它恢复。
        add_buttons(hook);
        log::info!("[taskbar] 已挂载任务栏缩略图按钮（子类化模式）");
    }

    /// 卸钩子：安全阀关闭时的逃生口。
    fn uninstall(hook: &mut Hook) {
        // ITaskbarList3 没有「移除按钮」的接口，只能用 THBF_HIDDEN 把按钮收起来
        if hook.installed {
            if let Some(buttons) = buttons_for(hook, true) {
                let list = hook.list.as_ref();
                if let Some(list) = list {
                    if let Err(err) = unsafe { list.ThumbBarUpdateButtons(hook.hwnd, &buttons) } {
                        log::warn!("[taskbar] 收起任务栏按钮失败: {}", err);
                    }
                }
            }
        }
        apply_dwm_attributes(hook, false);
        if hook.installed {
            // 返回值只表示「摘掉了没有」，此时已无补救手段：显式忽略（BOOL 是 must_use）
            let _ = unsafe { RemoveWindowSubclass(hook.hwnd, Some(hook_proc), SUBCLASS_ID) };
            hook.installed = false;
        }
        destroy_icons(hook);
        hook.thumb_size = None;
        hook.applied_cover_path = None;
        // 重新打开时按当时的播放状态重画一遍
        hook.applied_status.clear();
        log::info!("[taskbar] 已卸载任务栏钩子（按钮收起，悬浮预览退回系统默认）");
    }

    /// 主线程：播放状态 / 封面变化后刷新按钮图标与 DWM 预览位图。
    pub fn apply_track(app: &AppHandle) {
        if let Err(err) = sync_window(app) {
            log::warn!("[taskbar] 主窗口句柄不可用，本次刷新跳过: {}", err);
            return;
        }
        let (status, cover_path, cover) = {
            let state = shared();
            (state.status.clone(), state.cover_path.clone(), state.cover.clone())
        };
        with_hook(|hook| {
            if !hook.installed {
                return;
            }
            // 1) 播放状态 → 播放暂停按钮换图标
            if hook.applied_status != status {
                hook.applied_status = status.clone();
                if let Some(buttons) = buttons_for(hook, false) {
                    let list = hook.list.as_ref();
                    if let Some(list) = list {
                        if let Err(err) = unsafe { list.ThumbBarUpdateButtons(hook.hwnd, &buttons) } {
                            log::warn!("[taskbar] 更新任务栏按钮图标失败: {}", err);
                        }
                    }
                }
            }
            // 2) 封面换新 → 主动重推 DWM 位图（系统侧有缓存，等下次悬停可能还是旧封面）
            if hook.applied_cover_path != cover_path {
                hook.applied_cover_path = cover_path;
                if let Some(cover) = cover.as_ref() {
                    if let Some(size) = hook.thumb_size {
                        set_iconic_thumbnail(hook, cover, size);
                    }
                    set_live_preview(hook, cover);
                }
            }
        });
    }

    fn sync_window(app: &AppHandle) -> Result<(), String> {
        let hwnd = main_window_hwnd(app).ok_or_else(|| "窗口句柄不可用".to_string())?;
        HOOK.with(|slot| {
            if let Ok(mut guard) = slot.try_borrow_mut() {
                if let Some(hook) = guard.as_mut() {
                    hook.hwnd = hwnd;
                }
            }
        });
        Ok(())
    }

    /// 主窗口 HWND（与 smtc 同一取法：任务栏能力必须绑在真实窗口上）。
    fn main_window_hwnd(app: &AppHandle) -> Option<HWND> {
        let window = app.get_webview_window("main")?;
        let raw = window.hwnd().ok()?;
        Some(HWND(raw.0))
    }

    fn create_taskbar_list() -> Option<ITaskbarList3> {
        // COM 已由 WebView2/tao 在主线程初始化，这里不重复初始化
        let list: ITaskbarList3 = match unsafe {
            CoCreateInstance(&TaskbarList, None::<&IUnknown>, CLSCTX_INPROC_SERVER)
        } {
            Ok(list) => list,
            Err(err) => {
                log::warn!("[taskbar] 创建任务栏列表失败，本次不启用缩略图按钮: {}", err);
                return None;
            }
        };
        if let Err(err) = unsafe { list.HrInit() } {
            log::warn!("[taskbar] 初始化任务栏列表失败: {}", err);
            return None;
        }
        Some(list)
    }

    /// DWM 属性：让悬浮预览用我们的位图（而不是窗口快照）。
    ///
    /// `FORCE_ICONIC_REPRESENTATION` 让任务栏/预览走「图标式」表示，
    /// `HAS_ICONIC_BITMAP` 告诉 DWM 我们会提供位图；关闭时两个都复位。
    fn apply_dwm_attributes(hook: &Hook, on: bool) {
        let value = BOOL::from(on);
        for attribute in [DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP] {
            let result = unsafe {
                DwmSetWindowAttribute(
                    hook.hwnd,
                    attribute,
                    &value as *const BOOL as *const c_void,
                    size_of::<BOOL>() as u32,
                )
            };
            if let Err(err) = result {
                log::warn!(
                    "[taskbar] 设置 DWM 属性 {} 失败，悬浮预览保持系统默认: {}",
                    attribute.0,
                    err
                );
            }
        }
    }

    /// 挂按钮：图标拿不到 / 任务栏还没就绪都只记日志。
    fn add_buttons(hook: &mut Hook) {
        if hook.list.is_none() {
            log::warn!("[taskbar] 任务栏列表不可用，本次不添加按钮");
            return;
        }
        if let Err(err) = ensure_icons(hook) {
            log::warn!("[taskbar] 生成按钮图标失败，本次不添加任务栏按钮: {}", err);
            return;
        }
        let Some(buttons) = buttons_for(hook, false) else {
            return;
        };
        let list = hook.list.as_ref();
        if let Some(list) = list {
            if let Err(err) = unsafe { list.ThumbBarAddButtons(hook.hwnd, &buttons) } {
                // 任务栏按钮还没建好是正常情形：TaskbarButtonCreated 到了会再挂一次
                log::warn!(
                    "[taskbar] 添加任务栏缩略图按钮失败（等 TaskbarButtonCreated 再试）: {}",
                    err
                );
            }
        }
    }

    // ─── 图标 ─────────────────────────────────────────────────

    /// 四个字形一次性生成并缓存（数量固定，不会随切歌增长）。
    fn ensure_icons(hook: &mut Hook) -> Result<(), String> {
        if hook.icons.is_some() {
            return Ok(());
        }
        let glyphs = [
            Glyph::Previous,
            Glyph::Play,
            Glyph::Pause,
            Glyph::Next,
        ];
        let mut icons = [HICON(null_mut()); GLYPH_COUNT];
        let mut created = 0usize;
        for glyph in glyphs {
            match glyph_icon(glyph, ICON_SIZE) {
                Ok(icon) => {
                    icons[glyph.index()] = icon;
                    created += 1;
                }
                Err(err) => {
                    // 生成失败：把已经建好的图标全部释放，不留半套
                    for icon in icons.iter().take(created) {
                        let _ = unsafe { DestroyIcon(*icon) };
                    }
                    return Err(err);
                }
            }
        }
        hook.icons = Some(icons);
        Ok(())
    }

    fn destroy_icons(hook: &mut Hook) {
        if let Some(icons) = hook.icons.take() {
            for icon in icons {
                let _ = unsafe { DestroyIcon(icon) };
            }
        }
    }

    /// 字形像素 → HICON。
    ///
    /// 32bpp DIB（带 alpha，直通 alpha 不做预乘：图标合成按直通 alpha 解释）+ 全 0 掩码。
    /// `CreateIconIndirect` 要求一张掩码位图；全 0 即「不遮罩」，透明与否完全交给 alpha 通道。
    fn glyph_icon(glyph: Glyph, size: u32) -> Result<HICON, String> {
        let pixels = render_glyph(glyph, size);
        let color = dib_from_bgra(&pixels, size, size)?;
        // 1bpp 掩码：scan line 按 WORD 对齐，内容全 0
        let mask_bytes = (size as usize).div_ceil(16) * 2 * size as usize;
        let mask_bits = vec![0u8; mask_bytes];
        let mask = unsafe {
            CreateBitmap(
                size as i32,
                size as i32,
                1,
                1,
                Some(mask_bits.as_ptr() as *const c_void),
            )
        };
        if mask.0.is_null() {
            delete_bitmap(color);
            return Err("创建图标掩码失败".to_string());
        }

        let info = ICONINFO {
            fIcon: BOOL::from(true),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: color,
        };
        let icon = unsafe { CreateIconIndirect(&info) };
        // 图标已经复制了像素，两张位图随即释放（否则每次生成都漏两个 GDI 对象）
        delete_bitmap(mask);
        delete_bitmap(color);
        icon.map_err(step("创建按钮图标失败"))
    }

    // ─── 位图 ────────────────────────────────────────────────

    /// BGRA 像素 → 32bpp 自顶向下 DIB。
    ///
    /// DWM 的缩略图/预览位图与图标都要求 32bpp，高度取负值表示自上而下，
    /// 正好与我们的像素顺序一致，可以整块拷贝。
    fn dib_from_bgra(pixels: &[u8], width: u32, height: u32) -> Result<HBITMAP, String> {
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 || pixels.len() != expected {
            return Err("位图尺寸与像素数据不匹配".to_string());
        }
        let hdc = unsafe { CreateCompatibleDC(None) };
        if hdc.0.is_null() {
            return Err("创建内存 DC 失败".to_string());
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: expected as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = null_mut();
        let bitmap = unsafe {
            CreateDIBSection(Some(hdc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
        };
        let _ = unsafe { DeleteDC(hdc) };
        let bitmap = bitmap.map_err(step("创建位图失败"))?;
        if bits.is_null() {
            delete_bitmap(bitmap);
            return Err("位图像素地址为空".to_string());
        }
        unsafe { copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len()) };
        Ok(bitmap)
    }

    fn delete_bitmap(bitmap: HBITMAP) {
        let _ = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) };
    }

    /// 封面 → 指定尺寸的 DIB。
    fn cover_bitmap(cover: &Cover, size: (u32, u32)) -> Result<HBITMAP, String> {
        let pixels = scale_bgra(&cover.pixels, cover.width, cover.height, size.0, size.1)
            .ok_or_else(|| "封面缩放失败".to_string())?;
        dib_from_bgra(&pixels, size.0, size.1)
    }

    /// 把封面推给 DWM 当悬浮预览缩略图；成功返回 true（失败让调用方退回系统默认）。
    fn set_iconic_thumbnail(hook: &Hook, cover: &Cover, size: (u32, u32)) -> bool {
        match cover_bitmap(cover, size) {
            Ok(bitmap) => {
                // DwmSetIconicThumbnail 在调用时就取走像素（GDI 句柄不能跨进程），
                // 因此立刻释放位图，避免每次悬停都漏一个 GDI 对象。
                let result = unsafe { DwmSetIconicThumbnail(hook.hwnd, bitmap, 0) };
                delete_bitmap(bitmap);
                match result {
                    Ok(()) => true,
                    Err(err) => {
                        log::warn!(
                            "[taskbar] 设置悬浮预览缩略图失败，保持系统默认: {}",
                            err
                        );
                        false
                    }
                }
            }
            Err(err) => {
                log::warn!("[taskbar] 生成悬浮预览位图失败，保持系统默认: {}", err);
                false
            }
        }
    }

    /// 把封面推给 DWM 当预览大图（铺满客户区）；成功返回 true。
    fn set_live_preview(hook: &Hook, cover: &Cover) -> bool {
        let mut rect = RECT::default();
        if let Err(err) = unsafe { GetClientRect(hook.hwnd, &mut rect) } {
            log::warn!("[taskbar] 读取窗口客户区失败，本次不推预览大图: {}", err);
            return false;
        }
        let size = (
            (rect.right - rect.left).max(1) as u32,
            (rect.bottom - rect.top).max(1) as u32,
        );
        match cover_bitmap(cover, size) {
            Ok(bitmap) => {
                let result = unsafe { DwmSetIconicLivePreviewBitmap(hook.hwnd, bitmap, None, 0) };
                delete_bitmap(bitmap);
                match result {
                    Ok(()) => true,
                    Err(err) => {
                        log::warn!("[taskbar] 设置预览大图失败，保持系统默认: {}", err);
                        false
                    }
                }
            }
            Err(err) => {
                log::warn!("[taskbar] 生成预览大图失败，保持系统默认: {}", err);
                false
            }
        }
    }

    // ─── 按钮数组 ─────────────────────────────────────────────

    /// 组装三个按钮（id / 图标 / 提示 / 显隐）。
    fn buttons_for(hook: &Hook, hidden: bool) -> Option<[THUMBBUTTON; BUTTON_COUNT]> {
        let icons = hook.icons.as_ref()?;
        let glyphs = button_glyphs(&hook.applied_status);
        let mut buttons = [THUMBBUTTON::default(); BUTTON_COUNT];
        for (index, action) in BUTTON_ACTIONS.into_iter().enumerate() {
            let icon = icons.get(glyphs[index].index())?;
            let mut button = THUMBBUTTON::default();
            button.dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
            button.iId = button_id(action);
            button.hIcon = *icon;
            button.dwFlags = if hidden {
                THBF_HIDDEN
            } else {
                THBF_ENABLED
            };
            write_tooltip(&mut button.szTip, tooltip(action, &hook.applied_status));
            buttons[index] = button;
        }
        Some(buttons)
    }

    /// 按钮提示文案。
    fn tooltip(action: TaskbarAction, status: &str) -> &'static str {
        match action {
            TaskbarAction::Previous => "上一首",
            TaskbarAction::PlayPause => play_pause_tooltip(status),
            TaskbarAction::Next => "下一首",
        }
    }

    /// 把提示写进 `THUMBBUTTON::szTip`（定长 UTF-16，保持 NUL 结尾）。
    fn write_tooltip(dst: &mut [u16; 260], text: &str) {
        let mut written = 0;
        for unit in text.encode_utf16() {
            if written + 1 >= dst.len() {
                break;
            }
            dst[written] = unit;
            written += 1;
        }
    }

    // ─── 窗口过程（子类化） ────────────────────────────────────

    /// 子类过程：只拦我们关心的消息，其余原样交给 `DefSubclassProc`。
    ///
    /// 这里绝不 panic（跨 FFI）：所有消息处理都用 `Option` 兜住失败。
    unsafe extern "system" fn hook_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _ref_data: usize,
    ) -> LRESULT {
        match handle_message(message, wparam, lparam) {
            Some(result) => result,
            // 未处理（含任务栏/其他子类的消息）：交回链条上的下一个处理者
            None => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
        }
    }

    /// 处理我们关心的消息；`None` = 不处理，由调用方转给 `DefSubclassProc`。
    fn handle_message(message: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
        // 窗口消息在触发它的线程上派发：走到这里就是主线程
        if message == WM_COMMAND {
            let action = command_action(wparam.0 as u32)?;
            // 借出状态已经结束再派发事件：emit 可能触发重入
            emit_action(action);
            return Some(LRESULT(0));
        }

        let taskbar_message = with_hook(|hook| hook.taskbar_message).unwrap_or(0);
        if taskbar_message != 0 && message == taskbar_message {
            // 任务栏按钮就绪（建窗后 / explorer 重启后）：补挂按钮
            with_hook(add_buttons);
            return Some(LRESULT(0));
        }

        match message {
            WM_DWMSENDICONICTHUMBNAIL => {
                let size = thumbnail_size(lparam.0 as u32);
                // 先在锁外取出封面（Arc 克隆），拿锁时间极短
                let cover = shared().cover.clone()?;
                let handled = with_hook(|hook| {
                    hook.thumb_size = Some(size);
                    set_iconic_thumbnail(hook, &cover, size)
                })
                .unwrap_or(false);
                // 没画成功就不认领这条消息：交给 DefSubclassProc，让 DWM 用默认快照
                handled.then_some(LRESULT(0))
            }
            WM_DWMSENDICONICLIVEPREVIEWBITMAP => {
                let cover = shared().cover.clone()?;
                let handled = with_hook(|hook| set_live_preview(hook, &cover)).unwrap_or(false);
                handled.then_some(LRESULT(0))
            }
            WM_DESTROY => {
                // 窗口销毁前卸钩子并释放 GDI 对象；消息照常转发
                teardown();
                None
            }
            _ => None,
        }
    }

    /// 窗口销毁：卸载钩子、释放图标，状态整体丢掉。
    fn teardown() {
        HOOK.with(|slot| {
            let Ok(mut guard) = slot.try_borrow_mut() else {
                return;
            };
            if let Some(mut hook) = guard.take() {
                uninstall(&mut hook);
            }
        });
    }

    /// 点击 → Tauri 事件 → 前端转发给已有播放动作（Rust 侧不维护播放状态机）。
    fn emit_action(action: TaskbarAction) {
        let Some(app) = with_hook(|hook| hook.app.clone()) else {
            return;
        };
        let payload = TaskbarActionEvent {
            action: action_name(action).to_string(),
        };
        if let Err(err) = app.emit(ACTION_EVENT, payload) {
            log::warn!("[taskbar] 派发任务栏按钮动作失败: {}", err);
        }
    }

    // ─── 封面解码（在调用它的线程上跑） ─────────────────────────

    /// 工作线程上的 COM 初始化。`CoInitializeEx` 每次成功都会让引用计数 +1，
    /// 因此这里成对释放；`RPC_E_CHANGED_MODE`（套间模式冲突）不改变计数，也不去反初始化。
    struct ComGuard {
        balance: bool,
    }

    impl ComGuard {
        fn new() -> Self {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            Self { balance: hr.is_ok() }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.balance {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// 解码封面缓存文件 → 预乘 BGRA 像素。
    ///
    /// 只读已经落盘的本地封面缓存，**这条路径不下载任何东西**；
    /// 走 WIC（`Windows Imaging Component`）解码，PNG/JPEG 都能吃。
    pub fn decode_cover(path: &str) -> Result<Cover, String> {
        let _com = ComGuard::new();
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let factory: IWICImagingFactory = unsafe {
            CoCreateInstance(
                &CLSID_WICImagingFactory,
                None::<&IUnknown>,
                CLSCTX_INPROC_SERVER,
            )
        }
        .map_err(step("创建封面解码器失败"))?;
        let decoder = unsafe {
            factory.CreateDecoderFromFilename(
                PCWSTR(wide.as_ptr()),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
        }
        .map_err(step("打开封面文件失败"))?;
        let frame = unsafe { decoder.GetFrame(0) }.map_err(step("读取封面帧失败"))?;
        let converter = unsafe { factory.CreateFormatConverter() }
            .map_err(step("创建像素格式转换器失败"))?;
        unsafe {
            converter.Initialize(
                &*frame,
                &GUID_WICPixelFormat32bppPBGRA,
            WICBitmapDitherTypeNone,
                None::<&IWICPalette>,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
        }
        .map_err(step("转换封面像素格式失败"))?;

        let (mut width, mut height) = (0u32, 0u32);
        unsafe { converter.GetSize(&mut width, &mut height) }.map_err(step("读取封面尺寸失败"))?;
        if width == 0 || height == 0 {
            return Err("封面尺寸为空".to_string());
        }
        let (mut target_width, mut target_height) = fit_within(width, height, COVER_MAX_EDGE);

        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        unsafe { converter.CopyPixels(null(), width * 4, &mut pixels) }
            .map_err(step("读取封面像素失败"))?;

        if (target_width, target_height) != (width, height) {
            pixels = scale_bgra(&pixels, width, height, target_width, target_height)
                .ok_or_else(|| "封面缩放失败".to_string())?;
            width = target_width;
            height = target_height;
            // 只是为了让「缩放后尺寸」在编译期也被认为可能变化
            target_width = width;
            target_height = height;
        }
        let _ = (target_width, target_height);

        Ok(Cover {
            pixels: Arc::new(pixels),
            width,
            height,
        })
    }
}

// ─── 非 Windows 构建占位 ──────────────────────────────────────

#[cfg(not(windows))]
mod platform {
    //! 桌面端只面向 Windows。这里只保证非 Windows 构建仍可编译：
    //! 没有任务栏集成，入口全是 no-op。

    use super::*;

    pub fn prepare(_app: &AppHandle) {}
    pub fn apply_enabled(_app: &AppHandle, _enabled: bool) {}
    pub fn apply_track(_app: &AppHandle) {}
    pub fn decode_cover(_path: &str) -> Result<Cover, String> {
        Err("当前平台不支持任务栏封面预览".to_string())
    }
}

// ─── 单测（纯函数：不碰窗口、COM、GDI） ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_ids_round_trip() {
        // 按钮 id 就是按钮栏下标，前后端与窗口消息一起用，必须稳定
        assert_eq!(button_id(TaskbarAction::Previous), 0);
        assert_eq!(button_id(TaskbarAction::PlayPause), 1);
        assert_eq!(button_id(TaskbarAction::Next), 2);
        assert_eq!(
            action_for_button_id(0),
            Some(TaskbarAction::Previous)
        );
        assert_eq!(action_for_button_id(1), Some(TaskbarAction::PlayPause));
        assert_eq!(action_for_button_id(2), Some(TaskbarAction::Next));
        // 不是我们的按钮 id
        assert_eq!(action_for_button_id(3), None);
        assert_eq!(action_for_button_id(0xffff), None);
    }

    #[test]
    fn wm_command_only_accepts_our_clicked_buttons() {
        // THBN_CLICKED(6144) 在 wparam 高位，按钮 id 在低位
        assert_eq!(command_action(6144 << 16), Some(TaskbarAction::Previous));
        assert_eq!(command_action((6144 << 16) | 1), Some(TaskbarAction::PlayPause));
        assert_eq!(command_action((6144 << 16) | 2), Some(TaskbarAction::Next));
        // 通知码不对（例如菜单命令）不处理
        assert_eq!(command_action(2), None);
        // 通知码对但 id 不是我们的
        assert_eq!(command_action((6144 << 16) | 9), None);
    }

    #[test]
    fn action_names_match_frontend_contract() {
        assert_eq!(action_name(TaskbarAction::Previous), "previous");
        assert_eq!(action_name(TaskbarAction::PlayPause), "playPause");
        assert_eq!(action_name(TaskbarAction::Next), "next");
    }

    #[test]
    fn play_pause_glyph_follows_playback_status() {
        // 解析 / 缓冲期间保持「暂停」图标，避免切歌瞬间闪一下播放按钮
        assert_eq!(play_pause_glyph("playing"), Glyph::Pause);
        assert_eq!(play_pause_glyph("loading"), Glyph::Pause);
        assert_eq!(play_pause_glyph("paused"), Glyph::Play);
        assert_eq!(play_pause_glyph("idle"), Glyph::Play);
        assert_eq!(play_pause_glyph("error"), Glyph::Play);
        // 将来新增状态时保守处理：显示「播放」而不是假装在播
        assert_eq!(play_pause_glyph("something-new"), Glyph::Play);
        assert_eq!(play_pause_glyph(""), Glyph::Play);
        // 提示文案跟着图标走
        assert_eq!(play_pause_tooltip("playing"), "暂停");
        assert_eq!(play_pause_tooltip("paused"), "播放");
    }

    #[test]
    fn button_glyphs_keep_order_and_swap_middle() {
        assert_eq!(
            button_glyphs("playing"),
            [Glyph::Previous, Glyph::Pause, Glyph::Next]
        );
        assert_eq!(
            button_glyphs("paused"),
            [Glyph::Previous, Glyph::Play, Glyph::Next]
        );
    }

    #[test]
    fn thumbnail_size_parses_lparam_and_clamps_zero() {
        assert_eq!(thumbnail_size(0x0120_01E0), (0x01E0, 0x0120));
        // 系统给 0（尺寸还没算出来）按 1 兜住，避免生成非法位图
        assert_eq!(thumbnail_size(0), (1, 1));
    }

    #[test]
    fn glyphs_draw_strokes_without_filling_the_background() {
        let size = 32;
        for glyph in [Glyph::Previous, Glyph::Play, Glyph::Pause, Glyph::Next] {
            let pixels = render_glyph(glyph, size);
            assert_eq!(pixels.len(), (size * size * 4) as usize);

            // 四个角必须完全透明：按钮不做实心填充
            let corners = [(0usize, 0usize), (size as usize - 1, 0), (0, size as usize - 1), (size as usize - 1, size as usize - 1)];
            for (x, y) in corners {
                let alpha = pixels[(y * size as usize + x) * 4 + 3];
                assert_eq!(alpha, 0, "{:?} 的角落像素不该被填充", glyph);
            }

            // 但笔画本身要够实：中心区域存在接近不透明的像素
            let opaque = pixels
                .chunks_exact(4)
                .filter(|pixel| pixel[3] > 200)
                .count();
            assert!(opaque > 20, "{:?} 的字形笔画太少（{}）", glyph, opaque);
        }
    }

    #[test]
    fn glyphs_are_visually_distinct() {
        let play = render_glyph(Glyph::Play, 32);
        let pause = render_glyph(Glyph::Pause, 32);
        let previous = render_glyph(Glyph::Previous, 32);
        assert_ne!(play, pause);
        assert_ne!(play, previous);
        assert_ne!(pause, previous);
    }

    #[test]
    fn render_glyph_handles_zero_size() {
        assert!(render_glyph(Glyph::Play, 0).is_empty());
    }

    #[test]
    fn scale_bgra_rejects_bad_input() {
        let src = vec![0u8; 2 * 2 * 4];
        // 长度对不上
        assert!(scale_bgra(&src[..15], 2, 2, 1, 1).is_none());
        // 尺寸为 0
        assert!(scale_bgra(&src, 2, 2, 0, 1).is_none());
        assert!(scale_bgra(&src, 0, 2, 1, 1).is_none());
    }

    #[test]
    fn scale_bgra_averages_and_keeps_size() {
        // 2x2 → 1x1：四个像素的平均值
        let src = vec![
            0, 0, 0, 0, //
            4, 8, 12, 16, //
            8, 16, 24, 32, //
            12, 24, 36, 48,
        ];
        let scaled = scale_bgra(&src, 2, 2, 1, 1).expect("缩放应当成功");
        assert_eq!(scaled, vec![6, 12, 18, 24]);

        // 尺寸不变时原样返回
        let same = scale_bgra(&src, 2, 2, 2, 2).expect("缩放应当成功");
        assert_eq!(same, src);
    }

    #[test]
    fn fit_within_caps_the_longest_edge() {
        assert_eq!(fit_within(500, 400, 1024), (500, 400));
        assert_eq!(fit_within(2048, 1024, 1024), (1024, 512));
        assert_eq!(fit_within(1024, 2048, 1024), (512, 1024));
        // 极小图至少 1 像素
        assert_eq!(fit_within(3000, 1, 1024), (1024, 1));
        assert_eq!(fit_within(0, 0, 1024), (1, 1));
    }
}
