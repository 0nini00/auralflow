//! 音源网关 — 网易云 API 代理
//!
//! 将前端的 neteaseCrypto.ts / neteaseRequest.ts / wyProvider.ts
//! 迁移到 Rust 层，实现：
//!   1. weapi / eapi / linuxapi 加密
//!   2. 网易云 HTTP 请求代理
//!   3. 搜索 / URL 解析 / 歌词 / 歌单详情

use crate::models::*;
use base64::Engine;
use md5;
use reqwest::Client;
use serde_json::Value;
use std::sync::Arc;

// ─── 常量 ───────────────────────────────────────────────────────

const WY_IV: &[u8] = b"0102030405060708";
const WY_PRESET_KEY: &[u8] = b"0CoJUm6Qyw8W8jud";
const WY_EAPI_KEY: &[u8] = b"e82ckenh8dichen8";
const WY_LINUX_API_KEY: &[u8] = b"rFgB&h#%2?^eDg:Q";

const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// 网易云 RSA 公钥 PEM（与前端 neteaseCrypto.ts 一致）
const WY_RSA_PEM: &str = "-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ3
7BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvakl
V8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44o
ncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----";

/// 网易云 API 基础 URL
const NETEASE_BASE: &str = "https://interface3.music.163.com";
const NETEASE_EAPI_BATCH: &str = "http://interface.music.163.com/eapi/batch";
const NETEASE_LINUX_FORWARD: &str = "https://music.163.com/api/linux/forward";
const NETEASE_WEAPI_BASE: &str = "https://music.163.com";

// ─── 加密实现 ───────────────────────────────────────────────────

/// 生成随机 base62 密钥（16 字节）
fn rand_secret_key() -> Vec<u8> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    let mut key = Vec::with_capacity(16);
    let mut state = seed;
    for _ in 0..16 {
        // xorshift64
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let idx = (state as usize) % BASE62.len();
        key.push(BASE62[idx]);
    }
    key
}

/// AES-128-CBC 加密，返回 Base64
fn aes_cbc_encrypt_base64(data: &[u8], key: &[u8], iv: &[u8]) -> String {
    use aes::Aes128;
    use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};
    use aes::cipher::consts::U16;

    let block_size = 16;
    let pad_len = block_size - (data.len() % block_size);
    let mut buf = data.to_vec();
    buf.extend(std::iter::repeat(pad_len as u8).take(pad_len));

    let cipher = Aes128::new_from_slice(key).expect("invalid AES key length");
    let mut prev: GenericArray<u8, U16> = GenericArray::clone_from_slice(iv);

    for chunk in buf.chunks_exact_mut(block_size) {
        let block: &mut GenericArray<u8, U16> = GenericArray::from_mut_slice(chunk);
        // CBC: XOR plaintext with IV / previous ciphertext
        for (b, p) in block.iter_mut().zip(prev.iter()) {
            *b ^= *p;
        }
        cipher.encrypt_block(block);
        prev.copy_from_slice(block.as_slice());
    }

    base64::engine::general_purpose::STANDARD.encode(&buf)
}

/// AES-128-ECB 加密，返回 Hex（大写）
fn aes_ecb_encrypt_hex(data: &[u8], key: &[u8]) -> String {
    use aes::Aes128;
    use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};
    use aes::cipher::consts::U16;

    let block_size = 16;
    let pad_len = block_size - (data.len() % block_size);
    let mut buf = data.to_vec();
    buf.extend(std::iter::repeat(pad_len as u8).take(pad_len));

    let cipher = Aes128::new_from_slice(key).expect("invalid AES key length");

    for chunk in buf.chunks_exact_mut(block_size) {
        cipher.encrypt_block(GenericArray::<u8, U16>::from_mut_slice(chunk));
    }

    hex::encode_upper(&buf)
}

/// 解析网易云 RSA 公钥（PEM 格式）
fn get_wy_rsa_pubkey() -> rsa::RsaPublicKey {
    use rsa::pkcs8::DecodePublicKey;
    rsa::RsaPublicKey::from_public_key_pem(WY_RSA_PEM)
        .expect("parse wy rsa public key")
}

/// RSA 无 padding 加密（与前端 rsaNoPaddingEncrypt 对齐）
/// 左侧填充 \x00 到 128 字节，做 m^e mod n，返回 hex 小写（补齐到 256 字符）
fn rsa_no_padding_encrypt(input: &str) -> String {
    use num_bigint::BigUint;
    use rsa::traits::PublicKeyParts;

    let pubkey = get_wy_rsa_pubkey();
    let n = BigUint::from_bytes_be(&pubkey.n().to_bytes_be());
    let e = BigUint::from_bytes_be(&pubkey.e().to_bytes_be());

    // 左侧填充 0x00 到 128 字节
    let raw = input.as_bytes();
    let padded_len: usize = 128;
    let mut padded = vec![0u8; padded_len - raw.len()];
    padded.extend_from_slice(raw);

    let m = BigUint::from_bytes_be(&padded);
    let c = m.modpow(&e, &n);
    let hex_result = hex::encode(c.to_bytes_be()).to_lowercase();

    // 补齐到 256 字符（与前端 padLeft 对齐）
    if hex_result.len() < 256 {
        format!("{:0>256}", hex_result)
    } else {
        hex_result
    }
}

/// weapi 加密 — 与前端 weapi() 一致
/// 返回 (params, encSecKey)
pub fn weapi_encrypt(data: &Value) -> (String, String) {
    let text = serde_json::to_string(data).expect("serialize json");

    // 第一次加密：明文 → AES-CBC(PRESET_KEY, IV) → Base64
    let encrypted_once = aes_cbc_encrypt_base64(text.as_bytes(), WY_PRESET_KEY, WY_IV);

    // 随机密钥
    let secret_key = rand_secret_key();

    // 第二次加密：第一次结果的 Base64 字符串本身 → AES-CBC(secretKey, IV) → Base64
    let params = aes_cbc_encrypt_base64(encrypted_once.as_bytes(), &secret_key, WY_IV);

    // RSA 加密 secretKey 的反转字符串
    let secret_key_reversed: String = secret_key.iter().rev().map(|b| *b as char).collect();
    let enc_sec_key = rsa_no_padding_encrypt(&secret_key_reversed);

    (params, enc_sec_key)
}

/// eapi 加密 — 与前端 eapi() 一致
/// 格式: nobody{url}use{text}md5forencrypt → MD5 digest
///       → {url}-36cd479b6b5-{text}-36cd479b6b5-{digest} → AES-ECB(EAPI_KEY) → Hex
pub fn eapi_encrypt(url: &str, data: &Value) -> String {
    let text = serde_json::to_string(data).expect("serialize json");
    let message = format!("nobody{}use{}md5forencrypt", url, text);

    // MD5 digest
    let digest = format!("{:x}", md5::compute(message.as_bytes()));

    let payload = format!("{}-36cd479b6b5-{}-36cd479b6b5-{}", url, text, digest);
    aes_ecb_encrypt_hex(payload.as_bytes(), WY_EAPI_KEY)
}

/// linuxapi 加密 — 与前端 linuxapi() 一致
/// JSON → AES-ECB(LINUX_API_KEY) → Hex
pub fn linuxapi_encrypt(data: &Value) -> String {
    let text = serde_json::to_string(data).expect("serialize json");
    aes_ecb_encrypt_hex(text.as_bytes(), WY_LINUX_API_KEY)
}

/// 简易 URL 编码（与 Node.js querystring.stringify 行为对齐）
/// 保留 A-Z a-z 0-9 - _ . ~，其余编码为 %XX
fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + s.len() / 4);
    for &byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => {
                result.push('+');
            }
            _ => {
                use std::fmt::Write;
                write!(&mut result, "%{:02X}", byte).unwrap();
            }
        }
    }
    result
}

// ─── HTTP 客户端 ─────────────────────────────────────────────────

/// 网关 HTTP 客户端 — 封装 reqwest，带网易云默认 Headers
pub struct GatewayClient {
    http: Client,
    cookie: Option<String>,
}

impl GatewayClient {
    pub fn new(cookies: Option<String>) -> Self {
        use reqwest::cookie::Jar;

        // 用 cookie jar 绑定 Cookie 到网易云域名，重定向时自动携带
        let jar = Arc::new(Jar::default());
        if let Some(ref cookie_str) = cookies {
            for domain in &[
                "https://music.163.com",
                "https://interface3.music.163.com",
                "https://interface.music.163.com",
                "http://interface.music.163.com",   // eapi batch 走 HTTP
            ] {
                if let Ok(u) = domain.parse::<url::Url>() {
                    jar.add_cookie_str(cookie_str, &u);
                }
            }
        }

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54",
            ),
        );
        headers.insert(
            reqwest::header::REFERER,
            reqwest::header::HeaderValue::from_static("https://music.163.com"),
        );
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            reqwest::header::ACCEPT_LANGUAGE,
            reqwest::header::HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
        );
        headers.insert(
            reqwest::header::ORIGIN,
            reqwest::header::HeaderValue::from_static("https://music.163.com"),
        );

        // Cookie 由 cookie_provider 管理（自动跟随重定向），请求时也会手动注入原始 Cookie。
        let http = Client::builder()
            .http1_only()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(15))
            .cookie_provider(jar)
            .build()
            .expect("build reqwest client");

        GatewayClient {
            http,
            cookie: cookies,
        }
    }

    /// POST 请求（application/x-www-form-urlencoded）
    pub async fn netease_post(
        &self,
        url: &str,
        payload: &[(String, String)],
        extra_headers: Option<&[(String, String)]>,
    ) -> Result<Value, String> {
        let (status, text) = self.raw_post_with_status(url, payload, extra_headers).await?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(format!("网易云返回空响应: {}; status={}", url, status));
        }
        serde_json::from_str(trimmed).map_err(|e| {
            let preview: String = trimmed.chars().take(200).collect();
            format!("网易云响应不是 JSON: {}; url={}; body={}", e, url, preview)
        })
    }

    pub async fn raw_post_with_status(
        &self,
        url: &str,
        payload: &[(String, String)],
        extra_headers: Option<&[(String, String)]>,
    ) -> Result<(reqwest::StatusCode, String), String> {
        let mut req = self.http.post(url);

        // 手动构造 application/x-www-form-urlencoded body
        let body = payload
            .iter()
            .map(|(k, v)| format!("{}={}",
                urlencoding(k),
                urlencoding(v)))
            .collect::<Vec<_>>()
            .join("&");
        req = req
            .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body);

        if let Some(cookie) = self.cookie.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            req = req.header(reqwest::header::COOKIE, cookie);
        }

        if let Some(headers) = extra_headers {
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }
        }

        let resp = req.send().await.map_err(|e| {
            format!("Request failed: {}", e)
        })?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("HTTP {}", status));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        Ok((status, text))
    }

    // ─── 业务 API ───────────────────────────────────────────────

    /// EAPI 调用 — 与前端 neteaseEapi() 一致
    pub async fn eapi_call(&self, path: &str, data: &Value) -> Result<Value, String> {
        let params = eapi_encrypt(path, data);
        let payload = vec![("params".to_string(), params)];

        let eapi_headers = [
            ("Origin".to_string(), "https://music.163.com".to_string()),
        ];

        self.netease_post(
            &format!("{}/eapi{}", NETEASE_BASE, path),
            &payload,
            Some(&eapi_headers),
        )
        .await
    }

    /// EAPI batch 调用 — 与前端 neteaseEapi() 搜歌时使用的 /eapi/batch 端点一致
    pub async fn eapi_batch_call(&self, path: &str, data: &Value) -> Result<Value, String> {
        let params = eapi_encrypt(path, data);
        let payload = vec![("params".to_string(), params)];

        let batch_headers = [
            ("Origin".to_string(), "https://music.163.com".to_string()),
        ];

        self.netease_post(NETEASE_EAPI_BATCH, &payload, Some(&batch_headers)).await
    }

    /// 搜索歌曲 — 与前端 wyProvider.search() 一致
    pub async fn search_songs(
        &self,
        keyword: &str,
        page: u32,
        limit: u32,
    ) -> Result<SearchResult, String> {
        let offset = (page - 1) * limit;
        let data = serde_json::json!({
            "s": keyword,
            "type": 1,
            "limit": limit,
            "offset": offset,
        });

        let body = self.eapi_batch_call("/api/cloudsearch/pc", &data).await?;

        let total = body
            .get("result")
            .and_then(|r| r.get("songCount"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let songs_val = body
            .get("result")
            .and_then(|r| r.get("songs"))
            .cloned()
            .unwrap_or(Value::Null);

        let raw_songs: Vec<Value> = serde_json::from_value(songs_val).unwrap_or_default();
        let songs = raw_songs.iter().filter_map(map_wy_song).collect();

        Ok(SearchResult {
            songs,
            total,
            limit: limit as u64,
            offset: offset as u64,
        })
    }

    /// 搜索歌单 — 与前端 wyProvider.search() 一致
    pub async fn search_playlists(
        &self,
        keyword: &str,
        page: u32,
        limit: u32,
    ) -> Result<Vec<PlaylistInfo>, String> {
        let offset = (page - 1) * limit;
        let data = serde_json::json!({
            "s": keyword,
            "type": 1000,
            "limit": limit,
            "offset": offset,
        });

        let body = self.eapi_batch_call("/api/cloudsearch/pc", &data).await?;

        let playlists_val = body
            .get("result")
            .and_then(|r| r.get("playlists"))
            .cloned()
            .unwrap_or(Value::Null);

        let raw_playlists: Vec<Value> = serde_json::from_value(playlists_val).unwrap_or_default();
        Ok(raw_playlists.iter().filter_map(map_wy_playlist).collect())
    }

    /// 获取歌曲播放 URL — 与原版 desktop api-cookie.js 的 getMusicUrl() 完全一致
    /// 优先使用 weapi /song/enhance/player/url/v1（需 Cookie），回退到 eapi（免登录）
    pub async fn get_music_url(&self, id: &str, quality: &str) -> Result<Option<String>, String> {
        let id_num: i64 = id.parse().map_err(|_| "invalid id")?;

        // 将 quality 映射为 level + encodeType（与原版 desktop 一致）
        let (level, encode_type) = match quality {
            "flac24bit" | "hires" => ("hires", "flac"),
            "flac" | "lossless" => ("lossless", "aac"),
            "320k" | "exhigh" | "higher" => ("exhigh", "flac"),
            "128k" | "standard" => ("standard", "flac"),
            _ => ("exhigh", "flac"),
        };

        // 1. 优先用 weapi + Cookie（与原版 desktop 的 getMusicUrl() 完全一致）
        if self.cookie.is_some() {
            let csrf = extract_csrf_token(self.cookie.as_deref().unwrap_or(""));

            // 注意：ids 是 JSON 字符串格式 "[id_num]"，不是数组 [id_num]
            let data = serde_json::json!({
                "ids": format!("[{}]", id_num),
                "level": level,
                "encodeType": encode_type,
                "csrf_token": csrf,
            });

            if let Ok(body) = self.weapi_call("/song/enhance/player/url/v1", &data).await {
                if body.get("code").and_then(|c| c.as_i64()) == Some(200) {
                    let url = body
                        .get("data")
                        .and_then(|d| d.get(0))
                        .and_then(|item| item.get("url"))
                        .and_then(|u| u.as_str());
                    if let Some(url) = url {
                        if !url.is_empty() {
                            return Ok(Some(url.to_string()));
                        }
                    }
                }
            }
        }

        // 2. weapi 失败或无 Cookie → 回退 eapi（免登录，部分歌曲可用）
        let br = quality_to_br(quality);
        let eapi_data = serde_json::json!({
            "ids": [id_num],
            "br": br,
        });

        let body = self.eapi_call("/api/song/enhance/player/url", &eapi_data).await?;
        let url = body
            .get("data")
            .and_then(|d| d.get(0))
            .and_then(|item| item.get("url"))
            .and_then(|u| u.as_str());

        Ok(url.filter(|s| !s.is_empty()).map(|s| s.to_string()))
    }

    /// 获取歌词 — 与前端 wyProvider.getLyric() 一致
    pub async fn get_lyric(&self, id: &str) -> Result<LyricResult, String> {
        let id_num: i64 = id.parse().map_err(|_| "invalid id")?;

        let data = serde_json::json!({
            "id": id_num,
            "cp": false,
            "tv": 0,
            "lv": 0,
            "rv": 0,
            "kv": 0,
            "yv": 0,
            "ytv": 0,
            "yrv": 0,
        });

        let body = self.eapi_call("/api/song/lyric/v1", &data).await?;

        Ok(LyricResult {
            lyric: body
                .get("lrc")
                .and_then(|l| l.get("lyric"))
                .and_then(|v| v.as_str())
                .map(String::from),
            tlyric: body
                .get("tlyric")
                .and_then(|l| l.get("lyric"))
                .and_then(|v| v.as_str())
                .map(String::from),
            rlyric: body
                .get("romalrc")
                .and_then(|l| l.get("lyric"))
                .and_then(|v| v.as_str())
                .or_else(|| {
                    body.get("yromalrc")
                        .and_then(|l| l.get("lyric"))
                        .and_then(|v| v.as_str())
                })
                .map(String::from),
        })
    }

    /// 获取歌单详情 — 与前端 wyProvider.getPlaylistDetail() 一致
    pub async fn get_playlist_detail(&self, id: &str) -> Result<Vec<MusicInfo>, String> {
        let id_num: i64 = id.parse().map_err(|_| "invalid id")?;

        let linux_data = serde_json::json!({
            "method": "POST",
            "url": "https://music.163.com/api/v3/playlist/detail",
            "params": {
                "id": id_num,
                "n": 100000,
                "s": 8,
            },
        });

        let eparams = linuxapi_encrypt(&linux_data);
        let payload = vec![("eparams".to_string(), eparams)];

        let linux_headers = [
            ("User-Agent".to_string(), "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36".to_string()),
        ];

        let body = self
            .netease_post(NETEASE_LINUX_FORWARD, &payload, Some(&linux_headers))
            .await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Ok(Vec::new());
        }

        let tracks_val = body
            .get("playlist")
            .and_then(|p| p.get("tracks"))
            .cloned()
            .unwrap_or(Value::Null);

        let raw_tracks: Vec<Value> = serde_json::from_value(tracks_val).unwrap_or_default();
        Ok(raw_tracks.iter().filter_map(map_wy_song).collect())
    }

    // ─── 账号 API（weapi） ──────────────────────────────────

    /// weapi 调用
    pub async fn weapi_call(&self, path: &str, data: &Value) -> Result<Value, String> {
        let (params, enc_sec_key) = weapi_encrypt(data);
        let payload = vec![
            ("params".to_string(), params),
            ("encSecKey".to_string(), enc_sec_key),
        ];

        let origin_headers = [
            ("Origin".to_string(), "https://music.163.com".to_string()),
        ];

        self.netease_post(
            &format!("{}/weapi{}", NETEASE_WEAPI_BASE, path),
            &payload,
            Some(&origin_headers),
        )
        .await
    }

    /// 检查账号状态
    pub async fn get_account_status(&self, csrf_token: &str) -> Result<AccountInfo, String> {
        let data = serde_json::json!({
            "csrf_token": csrf_token,
        });

        let body = self.weapi_call("/nuser/account/get", &data).await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Err(body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("账号检查失败")
                .to_string());
        }

        let account = body.get("account").ok_or("Cookie 已过期或无效")?;
        let profile = body.get("profile");

        let uid = account
            .get("id")
            .or_else(|| profile.and_then(|p| p.get("userId")))
            .and_then(|v| v.as_i64())
            .map(|i| i.to_string())
            .unwrap_or_default();

        let vip_type = account
            .get("vipType")
            .or_else(|| profile.and_then(|p| p.get("vipType")))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;

        Ok(AccountInfo {
            uid,
            nickname: profile
                .and_then(|p| p.get("nickname"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            avatar_url: profile
                .and_then(|p| p.get("avatarUrl"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            vip_type,
            is_vip: vip_type > 0,
        })
    }

    /// 获取用户歌单列表
    pub async fn get_user_playlists(
        &self,
        uid: &str,
        csrf_token: &str,
    ) -> Result<Vec<PlaylistInfo>, String> {
        let data = serde_json::json!({
            "uid": uid,
            "limit": 1000,
            "offset": 0,
            "includeVideo": true,
            "csrf_token": csrf_token,
        });

        let body = self.weapi_call("/user/playlist", &data).await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Err(body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("获取歌单失败")
                .to_string());
        }

        let playlists_val = body
            .get("playlist")
            .cloned()
            .unwrap_or(Value::Null);

        let raw_playlists: Vec<Value> = serde_json::from_value(playlists_val).unwrap_or_default();
        let playlists: Vec<PlaylistInfo> = raw_playlists.iter().filter_map(|item| {
            let id = item.get("id").and_then(|v| v.as_i64()).map(|i| i.to_string())?;
            Some(PlaylistInfo {
                id,
                name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                cover_img_url: item.get("coverImgUrl").and_then(|v| v.as_str()).map(String::from),
                creator_nickname: item.get("creator").and_then(|c| c.get("nickname")).and_then(|n| n.as_str()).map(String::from),
                description: item.get("description").and_then(|v| v.as_str()).map(String::from),
                tags: None,
                play_count: item.get("playCount").and_then(|v| v.as_u64()),
                song_list: None,
                source: "wy".to_string(),
                subscribed: item.get("subscribed").and_then(|v| v.as_bool()),
                creator_user_id: item.get("userId").and_then(|v| v.as_i64()).map(|i| i as u64),
            })
        }).collect();

        Ok(playlists)
    }

    /// 获取喜欢歌曲 ID 列表
    pub async fn get_liked_song_ids(
        &self,
        uid: &str,
        csrf_token: &str,
    ) -> Result<Vec<i64>, String> {
        let data = serde_json::json!({
            "uid": uid,
            "csrf_token": csrf_token,
        });

        let body = self.weapi_call("/song/like/get", &data).await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Err(body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("获取喜欢列表失败")
                .to_string());
        }

        let ids: Vec<i64> = body
            .get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
            .unwrap_or_default();

        Ok(ids)
    }

    /// 获取每日推荐歌曲
    pub async fn get_daily_recommend_songs(
        &self,
        csrf_token: &str,
    ) -> Result<Vec<MusicInfo>, String> {
        let data = serde_json::json!({
            "offset": 0,
            "total": true,
            "limit": 30,
            "csrf_token": csrf_token,
        });

        let body = self.weapi_call("/v3/discovery/recommend/songs", &data).await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Err(body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("获取每日推荐失败")
                .to_string());
        }

        let songs_val = body
            .get("data")
            .and_then(|d| d.get("dailySongs"))
            .cloned()
            .unwrap_or(Value::Null);

        let raw_songs: Vec<Value> = serde_json::from_value(songs_val).unwrap_or_default();
        Ok(raw_songs.iter().filter_map(map_wy_song).collect())
    }

    /// 通过 cookie 获取歌单详情（weapi，完整歌曲列表）
    pub async fn get_playlist_detail_via_cookie(
        &self,
        id: &str,
        csrf_token: &str,
    ) -> Result<Vec<MusicInfo>, String> {
        let id_num: i64 = id.parse().map_err(|_| "invalid id")?;

        let data = serde_json::json!({
            "id": id_num,
            "n": 100000,
            "s": 8,
            "csrf_token": csrf_token,
        });

        let body = self.weapi_call("/v3/playlist/detail", &data).await?;

        if body.get("code").and_then(|c| c.as_i64()) != Some(200) {
            return Ok(Vec::new());
        }

        let playlist = body.get("playlist");
        let tracks_val = playlist
            .and_then(|p| p.get("tracks"))
            .cloned()
            .unwrap_or(Value::Null);

        let raw_tracks: Vec<Value> = serde_json::from_value(tracks_val).unwrap_or_default();
        Ok(raw_tracks.iter().filter_map(map_wy_song).collect())
    }
}

// ─── 数据映射（与前端 wyProvider 的 mapWySong / mapWyPlaylist 一致）───

/// 从 Cookie 字符串中提取 CSRF Token
pub(crate) fn extract_csrf_token(cookie: &str) -> String {
    cookie
        .split(';')
        .find(|s| s.trim().starts_with("__csrf=") || s.trim().starts_with("_csrf="))
        .and_then(|s| s.split('=').nth(1))
        .unwrap_or("")
        .to_string()
}

fn map_wy_song(item: &Value) -> Option<MusicInfo> {
    let id = item
        .get("id")
        .and_then(|v| v.as_i64())
        .map(|i| i.to_string())?;
    let name = item
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 合并歌手名
    let ar = item
        .get("ar")
        .or_else(|| item.get("artists"))
        .and_then(|v| v.as_array());
    let singer = ar
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                .collect::<Vec<_>>()
                .join("、")
        })
        .unwrap_or_default();

    // 专辑
    let album_obj = item.get("al").or_else(|| item.get("album"));
    let album = album_obj
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let album_pic_url = album_obj
        .and_then(|a| a.get("picUrl"))
        .and_then(|u| u.as_str())
        .map(String::from);

    // 时长（毫秒 → 秒）
    let duration = item
        .get("dt")
        .or_else(|| item.get("duration"))
        .and_then(|v| v.as_i64())
        .map(|ms| (ms / 1000) as u64);

    // 音质判断
    let privilege = item.get("privilege");
    let max_br = privilege
        .and_then(|p| p.get("maxbr"))
        .or_else(|| item.get("maxbr"))
        .and_then(|v| v.as_i64())
        .unwrap_or(128000);

    let max_br_level = privilege
        .and_then(|p| p.get("maxBrLevel"))
        .and_then(|v| v.as_str());

    let quality = if max_br_level == Some("hires")
        || max_br_level == Some("lossless")
        || max_br >= 999000
    {
        "flac".to_string()
    } else if max_br >= 320000 {
        "320k".to_string()
    } else {
        "128k".to_string()
    };

    Some(MusicInfo {
        id,
        name,
        singer,
        album,
        album_pic_url,
        duration,
        source: "wy".to_string(),
        quality: Some(quality),
        url: None,
        urls: None,
        lyric: None,
        tlyric: None,
        rlyric: None,
        extra: None,
    })
}

fn map_wy_playlist(item: &Value) -> Option<PlaylistInfo> {
    let id = item
        .get("id")
        .and_then(|v| v.as_i64())
        .map(|i| i.to_string())?;
    let name = item
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let creator_nickname = item
        .get("creator")
        .and_then(|c| c.get("nickname"))
        .and_then(|n| n.as_str())
        .map(String::from);
    let cover_img_url = item
        .get("coverImgUrl")
        .and_then(|v| v.as_str())
        .map(String::from);
    let description = item
        .get("description")
        .and_then(|v| v.as_str())
        .map(String::from);
    let tags = item
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(String::from))
                .collect()
        });
    let play_count = item.get("playCount").and_then(|v| v.as_u64());

    Some(PlaylistInfo {
        id,
        name,
        cover_img_url,
        creator_nickname,
        description,
        tags,
        play_count,
        song_list: None,
        source: "wy".to_string(),
        subscribed: None,
        creator_user_id: None,
    })
}

fn quality_to_br(quality: &str) -> u32 {
    match quality {
        "flac24bit" | "flac" | "lossless" | "hires" => 999000,
        "320k" | "higher" | "exhigh" => 320000,
        "128k" | "standard" => 128000,
        _ => 320000,
    }
}
