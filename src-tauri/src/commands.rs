//! Tauri IPC 命令 — 暴露给前端的 Rust 命令
//!
//! 涵盖：
//!   - 配置管理（加载/保存/重置/部分更新）
//!   - 音源网关（搜索/URL解析/歌词/歌单详情）
//!   - 本地音频扫描（沿用原 main.rs 的完整实现）
//!   - 音频信息获取

use crate::config;
use crate::gateway::GatewayClient;
use crate::gateway::extract_csrf_token;
use crate::models::*;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// ─── 配置管理 ──────────────────────────────────────────────────

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    config::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    config::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn patch_settings(app: AppHandle, patch: Value) -> Result<AppSettings, String> {
    config::patch_settings(&app, patch)
}

#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<AppSettings, String> {
    config::reset_settings(&app)
}

// ─── 音源网关 ──────────────────────────────────────────────────

/// 搜索歌曲
#[tauri::command]
pub async fn search_songs(
    app: AppHandle,
    keyword: String,
    page: u32,
    limit: u32,
    source: String,
) -> Result<SearchResult, String> {
    let cookies = get_cookies_from_settings(&app)?;
    let client = GatewayClient::new(cookies);

    match source.as_str() {
        "wy" => client.search_songs(&keyword, page, limit).await,
        _ => Err(format!("不支持的音源: {}", source)),
    }
}

/// 搜索歌单
#[tauri::command]
pub async fn search_playlists(
    app: AppHandle,
    keyword: String,
    page: u32,
    limit: u32,
    source: String,
) -> Result<Vec<PlaylistInfo>, String> {
    let cookies = get_cookies_from_settings(&app)?;
    let client = GatewayClient::new(cookies);

    match source.as_str() {
        "wy" => client.search_playlists(&keyword, page, limit).await,
        _ => Err(format!("不支持的音源: {}", source)),
    }
}

/// 获取歌曲播放 URL
#[tauri::command]
pub async fn get_music_url(
    app: AppHandle,
    id: String,
    quality: String,
    source: String,
) -> Result<Option<String>, String> {
    let cookies = get_cookies_from_settings(&app)?;
    let client = GatewayClient::new(cookies);

    match source.as_str() {
        "wy" => client.get_music_url(&id, &quality).await,
        _ => Err(format!("不支持的音源: {}", source)),
    }
}

/// 获取歌词
#[tauri::command]
pub async fn get_lyric(
    app: AppHandle,
    id: String,
    source: String,
) -> Result<LyricResult, String> {
    let cookies = get_cookies_from_settings(&app)?;
    let client = GatewayClient::new(cookies);

    match source.as_str() {
        "wy" => client.get_lyric(&id).await,
        _ => Err(format!("不支持的音源: {}", source)),
    }
}

/// 获取歌单详情
#[tauri::command]
pub async fn get_playlist_detail(
    app: AppHandle,
    id: String,
    source: String,
) -> Result<Vec<MusicInfo>, String> {
    let cookies = get_cookies_from_settings(&app)?;
    let client = GatewayClient::new(cookies);

    match source.as_str() {
        "wy" => client.get_playlist_detail(&id).await,
        _ => Err(format!("不支持的音源: {}", source)),
    }
}

// ─── 网易云账号 API ───────────────────────────────────────────

fn get_wy_cookie(app: &AppHandle) -> Result<String, String> {
    let settings = config::load_settings(app)?;
    let cookie = settings.wy_cookie.unwrap_or_default().trim().to_string();
    Ok(cookie)
}

/// 检查网易云账号状态
#[tauri::command]
pub async fn wy_check_account(app: AppHandle) -> Result<AccountInfo, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() {
        return Err("未设置网易云 Cookie".to_string());
    }
    let csrf = extract_csrf_token(&cookie);
    let client = GatewayClient::new(Some(cookie));
    client.get_account_status(&csrf).await
}

/// 获取用户歌单列表
#[tauri::command]
pub async fn wy_get_user_playlists(app: AppHandle, uid: String) -> Result<Vec<PlaylistInfo>, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() { return Err("未设置网易云 Cookie".to_string()); }
    let csrf = extract_csrf_token(&cookie);
    let client = GatewayClient::new(Some(cookie));
    client.get_user_playlists(&uid, &csrf).await
}

/// 获取喜欢歌曲 ID 列表
#[tauri::command]
pub async fn wy_get_liked_ids(app: AppHandle, uid: String) -> Result<Vec<i64>, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() { return Err("未设置网易云 Cookie".to_string()); }
    let csrf = extract_csrf_token(&cookie);
    let client = GatewayClient::new(Some(cookie));
    client.get_liked_song_ids(&uid, &csrf).await
}

/// 获取每日推荐歌曲
#[tauri::command]
pub async fn wy_get_daily_recommend(app: AppHandle) -> Result<Vec<MusicInfo>, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() { return Err("未设置网易云 Cookie".to_string()); }
    let csrf = extract_csrf_token(&cookie);
    let client = GatewayClient::new(Some(cookie));
    client.get_daily_recommend_songs(&csrf).await
}

/// 通过 Cookie 获取歌单详情
#[tauri::command]
pub async fn wy_get_playlist_detail(app: AppHandle, id: String) -> Result<Vec<MusicInfo>, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() { return Err("未设置网易云 Cookie".to_string()); }
    let csrf = extract_csrf_token(&cookie);
    let client = GatewayClient::new(Some(cookie));
    client.get_playlist_detail_via_cookie(&id, &csrf).await
}

/// 前端 weapi 代理 — 接收已加密的 params，直接转发到网易云
#[tauri::command]
pub async fn wy_proxy_weapi(
    app: AppHandle,
    path: String,
    params: String,
    enc_sec_key: String,
) -> Result<String, String> {
    let cookie = get_wy_cookie(&app)?;
    if cookie.is_empty() { return Err("未设置网易云 Cookie".to_string()); }
    let client = GatewayClient::new(Some(cookie));
    let payload = vec![
        ("params".to_string(), params),
        ("encSecKey".to_string(), enc_sec_key),
    ];
    let origin_headers = [
        ("Origin".to_string(), "https://music.163.com".to_string()),
    ];

    let url = format!("https://music.163.com/weapi{}", path);
    let (status, resp) = client
        .raw_post_with_status(
            &url,
            &payload,
            Some(&origin_headers),
        )
        .await?;
    if resp.trim().is_empty() {
        return Err(format!("网易云返回空响应: {}; status={}", url, status));
    }
    Ok(resp)
}

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

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    task_id: String,
    url: String,
    directory: String,
    file_name: String,
) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("只支持 HTTP/HTTPS 下载地址".to_string());
    }

    let path = safe_join_download_path(&directory, &file_name)?;
    let temp_path = path.with_extension(format!(
        "{}.download",
        path.extension().and_then(|ext| ext.to_str()).unwrap_or("tmp")
    ));

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|err| format!("创建下载客户端失败: {}", err))?;

    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("请求下载地址失败: {}", err))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    let total = resp.content_length();
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|err| format!("创建文件失败: {}", err))?;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded = 0u64;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|err| format!("读取下载数据失败: {}", err))?
    {
        file.write_all(&chunk)
            .map_err(|err| format!("写入文件失败: {}", err))?;
        downloaded += chunk.len() as u64;

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

    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| format!("覆盖旧文件失败: {}", err))?;
    }
    std::fs::rename(&temp_path, &path).map_err(|err| format!("完成下载文件失败: {}", err))?;

    let saved_path = path.to_string_lossy().to_string();
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

// ─── 本地音频扫描 ───────────────────────────────────────────────

/// 判断是否为音频文件
fn is_audio_file(path: &std::path::Path) -> bool {
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            return SUPPORTED_FORMATS.contains(&ext_str.to_lowercase().as_str());
        }
    }
    false
}

/// 提取音频文件元数据 — 沿用原 main.rs 的完整实现
/// 使用 audiotags 读取标签 + lofty 读取歌词
fn extract_metadata(path: &std::path::Path) -> Option<AudioFile> {
    use lofty::file::TaggedFileExt;
    let metadata = std::fs::metadata(path).ok()?;
    let file_name = path.file_name()?.to_str()?;
    let format = path.extension()?.to_str()?.to_string();

    let mut title = file_name.to_string();
    let mut artist = String::from("Unknown Artist");
    let mut album = String::from("Unknown Album");
    let mut duration = 0u32;
    let mut cover_data: Option<String> = None;
    let mut lyrics: Option<String> = None;

    // 使用 audiotags 读取音频标签
    if let Ok(tag) = audiotags::Tag::new().read_from_path(path) {
        if let Some(t) = tag.title() {
            title = t.to_string();
        }
        if let Some(a) = tag.artist() {
            artist = a.to_string();
        }
        if let Some(alb) = tag.album_title() {
            album = alb.to_string();
        }
        if let Some(d) = tag.duration() {
            duration = d as u32;
        }

        // 提取封面并转换为 Base64
        if let Some(picture) = tag.album_cover() {
            use base64::{Engine as _, engine::general_purpose};
            let base64_string = general_purpose::STANDARD.encode(picture.data);
            let mime_type = match picture.mime_type {
                audiotags::MimeType::Png => "image/png",
                audiotags::MimeType::Jpeg => "image/jpeg",
                audiotags::MimeType::Tiff => "image/tiff",
                audiotags::MimeType::Bmp => "image/bmp",
                audiotags::MimeType::Gif => "image/gif",
            };
            cover_data = Some(format!("data:{};base64,{}", mime_type, base64_string));
        }
    }

    // 使用 lofty 读取歌词（支持 ID3v2 USLT / Vorbis LYRICS）
    if let Ok(tagged_file) = lofty::read_from_path(path) {
        if let Some(tag) = tagged_file.primary_tag() {
            for item in tag.items() {
                let key_str = format!("{:?}", item.key());
                if key_str.contains("LYRICS") || key_str.contains("UNSYNCEDLYRICS") {
                    if let Some(text) = item.value().text() {
                        lyrics = Some(text.to_string());
                        break;
                    }
                }
            }
        }
    }

    Some(AudioFile {
        id: format!("{:x}", md5::compute(path.to_str()?)),
        path: path.to_str()?.to_string(),
        title,
        artist,
        album,
        duration,
        format,
        size: metadata.len(),
        cover_data,
        lyrics,
    })
}

/// 扫描本地目录中的音频文件（递归）
#[tauri::command]
pub async fn scan_directory(path: String) -> Result<Vec<AudioFile>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let mut audio_files = Vec::new();

    for entry in walkdir::WalkDir::new(path_buf)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && is_audio_file(path) {
            if let Some(audio_file) = extract_metadata(path) {
                audio_files.push(audio_file);
            }
        }
    }

    Ok(audio_files)
}

/// 获取单个音频文件信息
#[tauri::command]
pub async fn get_audio_info(path: String) -> Result<AudioFile, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    extract_metadata(&path_buf).ok_or_else(|| "Failed to extract metadata".to_string())
}

/// 写入音频文件元数据（标题/艺术家/专辑），通过 audiotags。
/// 传 None 的字段保持原值不变。
fn read_or_create_audio_tag(
    path: &std::path::Path,
) -> Result<Box<dyn audiotags::AudioTag + Send + Sync>, String> {
    match audiotags::Tag::new().read_from_path(path) {
        Ok(tag) => Ok(tag),
        Err(read_err) => {
            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or_default()
                .to_lowercase();
            match ext.as_str() {
                "mp3" => Ok(Box::new(audiotags::Id3v2Tag::new())),
                "flac" => Ok(Box::new(audiotags::FlacTag::new())),
                "m4a" | "m4b" | "m4p" | "m4v" | "mp4" => Ok(Box::new(audiotags::Mp4Tag::new())),
                _ => Err(format!("读取标签失败: {}", read_err)),
            }
        }
    }
}

#[tauri::command]
pub async fn set_audio_metadata(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let mut tag = read_or_create_audio_tag(&path_buf)?;

    if let Some(t) = title {
        tag.set_title(&t);
    }
    if let Some(a) = artist {
        tag.set_artist(&a);
    }
    if let Some(al) = album {
        tag.set_album_title(&al);
    }

    let path_str = path_buf.to_str().ok_or_else(|| "路径含非法字符".to_string())?;
    tag.write_to_path(path_str)
        .map_err(|e| format!("写入标签失败: {}", e))?;

    Ok(())
}

/// 写入封面图片。cover_data 为 data URL：`data:image/jpeg;base64,...`
#[tauri::command]
pub async fn set_audio_cover(path: String, cover_data: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    // 解析 data URL
    let (mime_str, b64) = cover_data
        .split_once(',')
        .ok_or_else(|| "封面 data URL 格式无效".to_string())?;
    let mime_str = mime_str.to_lowercase();
    let mime_type = if mime_str.contains("png") {
        audiotags::MimeType::Png
    } else if mime_str.contains("jpeg") || mime_str.contains("jpg") {
        audiotags::MimeType::Jpeg
    } else if mime_str.contains("bmp") {
        audiotags::MimeType::Bmp
    } else if mime_str.contains("gif") {
        audiotags::MimeType::Gif
    } else {
        audiotags::MimeType::Jpeg
    };

    use base64::{Engine as _, engine::general_purpose};
    let data = general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("base64 解码失败: {}", e))?;

    let mut tag = read_or_create_audio_tag(&path_buf)?;
    tag.set_album_cover(audiotags::Picture::new(&data, mime_type));

    let path_str = path_buf.to_str().ok_or_else(|| "路径含非法字符".to_string())?;
    tag.write_to_path(path_str)
        .map_err(|e| format!("写入封面失败: {}", e))?;

    Ok(())
}

/// 写入内嵌歌词（ID3 USLT / Vorbis LYRICS），通过 lofty。
/// 传空串则清除歌词。
#[tauri::command]
pub async fn set_audio_lyrics(path: String, lyrics: String) -> Result<(), String> {
    use lofty::file::AudioFile;
    use lofty::file::TaggedFileExt;
    use lofty::tag::ItemKey;

    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let mut tagged_file = lofty::read_from_path(&path_buf)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "该格式不支持标签写入".to_string())?;

    if lyrics.trim().is_empty() {
        tag.remove_key(&ItemKey::Lyrics);
    } else {
        tag.insert_text(ItemKey::Lyrics, lyrics);
    }

    let path_str = path_buf.to_str().ok_or_else(|| "路径含非法字符".to_string())?;
    tagged_file
        .save_to_path(path_str, lofty::config::WriteOptions::default())
        .map_err(|e| format!("写入歌词失败: {}", e))?;

    Ok(())
}

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

/// 切换桌面歌词窗口（开/关）。返回 true=已打开，false=已关闭。
#[tauri::command]
pub fn toggle_lyric_window(app: AppHandle) -> Result<bool, String> {
    crate::lyric_window::toggle(&app)
}

/// 播放器按钮专用桌面歌词切换。
///
/// 规则：未打开则打开；已打开未锁则关闭；已打开已锁则先解锁，不直接关闭。
#[tauri::command]
pub fn toggle_lyric_window_from_player(
    app: AppHandle,
) -> Result<crate::lyric_window::LyricWindowPlayerToggleResult, String> {
    crate::lyric_window::toggle_from_player(&app)
}

/// 播放器按钮第一步：若桌面歌词处于锁定或锁定意图状态，只解锁，不关闭。
#[tauri::command]
pub fn unlock_lyric_window_from_player(
    app: AppHandle,
) -> Result<crate::lyric_window::LyricWindowPlayerUnlockResult, String> {
    crate::lyric_window::unlock_from_player(&app)
}

/// 查询桌面歌词窗口状态，以后端运行时状态为准。
#[tauri::command]
pub fn get_lyric_window_state(app: AppHandle) -> crate::lyric_window::LyricWindowState {
    crate::lyric_window::state(&app)
}

/// 标记桌面歌词即将锁定；用于播放器按钮在后端窗口状态滞后时仍可先解锁。
#[tauri::command]
pub fn prepare_lyric_window_lock(app: AppHandle) -> u64 {
    crate::lyric_window::prepare_lock_intent(&app)
}

/// 查询桌面歌词窗口是否已打开。
#[tauri::command]
pub fn is_lyric_window_open(app: AppHandle) -> bool {
    crate::lyric_window::is_open(&app)
}

/// 设置桌面歌词窗口的置顶状态（同时持久化）
#[tauri::command]
pub fn set_lyric_window_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    crate::lyric_window::set_pinned(&app, pinned)
}

/// 设置桌面歌词窗口锁定状态（同时持久化）
#[tauri::command]
pub fn set_lyric_window_locked(
    app: AppHandle,
    locked: bool,
    lock_epoch: Option<u64>,
    lock_source: Option<String>,
) -> Result<bool, String> {
    crate::lyric_window::set_locked(
        &app,
        locked,
        lock_epoch,
        lock_source.as_deref().unwrap_or("ipc"),
    )
}

// ─── 辅助函数 ──────────────────────────────────────────────────

fn get_cookies_from_settings(app: &AppHandle) -> Result<Option<String>, String> {
    let cookie = get_wy_cookie(app)?;
    if cookie.is_empty() {
        Ok(None)
    } else {
        Ok(Some(cookie))
    }
}
