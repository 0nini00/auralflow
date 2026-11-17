//! Tauri IPC 命令 — 暴露给前端的 Rust 命令
//!
//! 涵盖：
//!   - 配置管理（加载/保存/重置/部分更新）
//!   - 压缩/解压 fallback
//!   - 本地音频扫描（沿用原 main.rs 的完整实现）
//!   - 音频信息获取
//!
//! 每个子文件都是普通模块，自带显式 `use`；跨文件共用的小工具集中在 `shared`，
//! 由使用方显式导入。这里只负责声明模块并把命令重新导出给 `main.rs` 注册。

mod compression;
mod downloads;
mod library;
mod local_audio;
mod logging;
mod lyric_window;
mod media_cache;
mod mini_player;
mod settings;
mod shared;
mod smtc;
mod taskbar;

pub use compression::*;
pub use downloads::*;
pub use library::*;
pub use local_audio::*;
pub use logging::*;
pub use lyric_window::*;
pub use media_cache::*;
pub use mini_player::*;
pub use settings::*;
pub use smtc::*;
pub use taskbar::*;
