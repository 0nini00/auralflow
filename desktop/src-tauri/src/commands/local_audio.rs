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
// ─── 旁挂图片封面（folder.jpg / cover.jpg / 同名图片）───────────────

/// 旁挂封面候选名，与移动端 `LocalMusicModule.SIDECAR_COVER_NAMES` 逐项一致、同序。
///
/// 两端对同一份音乐目录必须挑出同一张图，否则一张专辑在手机和桌面上显示不同封面。
const SIDECAR_COVER_NAMES: [&str; 8] = [
    "folder.jpg",
    "Folder.jpg",
    "cover.jpg",
    "Cover.jpg",
    "folder.png",
    "Folder.png",
    "cover.png",
    "Cover.png",
];

/// 同名图扩展名（移动端同序：jpg → jpeg → png）。
const SIDECAR_COVER_STEM_EXTS: [&str; 3] = ["jpg", "jpeg", "png"];

/// 目录级候选名查找：`folder.jpg` / `cover.jpg` …，同一目录内所有曲目共用同一结论。
///
/// 只做目录项探测（`is_file()`），不读图片内容：目录里可能躺着几十 MB 的扫描图，
/// 能不能解码交给前端 `<img>`，扫描阶段不搬运任何字节。
/// `folder.jpg` 是**目录**时必须跳过——`is_file()` 对目录返回 false，天然排除。
fn candidate_cover_in_dir(dir: &Path) -> Option<PathBuf> {
    SIDECAR_COVER_NAMES
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// 同名图查找：`<stem>.jpg` / `.jpeg` / `.png`（逐文件结论，不能跨曲目复用）。
fn same_stem_cover(audio_path: &Path) -> Option<PathBuf> {
    let dir = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_str()?;
    SIDECAR_COVER_STEM_EXTS
        .iter()
        .map(|ext| dir.join(format!("{}.{}", stem, ext)))
        .find(|candidate| candidate.is_file())
}

/// 查找音频文件同目录的旁挂封面：先候选名（`folder.jpg` …），再同名图（`<stem>.jpg` …）。
///
/// 候选名优先于同名图：目录里放一张 `folder.jpg` 表达的是「这个目录/这张专辑的封面」，
/// 语义比「恰好和某首歌同名」更强；顺序与移动端 `findSidecarCover` 保持一致。
/// 纯函数、只探目录项、不改任何文件，单测可直接调用。
fn find_sidecar_cover(audio_path: &Path) -> Option<PathBuf> {
    let dir = audio_path.parent()?;
    candidate_cover_in_dir(dir).or_else(|| same_stem_cover(audio_path))
}

/// 命中的文件名是否就是候选名之一（判定该结果能否跨文件复用）。
fn is_candidate_cover_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| SIDECAR_COVER_NAMES.contains(&name))
}

/// 带「本次调用一份」目录级 memo 的旁挂封面查找。
///
/// 一张专辑十几首曲子同处一个目录，逐曲去摸 8 个候选名纯属浪费；memo 只缓存
/// **目录级**结论（有没有候选名、是哪张图）。同名图（`<stem>.jpg`）天然逐文件不同，
/// 绝不写进 memo——否则 A 曲的 `A.jpg` 会被同目录的 B 曲认领。
/// memo 随调用创建、随调用丢弃（不是全局静态缓存）：两次扫描之间用户换了
/// `folder.jpg`，下次扫描必须看到新图，旧结论不能粘住。
/// 返回的是用户自己图片文件的路径：调用方不复制、不改写。
fn sidecar_cover_cached(
    audio_path: &Path,
    memo: &mut HashMap<PathBuf, Option<PathBuf>>,
) -> Option<PathBuf> {
    let Some(dir) = audio_path.parent() else {
        return find_sidecar_cover(audio_path);
    };
    if let Some(cached) = memo.get(dir).cloned() {
        // 目录级已知：有图直接复用，没有则只剩同名图要逐文件探测
        return cached.or_else(|| same_stem_cover(audio_path));
    }
    let found = find_sidecar_cover(audio_path);
    // find_sidecar_cover 先试候选名，于是：命中候选名 → 该目录的共用图；
    // 什么都没命中 → 该目录没有候选图（同名图也没有）。两种结论对全目录成立。
    // 命中同名图只对这一首成立，此时 memo 记 None（= 目录里没有候选图），
    // 不冒充目录级结论。
    let dir_level = match found.as_deref() {
        Some(hit) if is_candidate_cover_name(hit) => Some(hit.to_path_buf()),
        _ => None,
    };
    memo.insert(dir.to_path_buf(), dir_level);
    found
}

/// 判断 `cover_path` 是不是旁挂图（而不是落进封面缓存的内嵌封面）。
///
/// 内嵌封面一律由 `persist_local_cover` 落到封面缓存目录，只有一个例外会是音频文件
/// 的同目录兄弟文件：旁挂图。用「父目录相同」来判定，既不用把 media_cache 的内部
/// 路径函数暴露出来，也不必去枚举「封面缓存目录」这个实现细节。
fn is_sidecar_cover_path(audio_path: &Path, cover_path: &Path) -> bool {
    cover_path.parent() == audio_path.parent()
}

/// 提取音频文件元数据 — 沿用原 main.rs 的完整实现
///
/// `include_heavy_fields = false`（整目录扫描）时跳过大字段：不生成封面 base64，
/// 单文件查询（get_audio_info）通过 lofty 额外读取内嵌歌词，
/// 关闭封面与音频属性解析，避免重复搬运大封面。
///
/// 封面取值顺序（与移动端 `resolveCover` 同序）：内嵌封面 → 同目录旁挂图
/// （`folder.jpg` / `cover.jpg` / 同名图片，见 `find_sidecar_cover`）。
/// `sidecar_cover_memo` 是「本次调用一份」的目录级旁挂图 memo，由调用方传入；
/// 单文件查询（get_audio_info）传一个空表即可，不与扫描共享。
fn extract_metadata(
    app: &AppHandle,
    path: &std::path::Path,
    include_heavy_fields: bool,
    // 目录级旁挂图 memo（父目录 → 候选名结论），见 sidecar_cover_cached。
    // 只在一次扫描内复用：不落全局，避免跨调用变脏。
    sidecar_cover_memo: &mut HashMap<PathBuf, Option<PathBuf>>,
) -> Option<AudioFile> {
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

    // 内嵌封面优先，只有它缺席时才退回同目录旁挂图——与移动端 resolveCover 同序
    // （移动端是系统 albumart → 旁挂；桌面端内嵌封面就是「系统 albumart」那一档）。
    // 内嵌封面随文件走（换目录、拷给别人都在），旁挂图只是目录级兜底。
    //
    // 旁挂图不做任何复制/改写：直接把用户图片的绝对路径交给前端 asset 协议引用。
    // 复制进封面缓存会让一张 12 首的专辑存 12 份同样的图，白占 512 MiB 封面缓存；
    // 直接引用还能让用户换掉 folder.jpg 后立刻生效（无需等缓存失效）。
    //
    // 与内嵌封面一样不受 include_heavy_fields 门控：受门控的是 base64 大字段，
    // 而封面短路径在扫描整库时就必须带上，否则列表会空一片图。
    if cover_path.is_none() {
        cover_path = sidecar_cover_cached(path, sidecar_cover_memo)
            .map(|cover| cover.to_string_lossy().to_string());
    }

    // 目录扫描不返回歌词，无需再用 lofty 打开文件读取文本标签。
    if include_heavy_fields {
        let options = lofty::config::ParseOptions::new()
            .read_properties(false)
            .read_cover_art(false);
        if let Ok(probe) = lofty::probe::Probe::open(path) {
            if let Ok(tagged_file) = probe.options(options).read() {
                if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
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
        // 旁挂图探测按父目录 memo 一次：一张专辑十几首曲子同处一个目录，
        // 不让每个文件都把 8 个候选名摸一遍。memo 只活在本次扫描里，
        // 扫描结束即丢弃——不落全局，用户中途换了 folder.jpg 下次扫描就能看到。
        let mut sidecar_cover_memo: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
        for entry in walkdir::WalkDir::new(&scan_root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let entry_path = entry.path();
            if entry_path.is_file() && is_audio_file(entry_path) {
                // 扫描不做重活：不要 base64 封面、不要第二遍解析歌词
                if let Some(audio_file) =
                    extract_metadata(&scan_app, entry_path, false, &mut sidecar_cover_memo)
                {
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

    // 单文件查询不复用扫描的 memo（这里只有一首曲子，没有可复用的目录级结论）。
    let mut sidecar_cover_memo: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
    let info = extract_metadata(&app, &path_buf, true, &mut sidecar_cover_memo)
        .ok_or_else(|| "Failed to extract metadata".to_string())?;

    // 单曲添加同样需要 asset 协议访问，按文件粒度放行。
    app.asset_protocol_scope()
        .allow_file(&path_buf)
        .map_err(|err| format!("放行本地音乐文件失败: {}", err))?;

    // 内嵌封面落盘在封面缓存目录里，前端天然可读；旁挂封面却是用户自己目录里的图片，
    // 既不在缓存目录内，也不会被整目录扫描的 allow_directory 覆盖（单文件添加根本没扫过
    // 目录），必须单独放行——否则前端拿到 cover_path 也只是 403 空图。
    if let Some(cover) = info
        .cover_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|cover| is_sidecar_cover_path(&path_buf, cover))
    {
        app.asset_protocol_scope()
            .allow_file(&cover)
            .map_err(|err| format!("放行本地封面文件失败: {}", err))?;
    }

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
    // MIME 类别不在这里按声明字符串猜 —— 依据是解码后的字节魔数，见下面
    // `sniff_image_extension` 那一处。

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
    // 采信字节魔数，而不是声明的 MIME 字符串：此前「认不出来就当 JPEG」会把
    // `data:image/svg+xml` 这类活动内容贴成「JPEG」写进音频文件，而同一功能的
    // 手动封面落盘（`write_manual_cover`）早就有魔数白名单了 —— 两处不一致。
    let mime_type = match super::media_cache::sniff_image_extension(&data) {
        Some("png") => audiotags::MimeType::Png,
        Some("jpg") => audiotags::MimeType::Jpeg,
        Some("bmp") => audiotags::MimeType::Bmp,
        Some("gif") => audiotags::MimeType::Gif,
        // audiotags 0.5 的 `MimeType` 只有 Png/Jpeg/Tiff/Bmp/Gif，没有 Webp 变体，
        // 而前端封面写标签时（`set_audio_cover` 的调用方）会真的产出 image/webp。这里沿用
        // Jpeg 兜底而不是拒绝：拒绝会让「把封面写进文件标签」从「能写入」退化成「写入失败」。
        // 代价是这一种格式的 MIME 标注不准，属已知残留。
        Some("webp") => audiotags::MimeType::Jpeg,
        _ => {
            return Err("封面格式无效：只支持 PNG / JPEG / GIF / BMP / WebP 图片".to_string());
        }
    };

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

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试专用临时目录：唯一名字建目录，Drop 时连同内容一起删掉。
    /// （Cargo.toml 没有 tempfile 依赖，沿用仓库既有的 temp_dir + 唯一后缀写法。）
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "auralflow-sidecar-cover-{}-{}",
                label,
                unique_temp_suffix()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 建一首「音频文件」：find_sidecar_cover 只看路径与目录项，不解析内容。
    fn audio(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"audio-bytes").unwrap();
        path
    }

    /// 建一张「封面图片」，内容带上名字便于按字节比对。
    fn image(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("image:{}", name).as_bytes()).unwrap();
        path
    }

    #[test]
    fn finds_folder_jpg_in_same_directory() {
        let dir = TempDir::new("folder-jpg");
        let song = audio(&dir, "song.mp3");
        let expected = image(&dir, "folder.jpg");
        assert_eq!(find_sidecar_cover(&song), Some(expected));
    }

    #[test]
    fn finds_cover_png_in_same_directory() {
        let dir = TempDir::new("cover-png");
        let song = audio(&dir, "song.flac");
        let expected = image(&dir, "cover.png");
        assert_eq!(find_sidecar_cover(&song), Some(expected));
    }

    #[test]
    fn finds_same_stem_jpeg() {
        let dir = TempDir::new("same-stem");
        let song = audio(&dir, "Song Title.m4a");
        let expected = image(&dir, "Song Title.jpeg");
        assert_eq!(find_sidecar_cover(&song), Some(expected));
    }

    #[test]
    fn named_candidate_wins_over_same_stem_image() {
        let dir = TempDir::new("named-first");
        let song = audio(&dir, "song.mp3");
        let folder = image(&dir, "folder.jpg");
        image(&dir, "song.jpg");
        assert_eq!(
            find_sidecar_cover(&song),
            Some(folder),
            "候选名优先于同名图（与移动端 findSidecarCover 同序）"
        );
    }

    #[test]
    fn matches_case_variants_of_candidate_names() {
        // Windows / macOS 的文件系统大小写不敏感：磁盘上是 Folder.jpg 时，候选表里
        // 靠前的 "folder.jpg" 也会命中同一张图，返回路径保留的是候选名的拼写。
        // 因此这里按「路径（忽略大小写）+ 文件真实存在」断言。
        let jpg_dir = TempDir::new("case-folder-jpg");
        let song = audio(&jpg_dir, "song.mp3");
        let expected = image(&jpg_dir, "Folder.jpg");
        let found = find_sidecar_cover(&song).expect("Folder.jpg 应当命中");
        assert!(found.is_file(), "返回的封面路径必须真实可读");
        assert_eq!(
            found.to_string_lossy().to_ascii_lowercase(),
            expected.to_string_lossy().to_ascii_lowercase()
        );

        let png_dir = TempDir::new("case-cover-png");
        let song = audio(&png_dir, "song.mp3");
        let expected = image(&png_dir, "Cover.png");
        let found = find_sidecar_cover(&song).expect("Cover.png 应当命中");
        assert!(found.is_file(), "返回的封面路径必须真实可读");
        assert_eq!(
            found.to_string_lossy().to_ascii_lowercase(),
            expected.to_string_lossy().to_ascii_lowercase()
        );
    }

    #[test]
    fn returns_none_when_directory_has_no_cover() {
        let dir = TempDir::new("no-cover");
        let song = audio(&dir, "song.mp3");
        assert_eq!(find_sidecar_cover(&song), None);
    }

    #[test]
    fn skips_directory_named_like_a_cover() {
        let dir = TempDir::new("folder-jpg-is-dir");
        let song = audio(&dir, "song.mp3");
        std::fs::create_dir_all(dir.join("folder.jpg")).unwrap();
        assert_eq!(
            find_sidecar_cover(&song),
            None,
            "folder.jpg 是目录时必须跳过，不能当成封面"
        );

        // 跳过之后要继续试后面的候选名，而不是就地放弃
        let expected = image(&dir, "cover.jpg");
        assert_eq!(find_sidecar_cover(&song), Some(expected));
    }

    #[test]
    fn missing_audio_file_never_panics() {
        let dir = TempDir::new("missing-audio");
        assert_eq!(find_sidecar_cover(&dir.join("missing.mp3")), None);
        // 连目录都不存在
        assert_eq!(
            find_sidecar_cover(&dir.join("no-such-dir").join("missing.mp3")),
            None
        );
    }

    #[test]
    fn never_modifies_the_user_image_file() {
        let dir = TempDir::new("read-only");
        let song = audio(&dir, "song.mp3");
        let cover = image(&dir, "folder.jpg");
        let bytes_before = std::fs::read(&cover).unwrap();
        let modified_before = std::fs::metadata(&cover).unwrap().modified().unwrap();

        let found = find_sidecar_cover(&song).expect("folder.jpg 应当命中");

        assert_eq!(found, cover);
        assert_eq!(std::fs::read(&cover).unwrap(), bytes_before, "不得改写用户图片");
        assert_eq!(
            std::fs::metadata(&cover).unwrap().modified().unwrap(),
            modified_before,
            "不得触碰用户图片的修改时间"
        );
    }

    #[test]
    fn recognizes_sidecar_cover_path_only_within_audio_directory() {
        let dir = TempDir::new("cover-path");
        let song = audio(&dir, "song.mp3");
        let cover = image(&dir, "folder.jpg");
        assert!(is_sidecar_cover_path(&song, &cover));

        // 内嵌封面落盘在封面缓存目录（不是音频的同目录），不能被当成旁挂图重复放行
        let cache_dir = TempDir::new("cover-path-cache");
        let cached = image(&cache_dir, "abc.jpg");
        assert!(!is_sidecar_cover_path(&song, &cached));
    }

    /// 目录级 memo：folder.jpg 可被全目录曲目复用；同名图是逐文件结论，
    /// 绝不能被同目录的其它曲目认领；memo 随调用创建，换一次调用就看到新图。
    #[test]
    fn memo_shares_directory_cover_but_not_same_stem_cover() {
        let dir = TempDir::new("memo");
        let first = audio(&dir, "a.mp3");
        let second = audio(&dir, "b.mp3");
        let mut memo: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();

        let a_cover = image(&dir, "a.jpg");
        assert_eq!(sidecar_cover_cached(&first, &mut memo), Some(a_cover));
        assert_eq!(
            sidecar_cover_cached(&second, &mut memo),
            None,
            "b.mp3 不能蹭到 a.mp3 的同名图"
        );

        // 用户随后补了 folder.jpg：换一次扫描（新 memo）必须立刻看到它
        let folder = image(&dir, "folder.jpg");
        let mut next_scan: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
        assert_eq!(
            sidecar_cover_cached(&second, &mut next_scan),
            Some(folder.clone())
        );
        assert_eq!(sidecar_cover_cached(&first, &mut next_scan), Some(folder));
    }
}
