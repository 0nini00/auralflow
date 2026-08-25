// ─── 下载文件 ───────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub task_id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub progress: f64,
    pub speed: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCompletedEvent {
    pub task_id: String,
    pub saved_path: String,
    pub total: u64,
}

fn safe_join_download_path(directory: &str, file_name: &str) -> Result<PathBuf, String> {
    let file_component = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;

    if file_component.is_empty() || file_component == "." || file_component == ".." {
        return Err("文件名无效".to_string());
    }

    let dir = PathBuf::from(directory);
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|err| format!("创建下载目录失败: {}", err))?;
    }
    if !dir.is_dir() {
        return Err("下载目录不是有效文件夹".to_string());
    }

    Ok(dir.join(file_component))
}

// ─── 下载取消 ────────────────────────────────────────────────
fn download_cancel_map() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_download_cancel(task_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = download_cancel_map().lock() {
        map.insert(task_id.to_string(), Arc::clone(&flag));
    }
    flag
}

fn clear_download_cancel(task_id: &str) {
    if let Ok(mut map) = download_cancel_map().lock() {
        map.remove(task_id);
    }
}

fn unique_final_download_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    for i in 1..1000 {
        let name = match ext {
            Some(e) => format!("{} ({}).{}", stem, i, e),
            None => format!("{} ({})", stem, i),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    task_id: String,
    url: String,
    directory: String,
    file_name: String,
) -> Result<String, String> {
    // 下载地址由音源解析结果决定，属于运行时可控目标，统一走出站校验。
    crate::outbound::assert_public_url(&url, "下载")?;

    let cancel_flag = register_download_cancel(&task_id);
    let path = safe_join_download_path(&directory, &file_name)?;
    let temp_path = path.with_extension(format!(
        "{}.download",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("tmp")
    ));

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(crate::outbound::guarded_redirect_policy("下载"))
        .build()
        .map_err(|err| format!("创建下载客户端失败: {}", err))?;

    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("请求下载地址失败: {}", err))?;

    if !resp.status().is_success() {
        clear_download_cancel(&task_id);
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    let total = resp.content_length();
    let mut file =
        std::fs::File::create(&temp_path).map_err(|err| format!("创建文件失败: {}", err))?;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded = 0u64;

    const MAX_DOWNLOAD_SIZE: u64 = 2 * 1024 * 1024 * 1024; // 2GiB

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|err| format!("读取下载数据失败: {}", err))?
    {
        if cancel_flag.load(Ordering::SeqCst) {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            clear_download_cancel(&task_id);
            return Err("下载已取消".to_string());
        }
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .map_err(|err| format!("写入文件失败: {}", err))?;
        if downloaded > MAX_DOWNLOAD_SIZE {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            clear_download_cancel(&task_id);
            return Err("文件过大,已超过 2GB 上限".to_string());
        }

        if last_emit.elapsed() >= Duration::from_millis(180) {
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let progress = total
                .map(|size| downloaded as f64 / size.max(1) as f64 * 100.0)
                .unwrap_or(0.0);
            let _ = app.emit(
                "download-progress",
                DownloadProgressEvent {
                    task_id: task_id.clone(),
                    downloaded,
                    total,
                    progress,
                    speed: downloaded as f64 / elapsed,
                },
            );
            last_emit = Instant::now();
        }
    }

    file.flush()
        .map_err(|err| format!("保存文件失败: {}", err))?;
    drop(file);

    // 同名不覆盖：自动变成 "name (1).ext"
    let final_path = unique_final_download_path(path);
    if final_path.exists() {
        std::fs::remove_file(&final_path).map_err(|err| format!("覆盖旧文件失败: {}", err))?;
    }
    std::fs::rename(&temp_path, &final_path).map_err(|err| format!("完成下载文件失败: {}", err))?;

    clear_download_cancel(&task_id);

    // 下载目录可由用户改到任意位置，放行该文件以便播放已下载曲目。
    let _ = app.asset_protocol_scope().allow_file(&final_path);

    let saved_path = final_path.to_string_lossy().to_string();
    let _ = app.emit(
        "download-completed",
        DownloadCompletedEvent {
            task_id,
            saved_path: saved_path.clone(),
            total: downloaded,
        },
    );

    Ok(saved_path)
}

#[tauri::command]
pub fn cancel_download(task_id: String) -> Result<bool, String> {
    if let Ok(map) = download_cancel_map().lock() {
        if let Some(flag) = map.get(&task_id) {
            flag.store(true, Ordering::SeqCst);
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn write_download_text_file(
    directory: String,
    file_name: String,
    contents: String,
) -> Result<String, String> {
    let path = safe_join_download_path(&directory, &file_name)?;
    std::fs::write(&path, contents.as_bytes())
        .map_err(|err| format!("写入下载附属文件失败: {}", err))?;
    Ok(path.to_string_lossy().to_string())
}
