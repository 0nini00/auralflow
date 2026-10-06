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
    /// 播放失败时是否自动跳到下一首（FM 模式不受影响，始终连播）
    pub playback_failed_auto_next: bool,
    /// 跟随系统媒体控制（SMTC）：键盘媒体键 / 系统媒体浮层 / 锁屏控制
    #[serde(default = "default_true")]
    pub follow_system_media_control: bool,
    /// 任务栏缩略图按钮与封面预览：悬停任务栏图标可上一首 / 播放暂停 / 下一首，
    /// 并把窗口快照预览换成当前曲目封面（关闭时不安装窗口过程子类化钩子）
    #[serde(default = "default_true")]
    pub taskbar_thumbnails: bool,
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
    pub lyric_show_romanization: bool,
    pub lyric_show_ruby: bool,
    /// 桌面歌词窗口：文本对齐 left / center / right
    pub lyric_align: String,
    /// 桌面歌词窗口：两行歌词间距（px）
    pub lyric_line_gap: u32,
    /// 桌面歌词窗口：当前行字重
    pub lyric_font_weight: u32,
    /// 桌面歌词窗口：手动歌词偏移校准（毫秒），正=提前显示，负=延后
    pub lyric_manual_offset_ms: i32,
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
    /// 沉浸式歌词：字体族 CSS 值
    pub immersive_lyric_font_family: String,
    /// 主界面背景图片路径。None=使用主题背景
    pub app_background_image_path: Option<String>,
    /// 桌面歌词窗口：上次的 x（逻辑像素）。None=居中默认位置
    pub lyric_window_x: Option<f64>,
    /// 桌面歌词窗口：上次的 y
    pub lyric_window_y: Option<f64>,
    /// 桌面歌词窗口：上次的宽
    pub lyric_window_width: Option<f64>,
    /// 桌面歌词窗口：上次的高
    pub lyric_window_height: Option<f64>,
    /// 主窗口：上次的 x（逻辑像素）。None=居中默认位置
    pub main_window_x: Option<f64>,
    /// 主窗口：上次的 y
    pub main_window_y: Option<f64>,
    /// 主窗口：上次的宽
    pub main_window_width: Option<f64>,
    /// 主窗口：上次的高
    pub main_window_height: Option<f64>,
    /// 主窗口：上次退出时是否最大化。最大化时尺寸/位置记的是系统矩形，所以形状由这个开关决定
    #[serde(default)]
    pub main_window_maximized: bool,
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
    /// WebDAV 启动时自动同步歌单与历史
    #[serde(default)]
    pub webdav_auto_sync_playlists: bool,
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
            playback_failed_auto_next: false,
            // 默认跟随：媒体键直接可用是用户预期，关掉才需要用户主动操作
            follow_system_media_control: true,
            // 默认开：悬停任务栏就能看到曲目封面是用户预期，关掉才需要用户主动操作
            taskbar_thumbnails: true,
            wy_cookie: None,
            lyric_pinned: true,
            lyric_locked: false,
            lyric_pause_hide: false,
            lyric_font_size: 28,
            lyric_show_next_line: true,
            lyric_single_line: false,
            lyric_max_line_num: 2,
            lyric_show_translation: true,
            lyric_show_romanization: false,
            lyric_show_ruby: false,
            lyric_align: "center".to_string(),
            lyric_line_gap: 8,
            lyric_font_weight: 700,
            lyric_manual_offset_ms: 0,
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
            immersive_lyric_font_family:
                "\"Inter\", \"Noto Sans CJK SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
                    .to_string(),
            app_background_image_path: None,
            lyric_window_x: None,
            lyric_window_y: None,
            lyric_window_width: None,
            lyric_window_height: None,
            main_window_x: None,
            main_window_y: None,
            main_window_width: None,
            main_window_height: None,
            main_window_maximized: false,
            pact_accepted: false,
            cursor_effect: "off".to_string(),
            webdav_url: None,
            webdav_username: None,
            webdav_password: None,
            webdav_auto_sync_playlists: false,
            custom_source_auto_check: true,
        }
    }
}

// ============================================================
// 本地音频文件模型（沿用原 main.rs 中的 AudioFile，更丰富）
// ============================================================

/// 本地音频文件 — 包含完整元数据、封面 Base64、内嵌歌词
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// Base64 编码的封面图片，格式 "data:image/png;base64,..."。
    ///
    /// 仅单文件查询（get_audio_info）会填充；整目录扫描（scan_directory）留空，
    /// 否则一次 IPC 就要搬运整库封面的 base64。
    pub cover_data: Option<String>,
    /// 内嵌封面落盘后的文件路径（封面缓存目录），前端用 asset 协议显示。
    ///
    /// 封面以文件形式存在，持久化库里只留这个短路径，避免库文件随曲目数膨胀。
    pub cover_path: Option<String>,
    /// 内嵌歌词（LRC 格式）。同样只在单文件查询时填充。
    pub lyrics: Option<String>,
}

/// 支持的音频格式扩展名
pub const SUPPORTED_FORMATS: &[&str] = &[
    "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma", "ape", "aiff",
];

#[cfg(test)]
mod desktop_media_settings_tests {
    use super::*;

    #[test]
    fn new_media_features_default_off() {
        let settings = serde_json::to_value(AppSettings::default()).unwrap();
        assert!(settings.get("replayGainEnabled").is_none());
        assert_eq!(settings["lyricShowRomanization"], false);
        assert_eq!(settings["lyricShowRuby"], false);
    }

    #[test]
    fn legacy_audio_file_discards_replay_gain() {
        let file: AudioFile = serde_json::from_value(serde_json::json!({
            "id":"1", "path":"song.flac", "title":"song", "artist":"artist", "album":"album",
            "duration":10, "format":"flac", "size":100,
            "replayGain":{"gainDb":-6.0,"peak":0.8}
        })).unwrap();
        let value = serde_json::to_value(file).unwrap();
        assert!(value.get("replayGain").is_none());
        assert_eq!(value["title"], "song");
    }
}

#[cfg(test)]
mod legacy_playback_settings_tests {
    use super::AppSettings;

    #[test]
    fn legacy_enabled_replay_gain_is_ignored_and_not_saved() {
        let settings: AppSettings = serde_json::from_value(serde_json::json!({
            "replayGainEnabled": true,
            "volume": 37,
            "pauseOnExternalPlayback": false
        })).unwrap();
        assert_eq!(settings.volume, 37);
        assert!(!settings.pause_on_external_playback);
        let value = serde_json::to_value(settings).unwrap();
        assert!(value.get("replayGainEnabled").is_none());
        assert_eq!(value["volume"], 37);
    }
}
