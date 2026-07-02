//! Tauri IPC 命令 — 暴露给前端的 Rust 命令
//!
//! 涵盖：
//!   - 配置管理（加载/保存/重置/部分更新）
//!   - 压缩/解压 fallback
//!   - 本地音频扫描（沿用原 main.rs 的完整实现）
//!   - 音频信息获取

use crate::config;
use crate::models::*;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use serde_json::Value;
use std::net::IpAddr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const BILI_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BILI_AUDIO_CACHE_DIR: &str = "bili-audio";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongCacheStats {
    pub persistent_cache_size: u64,
    pub audio_cache_size: u64,
    pub total_size: u64,
}

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

// ─── 压缩/解压 ─────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum ZlibFormat {
    Zlib,
    Raw,
    Gzip,
}

fn parse_zlib_format(format: Option<String>) -> ZlibFormat {
    match format.as_deref() {
        Some("gzip") => ZlibFormat::Gzip,
        Some("deflate-raw") => ZlibFormat::Raw,
        _ => ZlibFormat::Zlib,
    }
}

#[tauri::command]
pub fn zlib_inflate(data: Vec<u8>, format: Option<String>) -> Result<Vec<u8>, String> {
    match parse_zlib_format(format) {
        ZlibFormat::Gzip => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::GzDecoder::new(data.as_slice());
            decoder
                .read_to_end(&mut output)
                .map_err(|err| format!("gzip 解压失败: {}", err))?;
            Ok(output)
        }
        ZlibFormat::Raw => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::DeflateDecoder::new(data.as_slice());
            decoder
                .read_to_end(&mut output)
                .map_err(|err| format!("raw deflate 解压失败: {}", err))?;
            Ok(output)
        }
        ZlibFormat::Zlib => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::ZlibDecoder::new(data.as_slice());
            match decoder.read_to_end(&mut output) {
                Ok(_) => Ok(output),
                Err(zlib_err) => {
                    let mut raw_output = Vec::new();
                    let mut raw_decoder = flate2::read::DeflateDecoder::new(data.as_slice());
                    raw_decoder
                        .read_to_end(&mut raw_output)
                        .map_err(|raw_err| {
                            format!(
                                "deflate 解压失败: zlib={}, raw={}",
                                zlib_err, raw_err
                            )
                        })?;
                    Ok(raw_output)
                }
            }
        }
    }
}

#[tauri::command]
pub fn zlib_deflate(data: Vec<u8>, format: Option<String>) -> Result<Vec<u8>, String> {
    match parse_zlib_format(format) {
        ZlibFormat::Gzip => {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("gzip 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("gzip 压缩失败: {}", err))
        }
        ZlibFormat::Raw => {
            let mut encoder =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("raw deflate 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("raw deflate 压缩失败: {}", err))
        }
        ZlibFormat::Zlib => {
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("deflate 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("deflate 压缩失败: {}", err))
        }
    }
}

// ─── B站 API 代理 ───────────────────────────────────────────────

fn ensure_bilibili_api_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| format!("B站请求地址无效: {}", err))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.bilibili.com") {
        return Err("B站请求只允许访问 https://api.bilibili.com".to_string());
    }
    Ok(parsed)
}

fn ensure_remote_https_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| format!("B站音频地址无效: {}", err))?;
    if parsed.scheme() != "https" {
        return Err("B站音频缓存只支持 HTTPS 地址".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "B站音频地址缺少 host".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("B站音频缓存不允许访问 localhost".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(addr) => addr.is_loopback() || addr.is_private() || addr.is_link_local(),
            IpAddr::V6(addr) => {
                addr.is_loopback() || addr.is_unique_local() || addr.is_unicast_link_local()
            }
        };
        if blocked {
            return Err("B站音频缓存不允许访问本地或内网地址".to_string());
        }
    }
    Ok(parsed)
}

fn normalize_cache_key(value: Option<String>, fallback: &str) -> String {
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

fn bili_audio_extension(url: &reqwest::Url) -> &'static str {
    let path = url.path().to_ascii_lowercase();
    if path.ends_with(".mp3") {
        "mp3"
    } else if path.ends_with(".flac") {
        "flac"
    } else if path.ends_with(".aac") {
        "aac"
    } else if path.ends_with(".ogg") {
        "ogg"
    } else if path.ends_with(".opus") {
        "opus"
    } else {
        "m4a"
    }
}

fn bili_audio_cache_path(
    app: &AppHandle,
    cache_key: Option<String>,
    url: &reqwest::Url,
) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("获取 app_cache_dir 失败: {}", err))?
        .join(BILI_AUDIO_CACHE_DIR);
    let key = normalize_cache_key(cache_key, url.as_str());
    Ok(cache_dir.join(format!("{}.{}", key, bili_audio_extension(url))))
}

fn bili_audio_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("获取 app_cache_dir 失败: {}", err))?
        .join(BILI_AUDIO_CACHE_DIR))
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

    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("读取缓存大小失败: {}", err))?;
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

fn song_cache_stats(app: &AppHandle) -> Result<SongCacheStats, String> {
    let persistent_cache_size = path_size(&persistent_song_cache_path(app)?)?;
    let audio_cache_size = path_size(&bili_audio_cache_dir(app)?)?;
    Ok(SongCacheStats {
        persistent_cache_size,
        audio_cache_size,
        total_size: persistent_cache_size.saturating_add(audio_cache_size),
    })
}

#[tauri::command]
pub fn get_song_cache_stats(app: AppHandle) -> Result<SongCacheStats, String> {
    song_cache_stats(&app)
}

#[tauri::command]
pub fn clear_song_cache(app: AppHandle) -> Result<SongCacheStats, String> {
    crate::library::reset(&app, "cache")?;
    let audio_cache_dir = bili_audio_cache_dir(&app)?;
    if audio_cache_dir.exists() {
        std::fs::remove_dir_all(&audio_cache_dir)
            .map_err(|err| format!("删除歌曲缓存失败: {}", err))?;
    }
    song_cache_stats(&app)
}

#[tauri::command]
pub async fn bili_get_json(
    url: String,
    cookie: Option<String>,
    referer: Option<String>,
) -> Result<Value, String> {
    let url = ensure_bilibili_api_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(BILI_UA)
        .build()
        .map_err(|err| format!("创建 B站请求客户端失败: {}", err))?;

    let mut request = client
        .get(url)
        .header(USER_AGENT, BILI_UA)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(ORIGIN, "https://www.bilibili.com")
        .header(REFERER, referer.unwrap_or_else(|| "https://www.bilibili.com/".to_string()));

    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        request = request.header(COOKIE, cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("B站请求失败: {}", err))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 B站响应失败: {}", err))?;

    if !status.is_success() {
        let detail = text.trim().chars().take(160).collect::<String>();
        return Err(format!(
            "B站请求失败: status={}{}",
            status,
            if detail.is_empty() {
                String::new()
            } else {
                format!("; body={}", detail)
            }
        ));
    }

    serde_json::from_str(&text).map_err(|err| format!("解析 B站响应失败: {}", err))
}

#[tauri::command]
pub async fn bili_cache_audio(
    app: AppHandle,
    url: String,
    referer: String,
    cookie: Option<String>,
    cache_key: Option<String>,
) -> Result<String, String> {
    let url = ensure_remote_https_url(&url)?;
    let path = bili_audio_cache_path(&app, cache_key, &url)?;
    if path.exists() {
        let size = std::fs::metadata(&path)
            .map_err(|err| format!("读取 B站音频缓存失败: {}", err))?
            .len();
        if size > 0 {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("创建 B站音频缓存目录失败: {}", err))?;
    }
    let temp_path = path.with_extension(format!(
        "{}.download",
        path.extension().and_then(|ext| ext.to_str()).unwrap_or("tmp")
    ));

    let client = reqwest::Client::builder()
        .user_agent(BILI_UA)
        .build()
        .map_err(|err| format!("创建 B站音频下载客户端失败: {}", err))?;
    let mut request = client
        .get(url)
        .header(USER_AGENT, BILI_UA)
        .header(ACCEPT, "*/*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(ORIGIN, "https://www.bilibili.com")
        .header(REFERER, referer);

    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        request = request.header(COOKIE, cookie);
    }

    let mut response = request
        .send()
        .await
        .map_err(|err| format!("请求 B站音频失败: {}", err))?;
    if !response.status().is_success() {
        return Err(format!("B站音频下载失败: HTTP {}", response.status()));
    }

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|err| format!("创建 B站音频缓存文件失败: {}", err))?;
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("读取 B站音频数据失败: {}", err))?
    {
        file.write_all(&chunk)
            .map_err(|err| format!("写入 B站音频缓存失败: {}", err))?;
        downloaded += chunk.len() as u64;
    }
    file.flush()
        .map_err(|err| format!("保存 B站音频缓存失败: {}", err))?;
    drop(file);

    if downloaded == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err("B站音频下载为空".to_string());
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| format!("覆盖 B站旧音频缓存失败: {}", err))?;
    }
    std::fs::rename(&temp_path, &path).map_err(|err| format!("完成 B站音频缓存失败: {}", err))?;

    Ok(path.to_string_lossy().to_string())
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
