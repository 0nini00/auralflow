//! Windows 系统媒体控制（SMTC）
//!
//! 目的：键盘媒体键、系统媒体浮层（音量键那块）与锁屏 / 蓝牙耳机控制能操作 AuralFlow，
//! 并在系统侧显示当前曲目与封面。
//!
//! 关键判断：Windows 8.1 起多媒体键（VK_MEDIA_*）由系统直接交给「当前 SMTC 会话」，
//! 所以拿到 SMTC 会话就等于拿到媒体键 —— 不需要 global-shortcut 插件。
//!
//! 线程模型：`SystemMediaTransportControls` 由
//! `ISystemMediaTransportControlsInterop::GetForWindow(主窗口 HWND)` 创建，必须绑在
//! **拥有窗口的主线程**上，因此所有会话操作都排在 `AppHandle::run_on_main_thread` 上执行。
//!
//! 失败即降级：初始化失败 / 单次推送失败都只写 `warn` 日志后返回，
//! 播放本身不受任何影响，绝不 panic、绝不阻断启动。

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;
use tauri::AppHandle;
use tauri_plugin_log::log;

/// 进度推送节流窗口（毫秒）。
///
/// 系统媒体浮层上的进度条不需要逐帧对齐，500ms 一次已经足够顺滑；
/// 更密只会把主线程的消息队列灌满（每次推送都是一次主线程调度）。
pub const PROGRESS_THROTTLE_MS: u64 = 500;

/// 一秒 10 000 000 拍（WinRT `TimeSpan` 以 100ns 为一拍）。
const TICKS_PER_SECOND: f64 = 10_000_000.0;

/// 时间轴上限（秒）：再大就无法用 i64 表示拍数（约 292 年）。
const MAX_TIMELINE_SECONDS: f64 = (i64::MAX / 10_000_000) as f64;

// ─── 纯函数层（不碰 COM，可单测） ─────────────────────────────

/// SMTC 会话状态。只保留我们真会推的三种：
/// `Closed`（会话关闭）由设置开关负责，`Changing`（过渡态）对用户没有意义。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtcStatus {
    Playing,
    Paused,
    Stopped,
}

/// 前端 `playerStore.status` → SMTC 会话状态。
///
/// `loading` 归入 `Playing`：切歌解析期间把系统浮层翻成「暂停」，用户会以为播放断了。
/// `idle` / `error` / 未知状态一律 `Stopped`（浮层停止走时）。
pub fn session_status(playback_status: &str) -> SmtcStatus {
    match playback_status {
        "playing" | "loading" => SmtcStatus::Playing,
        "paused" => SmtcStatus::Paused,
        _ => SmtcStatus::Stopped,
    }
}

/// 进度推送节流判定。
///
/// `last_ms` = 上次推送时刻（进程启动后的毫秒），`None` = 从未推送。
/// 时间戳倒退时放行：宁可多推一次，也不要因为一次异常让进度永久推不出去。
pub fn should_push_progress(last_ms: Option<u64>, now_ms: u64) -> bool {
    match last_ms {
        None => true,
        Some(last) => now_ms < last || now_ms - last >= PROGRESS_THROTTLE_MS,
    }
}

/// 秒 → WinRT `TimeSpan` 拍数。
///
/// 负数 / NaN / 无穷按 0 处理，超大值夹到时间轴上限：
/// 非法时长送进系统时间轴会让浮层显示成乱码时间。
pub fn seconds_to_ticks(seconds: f64) -> i64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds.min(MAX_TIMELINE_SECONDS) * TICKS_PER_SECOND).round() as i64
}

/// 系统拖动进度条请求的位置（拍数）→ 可用的秒数；无法使用时返回 `None`。
///
/// 拖动时系统可能给出越界值，所以按总时长夹住；总时长未知（0 / NaN）时判断不了
/// 目标是否合法，直接忽略这次请求，避免把播放位置拖到错误的地方。
pub fn sanitize_seek_seconds(requested_ticks: i64, duration_seconds: f64) -> Option<f64> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return None;
    }
    let seconds = requested_ticks as f64 / TICKS_PER_SECOND;
    if !seconds.is_finite() {
        return None;
    }
    Some(seconds.clamp(0.0, duration_seconds))
}

/// 总时长取值：非有限值 / 非正值一律当作「未知」（0）。
fn sane_duration(duration: f64) -> f64 {
    if duration.is_finite() && duration > 0.0 {
        duration
    } else {
        0.0
    }
}

// ─── 对外载荷 ─────────────────────────────────────────────

/// 推给系统的曲目信息（由前端播放快照填充）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtcTrack {
    /// `playerStore.status`：idle / loading / playing / paused / error
    pub status: String,
    /// 空标题表示没有当前曲目（停止 / 清空队列），系统侧一并清空
    pub title: String,
    pub artist: String,
    pub album: String,
    /// 总时长（秒）
    pub duration: f64,
    /// 当前播放位置（秒）
    pub position: f64,
    /// 已落盘的封面文件路径（取自本地封面缓存）；None / 空串 = 本次只更新文字
    pub cover_path: Option<String>,
}

/// 反向控制事件载荷（事件名与前端 bridge 里的 `SMTC_ACTION_EVENT` 一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmtcActionEvent {
    /// play / pause / stop / next / previous / seek
    pub action: String,
    /// seek 目标位置（秒）；其余动作不带该字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
}

// ─── 会话状态（跨线程可用的普通数据） ─────────────────────────

/// 只放可跨线程普通数据；COM 会话对象在 `platform` 里单独持有。
struct SessionState {
    /// 设置开关「跟随系统媒体控制」
    enabled: bool,
    /// 上次推送播放进度的时刻（进程启动后的毫秒）
    last_progress_ms: Option<u64>,
    /// 已推给系统的封面路径：相同就不再重写一遍内存流
    pushed_cover_path: Option<String>,
    /// 最近一次推给系统的总时长（秒），系统拖动进度条时按它夹住目标位置
    duration_seconds: f64,
}

impl SessionState {
    const fn new() -> Self {
        Self {
            enabled: false,
            last_progress_ms: None,
            pushed_cover_path: None,
            duration_seconds: 0.0,
        }
    }
}

static STATE: Mutex<SessionState> = Mutex::new(SessionState::new());

/// 取会话状态锁。锁只保护几个标量，中毒后数据仍然有意义，沿用内部值继续工作。
fn state() -> MutexGuard<'static, SessionState> {
    STATE.lock().unwrap_or_else(|err| err.into_inner())
}

/// 进程启动后的单调毫秒数（节流用，不受系统时间调整影响）。
fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// 把会话操作排到主线程执行；调度失败只记日志 —— SMTC 是附加能力，不能反过来影响播放。
///
/// 闭包拿到的是 `AppHandle` 的所有权（调用方自己那份不能被借走后再移动）。
fn run_on_main<F: FnOnce(AppHandle) + Send + 'static>(app: &AppHandle, task: F) {
    let handle = app.clone();
    if let Err(err) = app.run_on_main_thread(move || task(handle)) {
        log::warn!("[smtc] 主线程调度失败: {}", err);
    }
}

// ─── 对外的三个入口 ─────────────────────────────────────────

/// 启动时调用一次：把会话初始化排到主线程（fail-soft，失败只留日志）。
pub fn setup(app: &AppHandle) {
    run_on_main(app, |app| platform::init(&app));
}

/// 设置开关：启用 / 释放系统媒体控制会话。
///
/// 关闭后清空系统侧显示并禁用会话，媒体键交还系统（其他播放器可重新接管）。
pub fn set_enabled(app: &AppHandle, enabled: bool) {
    {
        let mut state = state();
        state.enabled = enabled;
        if !enabled {
            // 重新打开时按当时的曲目从头推一遍，残留的节流/去重状态一并清掉
            state.last_progress_ms = None;
            state.pushed_cover_path = None;
        }
    }
    run_on_main(app, move |app| platform::apply_enabled(&app, enabled));
}

/// 推送曲目 / 播放状态（切歌、暂停恢复、seek 之后调用）。
pub fn update_track(app: &AppHandle, track: SmtcTrack) {
    // 封面字节在主线程外读：磁盘 I/O 不该占着 UI 线程
    let cover_bytes = {
        let mut state = state();
        if !state.enabled {
            return;
        }
        // 本次推送已经带上位置与时长，进度节流从此刻重新计时
        state.last_progress_ms = Some(now_ms());
        state.duration_seconds = sane_duration(track.duration);
        take_cover_bytes(&mut state, track.cover_path.as_deref())
    };
    run_on_main(app, move |_app| platform::push_track(&track, cover_bytes.as_deref()));
}

/// 推送播放进度。Rust 侧按 [`PROGRESS_THROTTLE_MS`] 节流，前端照常全量推即可。
pub fn update_progress(app: &AppHandle, position: f64, duration: f64) {
    let now = now_ms();
    {
        let mut state = state();
        if !state.enabled || !should_push_progress(state.last_progress_ms, now) {
            return;
        }
        state.last_progress_ms = Some(now);
        state.duration_seconds = sane_duration(duration);
    }
    run_on_main(app, move |_app| platform::push_progress(position, duration));
}

/// 判断本次是否需要重推封面，需要就把字节读出来。
///
/// 返回 `None` 表示「本次不带封面」：可能是封面路径与上次相同（已经推过），
/// 也可能是文件读不到 —— 读不到就只更新文字，这条路径不下载任何东西。
fn take_cover_bytes(state: &mut SessionState, cover_path: Option<&str>) -> Option<Vec<u8>> {
    let requested = cover_path
        .map(str::trim)
        .filter(|path| !path.is_empty());
    if requested == state.pushed_cover_path.as_deref() {
        return None;
    }

    let bytes = requested.and_then(read_cover_bytes);
    // 读失败的路径不记为「已推送」，下次曲目更新还有机会补上
    state.pushed_cover_path = if bytes.is_some() {
        requested.map(str::to_string)
    } else {
        None
    };
    bytes
}

/// 读取封面缓存文件。封面缺失 / 为空 / 读不动都只是「这次没有封面」。
fn read_cover_bytes(path: &str) -> Option<Vec<u8>> {
    match std::fs::read(path) {
        Ok(bytes) if !bytes.is_empty() => Some(bytes),
        Ok(_) => {
            log::warn!("[smtc] 封面文件为空，本次只更新文字: {}", path);
            None
        }
        Err(err) => {
            log::warn!("[smtc] 读取封面失败，本次只更新文字: {} ({})", path, err);
            None
        }
    }
}

// ─── Windows 实现 ─────────────────────────────────────────

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{Error as WinError, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::Streams::{
        DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::{
        ISystemMediaTransportControlsInterop, RoGetActivationFactory,
    };

    /// 反向控制事件名。前端 bridge 导出的同名常量必须与此一致。
    const ACTION_EVENT: &str = "smtc-action";

    /// WinRT 运行时类名（SMTC 的激活工厂入口）。
    const CONTROLS_CLASS: &str = "Windows.Media.SystemMediaTransportControls";

    /// 等待封面写入内存流的上限。
    ///
    /// 内存流写入正常在微秒级完成，超时说明 WinRT 侧出了问题：
    /// 宁可这次没有封面，也绝不能把主线程挂在这里。
    const COVER_STORE_TIMEOUT: Duration = Duration::from_millis(200);

    /// 当前 SMTC 会话。
    ///
    /// 会话在进程生命周期内只创建一次（开关走 `SetIsEnabled`，不销毁会话），
    /// 因此不需要保存事件 token：控件析构时处理器随之释放。
    struct Session {
        controls: SystemMediaTransportControls,
    }

    /// 初始化失败时保持 `None`，所有推送入口自动退化成 no-op。
    static SESSION: Mutex<Option<Session>> = Mutex::new(None);

    fn session() -> MutexGuard<'static, Option<Session>> {
        SESSION.lock().unwrap_or_else(|err| err.into_inner())
    }

    /// windows crate 的错误不带「哪一步失败」，这里补上上下文。
    fn step(what: &'static str) -> impl Fn(WinError) -> String {
        move |err| format!("{}: {}", what, err)
    }

    /// 初始化会话（必须主线程 + 有 HWND；失败只记日志）。
    ///
    /// 会话建好先按「关闭」起手，等设置开关确认后再亮：
    /// 先亮会让「已关闭跟随系统媒体控制」的用户在启动瞬间被抢走媒体键。
    pub fn init(app: &AppHandle) {
        let mut guard = session();
        if guard.is_some() {
            return;
        }
        let Some(hwnd) = main_window_hwnd(app) else {
            log::warn!("[smtc] 主窗口句柄不可用，跳过系统媒体控制初始化");
            return;
        };

        match create_session(hwnd, app) {
            Ok(session) => {
                *guard = Some(session);
                log::info!("[smtc] 已接管系统媒体控制（媒体键 / 系统浮层 / 锁屏控制）");
            }
            Err(err) => log::warn!("[smtc] 初始化失败，本次运行不接管系统媒体控制: {}", err),
        }
    }

    /// 主线程：应用「跟随系统媒体控制」开关。
    pub fn apply_enabled(app: &AppHandle, enabled: bool) {
        if enabled {
            // 之前初始化失败（窗口还没就绪等）时，这里再补一次
            init(app);
        }

        let guard = session();
        let Some(session) = guard.as_ref() else {
            if enabled {
                log::warn!("[smtc] 会话不可用，本次启用不生效");
            }
            return;
        };

        let result = if enabled {
            session.controls.SetIsEnabled(true)
        } else {
            session
                .controls
                .DisplayUpdater()
                .and_then(|updater| updater.ClearAll())
                .and_then(|_| session.controls.SetIsEnabled(false))
        };
        if let Err(err) = result {
            log::warn!(
                "[smtc] {}系统媒体控制失败: {}",
                if enabled { "启用" } else { "释放" },
                err
            );
        }
    }

    /// 主线程：把曲目 / 播放状态 / 封面推给系统。
    pub fn push_track(track: &SmtcTrack, cover: Option<&[u8]>) {
        let guard = session();
        let Some(session) = guard.as_ref() else {
            return;
        };
        if let Err(err) = apply_track(&session.controls, track, cover) {
            log::warn!("[smtc] 更新系统媒体信息失败: {}", err);
        }
    }

    /// 主线程：更新系统侧时间轴（浮层进度条 / 剩余时间）。
    pub fn push_progress(position: f64, duration: f64) {
        let guard = session();
        let Some(session) = guard.as_ref() else {
            return;
        };
        if let Err(err) = apply_timeline(&session.controls, position, duration) {
            log::warn!("[smtc] 更新系统媒体进度失败: {}", err);
        }
    }

    /// 主窗口 HWND。SMTC 会话必须绑定一个真实窗口，系统才知道媒体键归属哪个应用。
    fn main_window_hwnd(app: &AppHandle) -> Option<isize> {
        let window = app.get_webview_window("main")?;
        let hwnd = window.hwnd().ok()?;
        Some(hwnd.0 as isize)
    }

    fn create_session(hwnd: isize, app: &AppHandle) -> Result<Session, String> {
        // 只有 WinRT 互操作入口是 unsafe；会话方法本身在 windows crate 里是安全封装。
        let interop: ISystemMediaTransportControlsInterop =
            unsafe { RoGetActivationFactory(&HSTRING::from(CONTROLS_CLASS)) }
                .map_err(step("获取 SMTC 工厂失败"))?;
        let controls: SystemMediaTransportControls =
            unsafe { interop.GetForWindow(HWND(hwnd as *mut core::ffi::c_void)) }
                .map_err(step("把 SMTC 会话绑定到主窗口失败"))?;

        controls
            .SetIsEnabled(false)
            .map_err(step("初始化禁用会话失败"))?;
        controls
            .SetIsPlayEnabled(true)
            .map_err(step("启用播放按钮失败"))?;
        controls
            .SetIsPauseEnabled(true)
            .map_err(step("启用暂停按钮失败"))?;
        controls
            .SetIsStopEnabled(true)
            .map_err(step("启用停止按钮失败"))?;
        controls
            .SetIsNextEnabled(true)
            .map_err(step("启用下一首按钮失败"))?;
        controls
            .SetIsPreviousEnabled(true)
            .map_err(step("启用上一首按钮失败"))?;

        let button_app = app.clone();
        let button_handler = TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_sender, args| {
            let Some(args) = args.as_ref() else {
                log::warn!("[smtc] 媒体按钮事件参数为空，忽略本次按键");
                return Ok(());
            };
            if let Some(action) = button_action(args) {
                emit_action(&button_app, action, None);
            }
            Ok(())
        });
        let button_token = controls
            .ButtonPressed(&button_handler)
            .map_err(step("订阅媒体按钮失败"))?;

        let seek_app = app.clone();
        let position_handler = TypedEventHandler::<
            SystemMediaTransportControls,
            PlaybackPositionChangeRequestedEventArgs,
        >::new(move |_sender, args| {
            let Some(args) = args.as_ref() else {
                log::warn!("[smtc] 进度拖动事件参数为空，忽略本次请求");
                return Ok(());
            };
            match args.RequestedPlaybackPosition() {
                // 目标位置按最近一次已知总时长夹住；总时长未知时忽略这次拖动
                Ok(ticks) => match sanitize_seek_seconds(ticks.Duration, state().duration_seconds) {
                    Some(seconds) => emit_action(&seek_app, "seek", Some(seconds)),
                    None => log::warn!(
                        "[smtc] 忽略本次进度拖动请求（总时长未知）: {} 拍",
                        ticks.Duration
                    ),
                },
                Err(err) => log::warn!("[smtc] 读取拖动目标位置失败，忽略本次请求: {}", err),
            }
            Ok(())
        });
        if let Err(err) = controls.PlaybackPositionChangeRequested(&position_handler) {
            // 订阅失败就摘掉上面的按钮处理器，别留下半截会话
            let _ = controls.RemoveButtonPressed(button_token);
            return Err(format!("订阅进度拖动失败: {}", err));
        }

        Ok(Session { controls })
    }

    /// 系统按钮 → 前端动作名；未接线的按钮（录制 / 快进 / 快退 / 频道切换）返回 `None`。
    fn button_action(
        args: &SystemMediaTransportControlsButtonPressedEventArgs,
    ) -> Option<&'static str> {
        let button = match args.Button() {
            Ok(button) => button,
            Err(err) => {
                log::warn!("[smtc] 读取媒体按钮失败，忽略本次按键: {}", err);
                return None;
            }
        };
        match button {
            SystemMediaTransportControlsButton::Play => Some("play"),
            SystemMediaTransportControlsButton::Pause => Some("pause"),
            SystemMediaTransportControlsButton::Stop => Some("stop"),
            SystemMediaTransportControlsButton::Next => Some("next"),
            SystemMediaTransportControlsButton::Previous => Some("previous"),
            _ => None,
        }
    }

    /// 把系统侧动作回传前端（播放状态始终归前端管，这里只转发）。
    fn emit_action(app: &AppHandle, action: &str, position: Option<f64>) {
        let payload = SmtcActionEvent {
            action: action.to_string(),
            position,
        };
        if let Err(err) = app.emit(ACTION_EVENT, payload) {
            log::warn!("[smtc] 派发系统媒体动作失败: {}", err);
        }
    }

    fn apply_track(
        controls: &SystemMediaTransportControls,
        track: &SmtcTrack,
        cover: Option<&[u8]>,
    ) -> Result<(), String> {
        let title = track.title.trim();
        let updater = controls.DisplayUpdater().map_err(step("取系统媒体信息失败"))?;

        if title.is_empty() {
            // 没有当前曲目（停止 / 清空队列）：系统侧文字与封面一起清掉
            updater
                .ClearAll()
                .map_err(step("清空系统媒体信息失败"))?;
        } else {
            updater
                .SetType(MediaPlaybackType::Music)
                .map_err(step("设置媒体类型失败"))?;
            let music = updater.MusicProperties().map_err(step("取音乐属性失败"))?;
            music
                .SetTitle(&HSTRING::from(title))
                .map_err(step("设置标题失败"))?;
            music
                .SetArtist(&HSTRING::from(track.artist.as_str()))
                .map_err(step("设置艺术家失败"))?;
            music
                .SetAlbumTitle(&HSTRING::from(track.album.as_str()))
                .map_err(step("设置专辑失败"))?;
            if let Some(bytes) = cover {
                match cover_stream_reference(bytes) {
                    Ok(reference) => updater
                        .SetThumbnail(&reference)
                        .map_err(step("设置封面失败"))?,
                    // 封面失败不影响文字与进度
                    Err(err) => log::warn!("[smtc] 生成封面内存流失败，本次只更新文字: {}", err),
                }
            }
            updater.Update().map_err(step("提交系统媒体信息失败"))?;
        }

        set_playback_status(controls, session_status(&track.status))?;
        apply_timeline(controls, track.position, track.duration)
    }

    fn set_playback_status(
        controls: &SystemMediaTransportControls,
        status: SmtcStatus,
    ) -> Result<(), String> {
        let smtc_status = match status {
            SmtcStatus::Playing => MediaPlaybackStatus::Playing,
            SmtcStatus::Paused => MediaPlaybackStatus::Paused,
            SmtcStatus::Stopped => MediaPlaybackStatus::Stopped,
        };
        controls
            .SetPlaybackStatus(smtc_status)
            .map_err(step("设置播放状态失败"))
    }

    fn apply_timeline(
        controls: &SystemMediaTransportControls,
        position: f64,
        duration: f64,
    ) -> Result<(), String> {
        let timeline = SystemMediaTransportControlsTimelineProperties::new()
            .map_err(step("创建系统时间轴失败"))?;
        let end = TimeSpan {
            Duration: seconds_to_ticks(duration),
        };
        timeline
            .SetStartTime(TimeSpan { Duration: 0 })
            .map_err(step("设置时间轴起点失败"))?;
        timeline
            .SetMinSeekTime(TimeSpan { Duration: 0 })
            .map_err(step("设置可拖动起点失败"))?;
        timeline
            .SetEndTime(end)
            .map_err(step("设置时间轴总长失败"))?;
        timeline
            .SetMaxSeekTime(end)
            .map_err(step("设置可拖动终点失败"))?;
        timeline
            .SetPosition(TimeSpan {
                Duration: seconds_to_ticks(position),
            })
            .map_err(step("设置播放位置失败"))?;
        controls
            .UpdateTimelineProperties(&timeline)
            .map_err(step("提交系统时间轴失败"))
    }

    /// 封面字节 → 系统要用的随机访问流引用。
    ///
    /// 走内存流（`InMemoryRandomAccessStream` + `DataWriter`），
    /// 字节来自调用方给的本地封面缓存文件 —— 这条路径不下载任何东西。
    fn cover_stream_reference(bytes: &[u8]) -> Result<RandomAccessStreamReference, String> {
        let stream = InMemoryRandomAccessStream::new().map_err(step("创建封面内存流失败"))?;
        let writer =
            DataWriter::CreateDataWriter(&stream).map_err(step("创建封面写入器失败"))?;
        writer
            .WriteBytes(bytes)
            .map_err(step("写入封面字节失败"))?;
        store_cover_bytes(&writer)?;
        writer.DetachStream().map_err(step("解绑封面内存流失败"))?;
        stream.Seek(0).map_err(step("封面流回到起点失败"))?;
        RandomAccessStreamReference::CreateFromStream(&stream).map_err(step("创建封面流引用失败"))
    }

    /// 等 `StoreAsync` 写完，但不阻塞死：回调 + 超时。
    fn store_cover_bytes(writer: &DataWriter) -> Result<(), String> {
        let store = writer.StoreAsync().map_err(step("提交封面字节失败"))?;
        let (tx, rx) = mpsc::channel();
        store
            .when(move |result| {
                let _ = tx.send(result.is_ok());
            })
            .map_err(step("监听封面落盘失败"))?;

        match rx.recv_timeout(COVER_STORE_TIMEOUT) {
            Ok(true) => Ok(()),
            Ok(false) => Err("封面字节写入内存流失败".to_string()),
            Err(_) => Err(format!(
                "封面字节写入超时（{}ms）",
                COVER_STORE_TIMEOUT.as_millis()
            )),
        }
    }
}

// ─── 非 Windows 构建占位 ──────────────────────────────────────

#[cfg(not(windows))]
mod platform {
    //! 桌面端只面向 Windows（同类说明见 secret_store）。这里只保证非 Windows 构建
    //! 仍可编译：没有 SMTC 就没有系统媒体控制，入口全是 no-op。

    use super::*;

    pub fn init(_app: &AppHandle) {}
    pub fn apply_enabled(_app: &AppHandle, _enabled: bool) {}
    pub fn push_track(_track: &SmtcTrack, _cover: Option<&[u8]>) {}
    pub fn push_progress(_position: f64, _duration: f64) {}
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn playing_and_loading_both_report_playing() {
        // 解析 / 缓冲期间保持 Playing，避免系统浮层在切歌瞬间闪一下「暂停」
        assert_eq!(session_status("playing"), SmtcStatus::Playing);
        assert_eq!(session_status("loading"), SmtcStatus::Playing);
    }

    #[test]
    fn paused_reports_paused() {
        assert_eq!(session_status("paused"), SmtcStatus::Paused);
    }

    #[test]
    fn idle_error_and_unknown_report_stopped() {
        assert_eq!(session_status("idle"), SmtcStatus::Stopped);
        assert_eq!(session_status("error"), SmtcStatus::Stopped);
        // 前端将来新增状态时保守处理：不假装在播放
        assert_eq!(session_status("something-new"), SmtcStatus::Stopped);
        assert_eq!(session_status(""), SmtcStatus::Stopped);
    }

    #[test]
    fn first_progress_push_always_passes() {
        assert!(should_push_progress(None, 0));
        assert!(should_push_progress(None, 12_345));
    }

    #[test]
    fn progress_push_is_throttled_for_half_a_second() {
        // 阈值正好是 500ms：够就放行，差 1ms 就拦下
        assert!(should_push_progress(Some(1_000), 1_500));
        assert!(!should_push_progress(Some(1_000), 1_499));
        assert!(!should_push_progress(Some(1_000), 1_000));
    }

    #[test]
    fn progress_push_survives_time_going_backwards() {
        // 时间戳倒退（时钟异常）时放行一次，不让进度永久推不出去
        assert!(should_push_progress(Some(9_000), 10));
    }

    #[test]
    fn seconds_to_ticks_converts_and_sanitizes() {
        assert_eq!(seconds_to_ticks(0.0), 0);
        assert_eq!(seconds_to_ticks(1.0), 10_000_000);
        assert_eq!(seconds_to_ticks(213.5), 2_135_000_000);
        // 负数 / NaN / 无穷都不是合法时长，一律 0
        assert_eq!(seconds_to_ticks(-3.0), 0);
        assert_eq!(seconds_to_ticks(f64::NAN), 0);
        assert_eq!(seconds_to_ticks(f64::INFINITY), 0);
        // 超大值夹到时间轴上限，不能溢出成负数
        assert!(seconds_to_ticks(f64::MAX) > 0);
        assert_eq!(
            seconds_to_ticks(f64::MAX),
            seconds_to_ticks(MAX_TIMELINE_SECONDS)
        );
    }

    #[test]
    fn seek_is_clamped_to_track_duration() {
        assert_eq!(sanitize_seek_seconds(0, 200.0), Some(0.0));
        assert_eq!(sanitize_seek_seconds(500_000_000, 200.0), Some(50.0));
        // 越过结尾：夹到总时长
        assert_eq!(sanitize_seek_seconds(10_000_000_000, 200.0), Some(200.0));
        // 负数（系统异常值）：夹到开头
        assert_eq!(sanitize_seek_seconds(-50_000_000, 200.0), Some(0.0));
    }

    #[test]
    fn seek_without_known_duration_is_ignored() {
        // 总时长未知时判断不了目标是否合法，宁可不动播放位置
        assert_eq!(sanitize_seek_seconds(500_000_000, 0.0), None);
        assert_eq!(sanitize_seek_seconds(500_000_000, -1.0), None);
        assert_eq!(sanitize_seek_seconds(500_000_000, f64::NAN), None);
    }
}
