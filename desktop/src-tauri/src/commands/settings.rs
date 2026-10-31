// ─── 配置管理 ──────────────────────────────────────────────────

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let settings = config::load_settings(&app)?;
    allow_app_background_asset(&app, &settings);
    Ok(settings)
}

/// 自定义背景图可能位于静态 assetProtocol scope 之外的任意路径，
/// 配置读写时按文件粒度放行，避免把整个用户主目录放进 scope。
fn allow_app_background_asset(app: &AppHandle, settings: &AppSettings) {
    let Some(path) = settings
        .app_background_image_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    let _ = app.asset_protocol_scope().allow_file(PathBuf::from(path));
}

#[tauri::command]
pub fn patch_settings(app: AppHandle, patch: Value) -> Result<AppSettings, String> {
    let settings = config::patch_settings(&app, patch)?;
    allow_app_background_asset(&app, &settings);
    Ok(settings)
}

// ─── 播放问题诊断日志 ─────────────────────────────────────────

/// 追加一行到 app_data_dir/debug.log（超过 2MB 先清空），用于定位线上播放失败。
///
/// 解析热路径多次调用：磁盘 IO 放进阻塞线程池，避免占住主线程。
#[tauri::command]
pub async fn debug_log(app: AppHandle, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_debug_log(&app, &message))
        .await
        .map_err(|err| format!("日志任务失败: {}", err))?
}

fn write_debug_log(app: &AppHandle, message: &str) -> Result<(), String> {
    use std::fs;
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    path.push("debug.log");

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > 2 * 1024 * 1024 {
            // 删除可能因文件被其它句柄占用而失败（多 WebView 并发写）：
            // 失败时退化为截断重写，保证 2MB 上限真正生效。
            if fs::remove_file(&path).is_err() {
                if let Ok(truncated) = fs::File::create(&path) {
                    drop(truncated);
                }
            }
        }
    }

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}\n", secs, message.replace('\n', " | "));

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开 debug.log 失败: {}", e))?;
    use std::io::Write;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("写入 debug.log 失败: {}", e))
}
