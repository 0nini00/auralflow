// ─── Windows 任务栏缩略图按钮与悬浮预览 ────────────────────────
//
// 实现见 src/taskbar.rs。这里只做 IPC 适配：两个入口一律返回 `()`，
// 任务栏相关失败在 Rust 侧记日志降级，不把错误抛回播放链路（前端照常播放）。

/// 应用设置项「任务栏缩略图按钮与封面预览」：启用或卸载窗口过程子类化钩子。
#[tauri::command]
pub fn taskbar_set_enabled(app: AppHandle, enabled: bool) {
    crate::taskbar::set_enabled(&app, enabled);
}

/// 推送当前播放状态与封面（切歌、暂停恢复、封面落盘后调用）。
#[tauri::command]
pub fn taskbar_update_track(app: AppHandle, track: crate::taskbar::TaskbarTrack) {
    crate::taskbar::update_track(&app, track);
}
