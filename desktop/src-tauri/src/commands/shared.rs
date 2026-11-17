//! `commands/` 下多个命令文件共用的小工具。
//!
//! 这些东西此前靠 `use super::*` 通配导入在文件之间隐式流通；现在谁用谁显式
//! `use super::shared::…`，依赖关系交给编译器检查。只收「与具体业务无关、且确有
//! 两个以上文件在用」的东西，业务逻辑留在各自模块里。

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime};

/// 媒体类出站请求（音频/封面缓存 `media_cache`、用户下载 `downloads`）共用的超时。
pub(super) const MEDIA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const MEDIA_READ_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const MEDIA_TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

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
mod image_magic_tests {
    use super::*;

    /// 魔数表是桌面端唯一的一张，
    /// 认不出来的字节一律 `None` —— `set_audio_cover` 靠这个挡掉 SVG 这类活动内容。
    #[test]
    fn sniff_recognizes_supported_images_and_rejects_anything_else() {
        assert_eq!(
            sniff_image_extension(b"\x89PNG\r\n\x1a\n\x00\x00"),
            Some("png")
        );
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
        assert_eq!(
            sniff_image_extension(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            None
        );
        assert_eq!(sniff_image_extension(b""), None);
        assert_eq!(sniff_image_extension(b"not an image at all"), None);
    }
}
