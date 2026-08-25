//! Tauri IPC 命令 — 暴露给前端的 Rust 命令
//!
//! 涵盖：
//!   - 配置管理（加载/保存/重置/部分更新）
//!   - 压缩/解压 fallback
//!   - 本地音频扫描（沿用原 main.rs 的完整实现）
//!   - 音频信息获取

use crate::config;
use crate::models::*;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

const BILI_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BILI_AUDIO_CACHE_DIR: &str = "bili-audio";
const SONG_AUDIO_CACHE_DIR: &str = "song-audio";
/// song-audio 音频缓存目录的 LRU 容量上限（字节），超限后从最旧文件开始淘汰。
/// 当前固定 2 GiB，可按需直接调整此常量；如需用户可配，后续接 AppSettings。
const SONG_AUDIO_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const SONG_COVER_CACHE_DIR: &str = "song-covers";

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

mod bili {
    use super::*;
    include!("commands/bili.rs");
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

pub use bili::*;
pub use compression::*;
pub use downloads::*;
pub use library::*;
pub use local_audio::*;
pub use lyric_window::*;
pub use media_cache::*;
pub use settings::*;
