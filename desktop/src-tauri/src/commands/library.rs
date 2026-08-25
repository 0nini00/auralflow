// ─── 用户数据持久化（B-mid） ──────────────────────────────────

/// 读取某个用户数据 namespace（favorites/playlists/library/customSources/recent）
#[tauri::command]
pub fn library_load(app: AppHandle, namespace: String) -> Result<Value, String> {
    crate::library::load(&app, &namespace)
}

/// 写入某个用户数据 namespace（整体覆盖）
#[tauri::command]
pub fn library_save(app: AppHandle, namespace: String, value: Value) -> Result<(), String> {
    crate::library::save(&app, &namespace, &value)
}

/// 重置单个 namespace（删文件）
#[tauri::command]
pub fn library_reset(app: AppHandle, namespace: String) -> Result<(), String> {
    crate::library::reset(&app, &namespace)
}

/// 重置所有用户数据
#[tauri::command]
pub fn library_reset_all(app: AppHandle) -> Result<(), String> {
    crate::library::reset_all(&app)
}
