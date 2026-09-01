//! 桌面歌词独立窗口
//!
//! 方案：复用 frontend dist，前端通过窗口 label `lyric` 路由到歌词视图。
//! 窗口属性：始终置顶（可切换）、无装饰、透明、不显示在任务栏、可拖动可调整大小。
//! 位置/尺寸/字号/置顶状态持久化到 AppSettings。

use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{
    async_runtime::{spawn, JoinHandle},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const LYRIC_LABEL: &str = "lyric";
const LYRIC_UNLOCK_LABEL: &str = "lyric-unlock";
/// 与 tauri.conf.json 主窗口 additionalBrowserArgs 逐字一致。
/// WebView2 要求同一用户数据目录的所有实例使用相同的浏览器附加参数，
/// 否则第二个 WebView2 环境（歌词窗/解锁按钮窗）会静默创建失败，
/// 表现为"点击桌面歌词无反应"。
const ADDITIONAL_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --app-user-model-id=cn.chenle.auralflow";
const PERSIST_DEBOUNCE_MS: u64 = 300;
const DEFAULT_WIDTH: f64 = 380.0;
const DEFAULT_HEIGHT: f64 = 76.0;
const MIN_WIDTH: f64 = 280.0;
const MIN_HEIGHT: f64 = 44.0;
/// 恢复窗口尺寸时的上限——旧版本保存的 900×150 等超大值会被 clamp 到此范围。
const MAX_RESTORE_WIDTH: f64 = 720.0;
const MAX_RESTORE_HEIGHT: f64 = 120.0;
const UNLOCK_WINDOW_SIZE: f64 = 46.0;
const ALWAYS_ON_TOP_LOOP_MS: u64 = 1500;
// 锁定态下光标轮询间隔：在窗口内时临时解除穿透以支持 hover 工具栏
const LOCK_CURSOR_POLL_MS: u64 = 150;
const LOCK_TOKEN_SEQUENCE_MASK: u64 = 0xffff_ffff;

static ALWAYS_ON_TOP_LOOP_RUNNING: AtomicBool = AtomicBool::new(false);
/// 循环实例代号：clear 时递增，使旧任务醒来后能识别自己已被取代。
static ALWAYS_ON_TOP_LOOP_GENERATION: AtomicU64 = AtomicU64::new(0);
static LYRIC_LOCKED: AtomicBool = AtomicBool::new(false);
static LYRIC_LOCK_RUNTIME_KNOWN: AtomicBool = AtomicBool::new(false);
static LYRIC_CREATE_PENDING: AtomicBool = AtomicBool::new(false);
static LYRIC_LOCK_EPOCH: AtomicU64 = AtomicU64::new(0);
static LYRIC_WINDOW_EPOCH: AtomicU64 = AtomicU64::new(0);
static LYRIC_PENDING_LOCK_TOKEN: AtomicU64 = AtomicU64::new(0);
static LOCK_CURSOR_POLL_RUNNING: AtomicBool = AtomicBool::new(false);
/// 同 ALWAYS_ON_TOP_LOOP_GENERATION。
static LOCK_CURSOR_POLL_GENERATION: AtomicU64 = AtomicU64::new(0);
// 锁定态下当前是否“光标在窗口内”（false = 穿透中）
static LYRIC_CURSOR_INSIDE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWindowPlayerToggleResult {
    pub action: String,
    pub open: bool,
    pub locked: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWindowPlayerUnlockResult {
    pub unlocked: bool,
    pub open: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWindowState {
    pub open: bool,
    pub locked: bool,
}

/// 切换桌面歌词窗口：不存在则创建，存在则销毁
pub fn toggle(app: &AppHandle) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window(LYRIC_LABEL) {
        LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
        set_locked(app, false, None, "toggle-close")?;
        invalidate_lyric_window_epoch("toggle-close");
        close_unlock_window(app);
        clear_always_on_top_loop();
        clear_lock_cursor_poll();
        existing
            .close()
            .map_err(|e| format!("关闭歌词窗口失败: {}", e))?;
        let _ = app.emit("lyric-window-open-changed", json!({ "open": false }));
        Ok(false)
    } else if LYRIC_CREATE_PENDING.swap(true, Ordering::SeqCst) {
        LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
        invalidate_lyric_window_epoch("toggle-cancel-create");
        let _ = app.emit("lyric-window-open-changed", json!({ "open": false }));
        Ok(false)
    } else {
        let _ = app.emit("lyric-window-open-changed", json!({ "open": true }));
        schedule_create(app);
        Ok(true)
    }
}

/// 查询桌面歌词窗口是否已存在
pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LYRIC_LABEL).is_some()
        || LYRIC_CREATE_PENDING.load(Ordering::SeqCst)
        || has_runtime_lock_target()
        || app.get_webview_window(LYRIC_UNLOCK_LABEL).is_some()
}

fn has_runtime_lock_target() -> bool {
    LYRIC_LOCKED.load(Ordering::SeqCst)
}

fn has_pending_lock_request() -> bool {
    let token = LYRIC_PENDING_LOCK_TOKEN.load(Ordering::SeqCst);
    token != 0 && token_window_epoch(token) == LYRIC_WINDOW_EPOCH.load(Ordering::SeqCst)
}

fn consume_pending_lock_token(prepared_lock_token: u64) -> Result<(), u64> {
    LYRIC_PENDING_LOCK_TOKEN
        .compare_exchange(prepared_lock_token, 0, Ordering::SeqCst, Ordering::SeqCst)
        .map(|_| ())
}

fn make_lock_token(window_epoch: u64, lock_epoch: u64) -> u64 {
    (window_epoch << 32) | (lock_epoch & LOCK_TOKEN_SEQUENCE_MASK)
}

fn token_window_epoch(token: u64) -> u64 {
    token >> 32
}

fn invalidate_pending_lock_token(_reason: &str) {
    LYRIC_LOCK_EPOCH.fetch_add(1, Ordering::SeqCst);
    LYRIC_PENDING_LOCK_TOKEN.store(0, Ordering::SeqCst);
}

fn invalidate_lyric_window_epoch(_reason: &str) -> u64 {
    let window_epoch = LYRIC_WINDOW_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    LYRIC_PENDING_LOCK_TOKEN.store(0, Ordering::SeqCst);
    window_epoch
}

pub fn state(app: &AppHandle) -> LyricWindowState {
    // is_open 已经包含 create_pending、LYRIC_LOCKED 和 unlock 窗口三项，
    // 这里不再重复析取：locked 为真时 is_open 必然为真。
    LyricWindowState {
        open: is_open(app),
        locked: LYRIC_LOCKED.load(Ordering::SeqCst)
            || app.get_webview_window(LYRIC_UNLOCK_LABEL).is_some(),
    }
}

/// 切换置顶状态；同时写回 settings.lyric_pinned
pub fn set_pinned(app: &AppHandle, pinned: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LYRIC_LABEL) {
        window
            .set_always_on_top(pinned)
            .map_err(|e| format!("设置置顶失败: {}", e))?;
    }
    if let Some(unlock) = app.get_webview_window(LYRIC_UNLOCK_LABEL) {
        unlock
            .set_always_on_top(pinned)
            .map_err(|e| format!("设置解锁按钮置顶失败: {}", e))?;
    }
    crate::config::patch_settings(app, json!({ "lyricPinned": pinned }))?;
    if pinned {
        ensure_always_on_top_loop(app);
    } else {
        clear_always_on_top_loop();
    }
    Ok(())
}

/// 切换锁定状态；锁定后主歌词窗口鼠标穿透，右上角保留悬停解锁键。
pub fn set_locked(
    app: &AppHandle,
    locked: bool,
    prepared_lock_epoch: Option<u64>,
    source: &str,
) -> Result<bool, String> {
    if locked && source != "lyric-window" {
        return Ok(false);
    }

    if locked {
        if let Some(prepared_lock_token) = prepared_lock_epoch {
            let token_window_epoch = token_window_epoch(prepared_lock_token);
            let current_window_epoch = LYRIC_WINDOW_EPOCH.load(Ordering::SeqCst);
            if token_window_epoch != current_window_epoch {
                return Ok(false);
            }

            if consume_pending_lock_token(prepared_lock_token).is_err() {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    } else {
        invalidate_pending_lock_token(source);
    }

    LYRIC_LOCKED.store(locked, Ordering::SeqCst);
    LYRIC_LOCK_RUNTIME_KNOWN.store(true, Ordering::SeqCst);
    let _ = app.emit("lyric-settings-changed", json!({ "lyricLocked": locked }));

    schedule_apply_locked_window_state(app, locked);
    Ok(true)
}

pub fn prepare_lock_intent(_app: &AppHandle) -> u64 {
    let lock_epoch = LYRIC_LOCK_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    let window_epoch = LYRIC_WINDOW_EPOCH.load(Ordering::SeqCst);
    let token = make_lock_token(window_epoch, lock_epoch);
    LYRIC_PENDING_LOCK_TOKEN.store(token, Ordering::SeqCst);
    token
}

pub fn unlock_from_player(app: &AppHandle) -> Result<LyricWindowPlayerUnlockResult, String> {
    let current = state(app);
    let pending_lock = has_pending_lock_request();

    if current.locked || pending_lock {
        set_locked(app, false, None, "player-unlock-first")?;
        return Ok(LyricWindowPlayerUnlockResult {
            unlocked: true,
            open: true,
            locked: false,
        });
    }

    Ok(LyricWindowPlayerUnlockResult {
        unlocked: false,
        open: current.open,
        locked: current.locked,
    })
}

fn apply_locked_window_state(app: &AppHandle, locked: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LYRIC_LABEL) else {
        if !locked {
            close_unlock_window(app);
        }
        return Ok(());
    };

    if !locked {
        close_unlock_window(app);
    }
    if locked {
        // 重新锁定时窗口已恢复穿透，重置光标状态后启动轮询
        LYRIC_CURSOR_INSIDE.store(false, Ordering::SeqCst);
        ensure_lock_cursor_poll(app);
    } else {
        clear_lock_cursor_poll();
        LYRIC_CURSOR_INSIDE.store(false, Ordering::SeqCst);
    }

    window.set_ignore_cursor_events(locked).map_err(|err| {
        if locked {
            format!("设置桌面歌词锁定失败: {}", err)
        } else {
            format!("设置桌面歌词解锁失败: {}", err)
        }
    })?;

    if locked {
        schedule_create_unlock_window(app);
    } else {
        close_unlock_window(app);
    }
    Ok(())
}

fn schedule_apply_locked_window_state(app: &AppHandle, locked: bool) {
    let app = app.clone();
    spawn(async move {
        tokio::time::sleep(Duration::from_millis(1)).await;
        if has_runtime_lock_target() != locked {
            return;
        }
        // 解锁失败时窗口仍处于鼠标穿透、unlock 按钮已关闭、光标轮询已停止的状态，
        // 用户没有任何解锁入口。必须把错误暴露到前端而不是静默丢弃。
        if let Err(message) = apply_locked_window_state(&app, locked) {
            let _ = app.emit(
                "lyric-window-lock-failed",
                json!({ "locked": locked, "message": message }),
            );
        }
    });
}

/// 播放器按钮专用切换：未打开则打开；已打开未锁则关闭；已打开已锁则先解锁。
pub fn toggle_from_player(app: &AppHandle) -> Result<LyricWindowPlayerToggleResult, String> {
    let current = state(app);
    let open = current.open;
    let locked = current.locked;
    let pending_lock = has_pending_lock_request();

    // locked 为真时 open 必然为真（见 state），故无需再用 open 做门控。
    if locked || (open && pending_lock) {
        set_locked(app, false, None, "player-toggle-unlock")?;
        return Ok(LyricWindowPlayerToggleResult {
            action: "unlocked".to_string(),
            open: true,
            locked: false,
            message: "桌面歌词已解锁".to_string(),
        });
    }

    // 窗口没开却留有待用加锁 token：清掉，避免下次开窗直接以穿透态启动。
    if !open && pending_lock {
        set_locked(app, false, None, "player-toggle-clear-stale")?;
    }

    let next_open = toggle(app)?;
    Ok(LyricWindowPlayerToggleResult {
        action: if next_open { "opened" } else { "closed" }.to_string(),
        open: next_open,
        locked: false,
        message: if next_open {
            "桌面歌词已打开"
        } else {
            "桌面歌词已关闭"
        }
        .to_string(),
    })
}

fn create(app: &AppHandle) -> Result<(), String> {
    let settings = crate::config::load_settings(app)?;

    let url = lyric_webview_url("#/lyric")?;
    let width = restore_window_length(settings.lyric_window_width, DEFAULT_WIDTH, MIN_WIDTH, MAX_RESTORE_WIDTH);
    let height = restore_window_length(settings.lyric_window_height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_RESTORE_HEIGHT);
    let pinned = settings.lyric_pinned;
    invalidate_lyric_window_epoch("create");

    let window = WebviewWindowBuilder::new(app, LYRIC_LABEL, url)
        .title("AuralFlow 桌面歌词")
        .additional_browser_args(ADDITIONAL_BROWSER_ARGS)
        .inner_size(width, height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .always_on_top(pinned)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(false)
        .focusable(false)
        .focused(false)
        .build()
        .map_err(|e| format!("创建歌词窗口失败: {}", e))?;

    window
        .show()
        .map_err(|e| format!("显示歌词窗口失败: {}", e))?;
    LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
    invalidate_lyric_window_epoch("create");
    let runtime_known = LYRIC_LOCK_RUNTIME_KNOWN.load(Ordering::SeqCst);
    let runtime_target = has_runtime_lock_target();
    let initial_locked = if runtime_known { runtime_target } else { false };
    LYRIC_LOCKED.store(initial_locked, Ordering::SeqCst);
    LYRIC_LOCK_RUNTIME_KNOWN.store(true, Ordering::SeqCst);
    schedule_apply_locked_window_state(app, initial_locked);
    if pinned {
        ensure_always_on_top_loop(app);
    } else {
        clear_always_on_top_loop();
    }

    // 设置位置/尺寸：上次保存的 → 屏幕底部居中；同时夹回当前屏幕，避免坏配置导致窗口“打开但不可见”。
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let geometry = resolve_window_geometry(
            settings.lyric_window_x,
            settings.lyric_window_y,
            settings.lyric_window_width,
            settings.lyric_window_height,
            size.width as f64 / scale,
            size.height as f64 / scale,
        );
        let _ = window.set_size(LogicalSize::new(geometry.width, geometry.height));
        let _ = window.set_position(LogicalPosition::new(geometry.x, geometry.y));
    } else if let (Some(x), Some(y)) = (settings.lyric_window_x, settings.lyric_window_y) {
        let _ = window.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
    }

    let _ = app.emit("lyric-window-open-changed", json!({ "open": true }));

    // 监听 move/resize → 写回 settings（debounce 300ms 限频，避免拖动期间频繁写盘）
    let app_for_event = app.clone();
    let position_pending: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
    let size_pending: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(pos) => {
            schedule_persist_position(&app_for_event, *pos, &position_pending);
            sync_unlock_window_position(&app_for_event);
        }
        WindowEvent::Resized(size) => {
            schedule_persist_size(&app_for_event, *size, &size_pending);
            sync_unlock_window_position(&app_for_event);
        }
        WindowEvent::Destroyed => {
            LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
            invalidate_lyric_window_epoch("destroyed");
            let _ = set_locked(&app_for_event, false, None, "window-destroyed");
            close_unlock_window(&app_for_event);
            clear_always_on_top_loop();
            clear_lock_cursor_poll();
            let _ = app_for_event.emit("lyric-window-open-changed", json!({ "open": false }));
        }
        _ => {}
    });

    Ok(())
}

fn schedule_create(app: &AppHandle) {
    let app = app.clone();
    spawn(async move {
        // Let the IPC command return before WebView2 starts creating another webview.
        tokio::time::sleep(Duration::from_millis(1)).await;
        if !LYRIC_CREATE_PENDING.load(Ordering::SeqCst) {
            return;
        }
        if app.get_webview_window(LYRIC_LABEL).is_some() {
            LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
            return;
        }
        if create(&app).is_err() {
            LYRIC_CREATE_PENDING.store(false, Ordering::SeqCst);
            let _ = app.emit("lyric-window-open-changed", json!({ "open": false }));
        }
    });
}

fn create_unlock_window(app: &AppHandle) -> Result<(), String> {
    let pinned = crate::config::load_settings(app)?.lyric_pinned;
    if let Some(unlock) = app.get_webview_window(LYRIC_UNLOCK_LABEL) {
        let _ = unlock.set_always_on_top(pinned);
        let _ = unlock.show();
        return Ok(());
    }

    let unlock = WebviewWindowBuilder::new(
        app,
        LYRIC_UNLOCK_LABEL,
        lyric_webview_url("#/lyric-unlock")?,
    )
    .title("解锁桌面歌词")
    .additional_browser_args(ADDITIONAL_BROWSER_ARGS)
    .inner_size(UNLOCK_WINDOW_SIZE, UNLOCK_WINDOW_SIZE)
    .always_on_top(pinned)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .transparent(true)
    .shadow(false)
    .focusable(false)
    .focused(false)
    .build()
    .map_err(|e| format!("创建桌面歌词解锁按钮失败: {}", e))?;

    let _ = unlock.set_always_on_top(pinned);
    unlock
        .show()
        .map_err(|e| format!("显示桌面歌词解锁按钮失败: {}", e))?;
    Ok(())
}

fn schedule_create_unlock_window(app: &AppHandle) {
    let app = app.clone();
    spawn(async move {
        if !has_runtime_lock_target() {
            return;
        }
        if create_unlock_window(&app).is_err() {
            return;
        }
        if !has_runtime_lock_target() {
            close_unlock_window(&app);
            return;
        }
        sync_unlock_window_position(&app);
        schedule_unlock_window_sync(&app);
    });
}

fn close_unlock_window(app: &AppHandle) {
    if let Some(unlock) = app.get_webview_window(LYRIC_UNLOCK_LABEL) {
        let _ = unlock.close();
    }
}

fn sync_unlock_window_position(app: &AppHandle) {
    let Some(lyric) = app.get_webview_window(LYRIC_LABEL) else {
        close_unlock_window(app);
        return;
    };
    let Some(unlock) = app.get_webview_window(LYRIC_UNLOCK_LABEL) else {
        return;
    };

    let scale = lyric.scale_factor().unwrap_or(1.0);
    let Ok(position) = lyric.outer_position() else {
        return;
    };
    let Ok(size) = lyric.inner_size() else {
        return;
    };

    let pinned = crate::config::load_settings(app)
        .map(|settings| settings.lyric_pinned)
        .unwrap_or(true);
    let x = position.x as f64 / scale + size.width as f64 / scale - UNLOCK_WINDOW_SIZE - 10.0;
    let y = position.y as f64 / scale + 8.0;
    let _ = unlock.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
    let _ = unlock.set_always_on_top(pinned);
    let _ = unlock.show();
}

fn schedule_unlock_window_sync(app: &AppHandle) {
    let app = app.clone();
    spawn(async move {
        tokio::time::sleep(Duration::from_millis(180)).await;
        sync_unlock_window_position(&app);
    });
}

/// 置顶巡检循环。用 generation 而非单个 bool 做互斥：
/// sleep 不可取消，旧任务醒来时可能已经有新任务在跑，单个 bool 无法区分
/// "该停下" 和 "别人在跑"，旧任务退出时会清掉新任务的守卫。
/// 每次 clear 递增 generation，任务只在自己那一代仍是当前代时继续。
fn ensure_always_on_top_loop(app: &AppHandle) {
    if ALWAYS_ON_TOP_LOOP_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let generation = ALWAYS_ON_TOP_LOOP_GENERATION.load(Ordering::SeqCst);

    let app = app.clone();
    spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(ALWAYS_ON_TOP_LOOP_MS)).await;
            if ALWAYS_ON_TOP_LOOP_GENERATION.load(Ordering::SeqCst) != generation {
                break;
            }

            let Ok(settings) = crate::config::load_settings(&app) else {
                continue;
            };
            if !settings.lyric_pinned {
                clear_always_on_top_loop();
                break;
            }

            let Some(window) = app.get_webview_window(LYRIC_LABEL) else {
                clear_always_on_top_loop();
                break;
            };
            let _ = window.set_always_on_top(true);
            if let Some(unlock) = app.get_webview_window(LYRIC_UNLOCK_LABEL) {
                let _ = unlock.set_always_on_top(true);
            }
        }
    });
}

fn clear_always_on_top_loop() {
    ALWAYS_ON_TOP_LOOP_GENERATION.fetch_add(1, Ordering::SeqCst);
    ALWAYS_ON_TOP_LOOP_RUNNING.store(false, Ordering::SeqCst);
}

/// 锁定态光标轮询：借鉴 LX Music 的穿透+hover 方案。
/// Tauri 2 的 set_ignore_cursor_events 不支持 forward 参数，
/// 改为轮询光标位置动态切换穿透：光标在窗口内时临时解除穿透
/// （让渲染层能收到 hover 显示工具栏/解锁按钮），移出后恢复穿透。
/// 仅在状态翻转时才调 set_ignore_cursor_events 并通知前端，避免频繁刷新。
fn ensure_lock_cursor_poll(app: &AppHandle) {
    if LOCK_CURSOR_POLL_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    // 同 ensure_always_on_top_loop：用 generation 区分任务实例，
    // 避免 "解锁后立即重新加锁" 时旧任务与新任务并存互相清守卫。
    let generation = LOCK_CURSOR_POLL_GENERATION.load(Ordering::SeqCst);

    let app = app.clone();
    spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(LOCK_CURSOR_POLL_MS)).await;
            if LOCK_CURSOR_POLL_GENERATION.load(Ordering::SeqCst) != generation
                || !has_runtime_lock_target()
            {
                break;
            }

            let Some(window) = app.get_webview_window(LYRIC_LABEL) else {
                break;
            };

            let inside = cursor_inside_window(&window);
            let was_inside = LYRIC_CURSOR_INSIDE.swap(inside, Ordering::SeqCst);
            if inside == was_inside {
                continue;
            }

            // 进入窗口：临时解除穿透；移出窗口：恢复穿透
            if window.set_ignore_cursor_events(!inside).is_ok() {
                let _ = app.emit(
                    if inside {
                        "lyric-cursor-enter"
                    } else {
                        "lyric-cursor-leave"
                    },
                    json!({}),
                );
            }
        }
        // 只在自己仍是当前代时释放守卫，否则会把后继任务的守卫误清。
        if LOCK_CURSOR_POLL_GENERATION.load(Ordering::SeqCst) == generation {
            LOCK_CURSOR_POLL_RUNNING.store(false, Ordering::SeqCst);
        }
    });
}

/// 光标是否落在歌词窗口矩形内（外框位置 + 内部尺寸，均为物理像素）
fn cursor_inside_window(window: &tauri::WebviewWindow) -> bool {
    let Ok(cursor) = window.cursor_position() else {
        return false;
    };
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.inner_size() else {
        return false;
    };
    cursor.x >= position.x as f64
        && cursor.x <= (position.x + size.width as i32) as f64
        && cursor.y >= position.y as f64
        && cursor.y <= (position.y + size.height as i32) as f64
}

fn clear_lock_cursor_poll() {
    LOCK_CURSOR_POLL_GENERATION.fetch_add(1, Ordering::SeqCst);
    LOCK_CURSOR_POLL_RUNNING.store(false, Ordering::SeqCst);
}

fn lyric_webview_url(hash: &str) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let url = format!("http://localhost:1420/{}", hash)
            .parse()
            .map_err(|e| format!("解析歌词窗口 dev URL 失败: {}", e))?;
        Ok(WebviewUrl::External(url))
    }

    #[cfg(not(debug_assertions))]
    {
        let app_url = format!("index.html{}", hash);
        Ok(WebviewUrl::App(app_url.into()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LyricWindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn sanitize_window_length(value: Option<f64>, fallback: f64, min: f64) -> f64 {
    match value {
        Some(v) if v.is_finite() && v >= min => v,
        _ => fallback,
    }
}

/// 恢复持久化尺寸时 clamp 到 [min, max]，防止旧版本保存的超大值恢复后窗口过大。
fn restore_window_length(value: Option<f64>, fallback: f64, min: f64, max: f64) -> f64 {
    let raw = sanitize_window_length(value, fallback, min);
    raw.clamp(min, max)
}

fn clamp_to_range(value: f64, min: f64, max: f64) -> f64 {
    if max <= min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn resolve_window_geometry(
    saved_x: Option<f64>,
    saved_y: Option<f64>,
    saved_width: Option<f64>,
    saved_height: Option<f64>,
    screen_width: f64,
    screen_height: f64,
) -> LyricWindowGeometry {
    let screen_width = screen_width.max(MIN_WIDTH);
    let screen_height = screen_height.max(MIN_HEIGHT);
    let width = restore_window_length(saved_width, DEFAULT_WIDTH, MIN_WIDTH, MAX_RESTORE_WIDTH);
    let height = restore_window_length(saved_height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_RESTORE_HEIGHT);

    let default_x = ((screen_width - width) / 2.0).max(0.0);
    let default_y = (screen_height - height - 60.0).max(0.0);
    let max_x = (screen_width - width).max(0.0);
    let max_y = (screen_height - height).max(0.0);

    let x = match saved_x {
        Some(v) if v.is_finite() => clamp_to_range(v, 0.0, max_x),
        _ => default_x,
    };
    let y = match saved_y {
        Some(v) if v.is_finite() => clamp_to_range(v, 0.0, max_y),
        _ => default_y,
    };

    LyricWindowGeometry {
        x,
        y,
        width,
        height,
    }
}

/// 取 debounce 句柄锁。锁只保护一个 JoinHandle，中毒不会让数据本身失去意义，
/// 所以沿用内部值继续工作；静默 return 会让位置/尺寸持久化永久失效且无任何迹象。
fn lock_pending(pending: &Mutex<Option<JoinHandle<()>>>) -> MutexGuard<'_, Option<JoinHandle<()>>> {
    pending.lock().unwrap_or_else(|err| err.into_inner())
}

fn schedule_persist_position(
    app: &AppHandle,
    pos: PhysicalPosition<i32>,
    pending: &Mutex<Option<JoinHandle<()>>>,
) {
    let app = app.clone();
    let mut guard = lock_pending(pending);
    if let Some(handle) = guard.take() {
        handle.abort();
    }
    *guard = Some(spawn(async move {
        tokio::time::sleep(Duration::from_millis(PERSIST_DEBOUNCE_MS)).await;
        persist_position(&app, pos);
    }));
}

fn schedule_persist_size(
    app: &AppHandle,
    size: PhysicalSize<u32>,
    pending: &Mutex<Option<JoinHandle<()>>>,
) {
    let app = app.clone();
    let mut guard = lock_pending(pending);
    if let Some(handle) = guard.take() {
        handle.abort();
    }
    *guard = Some(spawn(async move {
        tokio::time::sleep(Duration::from_millis(PERSIST_DEBOUNCE_MS)).await;
        persist_size(&app, size);
    }));
}

/// 当前歌词窗的缩放系数。必须每次实时读取：窗口被拖到不同 DPI 的显示器后
/// 缩放会变，用创建时的旧值换算会把逻辑坐标算错，下次开窗位置偏移。
fn current_scale(app: &AppHandle) -> f64 {
    app.get_webview_window(LYRIC_LABEL)
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0)
}

fn persist_position(app: &AppHandle, pos: PhysicalPosition<i32>) {
    let scale = current_scale(app);
    let x = pos.x as f64 / scale;
    let y = pos.y as f64 / scale;
    let _ = crate::config::patch_settings(app, json!({ "lyricWindowX": x, "lyricWindowY": y }));
}

fn persist_size(app: &AppHandle, size: PhysicalSize<u32>) {
    let scale = current_scale(app);
    let w = size.width as f64 / scale;
    let h = size.height as f64 / scale;
    let _ = crate::config::patch_settings(
        app,
        json!({ "lyricWindowWidth": w, "lyricWindowHeight": h }),
    );
}
