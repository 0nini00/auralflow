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

/// kind → 缓存目录 / 扩展名白名单 / 残包门槛。查询与删除共用，避免两份 match 各自漂移。
fn media_kind_config(
    app: &AppHandle,
    kind: &str,
) -> Result<(PathBuf, &'static [&'static str], u64), String> {
    match kind {
        "audio" => Ok((song_audio_cache_dir(app)?, AUDIO_CACHE_EXTS, MIN_AUDIO_CACHE_BYTES)),
        "cover" => Ok((song_cover_cache_dir(app)?, COVER_CACHE_EXTS, MIN_COVER_CACHE_BYTES)),
        other => Err(format!("未知的媒体缓存类型: {}", other)),
    }
}

/// 查询/删除/写入共用的空 key 校验：sanitize 后为空一律报错。
///
/// 写入侧若静默回退 `md5(url)`，文件会以另一个名字落盘、之后永远查不到——
/// 与其产生「写成功但永不可用」的条目，不如在入口 fail fast。
fn sanitized_cache_key(cache_key: &str) -> Result<String, String> {
    let key = sanitize_cache_key(cache_key);
    if key.is_empty() {
        return Err("缓存 key 无效：不能为空".to_string());
    }
    Ok(key)
}

fn find_cached_file(
    cache_dir: &Path,
    key: &str,
    allowed: &[&str],
    touch: bool,
) -> Result<Option<PathBuf>, String> {
    for ext in allowed {
        let path = cache_dir.join(format!("{}.{}", key, ext));
        // metadata 失败（含 NotFound）跳过该扩展名：查询与残包清理/容量淘汰并发时，
        // 文件可能在 exists 与 stat 之间刚被删——按未命中处理，不放大成查询错误。
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() > 0 {
            // 命中即刷新 mtime，让容量淘汰变成真正的 LRU（否则常用文件反而先被删）；
            // 删除路径传 touch=false，删之前刷新毫无意义。
            if touch {
                touch_cache_file(&path);
            }
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

/// 单条缓存写入结果：`(路径, 是否本次新写入)`。命中（false）时调用方不必再跑容量清理。
async fn cache_remote_file(
    url: String,
    cache_key: String,
    cache_dir: PathBuf,
    allowed_exts: &[&str],
    fallback_ext: &str,
    label: &str,
) -> Result<(String, bool), String> {
    let url = ensure_remote_cache_url(&url, label)?;
    let key = sanitized_cache_key(&cache_key)?;

    if let Some(path) = find_cached_file(&cache_dir, &key, allowed_exts, true)? {
        return Ok((path.to_string_lossy().to_string(), false));
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

    let mut writer = std::io::BufWriter::with_capacity(
        1024 * 1024,
        std::fs::File::create(&temp_path).map_err(|err| format!("创建{}缓存文件失败: {}", label, err))?,
    );
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("读取{}数据失败: {}", label, err))?
    {
        writer
            .write_all(&chunk)
            .map_err(|err| format!("写入{}缓存失败: {}", label, err))?;
        downloaded += chunk.len() as u64;
        // 出站地址已被 assert_public_url 限定公网，但失控 CDN / 误配音源仍可能
        // 返回超大响应。写循环里累计检查（与 downloads.rs 的 MAX_DOWNLOAD_SIZE 同量级），
        // 超限即失败，TempFileGuard 负责清掉残片。
        if downloaded > MAX_CACHE_FILE_BYTES {
            return Err(format!("{}超过单个缓存文件大小上限", label));
        }
    }

    if downloaded == 0 {
        return Err(format!("{}下载为空", label));
    }
    // flush + rename 放阻塞线程池：async 读循环里只做用户态缓冲，最后的落盘
    // 收尾不该占住 tokio worker。
    let temp_for_rename = temp_path.clone();
    let final_for_rename = path.clone();
    let label_owned = label.to_string();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // 直接 rename 覆盖（Windows 上等价于 MOVEFILE_REPLACE_EXISTING）：
        // 先 remove 会制造「目标已删、新文件未就位」的空窗，并发下载时还会
        // 误删另一个任务刚提交的文件。
        writer
            .flush()
            .map_err(|err| format!("保存{}缓存失败: {}", label_owned, err))?;
        drop(writer);
        std::fs::rename(&temp_for_rename, &final_for_rename)
            .map_err(|err| format!("完成{}缓存失败: {}", label_owned, err))
    })
    .await
    .map_err(|err| format!("{}缓存收尾任务失败: {}", label, err))??;
    temp_guard.disarm();

    Ok((path.to_string_lossy().to_string(), true))
}

fn media_cache_stats(app: &AppHandle) -> Result<MediaCacheStats, String> {
    let audio_cache_size = path_size(&song_audio_cache_dir(app)?)?;
    let cover_cache_size = path_size(&song_cover_cache_dir(app)?)?;
    Ok(MediaCacheStats {
        audio_cache_size,
        cover_cache_size,
        total_size: audio_cache_size.saturating_add(cover_cache_size),
    })
}

#[tauri::command]
pub async fn get_media_cache_stats(app: AppHandle) -> Result<MediaCacheStats, String> {
    // 全目录 walkdir（音频 2GiB + 封面 512MiB 上限）是重 IO：放进阻塞线程池，
    // 否则同步 command 在主线程执行，打开设置页就能卡住 UI。
    tauri::async_runtime::spawn_blocking(move || media_cache_stats(&app))
        .await
        .map_err(|err| format!("统计任务失败: {}", err))?
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

/// 启动清理的年龄门槛：只有「昨天之前」的临时文件才当作残片。
const STALE_TEMP_CACHE_AGE: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// 启动时清理「写入中断」留下的临时文件（`.download` / `.tmp`）。
///
/// 正常失败路径由 `TempFileGuard` 清掉临时文件，但进程被强杀、断电、蓝屏时 Drop
/// 不会执行，残片就永久留在缓存目录里：`enforce_cache_limit` 会跳过它们（避免误删
/// 正在写入的文件），于是既不参与淘汰、又计入「资源缓存已用体积」——用户看到的上限
/// 被一批永远用不上的半截文件占着。
///
/// 24 小时门槛是安全边界：本次启动刚创建的临时文件可能正在写入，绝不能动；
/// 一天前的临时文件不可能还有活的写入者（下载任务不会跨进程存活）。
/// 返回删掉的文件数，供调用方决定是否记日志。
fn sweep_stale_temp_files(cache_dir: &Path, max_age: std::time::Duration) -> u64 {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    let cutoff = SystemTime::now()
        .checked_sub(max_age)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut removed = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_temp_cache_file(&path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if modified > cutoff {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    removed
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
    let dir = song_audio_cache_dir(&app)?;
    let (path, written) = cache_remote_file(url, cache_key, dir.clone(), AUDIO_CACHE_EXTS, "mp3", "歌曲音频").await?;
    // 容量清理是一次全目录遍历：只有真的写了新文件才值得跑，命中缓存的播放请求不走这里。
    if written {
        enforce_cache_limit(&dir, SONG_AUDIO_CACHE_MAX_BYTES);
    }
    Ok(path)
}

/// 启动时的缓存守卫（由 `main.rs` 的 setup 在后台线程调用）。
///
/// `enforce_cache_limit` 只在写入新缓存后调用，所以「上次运行写超上限、之后没再写」
/// 的目录会一直超着；移动端有等价的启动清理（`autoCleanCache`），桌面端此前没有。
/// 命中缓存会刷新 mtime，因此这里淘汰掉的确实是最不常访问的那些。
///
/// 顺序：先清掉过期临时文件（它们不参与容量统计，也不该占着磁盘），再按容量淘汰。
pub fn sweep_caches(app: &AppHandle) {
    let (Ok(audio_dir), Ok(cover_dir)) = (song_audio_cache_dir(app), song_cover_cache_dir(app))
    else {
        return; // 目录取不到就跳过：缓存守卫不该影响启动
    };
    let stale_removed = sweep_stale_temp_files(&audio_dir, STALE_TEMP_CACHE_AGE)
        .saturating_add(sweep_stale_temp_files(&cover_dir, STALE_TEMP_CACHE_AGE));
    if stale_removed > 0 {
        tauri_plugin_log::log::info!(
            "[cache] 启动清理：删除 {} 个超过 {} 小时的下载残片",
            stale_removed,
            STALE_TEMP_CACHE_AGE.as_secs() / 3600
        );
    }
    enforce_cache_limit(&audio_dir, SONG_AUDIO_CACHE_MAX_BYTES);
    enforce_cache_limit(&cover_dir, SONG_COVER_CACHE_MAX_BYTES);
}

const AUDIO_CACHE_EXTS: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];
const COVER_CACHE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/// 命中的媒体缓存条目：文件路径 + 体积。
///
/// 前端要靠 `bytes` 做两件事：判断落盘的是不是「试听片段」（见 @lx/core stream-integrity），
/// 以及配合下面的体积门槛把残包挡在播放器之外。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMedia {
    pub path: String,
    pub bytes: u64,
}

/// 音频缓存的最小可信体积。历史样本里出现过 74 字节的 mp3（下载中断的残包）；
/// 旧逻辑只要求「文件存在且非空」，于是查询会一次次命中它、播放器一加载就报错。
/// 24 KiB 远低于任何可播放音频（128k 的 1.5 秒也有约 24 KB），不会误伤正常文件。
const MIN_AUDIO_CACHE_BYTES: u64 = 24 * 1024;
/// 封面缓存的对应门槛：几十字节的「图片」同样只可能是残包。
const MIN_COVER_CACHE_BYTES: u64 = 512;
/// 单个缓存文件的大小上限（与用户下载的 MAX_DOWNLOAD_SIZE 同一量级）。
const MAX_CACHE_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[tauri::command]
pub async fn cache_remote_image(
    app: AppHandle,
    url: String,
    cache_key: String,
) -> Result<String, String> {
    let dir = song_cover_cache_dir(&app)?;
    let (path, written) = cache_remote_file(url, cache_key, dir.clone(), COVER_CACHE_EXTS, "jpg", "封面图片").await?;
    // 封面缓存此前无上限，长期使用会无限增长（本地音乐的内嵌封面也落在这里）
    if written {
        enforce_cache_limit(&dir, SONG_COVER_CACHE_MAX_BYTES);
    }
    Ok(path)
}

/// 只查缓存、不发起下载。
///
/// 播放路径用它区分「已缓存 → 直接放本地文件」与「未缓存 → 先播远端、后台落盘」，
/// 避免把整首歌下载完才开始播放。
/// 查询侧的统一判定：先找文件，再按体积门槛校验；残包（体积不够）直接清掉并按未命中返回。
///
/// 抽成纯函数是为了能在单测里用临时目录同时覆盖「来不及下完的残包」与正常文件两种情况。
fn inspect_cached_file(
    cache_dir: &Path,
    key: &str,
    allowed: &[&str],
    min_bytes: u64,
) -> Result<Option<CachedMedia>, String> {
    let Some(path) = find_cached_file(cache_dir, key, allowed, true)? else {
        return Ok(None);
    };
    let bytes = match std::fs::metadata(&path) {
        Ok(meta) => meta.len(),
        // 与残包清理 / 容量淘汰并发时，文件可能刚在 find 与 stat 之间被删：
        // 按未命中处理而不是把一次播放误判成失败
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("读取缓存文件失败: {}", err)),
    };
    if bytes < min_bytes {
        // 残包留在磁盘上只会让每次查询都再命中一次，清理失败也不改变「按未命中返回」的结论。
        let _ = std::fs::remove_file(&path);
        tauri_plugin_log::log::warn!(
            "[cache] 清理不可用的缓存残包 {}（{} 字节，门槛 {} 字节）",
            path.display(),
            bytes,
            min_bytes
        );
        return Ok(None);
    }
    Ok(Some(CachedMedia {
        path: path.to_string_lossy().to_string(),
        bytes,
    }))
}

/// 查询已落盘的媒体缓存（不发起下载）。
///
/// 播放路径用它区分「已缓存 → 直接放本地文件」与「未缓存 → 先播远端、后台落盘」，
/// 避免把整首歌下载完才开始播放；返回的体积供前端判断「这是不是一个试听片段」。
#[tauri::command]
pub fn lookup_cached_media(
    app: AppHandle,
    kind: String,
    cache_key: String,
) -> Result<Option<CachedMedia>, String> {
    let (cache_dir, allowed, min_bytes) = media_kind_config(&app, &kind)?;
    let key = sanitized_cache_key(&cache_key)?;
    inspect_cached_file(&cache_dir, &key, allowed, min_bytes)
}

/// 按 key 删除单条媒体缓存，返回是否真的删掉了文件。
///
/// 存在的理由：`clear_media_cache` 只能整体清空，而试听片段 / 坏链需要「按曲定向失效」——
/// 只清前端 URL 缓存不够，磁盘上的音频文件还在，
/// 而 `lookup_cached_media` 命中它就直接返回，下次播放仍会命中同一个试听片段。
#[tauri::command]
pub fn remove_cached_media(
    app: AppHandle,
    kind: String,
    cache_key: String,
) -> Result<bool, String> {
    let (cache_dir, allowed, _min_bytes) = media_kind_config(&app, &kind)?;
    let key = sanitized_cache_key(&cache_key)?;
    // 删除路径不做 LRU touch：刷新完 mtime 紧接着就删，白白多开一个写句柄
    let Some(path) = find_cached_file(&cache_dir, &key, allowed, false)? else {
        return Ok(false);
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("删除媒体缓存失败: {}", err)),
    }
}

/// 只清理资源缓存（音频与封面文件），保留播放地址 / 歌词等元信息缓存。
///
/// 与设置页的两组缓存一一对应：这里对应「资源缓存」；播放地址与歌词由前端
/// 各自的清理入口处理（都在 `library` 的 `cache` 命名空间内），互不影响。
#[tauri::command]
pub async fn clear_media_cache(app: AppHandle) -> Result<MediaCacheStats, String> {
    // remove_dir_all 与随后的统计都是重 IO，理由同 get_media_cache_stats
    tauri::async_runtime::spawn_blocking(move || {
        for cache_dir in [
            song_audio_cache_dir(&app)?,
            song_cover_cache_dir(&app)?,
        ] {
            if cache_dir.exists() {
                std::fs::remove_dir_all(&cache_dir)
                    .map_err(|err| format!("删除媒体缓存失败: {}", err))?;
            }
        }
        media_cache_stats(&app)
    })
    .await
    .map_err(|err| format!("清理任务失败: {}", err))?
}

/// 按字节魔数识别图片格式，返回扩展名。
///
/// 桌面端只有这里一张图片魔数表：`local_audio::set_audio_cover`（把封面写进音频标签，
/// 供下载在线曲时使用）靠它做白名单。此前它只看声明的 MIME 字符串、认不出来就当
/// JPEG，于是 `data:image/svg+xml` 这类活动内容也能被贴成「JPEG」写进音频文件。
pub(super) fn sniff_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else {
        None
    }
}

#[cfg(test)]
mod cache_lookup_tests {
    use super::*;

    /// 残包（下载中断留下的几十字节文件）必须按未命中处理并顺手清掉；
    /// 正常体积的文件要带出字节数，前端据此判定「落盘的试听片段」。
    #[test]
    fn rejects_stub_files_and_reports_bytes() {
        let dir = std::env::temp_dir().join(format!("auralflow-cache-lookup-{}", unique_temp_suffix()));
        std::fs::create_dir_all(&dir).unwrap();

        let stub = dir.join("wy-1-audio-flac.mp3");
        std::fs::write(&stub, vec![0u8; 74]).unwrap();
        let hit = inspect_cached_file(&dir, "wy-1-audio-flac", &["mp3"], MIN_AUDIO_CACHE_BYTES).unwrap();
        assert!(hit.is_none(), "74 字节的残包不能算命中");
        assert!(!stub.exists(), "残包应当被清掉，否则每次查询都会再命中一次");

        let good = dir.join("wy-2-audio-builtinNetease-320k.mp3");
        std::fs::write(&good, vec![0u8; (MIN_AUDIO_CACHE_BYTES + 10) as usize]).unwrap();
        let hit = inspect_cached_file(&dir, "wy-2-audio-builtinNetease-320k", &["mp3"], MIN_AUDIO_CACHE_BYTES)
            .unwrap()
            .expect("正常体积的文件应当命中");
        assert_eq!(hit.bytes, MIN_AUDIO_CACHE_BYTES + 10);
        assert!(hit.path.ends_with("wy-2-audio-builtinNetease-320k.mp3"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 启动清理只动「昨天之前」的临时文件：正在写入的 `.download`、以及任何正式音频
    /// 都不能被误删。断点续传/并发下载不会跨进程存活，24 小时前的残片必然是死的。
    #[test]
    fn sweeps_only_stale_temp_files() {
        let dir = std::env::temp_dir().join(format!("auralflow-cache-sweep-{}", unique_temp_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let long_ago = SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(48 * 60 * 60))
            .unwrap();
        let age = |path: &std::path::Path| {
            let file = std::fs::File::options().write(true).open(path).unwrap();
            file.set_modified(long_ago).unwrap();
        };

        let stale_audio = dir.join("wy-1-audio-flac.flac.123-0-1.download");
        std::fs::write(&stale_audio, vec![0u8; 4096]).unwrap();
        age(&stale_audio);

        let stale_cover = dir.join("0123456789abcdef-abcdef12.jpg.123-1-2.tmp");
        std::fs::write(&stale_cover, vec![0u8; 512]).unwrap();
        age(&stale_cover);

        let active_download = dir.join("wy-2-audio-flac.flac.123-3-4.download");
        std::fs::write(&active_download, vec![0u8; 4096]).unwrap();

        let complete = dir.join("wy-3-audio-builtinNetease-flac.flac");
        std::fs::write(&complete, vec![0u8; 4096]).unwrap();
        age(&complete);

        assert_eq!(sweep_stale_temp_files(&dir, STALE_TEMP_CACHE_AGE), 2);
        assert!(!stale_audio.exists(), "48 小时前的音频残片应当被清掉");
        assert!(!stale_cover.exists(), "48 小时前的封面临时文件应当被清掉");
        assert!(active_download.exists(), "正在写入的临时文件不能删");
        assert!(complete.exists(), "正式缓存文件永远不归这个清理管");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod image_magic_tests {
    use super::*;

    /// 魔数表是桌面端唯一的一张，
    /// 认不出来的字节一律 `None` —— `set_audio_cover` 靠这个挡掉 SVG 这类活动内容。
    #[test]
    fn sniff_recognizes_supported_images_and_rejects_anything_else() {
        assert_eq!(sniff_image_extension(b"\x89PNG\r\n\x1a\n\x00\x00"), Some("png"));
        assert_eq!(sniff_image_extension(b"\xff\xd8\xff\xe0"), Some("jpg"));
        assert_eq!(sniff_image_extension(b"GIF89a"), Some("gif"));
        assert_eq!(sniff_image_extension(b"BM\x00\x00"), Some("bmp"));
        assert_eq!(
            sniff_image_extension(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Some("webp")
        );

        // RIFF 容器但不是 WEBP（WAV / AVI）不算图片。
        assert_eq!(sniff_image_extension(b"RIFF\x00\x00\x00\x00WAVEfmt "), None);
        // SVG 是活动内容：此前 `set_audio_cover` 会把这类字节当 JPEG 写进音频文件。
        assert_eq!(sniff_image_extension(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(sniff_image_extension(b""), None);
        assert_eq!(sniff_image_extension(b"not an image at all"), None);
    }
}
