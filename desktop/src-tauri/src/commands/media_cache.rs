fn ensure_remote_cache_url(url: &str, label: &str) -> Result<reqwest::Url, String> {
    crate::outbound::assert_public_url(url, &format!("{}缓存", label))
}

/// 只做字符净化（不提供回退）：查询侧用它判断调用方是否给了一个可用的 key。
pub(super) fn sanitize_cache_key(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(80)
        .collect()
}

pub(super) fn normalize_cache_key(value: Option<String>, fallback: &str) -> String {
    let raw = value.unwrap_or_else(|| format!("{:x}", md5::compute(fallback)));
    let normalized = sanitize_cache_key(&raw);
    if normalized.is_empty() {
        format!("{:x}", md5::compute(fallback))
    } else {
        normalized
    }
}

fn song_audio_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("获取 app_cache_dir 失败: {}", err))?
        .join(SONG_AUDIO_CACHE_DIR))
}

fn song_cover_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("获取 app_cache_dir 失败: {}", err))?
        .join(SONG_COVER_CACHE_DIR))
}

fn persistent_song_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("获取 app_data_dir 失败: {}", err))?
        .join("library")
        .join("cache.json"))
}

fn path_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let metadata = std::fs::metadata(path).map_err(|err| format!("读取缓存大小失败: {}", err))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut size = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|err| format!("遍历缓存目录失败: {}", err))?;
        let entry_metadata = entry
            .metadata()
            .map_err(|err| format!("读取缓存文件大小失败: {}", err))?;
        if entry_metadata.is_file() {
            size = size.saturating_add(entry_metadata.len());
        }
    }
    Ok(size)
}

fn extension_from_url(url: &reqwest::Url, allowed: &[&str], fallback: &str) -> String {
    let ext = Path::new(url.path())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if allowed.contains(&ext.as_str()) {
        ext
    } else {
        fallback.to_string()
    }
}

fn extension_from_content_type(
    content_type: Option<&str>,
    allowed: &[&str],
    fallback: &str,
) -> String {
    let normalized = content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    let ext = match normalized.as_str() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/aac" | "audio/aacp" => "aac",
        "audio/ogg" | "application/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/x-wav" => "wav",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => fallback,
    };

    if allowed.contains(&ext) {
        ext.to_string()
    } else {
        fallback.to_string()
    }
}

fn find_cached_file(
    cache_dir: &Path,
    key: &str,
    allowed: &[&str],
) -> Result<Option<PathBuf>, String> {
    for ext in allowed {
        let path = cache_dir.join(format!("{}.{}", key, ext));
        if !path.exists() {
            continue;
        }
        let size = std::fs::metadata(&path)
            .map_err(|err| format!("读取缓存文件失败: {}", err))?
            .len();
        if size > 0 {
            // 命中即刷新 mtime，让容量淘汰变成真正的 LRU（否则常用文件反而先被删）
            touch_cache_file(&path);
            return Ok(Some(path));
        }
    }
    Ok(None)
}

/**
 * 并发下载的唯一后缀。
 *
 * 同一首歌可能被重复请求（播放中再次点击同一首、多窗口、重试），若两个任务共用
 * 同一个 `.download` 临时文件，两次 `File::create` + 交错 `write_all` 会产出
 * 字节错乱的文件，再被 rename 成正式缓存后永久命中。
 */
pub(super) fn unique_temp_suffix() -> String {
    use std::sync::atomic::AtomicU64;
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or(0);
    format!("{}-{}-{}", std::process::id(), seq, nanos)
}

/// 把本地音乐的内嵌封面写入封面缓存目录，返回文件路径。
///
/// 扫描整库时把封面 base64 塞进 IPC 载荷、再持久化进 library.json，会让内存与
/// 库文件体积随曲目数线性膨胀（几千首即数百 MB）。落盘后前端只持有一个 asset
/// 短路径，且文件名带内容哈希，重复扫描不重复写盘、换了封面也不会命中旧图。
pub(super) fn persist_local_cover(
    app: &AppHandle,
    source_path: &Path,
    data: &[u8],
    ext: &str,
) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let dir = song_cover_cache_dir(app).ok()?;
    let path_hash = format!("{:x}", md5::compute(source_path.to_string_lossy().as_bytes()));
    let data_hash = format!("{:x}", md5::compute(data));
    let file_name = format!("{}-{}.{}", path_hash, &data_hash[..8], ext);
    let cover_path = dir.join(&file_name);

    if cover_path.exists() {
        return Some(cover_path.to_string_lossy().to_string());
    }
    std::fs::create_dir_all(&dir).ok()?;

    // 原子落盘：半截文件会被当成有效封面长期沿用
    let temp_path = dir.join(format!("{}.{}.tmp", file_name, unique_temp_suffix()));
    if std::fs::write(&temp_path, data).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return None;
    }
    if std::fs::rename(&temp_path, &cover_path).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return None;
    }
    Some(cover_path.to_string_lossy().to_string())
}

/// 下载/落盘临时文件守卫：任何提前返回（含 `?` 错误路径）都会清掉残片，
/// 成功提交（rename）后调用 `disarm()` 交出所有权。
pub(super) struct TempFileGuard {
    path: PathBuf,
    armed: bool,
}

impl TempFileGuard {
    pub(super) fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

async fn cache_remote_file(
    url: String,
    cache_key: String,
    cache_dir: PathBuf,
    allowed_exts: &[&str],
    fallback_ext: &str,
    label: &str,
) -> Result<String, String> {
    let url = ensure_remote_cache_url(&url, label)?;
    let key = normalize_cache_key(Some(cache_key), url.as_str());

    if let Some(path) = find_cached_file(&cache_dir, &key, allowed_exts)? {
        return Ok(path.to_string_lossy().to_string());
    }

    std::fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("创建{}缓存目录失败: {}", label, err))?;

    let client = reqwest::Client::builder()
        .user_agent(MEDIA_CACHE_UA)
        .redirect(crate::outbound::guarded_redirect_policy("媒体缓存"))
        .build()
        .map_err(|err| format!("创建{}下载客户端失败: {}", label, err))?;

    let mut response = client
        .get(url.clone())
        .header(USER_AGENT, MEDIA_CACHE_UA)
        .header(ACCEPT, "*/*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|err| format!("请求{}失败: {}", label, err))?;

    if !response.status().is_success() {
        return Err(format!("{}下载失败: HTTP {}", label, response.status()));
    }

    let fallback = extension_from_url(&url, allowed_exts, fallback_ext);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let ext = extension_from_content_type(content_type, allowed_exts, &fallback);
    let path = cache_dir.join(format!("{}.{}", key, ext));
    // 每个下载任务写自己的临时文件：并发任务之间不会互相踩写字节。
    let temp_path = cache_dir.join(format!("{}.{}.download", key, unique_temp_suffix()));
    let mut temp_guard = TempFileGuard::new(temp_path.clone());

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|err| format!("创建{}缓存文件失败: {}", label, err))?;
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("读取{}数据失败: {}", label, err))?
    {
        file.write_all(&chunk)
            .map_err(|err| format!("写入{}缓存失败: {}", label, err))?;
        downloaded += chunk.len() as u64;
    }
    file.flush()
        .map_err(|err| format!("保存{}缓存失败: {}", label, err))?;
    drop(file);

    if downloaded == 0 {
        return Err(format!("{}下载为空", label));
    }
    // 直接 rename 覆盖（Windows 上等价于 MOVEFILE_REPLACE_EXISTING）：
    // 先 remove 会制造「目标已删、新文件未就位」的空窗，并发下载时还会
    // 误删另一个任务刚提交的文件。
    std::fs::rename(&temp_path, &path).map_err(|err| format!("完成{}缓存失败: {}", label, err))?;
    temp_guard.disarm();

    Ok(path.to_string_lossy().to_string())
}

fn song_cache_stats(app: &AppHandle) -> Result<SongCacheStats, String> {
    let persistent_cache_size = path_size(&persistent_song_cache_path(app)?)?;
    let audio_cache_size = path_size(&song_audio_cache_dir(app)?)?;
    let cover_cache_size = path_size(&song_cover_cache_dir(app)?)?;
    Ok(SongCacheStats {
        persistent_cache_size,
        audio_cache_size,
        cover_cache_size,
        total_size: persistent_cache_size
            .saturating_add(audio_cache_size)
            .saturating_add(cover_cache_size),
    })
}

#[tauri::command]
pub fn get_song_cache_stats(app: AppHandle) -> Result<SongCacheStats, String> {
    song_cache_stats(&app)
}

/// 缓存目录容量清理：目录总大小超上限时按 modified time 从最旧开始删，直到回到上限内。
/// 单个文件删除失败（被占用/权限不足）跳过继续，不影响下载主流程。
/// 命中缓存时会刷新 mtime（见 `touch_cache_file`），因此这里的“最旧”是真正的 LRU。
/// 写入一律走「临时文件 + rename」，这里跳过 `.download` / `.tmp`，不会误删进行中的写入。
pub(super) fn enforce_cache_limit(cache_dir: &Path, max_bytes: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return; // 目录不存在视为缓存为空
    };

    let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let mut total_size = 0u64;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let path = entry.path();
        if is_temp_cache_file(&path) {
            continue;
        }
        let size = metadata.len();
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        total_size = total_size.saturating_add(size);
        files.push((path, size, modified));
    }

    if total_size <= max_bytes {
        return;
    }

    // oldest first，从最旧开始淘汰
    files.sort_by_key(|&(_, _, modified)| modified);
    for (path, size, _) in files {
        if total_size <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_size = total_size.saturating_sub(size);
        }
    }
}

/// 写入中的临时文件（下载 / 封面落盘），不能被容量清理当成完整文件删掉。
fn is_temp_cache_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("download") | Some("tmp")
    )
}

/// 命中缓存时刷新 mtime，让按时间淘汰成为真正的 LRU。
/// 失败无所谓（被占用 / 无写权限），淘汰退化为 FIFO，不影响本次命中。
pub(super) fn touch_cache_file(path: &Path) {
    let Ok(file) = std::fs::File::options().write(true).open(path) else {
        return;
    };
    let _ = file.set_modified(SystemTime::now());
}

#[tauri::command]
pub async fn cache_remote_audio(
    app: AppHandle,
    url: String,
    cache_key: String,
) -> Result<String, String> {
    let path = cache_remote_file(
        url,
        cache_key,
        song_audio_cache_dir(&app)?,
        AUDIO_CACHE_EXTS,
        "mp3",
        "歌曲音频",
    )
    .await?;
    enforce_cache_limit(&song_audio_cache_dir(&app)?, SONG_AUDIO_CACHE_MAX_BYTES);
    Ok(path)
}

const AUDIO_CACHE_EXTS: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];
const COVER_CACHE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

#[tauri::command]
pub async fn cache_remote_image(
    app: AppHandle,
    url: String,
    cache_key: String,
) -> Result<String, String> {
    let path = cache_remote_file(
        url,
        cache_key,
        song_cover_cache_dir(&app)?,
        COVER_CACHE_EXTS,
        "jpg",
        "封面图片",
    )
    .await?;
    // 封面缓存此前无上限，长期使用会无限增长（本地音乐的内嵌封面也落在这里）
    enforce_cache_limit(&song_cover_cache_dir(&app)?, SONG_COVER_CACHE_MAX_BYTES);
    Ok(path)
}

/// 只查缓存、不发起下载。
///
/// 播放路径用它区分「已缓存 → 直接放本地文件」与「未缓存 → 先播远端、后台落盘」，
/// 避免把整首歌下载完才开始播放。
#[tauri::command]
pub fn lookup_cached_media(
    app: AppHandle,
    kind: String,
    cache_key: String,
) -> Result<Option<String>, String> {
    let (cache_dir, allowed) = match kind.as_str() {
        "audio" => (song_audio_cache_dir(&app)?, AUDIO_CACHE_EXTS),
        "cover" => (song_cover_cache_dir(&app)?, COVER_CACHE_EXTS),
        other => return Err(format!("未知的媒体缓存类型: {}", other)),
    };
    // 查询侧不接受空 key：normalize_cache_key 在 key 为空时会回退到 md5("")（一个固定值），
    // 所有空 key 会撞到同一个文件；而写入侧的回退是 md5(url)，两边永远对不上 —— 与其
    // 静默返回错误结果，不如直接报错（前端目前总是传非空 key）。
    let key = sanitize_cache_key(&cache_key);
    if key.is_empty() {
        return Err("缓存 key 无效：不能为空".to_string());
    }
    Ok(find_cached_file(&cache_dir, &key, allowed)?.map(|path| path.to_string_lossy().to_string()))
}

/// 按 key 删除单条媒体缓存，返回是否真的删掉了文件。
///
/// 存在的理由：`clear_song_cache` 只能整体清空，而试听片段 / 坏链需要「按曲定向失效」——
/// 只清前端 URL 缓存不够，磁盘上的音频文件还在，
/// 而 `lookup_cached_media` 命中它就直接返回，下次播放仍会命中同一个试听片段。
#[tauri::command]
pub fn remove_cached_media(
    app: AppHandle,
    kind: String,
    cache_key: String,
) -> Result<bool, String> {
    let (cache_dir, allowed) = match kind.as_str() {
        "audio" => (song_audio_cache_dir(&app)?, AUDIO_CACHE_EXTS),
        "cover" => (song_cover_cache_dir(&app)?, COVER_CACHE_EXTS),
        other => return Err(format!("未知的媒体缓存类型: {}", other)),
    };
    let key = sanitize_cache_key(&cache_key);
    if key.is_empty() {
        return Err("缓存 key 无效：不能为空".to_string());
    }
    let Some(path) = find_cached_file(&cache_dir, &key, allowed)? else {
        return Ok(false);
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("删除媒体缓存失败: {}", err)),
    }
}

#[tauri::command]
pub fn clear_song_cache(app: AppHandle) -> Result<SongCacheStats, String> {
    crate::library::reset(&app, "cache")?;
    for cache_dir in [
        song_audio_cache_dir(&app)?,
        song_cover_cache_dir(&app)?,
    ] {
        if cache_dir.exists() {
            std::fs::remove_dir_all(&cache_dir)
                .map_err(|err| format!("删除歌曲缓存失败: {}", err))?;
        }
    }
    song_cache_stats(&app)
}


/// 用户明确选择的封面属于资料，不参与自动缓存淘汰或清空。
#[tauri::command]
pub fn save_manual_cover(app: AppHandle, data_url: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("manual-covers");
    write_manual_cover(&dir, &data_url).map(|path| path.to_string_lossy().into_owned())
}

fn write_manual_cover(dir: &Path, data_url: &str) -> Result<PathBuf, String> {
    use base64::Engine;
    const MAX_BYTES: usize = 10 * 1024 * 1024;
    let (header, encoded) = data_url.split_once(',').ok_or("封面必须是图片Data URL")?;
    let (extension, prefix): (&str, &[u8]) = match header {
        "data:image/png;base64" => ("png", b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg;base64" => ("jpg", b"\xff\xd8\xff"),
        "data:image/gif;base64" => ("gif", b"GIF8"),
        "data:image/bmp;base64" => ("bmp", b"BM"),
        "data:image/webp;base64" => ("webp", b"RIFF"),
        _ => return Err("不支持的封面图片类型".into()),
    };
    if encoded.len() > (MAX_BYTES + 2) / 3 * 4 { return Err("封面超过10MB".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| format!("封面解码失败: {}", e))?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(prefix)
        || (extension == "webp" && bytes.get(8..12) != Some(b"WEBP")) {
        return Err("封面内容或大小无效".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("创建封面资料目录失败: {}", e))?;
    let name = format!("{:x}.{}", md5::compute(&bytes), extension);
    let output = dir.join(&name);
    let temporary = dir.join(format!("{}.{}.tmp", name, unique_temp_suffix()));
    let mut guard = TempFileGuard::new(temporary.clone());
    let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&temporary, &output).map_err(|e| format!("保存手动封面失败: {}", e))?;
    guard.disarm();
    Ok(output)
}

#[cfg(test)]
mod manual_cover_tests {
    use super::*;
    #[test]
    fn rejects_active_content_and_wrong_image_magic() {
        let dir = std::env::temp_dir().join(format!("auralflow-manual-cover-{}", unique_temp_suffix()));
        assert!(write_manual_cover(&dir, "data:image/svg+xml;base64,PHN2Zy8+").is_err());
        assert!(write_manual_cover(&dir, "data:image/png;base64,bm90IGEgcG5n").is_err());
        assert!(!dir.exists());
    }
}
