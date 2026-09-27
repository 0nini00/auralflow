// ─── 本地音频扫描 ───────────────────────────────────────────────

/// 判断是否为音频文件
fn is_audio_file(path: &std::path::Path) -> bool {
    // 标签写入留下的临时副本（见 write_audio_file_safely）保留了原扩展名，
    // 不能被扫描当成一首歌导入。
    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
        if name.contains(".aftmp.") {
            return false;
        }
    }
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            return SUPPORTED_FORMATS.contains(&ext_str.to_lowercase().as_str());
        }
    }
    false
}

/// 提取音频文件元数据 — 沿用原 main.rs 的完整实现
///
/// `include_heavy_fields = false`（整目录扫描）时跳过大字段：不生成封面 base64，
/// 也不做 lofty 的第二次解析去取内嵌歌词 —— 否则一次扫描就是「整库封面 base64 +
/// 双倍标签解析」，几千首的库直接卡死。单文件查询（get_audio_info）仍取全量。
fn extract_metadata(app: &AppHandle, path: &std::path::Path, include_heavy_fields: bool) -> Option<AudioFile> {
    use lofty::file::TaggedFileExt;
    let metadata = std::fs::metadata(path).ok()?;
    let file_name = path.file_name()?.to_str()?;
    let format = path.extension()?.to_str()?.to_string();

    let mut title = file_name.to_string();
    let mut artist = String::from("Unknown Artist");
    let mut album = String::from("Unknown Album");
    let mut duration = 0u32;
    let mut cover_data: Option<String> = None;
    let mut cover_path: Option<String> = None;
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

        // 封面一律落盘成文件（前端只持短路径）；base64 仅在单文件查询时附带
        if let Some(picture) = tag.album_cover() {
            let (mime_type, ext) = match picture.mime_type {
                audiotags::MimeType::Png => ("image/png", "png"),
                audiotags::MimeType::Jpeg => ("image/jpeg", "jpg"),
                audiotags::MimeType::Tiff => ("image/tiff", "tiff"),
                audiotags::MimeType::Bmp => ("image/bmp", "bmp"),
                audiotags::MimeType::Gif => ("image/gif", "gif"),
            };
            cover_path = persist_local_cover(app, path, picture.data, ext);
            if include_heavy_fields {
                use base64::{engine::general_purpose, Engine as _};
                let base64_string = general_purpose::STANDARD.encode(picture.data);
                cover_data = Some(format!("data:{};base64,{}", mime_type, base64_string));
            }
        }
    }

    // 使用 lofty 读取歌词（支持 ID3v2 USLT / Vorbis LYRICS）
    if include_heavy_fields {
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
        cover_path,
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

    // 目录遍历 + 逐文件标签解析是同步阻塞 IO。放进阻塞线程池执行，
    // 否则大目录扫描期间会占住 tokio worker，其它 IPC（播放解析、歌词、设置）一起卡住。
    let scan_root = path_buf.clone();
    let scan_app = app.clone();
    let audio_files = tauri::async_runtime::spawn_blocking(move || {
        let mut audio_files = Vec::new();
        for entry in walkdir::WalkDir::new(&scan_root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();
            if entry_path.is_file() && is_audio_file(entry_path) {
                // 扫描不做重活：不要 base64 封面、不要第二遍解析歌词
                if let Some(audio_file) = extract_metadata(&scan_app, entry_path, false) {
                    audio_files.push(audio_file);
                }
            }
        }
        audio_files
    })
    .await
    .map_err(|err| format!("扫描目录任务异常: {}", err))?;

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
        extract_metadata(&app, &path_buf, true).ok_or_else(|| "Failed to extract metadata".to_string())?;

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

/// 内嵌封面大小上限。
///
/// 封面是整份嵌进音频文件的：不设限时用户误选一张几十 MB 的图，
/// 文件会被撑大且每次写入都要多复制这么一份。
const MAX_EMBEDDED_COVER_BYTES: usize = 10 * 1024 * 1024;

/// 安全写回音频文件：复制成同目录临时文件 → 在副本上写入 → 校验 → 原子替换。
///
/// 标签写入（audiotags / lofty）都是**原地重写**：直接写原文件时，进程中断、
/// 掉电或磁盘写满都会留下被截断的音频，用户的原文件直接报废。
/// 这里保证任意时刻磁盘上要么是完整旧文件、要么是完整新文件。
fn write_audio_file_safely<F>(path: &Path, apply: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法确定父目录: {}", path.display()))?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    // 临时文件必须保留原扩展名：audiotags 是按扩展名推断标签类型的，
    // 改成 .tmp 会导致后续校验读不出副本。
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("tmp");
    let temp_path = parent.join(format!(".{}.{}.aftmp.{}", stem, unique_temp_suffix(), ext));
    let mut temp_guard = TempFileGuard::new(temp_path.clone());

    let original_size = std::fs::metadata(path)
        .map_err(|err| format!("读取原文件信息失败: {}", err))?
        .len();
    std::fs::copy(path, &temp_path).map_err(|err| format!("创建写入副本失败: {}", err))?;

    apply(&temp_path)?;

    // 校验副本：体积没异常坍缩（防写入中途截断），且容器仍可被解析
    let new_size = std::fs::metadata(&temp_path)
        .map_err(|err| format!("读取写入结果失败: {}", err))?
        .len();
    if new_size == 0 || new_size < original_size / 2 {
        return Err(format!(
            "写入结果异常（{} → {} 字节），已放弃替换，原文件未改动",
            original_size, new_size
        ));
    }
    audiotags::Tag::new()
        .read_from_path(&temp_path)
        .map_err(|err| format!("写入结果无法解析，已放弃替换，原文件未改动: {}", err))?;

    // 原子替换（Windows 上等价于 MOVEFILE_REPLACE_EXISTING）
    std::fs::rename(&temp_path, path).map_err(|err| {
        format!(
            "替换原文件失败（文件可能正在播放或被其它程序占用）: {}",
            err
        )
    })?;
    temp_guard.disarm();
    Ok(())
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

    // 在副本上写入后原子替换：直接写原文件时中断会留下截断的音频
    write_audio_file_safely(&path_buf, |temp| {
        let temp_str = temp
            .to_str()
            .ok_or_else(|| "路径含非法字符".to_string())?;
        tag.write_to_path(temp_str)
            .map_err(|e| format!("写入标签失败: {}", e))
    })
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
    if !mime_str.starts_with("data:image/") {
        return Err("封面格式无效：只支持图片 data URL".to_string());
    }
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
    // base64 长度先粗判，避免为了量大小而先解码出一个几十 MB 的字符串
    let b64_trimmed = b64.trim();
    let estimated_bytes = b64_trimmed.len() / 4 * 3;
    if estimated_bytes > MAX_EMBEDDED_COVER_BYTES {
        return Err(format!(
            "封面过大（约 {} MB，上限 {} MB）",
            estimated_bytes / (1024 * 1024),
            MAX_EMBEDDED_COVER_BYTES / (1024 * 1024)
        ));
    }
    let data = general_purpose::STANDARD
        .decode(b64_trimmed)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    if data.len() > MAX_EMBEDDED_COVER_BYTES {
        return Err(format!(
            "封面过大（{} MB，上限 {} MB）",
            data.len() / (1024 * 1024),
            MAX_EMBEDDED_COVER_BYTES / (1024 * 1024)
        ));
    }

    let mut tag = read_or_create_audio_tag(&path_buf)?;
    tag.set_album_cover(audiotags::Picture::new(&data, mime_type));

    write_audio_file_safely(&path_buf, |temp| {
        let temp_str = temp
            .to_str()
            .ok_or_else(|| "路径含非法字符".to_string())?;
        tag.write_to_path(temp_str)
            .map_err(|e| format!("写入封面失败: {}", e))
    })
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

    write_audio_file_safely(&path_buf, |temp| {
        let temp_str = temp
            .to_str()
            .ok_or_else(|| "路径含非法字符".to_string())?;
        tagged_file
            .save_to_path(temp_str, lofty::config::WriteOptions::default())
            .map_err(|e| format!("写入歌词失败: {}", e))
    })
}
