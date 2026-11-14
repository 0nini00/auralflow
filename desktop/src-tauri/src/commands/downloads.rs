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
fn download_cancel_map() -> &'static Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>> =
        OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_download_cancel(task_id: &str) -> Result<tokio::sync::watch::Receiver<bool>, String> {
    let mut map = download_cancel_map()
        .lock()
        .map_err(|_| "下载取消状态锁损坏")?;
    if map.contains_key(task_id) {
        return Err("下载任务 ID 已在使用".to_string());
    }
    let (sender, receiver) = tokio::sync::watch::channel(false);
    map.insert(task_id.to_string(), sender);
    Ok(receiver)
}

fn clear_download_cancel(task_id: &str) {
    if let Ok(mut map) = download_cancel_map().lock() {
        map.remove(task_id);
    }
}

async fn await_download_step<T>(
    cancel: &mut tokio::sync::watch::Receiver<bool>,
    operation: impl std::future::Future<Output = Result<T, reqwest::Error>>,
) -> Result<T, String> {
    if *cancel.borrow() {
        return Err("下载已取消".to_string());
    }
    tokio::select! {
        biased;
        _ = cancel.changed() => Err("下载已取消".to_string()),
        result = operation => result.map_err(|err| err.to_string()),
    }
}

#[cfg(windows)]
fn rename_download_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // flags=0 保留 Windows 的原子拒绝覆盖语义，也适用于不支持硬链接的下载卷。
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn rename_download_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::hard_link(source, destination)?;
    std::fs::remove_file(source)
}

/// 取消登记守卫：任何提前返回路径都会把 task_id 从取消表里摘掉。
///
/// 原先只在部分分支手动清理，HTTP 失败 / 建文件失败 / 读流出错等路径会漏，
/// 结果是取消表条目永久残留（`cancel_download` 对旧 id 一直返回 true，
/// 且这张静态 map 会随失败次数无限增长）。
struct DownloadCancelGuard {
    task_id: String,
}

impl Drop for DownloadCancelGuard {
    fn drop(&mut self) {
        clear_download_cancel(&self.task_id);
    }
}

/// 嗅探窗口：音频容器头与错误页都在文件开头就能区分。
const SNIFF_BYTES: usize = 512;

/// 响应头明确是文本类内容时直接判定失败。
///
/// CDN / 代理在无版权、链接过期、鉴权失败时经常返回 **HTTP 200 + HTML 错误页**，
/// 旧实现只看状态码和字节流，会把整页 HTML 存成 `.flac` 并当作下载成功。
fn is_textual_content_type(content_type: &str) -> bool {
    let value = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    value.starts_with("text/")
        || value.contains("html")
        || value.contains("json")
        || value.contains("xml")
}

/// 首块内容嗅探：拦住没有 Content-Type 或类型谎报的错误页。
///
/// 只看「像不像文本负载」，不要求命中具体音频魔数——部分源站会包一层 ID3/自定义头，
/// 强制匹配容器头会把正常文件误杀。
fn looks_like_text_payload(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(SNIFF_BYTES)];
    // 部分错误页带 UTF-8 BOM，先剥掉再做嗅探。
    let head = head.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(head);
    let start = head
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(head.len());
    let payload = head[start..].to_ascii_lowercase();
    const MARKERS: [&[u8]; 6] = [b"<!doctype", b"<html", b"<?xml", b"#extm3u", b"{", b"["];
    MARKERS.iter().any(|marker| payload.starts_with(marker))
}

fn validate_download_payload(downloaded: u64, sniffed: bool, prefix: &[u8]) -> Result<(), String> {
    if downloaded == 0 {
        return Err("下载地址返回空文件".to_string());
    }
    if !sniffed && looks_like_text_payload(prefix) {
        return Err("下载地址返回的是网页/文本而不是音频文件，可能已失效或无版权".to_string());
    }
    Ok(())
}

fn publish_download(temp_path: &Path, path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    for i in 0..1000 {
        let name = match (i, ext) {
            (0, _) => path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            (_, Some(e)) => format!("{} ({}).{}", stem, i, e),
            (_, None) => format!("{} ({})", stem, i),
        };
        let candidate = parent.join(name);
        match rename_download_no_replace(temp_path, &candidate) {
            Ok(()) => return Ok(candidate),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("完成下载文件失败: {}", err)),
        }
    }
    Err("同名文件已超过重名上限，请换个文件名或目录".to_string())
}

/// 允许调用方附加的请求头白名单。
///
/// 前端只能传这些防盗链相关的头（大小写不敏感）。`download_file` 的目标地址由音源
/// 解析结果决定，若不限制键名，这个命令就变成了「任意请求头注入器」。
const ALLOWED_HEADER_KEYS: [&str; 3] = ["referer", "origin", "user-agent"];

fn apply_allowed_headers(
    mut request: reqwest::RequestBuilder,
    headers: Option<&HashMap<String, String>>,
) -> reqwest::RequestBuilder {
    let Some(headers) = headers else {
        return request;
    };
    for (key, value) in headers {
        if !ALLOWED_HEADER_KEYS.contains(&key.to_ascii_lowercase().as_str()) {
            continue;
        }
        // 头值里的换行会被 reqwest 拒绝，这里提前过滤掉更明确的错误来源。
        if value.contains('\r') || value.contains('\n') {
            continue;
        }
        request = request.header(key.as_str(), value.as_str());
    }
    request
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    task_id: String,
    url: String,
    directory: String,
    file_name: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    // 下载地址由音源解析结果决定，属于运行时可控目标，统一走出站校验。
    crate::outbound::assert_public_url(&url, "下载")?;

    let mut cancel_flag = register_download_cancel(&task_id)?;
    let _cancel_guard = DownloadCancelGuard {
        task_id: task_id.clone(),
    };
    let path = safe_join_download_path(&directory, &file_name)?;
    // 唯一临时名 + 守卫：重复下载同一文件时不会互相踩写，任何失败路径也会清掉残片
    let temp_path = path.with_extension(format!(
        "{}.{}.download",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("tmp"),
        unique_temp_suffix()
    ));
    let mut temp_guard = TempFileGuard::new(temp_path.clone());

    let client = reqwest::Client::builder()
        .connect_timeout(super::MEDIA_CONNECT_TIMEOUT)
        .read_timeout(super::MEDIA_READ_TIMEOUT)
        .timeout(super::MEDIA_TOTAL_TIMEOUT)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(crate::outbound::guarded_redirect_policy("下载"))
        .build()
        .map_err(|err| format!("创建下载客户端失败: {}", err))?;

    let mut resp = await_download_step(
        &mut cancel_flag,
        apply_allowed_headers(client.get(&url), headers.as_ref()).send(),
    )
    .await
    .map_err(|err| format!("请求下载地址失败: {}", err))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    // 先看响应头：CDN 在无版权 / 链接过期时经常回 200 + HTML 错误页。
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    if is_textual_content_type(&content_type) {
        return Err(format!(
            "下载地址返回的不是音频文件（Content-Type: {}），可能已失效或无版权",
            content_type
        ));
    }

    let total = resp.content_length();
    let mut file =
        std::fs::File::create(&temp_path).map_err(|err| format!("创建文件失败: {}", err))?;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded = 0u64;

    const MAX_DOWNLOAD_SIZE: u64 = 2 * 1024 * 1024 * 1024; // 2GiB

    // 内容嗅探：Content-Type 缺失或被谎报时，用实际内容兜住「200 + HTML」。
    // 判定前攒够 SNIFF_BYTES（或流提前结束）：CDN 可能把错误页拆成小片，
    // 只看第一个 chunk 会让 `<` 与后续分片分离、嗅探漏网。
    let mut sniff_buffer: Vec<u8> = Vec::new();
    let mut sniffed = false;
    const SNIFF_BYTES: usize = 512;

    while let Some(chunk) = await_download_step(&mut cancel_flag, resp.chunk())
        .await
        .map_err(|err| format!("读取下载数据失败: {}", err))?
    {
        if *cancel_flag.borrow() {
            drop(file);
            return Err("下载已取消".to_string());
        }
        if !sniffed {
            sniff_buffer.extend_from_slice(&chunk);
            if sniff_buffer.len() >= SNIFF_BYTES {
                sniffed = true;
                if looks_like_text_payload(&sniff_buffer) {
                    drop(file);
                    return Err(
                        "下载地址返回的是网页/文本而不是音频文件，可能已失效或无版权".to_string(),
                    );
                }
            }
        }
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .map_err(|err| format!("写入文件失败: {}", err))?;
        if downloaded > MAX_DOWNLOAD_SIZE {
            drop(file);
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

    // 整个响应比 SNIFF_BYTES 还短（多数是错误页/占位文本）：提交前再嗅探一次
    validate_download_payload(downloaded, sniffed, &sniff_buffer)?;

    if *cancel_flag.borrow() {
        return Err("下载已取消".to_string());
    }
    let final_path = publish_download(&temp_path, &path)?;
    temp_guard.disarm();

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
            flag.send_replace(true);
            return Ok(true);
        }
    }
    Ok(false)
}

/// 写下载附属文件（目前唯一用途：下载完成后在旁边补一份 `.lrc` 歌词）。
///
/// 这个命令与 `download_file` 跑在同一个 WebView 里、自定义音源脚本同样可达，
/// 所以收得比通用写文件更紧：只允许 `.lrc`、目录必须已存在（不代建）、
/// 且绝不覆盖既有文件——「任意路径 + 任意文件名 + 覆盖」等于给脚本一个
/// 无提示改写用户文件的写原语。
#[tauri::command]
pub fn write_download_text_file(
    directory: String,
    file_name: String,
    contents: String,
) -> Result<String, String> {
    let file_component = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    if file_component.is_empty() || file_component == "." || file_component == ".." {
        return Err("文件名无效".to_string());
    }
    if !file_component.to_ascii_lowercase().ends_with(".lrc") {
        return Err("只允许写入 .lrc 歌词文件".to_string());
    }

    let dir = PathBuf::from(&directory);
    if !dir.is_dir() {
        return Err("下载目录不存在".to_string());
    }

    let path = dir.join(file_component);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::AlreadyExists => "同名歌词文件已存在，拒绝覆盖".to_string(),
            _ => format!("写入下载附属文件失败: {}", err),
        })?;
    file.write_all(contents.as_bytes())
        .map_err(|err| format!("写入下载附属文件失败: {}", err))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn empty_http_success_is_rejected_before_publishing() {
        assert!(validate_download_payload(0, false, &[]).is_err());
    }

    fn cancel_stalled_http(response_headers: Option<&'static [u8]>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task_id = format!("http-cancel-{}", unique_temp_suffix());
        let mut cancel = register_download_cancel(&task_id).unwrap();
        let _guard = DownloadCancelGuard {
            task_id: task_id.clone(),
        };
        let (done, released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0u8; 2048];
            assert!(socket.read(&mut request).unwrap() > 0);
            if let Some(headers) = response_headers {
                socket.write_all(headers).unwrap();
            }
            std::thread::sleep(Duration::from_millis(30));
            assert!(cancel_download(task_id).unwrap());
            let _ = released.recv_timeout(Duration::from_secs(2));
        });
        let result = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(1), async {
                let request = reqwest::Client::new().get(url).send();
                if response_headers.is_none() {
                    return await_download_step(&mut cancel, request).await.map(|_| ());
                }
                let mut response = await_download_step(&mut cancel, request).await?;
                await_download_step(&mut cancel, response.chunk())
                    .await
                    .map(|_| ())
            })
            .await
        });
        let _ = done.send(());
        server.join().unwrap();
        assert_eq!(
            result.expect("停滞连接应由取消信号立即唤醒").unwrap_err(),
            "下载已取消"
        );
    }

    #[test]
    fn cancellation_interrupts_waiting_for_http_headers() {
        cancel_stalled_http(None);
    }

    #[test]
    fn cancellation_interrupts_a_stalled_http_body() {
        cancel_stalled_http(Some(b"HTTP/1.1 200 OK\r\nContent-Length: 512\r\n\r\n"));
    }

    #[test]
    fn concurrent_same_name_downloads_keep_each_payload() {
        let dir = std::env::temp_dir().join(format!(
            "auralflow-concurrent-publish-{}",
            unique_temp_suffix()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|index| {
                let dir = dir.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let source = dir.join(format!("{}.download", index));
                    std::fs::write(&source, index.to_string()).unwrap();
                    barrier.wait();
                    let path = publish_download(&source, &dir.join("song.mp3")).unwrap();
                    (path, index.to_string())
                })
            })
            .collect();
        for worker in workers {
            let (path, expected) = worker.join().unwrap();
            assert_eq!(std::fs::read_to_string(path).unwrap(), expected);
        }
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 8);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cancellation_wakes_a_pending_network_operation() {
        let task_id = format!("cancel-test-{}", unique_temp_suffix());
        let mut cancel = register_download_cancel(&task_id).unwrap();
        let _guard = DownloadCancelGuard {
            task_id: task_id.clone(),
        };
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            assert!(cancel_download(task_id).unwrap());
        });
        let outcome = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                Duration::from_millis(250),
                await_download_step(
                    &mut cancel,
                    std::future::pending::<Result<(), reqwest::Error>>(),
                ),
            )
            .await
        });
        worker.join().unwrap();
        assert_eq!(
            outcome
                .expect("取消必须唤醒没有网络响应的任务")
                .unwrap_err(),
            "下载已取消"
        );
    }

    #[test]
    fn final_publish_never_replaces_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("auralflow-publish-{}", unique_temp_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("new.download");
        let target = dir.join("song.mp3");
        std::fs::write(&source, b"new").unwrap();
        std::fs::write(&target, b"original").unwrap();
        let result = rename_download_no_replace(&source, &target);
        let contents = std::fs::read(&target).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(result.is_err(), "目标已存在时必须拒绝替换");
        assert_eq!(contents, b"original");
    }

    #[test]
    fn sidecar_writer_only_accepts_new_lrc_files_in_existing_dirs() {
        let dir = std::env::temp_dir().join(format!("auralflow-sidecar-{}", unique_temp_suffix()));
        std::fs::create_dir_all(&dir).unwrap();

        // 正常路径：新 .lrc 写入成功
        let written = write_download_text_file(
            dir.to_string_lossy().to_string(),
            "song.lrc".to_string(),
            "歌词".to_string(),
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&written).unwrap(), "歌词");

        // 已存在的同名文件拒绝覆盖
        assert!(write_download_text_file(
            dir.to_string_lossy().to_string(),
            "song.lrc".to_string(),
            "替换内容".to_string(),
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(&written).unwrap(), "歌词");

        // 非 .lrc 文件名拒绝
        assert!(write_download_text_file(
            dir.to_string_lossy().to_string(),
            "song.txt".to_string(),
            "x".to_string(),
        )
        .is_err());

        // 目录不存在时不再代建
        let missing = dir.join("missing-dir");
        assert!(write_download_text_file(
            missing.to_string_lossy().to_string(),
            "song.lrc".to_string(),
            "x".to_string(),
        )
        .is_err());
        assert!(!missing.exists());

        // 借文件名逃出目录的写法仍被 file_name() 收敛回目录内
        let escaped = write_download_text_file(
            dir.to_string_lossy().to_string(),
            "../up.lrc".to_string(),
            "x".to_string(),
        )
        .unwrap();
        assert!(Path::new(&escaped).parent().unwrap().ends_with(dir.file_name().unwrap()));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
