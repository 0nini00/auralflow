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
/// lofty 只读取文本标签，关闭封面与音频属性解析，避免重复搬运大封面；
/// 单文件查询（get_audio_info）额外返回内嵌歌词。
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
    let mut replay_gain = None;

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

    // 只读取文本标签；已有 audiotags 路径负责属性/封面，避免重复解析大图。
    let options = lofty::config::ParseOptions::new()
        .read_properties(false)
        .read_cover_art(false);
    if let Ok(probe) = lofty::probe::Probe::open(path) {
        if let Ok(tagged_file) = probe.options(options).read() {
            replay_gain = read_replay_gain_tags(tagged_file.primary_tag(), tagged_file.tags());
            if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
                if include_heavy_fields {
                    lyrics = tag.get_string(&lofty::tag::ItemKey::Lyrics).map(str::to_string);
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
        replay_gain,
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


fn read_replay_gain(tag: &lofty::tag::Tag) -> Option<AudioReplayGain> {
    use lofty::tag::ItemKey;
    let raw = tag.get_string(&ItemKey::ReplayGainTrackGain)?.trim().to_ascii_lowercase();
    let value = raw.strip_suffix("db").unwrap_or(&raw).trim();
    let gain_db: f64 = value.parse().ok()?;
    if !gain_db.is_finite() { return None; }
    let peak = tag.get_string(&ItemKey::ReplayGainTrackPeak)
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    Some(AudioReplayGain { gain_db, peak })
}

#[cfg(test)]
mod replay_gain_tests {
    use super::*;
    use lofty::tag::{ItemKey, Tag, TagType};

    #[test]
    fn reads_track_gain_and_optional_peak() {
        let mut tag = Tag::new(TagType::VorbisComments);
        tag.insert_text(ItemKey::ReplayGainTrackGain, " -6.25 dB ".into());
        tag.insert_text(ItemKey::ReplayGainTrackPeak, "0.92".into());
        let result = read_replay_gain(&tag).unwrap();
        assert_eq!(result.gain_db, -6.25);
        assert_eq!(result.peak, Some(0.92));
        tag.remove_key(&ItemKey::ReplayGainTrackPeak);
        assert!(read_replay_gain(&tag).unwrap().peak.is_none());
    }

    #[test]
    fn missing_or_non_finite_gain_is_not_fabricated() {
        let mut tag = Tag::new(TagType::Id3v2);
        assert!(read_replay_gain(&tag).is_none());
        for value in ["NaN", "inf", "broken", "1.0 junk"] {
            tag.insert_text(ItemKey::ReplayGainTrackGain, value.into());
            assert!(read_replay_gain(&tag).is_none());
        }
    }

    #[test]
    fn positive_gain_and_invalid_peak_remain_distinguishable() {
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(ItemKey::ReplayGainTrackGain, "+3.0 DB".into());
        tag.insert_text(ItemKey::ReplayGainTrackPeak, "NaN".into());
        let result = read_replay_gain(&tag).unwrap();
        assert_eq!(result.gain_db, 3.0);
        assert!(result.peak.is_none());
    }
}


/// 单曲补读标签，让升级前的曲库缓存也能使用 ReplayGain。
#[tauri::command]
pub async fn get_audio_replay_gain(path: String) -> Result<Option<AudioReplayGain>, String> {
    use lofty::file::TaggedFileExt;
    let path = PathBuf::from(path);
    if !path.is_file() { return Err("音频文件不存在或不可访问".to_string()); }
    let options = lofty::config::ParseOptions::new().read_properties(false).read_cover_art(false);
    let tagged = lofty::probe::Probe::open(&path)
        .map_err(|e| format!("打开标签失败: {}", e))?
        .options(options).read().map_err(|e| format!("读取标签失败: {}", e))?;
    Ok(read_replay_gain_tags(tagged.primary_tag(), tagged.tags()))
}


fn read_replay_gain_tags(primary: Option<&lofty::tag::Tag>, tags: &[lofty::tag::Tag]) -> Option<AudioReplayGain> {
    // 主标签有有效值时优先；否则查其他标签，同一组增益/峰值不跨标签拼接。
    primary.and_then(read_replay_gain).or_else(|| tags.iter().find_map(read_replay_gain))
}

#[cfg(test)]
mod replay_gain_multi_tag_tests {
    use super::*;
    use lofty::tag::{ItemKey, Tag, TagType};

    #[test]
    fn metadata_only_primary_does_not_hide_ape_replaygain() {
        let primary = Tag::new(TagType::Id3v2);
        let mut ape = Tag::new(TagType::Ape);
        ape.insert_text(ItemKey::ReplayGainTrackGain, "-7.5 dB".into());
        ape.insert_text(ItemKey::ReplayGainTrackPeak, "0.7".into());
        let tags = vec![primary, ape];
        let result = read_replay_gain_tags(Some(&tags[0]), &tags).unwrap();
        assert_eq!(result.gain_db, -7.5);
        assert_eq!(result.peak, Some(0.7));
    }

    #[test]
    fn valid_primary_is_preferred_without_mixing_another_tags_peak() {
        let mut primary = Tag::new(TagType::Id3v2);
        primary.insert_text(ItemKey::ReplayGainTrackGain, "-3 dB".into());
        let mut ape = Tag::new(TagType::Ape);
        ape.insert_text(ItemKey::ReplayGainTrackGain, "-7 dB".into());
        ape.insert_text(ItemKey::ReplayGainTrackPeak, "0.7".into());
        let tags = vec![primary, ape];
        let result = read_replay_gain_tags(Some(&tags[0]), &tags).unwrap();
        assert_eq!(result.gain_db, -3.0);
        assert_eq!(result.peak, None);
    }
}
