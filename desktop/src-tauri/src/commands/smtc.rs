// ─── Windows 系统媒体控制（SMTC） ──────────────────────────────
//
// 实现见 src/smtc.rs。这里只做 IPC 适配：三个入口一律返回 `()`，
// SMTC 失败在 Rust 侧记日志降级，不把错误抛回播放链路（前端照常播放）。

/// 应用设置项「跟随系统媒体控制」：启用或释放 SMTC 会话。
#[tauri::command]
pub fn smtc_set_enabled(app: AppHandle, enabled: bool) {
    crate::smtc::set_enabled(&app, enabled);
}

/// 推送当前曲目 / 播放状态（切歌、暂停恢复、seek 之后调用）。
///
/// 封面读取（fs::read，可达数 MB）发生在 update_track 内部：放进阻塞线程池，
/// 不让它落在切歌瞬间的主线程上。
#[tauri::command]
pub async fn smtc_update_track(app: AppHandle, track: crate::smtc::SmtcTrack) {
    let _ = tauri::async_runtime::spawn_blocking(move || crate::smtc::update_track(&app, track)).await;
}

/// 推送播放进度（Rust 侧按 ≥500ms 节流，前端照常全量推）。
#[tauri::command]
pub fn smtc_update_progress(app: AppHandle, position: f64, duration: f64) {
    crate::smtc::update_progress(&app, position, duration);
}
