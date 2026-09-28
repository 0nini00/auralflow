//! 出站 HTTP 的单一真相源。
//!
//! 存在的原因：WebDAV 服务地址与自定义音源脚本请求的目标由用户在运行时配置，
//! 无法用 `capabilities/*.json` 里的静态 URL 白名单表达。这类请求统一走本模块，
//! 由 Rust 侧做一次校验，避免前端各写一份判定（第二真相源）。
//!
//! 安全边界（显式声明，便于评审与调整）：
//!   - 只允许 http / https；
//!   - 拒绝 localhost、`.local` 域名，以及字面量的回环 / 私有 / 链路本地 /
//!     CGNAT / 未指定 / 多播 / 广播地址，IPv4-mapped IPv6 会先还原再判定；
//!   - 重定向逐跳复用同一判定，避免 302 到内网绕过；
//!   - **不做** DNS 解析后校验，因此解析到内网的域名（DNS rebinding）不在拦截范围。
//!     该场景要求用户主动填入恶意地址或安装恶意音源，与「用户自带脚本同权」的
//!     既有威胁模型一致，故不在此层处理。

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
/// 单次响应体上限，避免恶意端点撑爆内存。
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

fn is_blocked_v4(addr: Ipv4Addr) -> bool {
    let [a, b, ..] = addr.octets();
    // CGNAT 100.64.0.0/10 —— 标准库的 is_shared() 尚未 stable，手动判定。
    let is_cgnat = a == 100 && (64..=127).contains(&b);
    // 下面四段标准库都没有对应判定，必须手动补齐：它们与 JS 侧
    // `packages/core/src/outbound-host.ts:100-111` 一一对应。缺一段就会让桌面端
    // 比移动端更宽松——同一套规则两份实现，宽松的那份是实际的攻击面。
    // 四段都是不可路由地址，任何正常音源 CDN / WebDAV 都不会落在其中。
    let is_this_network = a == 0; // 0.0.0.0/8（含 0.0.0.0 自身）
    let is_ietf_protocol = a == 192 && b == 0; // 192.0.0.0/16
    let is_benchmark = a == 198 && (b == 18 || b == 19); // 198.18.0.0/15
    let is_reserved = a >= 240; // 240.0.0.0/4（含广播 255.255.255.255）
    addr.is_loopback()
        || addr.is_private()
        || addr.is_link_local()
        || addr.is_unspecified()
        || addr.is_multicast()
        || addr.is_broadcast()
        || addr.is_documentation()
        || is_cgnat
        || is_this_network
        || is_ietf_protocol
        || is_benchmark
        || is_reserved
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(addr) => is_blocked_v4(addr),
        IpAddr::V6(addr) => {
            // 先判 IPv6 自身属性：`::1` 是 IPv4-compatible 形式，若先走 to_ipv4()
            // 会被还原成 0.0.0.1 而漏判。
            if addr.is_loopback()
                || addr.is_unspecified()
                || addr.is_multicast()
                || addr.is_unique_local()
                || addr.is_unicast_link_local()
            {
                return true;
            }
            // `::ffff:127.0.0.1` 这类映射地址还原成 IPv4 再判一次。
            match addr.to_ipv4() {
                Some(mapped) => is_blocked_v4(mapped),
                None => false,
            }
        }
    }
}

/// 校验目标地址是否允许出站。所有运行时可配置的出站请求都必须先过这里。
pub fn assert_public_url(url: &str, label: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| format!("{}地址无效: {}", label, err))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("{}只支持 HTTP/HTTPS 地址", label));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("{}地址缺少 host", label))?;
    // 尾点是等价的 FQDN 写法（`localhost.` 照样解析到回环），必须先剥掉，
    // 否则既躲过 `== "localhost"` 也躲过 `.ends_with(".local")`。
    // 与 JS 侧 `normalizeHost` 的同一步保持一致。
    let lowered = host.to_ascii_lowercase();
    let lowered = lowered.trim_end_matches('.');
    if lowered.is_empty() {
        return Err(format!("{}地址缺少 host", label));
    }
    if lowered == "localhost" || lowered.ends_with(".localhost") || lowered.ends_with(".local") {
        return Err(format!("{}不允许访问本地地址: {}", label, host));
    }
    // URL 里的 IPv6 字面量带方括号，解析前先剥掉。
    let host_for_ip = lowered.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host_for_ip.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err(format!("{}不允许访问本地或内网地址: {}", label, host));
        }
    }
    Ok(parsed)
}

/// 重定向逐跳校验策略。跳转到内网时直接失败，而不是静默跟随。
/// 所有对外下载的 reqwest 客户端都应挂上它。
pub fn guarded_redirect_policy(label: &'static str) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error("重定向次数过多");
        }
        match assert_public_url(attempt.url().as_str(), label) {
            Ok(_) => attempt.follow(),
            Err(message) => attempt.error(message),
        }
    })
}

/// 构造带重定向逐跳校验的客户端。
fn build_guarded_client(timeout: Duration, label: &'static str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(guarded_redirect_policy(label))
        .build()
        .map_err(|err| format!("创建{}客户端失败: {}", label, err))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequestOptions {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    /// 本次请求允许的最大响应体字节数，缺省用 `MAX_RESPONSE_BYTES`。
    ///
    /// 用于只需响应头/少量内容的调用（如流探活）：即使服务端忽略 `Range`
    /// 返回整个文件，也不会被完整读进内存。
    pub max_bytes: Option<u64>,
    /// `text`（默认）或 `base64`。二进制响应（封面图等）必须用 base64，
    /// 否则 UTF-8 lossy 转换会破坏字节。
    pub response_type: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// 运行时可配置目标的通用 HTTP 代理（WebDAV / 自定义音源）。
///
/// 走 Rust 而不是 `@tauri-apps/plugin-http` 的原因：后者的 scope 是静态 URL 白名单，
/// 无法覆盖用户自填的 WebDAV 服务器和音源脚本的任意目标。
#[tauri::command]
pub async fn proxy_http_request(options: ProxyRequestOptions) -> Result<ProxyResponse, String> {
    const LABEL: &str = "出站请求";
    let url = assert_public_url(&options.url, LABEL)?;

    let method_text = options.method.unwrap_or_else(|| "GET".to_string());
    let method = reqwest::Method::from_bytes(method_text.trim().to_uppercase().as_bytes())
        .map_err(|_| format!("不支持的 HTTP 方法: {}", method_text))?;

    let timeout = Duration::from_millis(
        options
            .timeout_ms
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS),
    );

    let client = build_guarded_client(timeout, LABEL)?;
    let mut request = client.request(method, url);
    for (name, value) in options.headers.unwrap_or_default() {
        request = request.header(name, value);
    }
    if let Some(body) = options.body {
        request = request.body(body);
    }

    let mut response = request
        .send()
        .await
        .map_err(|err| format!("请求失败: {}", err))?;

    let status = response.status();
    let mut headers = HashMap::new();
    // 多个同名头（特别是 Set-Cookie）会被 reqwest 合并成逗号分隔的单个值；
    // 这里用 \n 拼接保留各条独立，便于前端按行解析提取 cookie。
    let mut set_cookie_values: Vec<String> = Vec::new();
    for (name, value) in response.headers() {
        if let Ok(text) = value.to_str() {
            if name == "set-cookie" {
                set_cookie_values.push(text.to_string());
            } else {
                headers.insert(name.as_str().to_string(), text.to_string());
            }
        }
    }
    if !set_cookie_values.is_empty() {
        headers.insert("set-cookie".to_string(), set_cookie_values.join("\n"));
    }

    // 流式读取并在超限时立即中止。
    //
    // 不能先 `response.bytes()` 全量缓冲再比长度：那样一个异常端点会在被拒绝前
    // 就把内存吃满（流探活的 Range 请求被 CDN 忽略时，等于把整首歌读进内存）。
    let limit = options
        .max_bytes
        .map(|value| value as usize)
        .filter(|value| *value > 0)
        .unwrap_or(MAX_RESPONSE_BYTES)
        .min(MAX_RESPONSE_BYTES);

    let mut bytes: Vec<u8> = Vec::new();
    if let Some(length) = response.content_length() {
        if length as usize > limit {
            return Err(format!(
                "响应体过大（声明 {} 字节，上限 {} 字节）",
                length, limit
            ));
        }
        bytes.reserve(length as usize);
    }
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("读取响应失败: {}", err))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(format!(
                "响应体过大（已读取 {} 字节，上限 {} 字节）",
                bytes.len(),
                limit
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    let body = match options.response_type.as_deref() {
        Some("base64") => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        }
        _ => String::from_utf8_lossy(&bytes).into_owned(),
    };

    Ok(ProxyResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这四段是补齐的：标准库没有对应判定，此前桌面端比移动端宽松。
    /// 每段都给「边界内」与「边界外」两个样本，避免把网段写大或写小一位。
    #[test]
    fn blocks_reserved_ranges_std_lacks() {
        for blocked in ["0.0.0.0", "0.0.0.1", "0.255.255.255"] {
            assert!(is_blocked_v4(blocked.parse().unwrap()), "0.0.0.0/8 应拦截: {blocked}");
        }
        assert!(!is_blocked_v4("1.0.0.0".parse().unwrap()), "1.0.0.0 不在 0.0.0.0/8");

        for blocked in ["192.0.0.0", "192.0.0.1", "192.0.255.255"] {
            assert!(is_blocked_v4(blocked.parse().unwrap()), "192.0.0.0/16 应拦截: {blocked}");
        }
        assert!(!is_blocked_v4("192.1.0.0".parse().unwrap()), "192.1.0.0 不在 192.0.0.0/16");

        for blocked in ["198.18.0.0", "198.18.0.1", "198.19.255.255"] {
            assert!(is_blocked_v4(blocked.parse().unwrap()), "198.18.0.0/15 应拦截: {blocked}");
        }
        assert!(!is_blocked_v4("198.20.0.0".parse().unwrap()), "198.20.0.0 不在 198.18.0.0/15");

        for blocked in ["240.0.0.0", "240.0.0.1", "255.255.255.255"] {
            assert!(is_blocked_v4(blocked.parse().unwrap()), "240.0.0.0/4 应拦截: {blocked}");
        }
        // 223/8 既不在多播 224/4 也不在保留 240/4 内
        assert!(!is_blocked_v4("223.255.255.255".parse().unwrap()));
    }

    /// 两端本来就一致的判定，钉住不回归。
    #[test]
    fn blocks_ranges_both_implementations_agreed_on() {
        for blocked in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "224.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
        ] {
            assert!(is_blocked_v4(blocked.parse().unwrap()), "应拦截: {blocked}");
        }
        for allowed in ["8.8.8.8", "1.1.1.1", "203.0.114.1"] {
            assert!(!is_blocked_v4(allowed.parse().unwrap()), "应放行: {allowed}");
        }
    }

    /// IPv4-mapped 靠 `to_ipv4()` 落回同一张表，所以 0.0.0.0/8 补齐后这条自动成立。
    /// 本测试专门钉住这个依赖关系——两处判定分别维护时最容易在这里漏判。
    #[test]
    fn mapped_ipv6_inherits_the_v4_blocklist() {
        assert!(is_blocked_ip("::ffff:0.0.0.1".parse().unwrap()));
        assert!(is_blocked_ip("::ffff:127.0.0.1".parse().unwrap()));
        assert!(is_blocked_ip("::1".parse().unwrap()));
        assert!(!is_blocked_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    /// 端到端（只解析、不发请求）：这是所有运行时可配置出站请求的必经关口。
    #[test]
    fn assert_public_url_rejects_internal_and_non_http_targets() {
        for rejected in [
            "http://127.0.0.1/",
            "http://0.0.0.1/",
            "http://192.0.0.1/",
            "http://198.18.0.1/",
            "http://240.0.0.1/",
            "http://[::ffff:0.0.0.1]/",
            "http://localhost./",
            "http://foo.local/",
            "ftp://8.8.8.8/",
        ] {
            assert!(assert_public_url(rejected, "测试").is_err(), "应拒绝: {rejected}");
        }
        for accepted in ["http://8.8.8.8/", "https://example.com/path?q=1"] {
            assert!(assert_public_url(accepted, "测试").is_ok(), "应放行: {accepted}");
        }
    }
}
