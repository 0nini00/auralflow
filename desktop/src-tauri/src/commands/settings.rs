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
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    config::save_settings(&app, &settings)?;
    allow_app_background_asset(&app, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn patch_settings(app: AppHandle, patch: Value) -> Result<AppSettings, String> {
    let settings = config::patch_settings(&app, patch)?;
    allow_app_background_asset(&app, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<AppSettings, String> {
    config::reset_settings(&app)
}

// ─── 播放问题诊断日志 ─────────────────────────────────────────

use std::fs;

/// 追加一行到 app_data_dir/debug.log（超过 2MB 先清空），用于定位线上播放失败。
#[tauri::command]
pub fn debug_log(app: AppHandle, message: String) -> Result<(), String> {
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
            let _ = fs::remove_file(&path);
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
