//! AuralFlow Tauri IPC 数据模型

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_lyric_animation_intensity() -> String {
    "normal".to_string()
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
    /// 其他媒体开始播放时，是否接受系统/浏览器触发的自动暂停
    pub pause_on_external_playback: bool,
    /// 是否把网易云源歌曲同步到网易云听歌记录
    #[serde(default = "default_true")]
    pub netease_scrobble_sync: bool,
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
    /// 歌词动画强度: "reduced" / "normal" / "enhanced"
    #[serde(default = "default_lyric_animation_intensity")]
    pub lyric_animation_intensity: String,
    /// 沉浸式歌词：主歌词字号（px）
    pub immersive_lyric_font_size: u32,
    /// 沉浸式歌词：字体族 CSS 值
    pub immersive_lyric_font_family: String,
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
            pause_on_external_playback: true,
            netease_scrobble_sync: true,
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
            lyric_animation_intensity: default_lyric_animation_intensity(),
            immersive_lyric_font_size: 36,
            immersive_lyric_font_family: "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif".to_string(),
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
