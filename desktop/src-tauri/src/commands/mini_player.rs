// ─── 迷你播放器 ───────────────────────────────────────────────

#[tauri::command]
pub fn toggle_mini_player(app: AppHandle) -> Result<bool, String> {
    crate::mini_player::toggle(&app)
}

#[tauri::command]
pub fn hide_mini_player(app: AppHandle) -> Result<(), String> {
    crate::mini_player::hide(&app)
}

/// 双击迷你播放器 / 托盘左键：显示并聚焦主窗口，同时收起迷你条。
#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    let _ = crate::mini_player::hide(&app);
    crate::tray::show_main_window(&app);
    Ok(())
}

/// 右键迷你播放器：弹原生菜单（显示主窗口 / 关闭迷你播放器 / 退出）。
#[tauri::command]
pub fn show_mini_player_menu(app: AppHandle) -> Result<(), String> {
    crate::mini_player::show_context_menu(&app)
}
