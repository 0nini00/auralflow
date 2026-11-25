//! 网易云云盘直传的桌面端原生边界。
//!
//! 前端负责 weapi 参数与状态机；文件读取、MD5、LBS 解析和二进制上传都在 Rust 侧按流
//! 处理，避免把几十 MB 的 FLAC 读进 WebView 堆。上传目标由 LBS 下发，仍统一过出站校验。

use crate::logging::ResultExt;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_CLOUD_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(180);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFileDigest {
    pub md5: String,
    pub size: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudUploadProgressEvent {
    pub task_id: String,
    pub uploaded: u64,
    pub total: u64,
    pub progress: f64,
}

#[derive(serde::Deserialize)]
struct LbsResponse {
    upload: Vec<String>,
}

fn cancel_map() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_cancel(task_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut map = cancel_map()
        .lock()
        .map_err(|_| "云盘上传取消状态锁损坏".to_string())?;
    if map.contains_key(task_id) {
        return Err("云盘上传任务 ID 已在使用".to_string());
    }
    let flag = Arc::new(AtomicBool::new(false));
    map.insert(task_id.to_string(), Arc::clone(&flag));
    Ok(flag)
}

fn clear_cancel(task_id: &str) {
    if let Ok(mut map) = cancel_map().lock() {
        map.remove(task_id);
    }
}

struct CancelGuard {
    task_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        clear_cancel(&self.task_id);
    }
}

fn emit_progress(app: &AppHandle, task_id: &str, uploaded: u64, total: u64) {
    let progress = if total > 0 {
        uploaded as f64 / total as f64 * 100.0
    } else {
        0.0
    };
    app.emit(
        "cloud-upload-progress",
        CloudUploadProgressEvent {
            task_id: task_id.to_string(),
            uploaded,
            total,
            progress,
        },
    )
    .log_warn("[cloud-upload] 推送上传进度失败");
}

/// 解析 NOS 上传服务器；前端再用共享模型拼出完整上传地址。
#[tauri::command]
pub async fn cloud_upload_lbs(bucket: String) -> Result<String, String> {
    if bucket.is_empty()
        || bucket.len() > 128
        || !bucket
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err("云盘 bucket 无效".to_string());
    }

    let mut url = reqwest::Url::parse("https://wanproxy.127.net/lbs")
        .map_err(|err| format!("云盘上传服务器地址无效: {}", err))?;
    url.query_pairs_mut()
        .append_pair("version", "1.0")
        .append_pair("bucketname", &bucket);
    let client = crate::net::proxy_client(Duration::from_secs(15), "云盘上传")
        .map_err(|err| format!("创建云盘上传客户端失败: {}", err))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("获取云盘上传服务器失败: {}", err))?;
    if !response.status().is_success() {
        return Err(format!(
            "获取云盘上传服务器失败: HTTP {}",
            response.status()
        ));
    }
    let body: LbsResponse = response
        .json()
        .await
        .map_err(|err| format!("解析云盘上传服务器失败: {}", err))?;
    let base = body
        .upload
        .first()
        .map(|value| value.trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "云盘上传服务器返回为空".to_string())?;
    crate::outbound::assert_public_url(&base, "云盘上传")?;
    Ok(base)
}

/// 流式计算文件 MD5，同时返回实际字节数；不把文件读入内存。
#[tauri::command]
pub async fn cloud_file_md5(path: String) -> Result<CloudFileDigest, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<CloudFileDigest, String> {
        let file = File::open(&path).map_err(|err| format!("打开音频文件失败: {}", err))?;
        let metadata = file
            .metadata()
            .map_err(|err| format!("读取音频文件信息失败: {}", err))?;
        if !metadata.is_file() {
            return Err("所选路径不是文件".to_string());
        }
        let size = metadata.len();
        if size == 0 {
            return Err("音频文件为空".to_string());
        }
        if size > MAX_CLOUD_UPLOAD_BYTES {
            return Err("文件超过 2GB 上限".to_string());
        }

        let mut reader = BufReader::with_capacity(64 * 1024, file);
        let mut context = md5::Context::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|err| format!("读取音频文件失败: {}", err))?;
            if read == 0 {
                break;
            }
            context.consume(&buffer[..read]);
        }
        Ok(CloudFileDigest {
            md5: format!("{:x}", context.compute()),
            size,
        })
    })
    .await
    .map_err(|err| format!("计算文件 MD5 任务失败: {}", err))?
}

struct ProgressReader<R> {
    inner: R,
    app: AppHandle,
    task_id: String,
    cancel: Arc<AtomicBool>,
    uploaded: u64,
    total: u64,
    last_emit: Instant,
}

impl<R: Read> Read for ProgressReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "上传已取消",
            ));
        }
        let read = self.inner.read(buffer)?;
        if read > 0 {
            self.uploaded += read as u64;
            if self.last_emit.elapsed() >= PROGRESS_INTERVAL || self.uploaded >= self.total {
                emit_progress(&self.app, &self.task_id, self.uploaded, self.total);
                self.last_emit = Instant::now();
            }
        }
        Ok(read)
    }
}

fn upload_blocking(
    app: AppHandle,
    task_id: String,
    path: String,
    upload_url: String,
    token: String,
    md5: String,
    mime_type: String,
    file_size: u64,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let path_buf = Path::new(&path);
    let file = File::open(path_buf).map_err(|err| format!("打开音频文件失败: {}", err))?;
    let actual_size = file
        .metadata()
        .map_err(|err| format!("读取音频文件信息失败: {}", err))?
        .len();
    if actual_size != file_size {
        return Err("文件在准备上传后发生了变化，请重新选择".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(30 * 60))
        // 上传体是一次性流，不能安全地重放；重定向直接暴露为错误。
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| format!("创建上传客户端失败: {}", err))?;

    emit_progress(&app, &task_id, 0, file_size);
    let reader = ProgressReader {
        inner: file,
        app: app.clone(),
        task_id: task_id.clone(),
        cancel: Arc::clone(&cancel),
        uploaded: 0,
        total: file_size,
        last_emit: Instant::now(),
    };
    let response = client
        .post(upload_url)
        .header("x-nos-token", token)
        .header("Content-MD5", md5)
        .header(
            "Content-Type",
            if mime_type.is_empty() {
                "application/octet-stream"
            } else {
                mime_type.as_str()
            },
        )
        .body(reqwest::blocking::Body::sized(reader, file_size))
        .send()
        .map_err(|err| {
            if cancel.load(Ordering::SeqCst) {
                "上传已取消".to_string()
            } else {
                format!("上传文件失败: {}", err)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let mut body = String::new();
        if let Err(err) = response.take(4096).read_to_string(&mut body) {
            return Err(format!(
                "上传失败（HTTP {}），读取响应失败: {}",
                status, err
            ));
        }
        let detail = body.trim();
        return Err(if detail.is_empty() {
            format!("上传失败（HTTP {}）", status)
        } else {
            format!("上传失败（HTTP {}）：{}", status, detail)
        });
    }

    emit_progress(&app, &task_id, file_size, file_size);
    Ok(())
}

/// 把本地文件流式直传到 NOS；进度通过 `cloud-upload-progress` 事件上报。
#[tauri::command]
pub async fn cloud_upload_file(
    app: AppHandle,
    task_id: String,
    path: String,
    upload_url: String,
    token: String,
    md5: String,
    mime_type: String,
    file_size: u64,
) -> Result<(), String> {
    crate::outbound::assert_public_url(&upload_url, "云盘上传")?;
    if task_id.is_empty() {
        return Err("缺少上传任务 ID".to_string());
    }
    if token.is_empty() {
        return Err("缺少上传凭证".to_string());
    }
    if md5.len() != 32 || !md5.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("文件 MD5 无效".to_string());
    }
    if file_size == 0 || file_size > MAX_CLOUD_UPLOAD_BYTES {
        return Err("文件大小无效".to_string());
    }

    let cancel = register_cancel(&task_id)?;
    let _guard = CancelGuard {
        task_id: task_id.clone(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        upload_blocking(
            app, task_id, path, upload_url, token, md5, mime_type, file_size, cancel,
        )
    })
    .await
    .map_err(|err| format!("上传任务异常结束: {}", err))?
}

#[tauri::command]
pub fn cancel_cloud_upload(task_id: String) -> Result<bool, String> {
    let map = cancel_map()
        .lock()
        .map_err(|_| "云盘上传取消状态锁损坏".to_string())?;
    let Some(flag) = map.get(&task_id) else {
        return Ok(false);
    };
    flag.store(true, Ordering::SeqCst);
    Ok(true)
}
