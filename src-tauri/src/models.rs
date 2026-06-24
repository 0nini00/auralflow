//! AuralFlow 核心数据模型
//! 与前端 @lx/core/src/sources/types.ts 对齐

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_true() -> bool {
    true
}

// ============================================================
// 音乐信息模型（与前端 MusicInfo 对齐）
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicInfo {
    /// 歌曲ID（各平台自有ID体系）
    pub id: String,
    /// 歌名
    pub name: String,
    /// 歌手列表
    pub singer: String,
    /// 专辑名
    pub album: String,
    /// 专辑封面URL
    pub album_pic_url: Option<String>,
    /// 歌曲时长（秒）
    pub duration: Option<u64>,
    /// 音源标识，如 "wy" / "tx" / "kg" / "local"
    pub source: String,
    /// 最高可用音质，如 "128k" / "320k" / "flac"
    pub quality: Option<String>,
    /// 歌曲URL（播放时解析获得）
    pub url: Option<String>,
    /// 歌曲URL列表（不同质量）
    pub urls: Option<Vec<MusicUrlInfo>>,
    /// 歌词内容（LRC格式）
    pub lyric: Option<String>,
    /// 歌词翻译
    pub tlyric: Option<String>,
    /// 歌词罗马音
    pub rlyric: Option<String>,
    /// 其他扩展字段
    pub extra: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicUrlInfo {
    /// URL
    pub url: String,
    /// 质量标识，如 "128k" / "320k" / "flac"
    pub quality: String,
    /// 大小（字节）
    pub size: Option<u64>,
}

// ============================================================
// 搜索结果模型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub songs: Vec<MusicInfo>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

// ============================================================
// 歌单模型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    /// 歌单ID
    pub id: String,
    /// 歌单名
    pub name: String,
    /// 歌单封面URL
    pub cover_img_url: Option<String>,
    /// 创建者昵称
    pub creator_nickname: Option<String>,
    /// 歌单描述
    pub description: Option<String>,
    /// 歌单标签
    pub tags: Option<Vec<String>>,
    /// 播放数
    pub play_count: Option<u64>,
    /// 歌曲列表
    pub song_list: Option<Vec<MusicInfo>>,
    /// 歌单来源
    pub source: String,
    /// 是否已收藏
    pub subscribed: Option<bool>,
    /// 创建者用户ID
    pub creator_user_id: Option<u64>,
}

// ============================================================
// 歌词模型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResult {
    /// LRC格式歌词
    pub lyric: Option<String>,
    /// 翻译歌词
    pub tlyric: Option<String>,
    /// 罗马音歌词
    pub rlyric: Option<String>,
}

// ============================================================
// 配置模型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    /// 主题: "light" / "dark" / "auto"
    pub theme: String,
    /// 音量 (0-100)
    pub volume: u32,
    /// 默认音质: "128k" / "320k" / "flac"
    pub default_quality: String,
    /// 网易云 Cookie
    pub wy_cookie: Option<String>,
    /// 桌面歌词窗口：是否始终置顶
    pub lyric_pinned: bool,
    /// 桌面歌词窗口：锁定后鼠标穿透，防止误拖动/误点击
    pub lyric_locked: bool,
    /// 桌面歌词窗口：暂停播放时隐藏窗口
    pub lyric_pause_hide: bool,
    /// 桌面歌词窗口：字号（px）
    pub lyric_font_size: u32,
    /// 桌面歌词窗口：是否显示下一行
    pub lyric_show_next_line: bool,
    /// 桌面歌词窗口：单行模式
    pub lyric_single_line: bool,
    /// 桌面歌词窗口：最多显示行数
    pub lyric_max_line_num: u32,
    /// 桌面歌词窗口：是否显示歌词翻译
    pub lyric_show_translation: bool,
    /// 桌面歌词窗口：文本对齐 left / center / right
    pub lyric_align: String,
    /// 桌面歌词窗口：两行歌词间距（px）
    pub lyric_line_gap: u32,
    /// 桌面歌词窗口：当前行字重
    pub lyric_font_weight: u32,
    /// 桌面歌词窗口：当前行颜色
    pub lyric_active_color: String,
    /// 桌面歌词窗口：下一行颜色
    pub lyric_next_color: String,
    /// 桌面歌词窗口：文字阴影颜色
    pub lyric_shadow_color: String,
    /// 桌面歌词窗口：文字透明度
    pub lyric_text_opacity: f64,
    /// 桌面歌词窗口：背景透明度
    pub lyric_background_opacity: f64,
    /// 桌面歌词窗口：文字横向偏移百分比
    pub lyric_text_position_x: f64,
    /// 桌面歌词窗口：文字纵向偏移百分比
    pub lyric_text_position_y: f64,
    /// 桌面歌词窗口：鼠标悬停时隐藏，减少遮挡
    pub lyric_hover_hide: bool,
    /// 桌面歌词窗口：是否启用切换动画
    pub lyric_enable_animation: bool,
    /// 桌面歌词窗口：上次的 x（逻辑像素）。None=居中默认位置
    pub lyric_window_x: Option<f64>,
    /// 桌面歌词窗口：上次的 y
    pub lyric_window_y: Option<f64>,
    /// 桌面歌词窗口：上次的宽
    pub lyric_window_width: Option<f64>,
    /// 桌面歌词窗口：上次的高
    pub lyric_window_height: Option<f64>,
    /// 用户协议是否已同意
    pub pact_accepted: bool,
    /// 鼠标特效: "off" / "trail"
    pub cursor_effect: String,
    /// WebDAV 同步地址（目录 URL）
    pub webdav_url: Option<String>,
    /// WebDAV 用户名
    pub webdav_username: Option<String>,
    /// WebDAV 密码
    pub webdav_password: Option<String>,
    /// 自定义音源：启动后自动检测更新
    #[serde(default = "default_true")]
    pub custom_source_auto_check: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            volume: 80,
            default_quality: "320k".to_string(),
            wy_cookie: None,
            lyric_pinned: true,
            lyric_locked: false,
            lyric_pause_hide: false,
            lyric_font_size: 28,
            lyric_show_next_line: true,
            lyric_single_line: false,
            lyric_max_line_num: 2,
            lyric_show_translation: true,
            lyric_align: "center".to_string(),
            lyric_line_gap: 8,
            lyric_font_weight: 700,
            lyric_active_color: "#ffffff".to_string(),
            lyric_next_color: "#d1d5db".to_string(),
            lyric_shadow_color: "#000000".to_string(),
            lyric_text_opacity: 0.95,
            lyric_background_opacity: 0.55,
            lyric_text_position_x: 0.0,
            lyric_text_position_y: 0.0,
            lyric_hover_hide: false,
            lyric_enable_animation: true,
            lyric_window_x: None,
            lyric_window_y: None,
            lyric_window_width: None,
            lyric_window_height: None,
            pact_accepted: false,
            cursor_effect: "off".to_string(),
            webdav_url: None,
            webdav_username: None,
            webdav_password: None,
            custom_source_auto_check: true,
        }
    }
}

// ============================================================
// 网易云账号模型
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub uid: String,
    pub nickname: String,
    pub avatar_url: String,
    pub vip_type: i32,
    pub is_vip: bool,
}

// ============================================================
// 本地音频文件模型（沿用原 main.rs 中的 AudioFile，更丰富）
// ============================================================

/// 本地音频文件 — 包含完整元数据、封面 Base64、内嵌歌词
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFile {
    /// 文件路径的 MD5 值作为 ID
    pub id: String,
    /// 文件路径
    pub path: String,
    /// 标题（从标签读取，fallback 为文件名）
    pub title: String,
    /// 艺术家
    pub artist: String,
    /// 专辑
    pub album: String,
    /// 时长（秒）
    pub duration: u32,
    /// 格式（扩展名）
    pub format: String,
    /// 文件大小（字节）
    pub size: u64,
    /// Base64 编码的封面图片，格式 "data:image/png;base64,..."
    pub cover_data: Option<String>,
    /// 内嵌歌词（LRC 格式）
    pub lyrics: Option<String>,
}

/// 支持的音频格式扩展名
pub const SUPPORTED_FORMATS: &[&str] = &[
    "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "aiff",
];
