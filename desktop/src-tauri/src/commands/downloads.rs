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
    const MARKERS: [&[u8]; 6] = [
        b"<!doctype",
        b"<html",
        b"<?xml",
        b"#extm3u",
        b"{",
        b"[",
    ];
    MARKERS
        .iter()
        .any(|marker| payload.starts_with(*marker))
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

    let cancel_flag = register_download_cancel(&task_id);
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
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .redirect(crate::outbound::guarded_redirect_policy("下载"))
        .build()
        .map_err(|err| format!("创建下载客户端失败: {}", err))?;

    let mut resp = apply_allowed_headers(client.get(&url), headers.as_ref())
        .send()
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

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|err| format!("读取下载数据失败: {}", err))?
    {
        if cancel_flag.load(Ordering::SeqCst) {
            drop(file);
            return Err("下载已取消".to_string());
        }
        if !sniffed {
            sniff_buffer.extend_from_slice(&chunk);
            if sniff_buffer.len() >= SNIFF_BYTES {
                sniffed = true;
                if looks_like_text_payload(&sniff_buffer) {
                    drop(file);
                    return Err("下载地址返回的是网页/文本而不是音频文件，可能已失效或无版权".to_string());
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
    if !sniffed && looks_like_text_payload(&sniff_buffer) {
        return Err("下载地址返回的是网页/文本而不是音频文件，可能已失效或无版权".to_string());
    }

    // 同名不覆盖：自动变成 "name (1).ext"。
    // unique_final_download_path 只在 1000 个重名全撞上时才原样返回已存在的路径，
    // 那种极端情形直接报错而不是删掉旧文件（「同名不覆盖」是这里的契约）。
    let final_path = unique_final_download_path(path);
    if final_path.exists() {
        return Err("同名文件已超过重名上限，请换个文件名或目录".to_string());
    }
    std::fs::rename(&temp_path, &final_path).map_err(|err| format!("完成下载文件失败: {}", err))?;
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
