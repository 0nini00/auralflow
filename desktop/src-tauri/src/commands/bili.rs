// ─── B站 API 代理 ───────────────────────────────────────────────

fn ensure_bilibili_api_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|err| format!("B站请求地址无效: {}", err))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.bilibili.com") {
        return Err("B站请求只允许访问 https://api.bilibili.com".to_string());
    }
    Ok(parsed)
}

fn ensure_remote_https_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = crate::outbound::assert_public_url(url, "B站音频缓存")?;
    if parsed.scheme() != "https" {
        return Err("B站音频缓存只支持 HTTPS 地址".to_string());
    }
    Ok(parsed)
}

fn bili_audio_extension(url: &reqwest::Url) -> &'static str {
    let path = url.path().to_ascii_lowercase();
    if path.ends_with(".mp3") {
        "mp3"
    } else if path.ends_with(".flac") {
        "flac"
    } else if path.ends_with(".aac") {
        "aac"
    } else if path.ends_with(".ogg") {
        "ogg"
    } else if path.ends_with(".opus") {
        "opus"
    } else {
        "m4a"
    }
}

fn bili_audio_cache_path(
    app: &AppHandle,
    cache_key: Option<String>,
    url: &reqwest::Url,
) -> Result<PathBuf, String> {
    let cache_dir = super::media_cache::bili_audio_cache_dir(app)?;
    let key = super::media_cache::normalize_cache_key(cache_key, url.as_str());
    Ok(cache_dir.join(format!("{}.{}", key, bili_audio_extension(url))))
}

#[tauri::command]
pub async fn bili_get_json(
    url: String,
    cookie: Option<String>,
    referer: Option<String>,
) -> Result<Value, String> {
    let url = ensure_bilibili_api_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(BILI_UA)
        .redirect(crate::outbound::guarded_redirect_policy("B站请求"))
        .build()
        .map_err(|err| format!("创建 B站请求客户端失败: {}", err))?;

    let mut request = client
        .get(url)
        .header(USER_AGENT, BILI_UA)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(ORIGIN, "https://www.bilibili.com")
        .header(
            REFERER,
            referer.unwrap_or_else(|| "https://www.bilibili.com/".to_string()),
        );

    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        request = request.header(COOKIE, cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("B站请求失败: {}", err))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 B站响应失败: {}", err))?;

    if !status.is_success() {
        let detail = text.trim().chars().take(160).collect::<String>();
        return Err(format!(
            "B站请求失败: status={}{}",
            status,
            if detail.is_empty() {
                String::new()
            } else {
                format!("; body={}", detail)
            }
        ));
    }

    serde_json::from_str(&text).map_err(|err| format!("解析 B站响应失败: {}", err))
}

#[tauri::command]
pub async fn bili_cache_audio(
    app: AppHandle,
    url: String,
    referer: String,
    cookie: Option<String>,
    cache_key: Option<String>,
) -> Result<String, String> {
    let url = ensure_remote_https_url(&url)?;
    let path = bili_audio_cache_path(&app, cache_key, &url)?;
    if path.exists() {
        let size = std::fs::metadata(&path)
            .map_err(|err| format!("读取 B站音频缓存失败: {}", err))?
            .len();
        if size > 0 {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("创建 B站音频缓存目录失败: {}", err))?;
    }
    let temp_path = path.with_extension(format!(
        "{}.download",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("tmp")
    ));

    let client = reqwest::Client::builder()
        .user_agent(BILI_UA)
        .redirect(crate::outbound::guarded_redirect_policy("B站音频缓存"))
        .build()
        .map_err(|err| format!("创建 B站音频下载客户端失败: {}", err))?;
    let mut request = client
        .get(url)
        .header(USER_AGENT, BILI_UA)
        .header(ACCEPT, "*/*")
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(ORIGIN, "https://www.bilibili.com")
        .header(REFERER, referer);

    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        request = request.header(COOKIE, cookie);
    }

    let mut response = request
        .send()
        .await
        .map_err(|err| format!("请求 B站音频失败: {}", err))?;
    if !response.status().is_success() {
        return Err(format!("B站音频下载失败: HTTP {}", response.status()));
    }

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|err| format!("创建 B站音频缓存文件失败: {}", err))?;
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("读取 B站音频数据失败: {}", err))?
    {
        file.write_all(&chunk)
            .map_err(|err| format!("写入 B站音频缓存失败: {}", err))?;
        downloaded += chunk.len() as u64;
    }
    file.flush()
        .map_err(|err| format!("保存 B站音频缓存失败: {}", err))?;
    drop(file);

    if downloaded == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err("B站音频下载为空".to_string());
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| format!("覆盖 B站旧音频缓存失败: {}", err))?;
    }
    std::fs::rename(&temp_path, &path).map_err(|err| format!("完成 B站音频缓存失败: {}", err))?;

    Ok(path.to_string_lossy().to_string())
}
