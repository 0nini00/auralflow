fn ensure_remote_cache_url(url: &str, label: &str) -> Result<reqwest::Url, String> {
    crate::outbound::assert_public_url(url, &format!("{}缓存", label))
}

pub(super) fn normalize_cache_key(value: Option<String>, fallback: &str) -> String {
    let raw = value.unwrap_or_else(|| format!("{:x}", md5::compute(fallback)));
    let normalized: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(80)
        .collect();
    if normalized.is_empty() {
        format!("{:x}", md5::compute(fallback))
    } else {
        normalized
    }
}

pub(super) fn bili_audio_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("获取 app_cache_dir 失败: {}", err))?
        .join(BILI_AUDIO_CACHE_DIR))
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
            return Ok(Some(path));
        }
    }
    Ok(None)
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
        .user_agent(BILI_UA)
        .redirect(crate::outbound::guarded_redirect_policy("媒体缓存"))
        .build()
        .map_err(|err| format!("创建{}下载客户端失败: {}", label, err))?;

    let mut response = client
        .get(url.clone())
        .header(USER_AGENT, BILI_UA)
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
    let temp_path = path.with_extension(format!("{}.download", ext));

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
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("{}下载为空", label));
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| format!("覆盖旧{}缓存失败: {}", label, err))?;
    }
    std::fs::rename(&temp_path, &path).map_err(|err| format!("完成{}缓存失败: {}", label, err))?;

    Ok(path.to_string_lossy().to_string())
}

fn song_cache_stats(app: &AppHandle) -> Result<SongCacheStats, String> {
    let persistent_cache_size = path_size(&persistent_song_cache_path(app)?)?;
    let audio_cache_size = path_size(&song_audio_cache_dir(app)?)?
        .saturating_add(path_size(&bili_audio_cache_dir(app)?)?);
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

/// song-audio 缓存 LRU 容量清理：目录总大小超上限时按 modified time 从最旧开始删，
/// 直到回到上限以内。单个文件删除失败（被占用/权限不足）跳过继续，不影响下载主流程。
/// 下载走「.download 临时文件 + rename」落盘，这里跳过 .download 后缀，
/// 扫到的都是完整文件，不会误删进行中的下载。只管 song-audio，不碰 song-covers/bili-audio。
fn enforce_song_audio_cache_limit(app: &AppHandle) {
    let Ok(cache_dir) = song_audio_cache_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&cache_dir) else {
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
        if path.extension().and_then(|ext| ext.to_str()) == Some("download") {
            continue;
        }
        let size = metadata.len();
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        total_size = total_size.saturating_add(size);
        files.push((path, size, modified));
    }

    if total_size <= SONG_AUDIO_CACHE_MAX_BYTES {
        return;
    }

    // oldest first，从最旧开始淘汰
    files.sort_by_key(|&(_, _, modified)| modified);
    for (path, size, _) in files {
        if total_size <= SONG_AUDIO_CACHE_MAX_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_size = total_size.saturating_sub(size);
        }
    }
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
    enforce_song_audio_cache_limit(&app);
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
    cache_remote_file(
        url,
        cache_key,
        song_cover_cache_dir(&app)?,
        COVER_CACHE_EXTS,
        "jpg",
        "封面图片",
    )
    .await
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
    let key = normalize_cache_key(Some(cache_key), "");
    Ok(find_cached_file(&cache_dir, &key, allowed)?.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn clear_song_cache(app: AppHandle) -> Result<SongCacheStats, String> {
    crate::library::reset(&app, "cache")?;
    for cache_dir in [
        song_audio_cache_dir(&app)?,
        bili_audio_cache_dir(&app)?,
        song_cover_cache_dir(&app)?,
    ] {
        if cache_dir.exists() {
            std::fs::remove_dir_all(&cache_dir)
                .map_err(|err| format!("删除歌曲缓存失败: {}", err))?;
        }
    }
    song_cache_stats(&app)
}
