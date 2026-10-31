// ─── 用户数据持久化（B-mid） ──────────────────────────────────

/// 读取某个用户数据 namespace（favorites/playlists/library/customSources/recent）
#[tauri::command]
pub fn library_load(app: AppHandle, namespace: String) -> Result<Value, String> {
    crate::library::load(&app, &namespace)
}

/// 写入某个用户数据 namespace（整体覆盖）。
///
/// 序列化 + fsync 是同步阻塞 IO，收藏/歌单 JSON 可达 MB 级——放进阻塞线程池，
/// 不让它占住主线程（Tauri 2 同步 command 在主线程执行）。
#[tauri::command]
pub async fn library_save(app: AppHandle, namespace: String, value: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::library::save(&app, &namespace, &value))
        .await
        .map_err(|err| format!("写入任务失败: {}", err))?
}


/// 重置单个 namespace（删文件）
#[tauri::command]
pub fn library_reset(app: AppHandle, namespace: String) -> Result<(), String> {
    crate::library::reset(&app, &namespace)
}

