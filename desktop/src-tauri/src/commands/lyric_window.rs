/// 切换桌面歌词窗口（开/关）。返回 true=已打开，false=已关闭。
#[tauri::command]
pub fn toggle_lyric_window(app: AppHandle) -> Result<bool, String> {
    crate::lyric_window::toggle(&app)
}

/// 播放器按钮专用桌面歌词切换。
///
/// 规则：未打开则打开；已打开未锁则关闭；已打开已锁则先解锁，不直接关闭。
#[tauri::command]
pub fn toggle_lyric_window_from_player(
    app: AppHandle,
) -> Result<crate::lyric_window::LyricWindowPlayerToggleResult, String> {
    crate::lyric_window::toggle_from_player(&app)
}

/// 播放器按钮第一步：若桌面歌词处于锁定或锁定意图状态，只解锁，不关闭。
#[tauri::command]
pub fn unlock_lyric_window_from_player(
    app: AppHandle,
) -> Result<crate::lyric_window::LyricWindowPlayerUnlockResult, String> {
    crate::lyric_window::unlock_from_player(&app)
}

/// 查询桌面歌词窗口状态，以后端运行时状态为准。
#[tauri::command]
pub fn get_lyric_window_state(app: AppHandle) -> crate::lyric_window::LyricWindowState {
    crate::lyric_window::state(&app)
}

/// 标记桌面歌词即将锁定；用于播放器按钮在后端窗口状态滞后时仍可先解锁。
#[tauri::command]
pub fn prepare_lyric_window_lock(app: AppHandle) -> u64 {
    crate::lyric_window::prepare_lock_intent(&app)
}

/// 查询桌面歌词窗口是否已打开。
#[tauri::command]
pub fn is_lyric_window_open(app: AppHandle) -> bool {
    crate::lyric_window::is_open(&app)
}

/// 设置桌面歌词窗口的置顶状态（同时持久化）
#[tauri::command]
pub fn set_lyric_window_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    crate::lyric_window::set_pinned(&app, pinned)
}

/// 设置桌面歌词窗口锁定状态（同时持久化）
#[tauri::command]
pub fn set_lyric_window_locked(
    app: AppHandle,
    locked: bool,
    lock_epoch: Option<u64>,
    lock_source: Option<String>,
) -> Result<bool, String> {
    crate::lyric_window::set_locked(
        &app,
        locked,
        lock_epoch,
        lock_source.as_deref().unwrap_or("ipc"),
    )
}
