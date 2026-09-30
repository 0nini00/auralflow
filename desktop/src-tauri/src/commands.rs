//! Tauri IPC 命令 — 暴露给前端的 Rust 命令
//!
//! 涵盖：
//!   - 配置管理（加载/保存/重置/部分更新）
//!   - 压缩/解压 fallback
//!   - 本地音频扫描（沿用原 main.rs 的完整实现）
//!   - 音频信息获取

use crate::config;
use crate::models::*;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, USER_AGENT};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

const MEDIA_CACHE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SONG_AUDIO_CACHE_DIR: &str = "song-audio";
const SONG_COVER_CACHE_DIR: &str = "song-covers";
/// 各缓存目录的容量上限（字节），超限后按修改时间从最旧开始淘汰。
/// 命中缓存会刷新 mtime，因此是真正的 LRU（常用的不会被先删）。
/// 当前固定值，可按需直接调整；如需用户可配，后续接 AppSettings。
const SONG_AUDIO_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 封面（含本地音乐内嵌封面落盘）体量小但数量多，单独给 512 MiB 上限。
const SONG_COVER_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongCacheStats {
    pub persistent_cache_size: u64,
    pub audio_cache_size: u64,
    pub cover_cache_size: u64,
    pub total_size: u64,
}

mod settings {
    use super::*;
    include!("commands/settings.rs");
}

mod compression {
    use super::*;
    include!("commands/compression.rs");
}

mod media_cache {
    use super::*;
    include!("commands/media_cache.rs");
}

mod downloads {
    use super::*;
    include!("commands/downloads.rs");
}

mod local_audio {
    use super::*;
    include!("commands/local_audio.rs");
}

mod library {
    use super::*;
    include!("commands/library.rs");
}

mod lyric_window {
    use super::*;
    include!("commands/lyric_window.rs");
}

mod logging {
    use super::*;
    include!("commands/logging.rs");
}

mod smtc {
    use super::*;
    include!("commands/smtc.rs");
}

mod taskbar {
    use super::*;
    include!("commands/taskbar.rs");
}

pub use compression::*;
pub use downloads::*;
pub use library::*;
pub use local_audio::*;
pub use logging::*;
pub use lyric_window::*;
pub use media_cache::*;
pub use settings::*;
pub use smtc::*;
pub use taskbar::*;
