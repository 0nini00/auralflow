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

// ─── 关闭窗口的确认答复 ────────────────────────────────────────

/// 前端关闭确认框的答复：`action` = `"tray"`（最小化到托盘）/ `"quit"`（退出应用）。
///
/// `remember` = 用户勾了「记住我的选择」：写入 close_to_tray 并置 close_prompt_seen，
/// 之后关闭窗口直接按这个行为执行（不再提问）；不勾则只对本次生效。
///
/// 窗口的 close 事件已在 main.rs 里 prevent 掉，所以「最小化到托盘」在这里才真正 hide，
/// 「退出应用」走与 main.rs 相同的 flush → exit 路径。
#[tauri::command]
pub fn resolve_close_request(app: AppHandle, action: String, remember: bool) -> Result<(), String> {
    // 前端已经回话：先取消 main.rs 里「没人回话就按默认关到托盘」的兜底。
    crate::CLOSE_PROMPT_PENDING.store(false, Ordering::SeqCst);
    let to_tray = match action.as_str() {
        "tray" => true,
        "quit" => false,
        other => return Err(format!("未知的关闭动作: {}", other)),
    };
    if remember {
        config::patch_settings(
            &app,
            serde_json::json!({ "closeToTray": to_tray, "closePromptSeen": true }),
        )?;
    }
    if to_tray {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "找不到主窗口".to_string())?;
        window
            .hide()
            .map_err(|err| format!("最小化到托盘失败: {}", err))?;
        // 隐藏后由迷你播放器接手显示当前播放（开关在 设置 → 其他 → 窗口与启动）。
        crate::mini_player::show_on_tray_hide(&app);
        return Ok(());
    }
    crate::tray::request_quit(&app);
    Ok(())
}

/// 前端把确认弹窗真正画出来了：立刻取消「没人回话就关到托盘」的兜底。
///
/// 兜底只该防「渲染进程卡死/崩了没人应答」；不能让它在用户读弹窗前就把窗口藏掉
/// ——1.5s 这种时间窗人类根本来不及读，更来不及选。
#[tauri::command]
pub fn ack_close_request(_app: AppHandle) -> Result<(), String> {
    crate::CLOSE_PROMPT_PENDING.store(false, Ordering::SeqCst);
    Ok(())
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
