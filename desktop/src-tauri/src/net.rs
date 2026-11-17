//! 出站 HTTP 客户端的唯一构造点。
//!
//! 此前 `outbound.rs`、`commands/media_cache.rs`、`commands/downloads.rs` 各自调
//! `reqwest::Client::builder()`，超时、UA、重定向策略散在三处，哪一处漏挂重定向校验
//! 都不会有人发现。现在全 crate 只有本文件构造客户端（测试里的本地回环客户端除外）：
//! 重定向逐跳校验在 `guarded_builder` 里统一挂上，调用方只能在下面两个具名构造器里选。
//!
//! 为什么是两个构造器而不是一个：connect / read 超时在 reqwest 里只能设在客户端上，
//! 不能按请求覆盖。媒体下载需要它们（连不上、中途停流要尽快失败，总时长却可以很长）；
//! 通用代理不能带——WebDAV 的 MOVE/COPY、慢音源接口可能几十秒不回一个字节，
//! 它只受调用方给的总超时约束。
//!
//! 为什么每次调用都新建、而不是缓存一个进程级客户端：`ClientBuilder::build()` 会在
//! 构建那一刻读取系统代理（环境变量 + Windows「Internet 选项」注册表）并固化进客户端。
//! 每次新建，用户中途开关系统代理对下一个请求立即生效，与前端走的 tauri-plugin-http
//! （同样每次请求新建客户端）表现一致；缓存的客户端会把代理冻结在首次使用那一刻，
//! 代理关掉之后 Rust 侧请求会一直打向已经不存在的本地端口，直到重启应用。
//! 代价是没有跨请求的连接复用。要换成共享客户端只需改这一个文件，
//! 但必须同时解决「系统代理变了怎么办」。

use std::time::Duration;

/// 媒体类请求（音频/封面缓存、用户下载）的超时。
const MEDIA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MEDIA_READ_TIMEOUT: Duration = Duration::from_secs(30);
const MEDIA_TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// 媒体缓存（音频/封面）请求用的完整浏览器 UA。
pub const MEDIA_CACHE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/// 用户下载的缺省 UA（调用方可经白名单请求头覆盖）。
///
/// 与 `MEDIA_CACHE_UA` 不同是历史原样保留：部分源站的防盗链对 UA 敏感，
/// 合并成一个值等于改了线上实际发出的请求，需要逐个音源实测之后再动。
pub const DOWNLOAD_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/// 所有出站客户端的公共底座：重定向逐跳过 `assert_public_url`，跳向内网直接失败。
fn guarded_builder(label: &'static str) -> reqwest::ClientBuilder {
    reqwest::Client::builder().redirect(crate::outbound::guarded_redirect_policy(label))
}

/// 通用代理（WebDAV / 自定义音源）用的客户端：只有调用方给的总超时。
pub fn proxy_client(
    timeout: Duration,
    label: &'static str,
) -> Result<reqwest::Client, reqwest::Error> {
    guarded_builder(label).timeout(timeout).build()
}

/// 媒体下载（缓存落盘 / 用户下载）用的客户端：带 connect / read 超时与缺省 UA。
pub fn media_client(
    user_agent: &'static str,
    label: &'static str,
) -> Result<reqwest::Client, reqwest::Error> {
    guarded_builder(label)
        .connect_timeout(MEDIA_CONNECT_TIMEOUT)
        .read_timeout(MEDIA_READ_TIMEOUT)
        .timeout(MEDIA_TOTAL_TIMEOUT)
        .user_agent(user_agent)
        .build()
}
