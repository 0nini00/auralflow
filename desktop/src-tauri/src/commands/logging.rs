// ─── 运行日志 ────────────────────────────────────────────────

/// 用系统文件管理器打开日志目录（`app_log_dir`，与 tauri-plugin-log 的落盘位置一致）。
///
/// 只有在 Windows 上才有实现；目录不存在时先建出来 —— 日志插件初始化失败（fail-soft）
/// 时目录可能还没被创建，此时按钮仍应能打开一个空目录而不是报错。
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = crate::logging::log_dir(&app)?;
    crate::logging::open_in_file_manager(&dir)
}
