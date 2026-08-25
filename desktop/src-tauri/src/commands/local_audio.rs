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
            use base64::{engine::general_purpose, Engine as _};
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
///
/// 用户的音乐目录可能在任意盘符，静态 assetProtocol scope 无法预先列举，
/// 因此扫描成功后按需把该目录动态加入 scope，让前端能用 asset 协议播放。
#[tauri::command]
pub async fn scan_directory(app: AppHandle, path: String) -> Result<Vec<AudioFile>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let mut audio_files = Vec::new();

    for entry in walkdir::WalkDir::new(&path_buf)
        .follow_links(false)
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

    app.asset_protocol_scope()
        .allow_directory(&path_buf, true)
        .map_err(|err| format!("放行本地音乐目录失败: {}", err))?;

    Ok(audio_files)
}

/// 获取单个音频文件信息
#[tauri::command]
pub async fn get_audio_info(app: AppHandle, path: String) -> Result<AudioFile, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let info =
        extract_metadata(&path_buf).ok_or_else(|| "Failed to extract metadata".to_string())?;

    // 单曲添加同样需要 asset 协议访问，按文件粒度放行。
    app.asset_protocol_scope()
        .allow_file(&path_buf)
        .map_err(|err| format!("放行本地音乐文件失败: {}", err))?;

    Ok(info)
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
                "wav" | "aac" | "ogg" | "opus" | "wma" | "ape" | "aiff" => {
                    Err(format!("该格式({})不支持写入元数据: {}", ext, read_err))
                }
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

    let path_str = path_buf
        .to_str()
        .ok_or_else(|| "路径含非法字符".to_string())?;
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

    use base64::{engine::general_purpose, Engine as _};
    let data = general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("base64 解码失败: {}", e))?;

    let mut tag = read_or_create_audio_tag(&path_buf)?;
    tag.set_album_cover(audiotags::Picture::new(&data, mime_type));

    let path_str = path_buf
        .to_str()
        .ok_or_else(|| "路径含非法字符".to_string())?;
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

    let mut tagged_file =
        lofty::read_from_path(&path_buf).map_err(|e| format!("读取文件失败: {}", e))?;

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "该格式不支持标签写入".to_string())?;

    if lyrics.trim().is_empty() {
        tag.remove_key(&ItemKey::Lyrics);
    } else {
        tag.insert_text(ItemKey::Lyrics, lyrics);
    }

    let path_str = path_buf
        .to_str()
        .ok_or_else(|| "路径含非法字符".to_string())?;
    tagged_file
        .save_to_path(path_str, lofty::config::WriteOptions::default())
        .map_err(|e| format!("写入歌词失败: {}", e))?;

    Ok(())
}
