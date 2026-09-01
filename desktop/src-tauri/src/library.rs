//! 用户数据持久化（B-mid 持久化层）
//!
//! 与 config.rs 平行：config.rs 管 AppSettings（应用偏好），
//! 本模块管 favorites / playlists / library / customSources / recent / cache
//! "用户级数据"。每份独立 JSON 存盘，Rust 不复刻其 schema —— 仅做透明 IO。
//!
//! 文件位置：app_data_dir / library / <namespace>.json
//!
//! 命名空间白名单见 ALLOWED_NAMESPACES，避免前端写入任意路径。

use crate::atomic_file::{lock_persistence, write_atomic};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LIBRARY_DIR: &str = "library";

/// 允许的命名空间。新增数据类型时在此追加。
const ALLOWED_NAMESPACES: &[&str] = &[
    "favorites",
    "playlists",
    "library",
    "customSources",
    "recent",
    "cache",
    "dailyRecommend",
];

fn validate(namespace: &str) -> Result<(), String> {
    if ALLOWED_NAMESPACES.contains(&namespace) {
        Ok(())
    } else {
        Err(format!("未知的 library namespace: {}", namespace))
    }
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    Ok(data_dir.join(LIBRARY_DIR))
}

fn namespace_path(app: &AppHandle, namespace: &str) -> Result<PathBuf, String> {
    validate(namespace)?;
    Ok(library_dir(app)?.join(format!("{}.json", namespace)))
}

/// 读取某个 namespace 的数据。文件不存在返回 null。
pub fn load(app: &AppHandle, namespace: &str) -> Result<Value, String> {
    let path = namespace_path(app, namespace)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("读取 {} 失败: {}", namespace, e))?;
    if content.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&content).map_err(|e| format!("解析 {} 失败: {}", namespace, e))
}

/// 写入某个 namespace 的数据。整体覆盖，原子写。
///
/// 收藏与歌单丢失后无法重新获取，因此这里比 config.rs 更依赖原子性：
/// 裸 `fs::write` 在写入过程中崩溃会留下截断的 JSON，下次 load 直接解析失败。
pub fn save(app: &AppHandle, namespace: &str, value: &Value) -> Result<(), String> {
    let path = namespace_path(app, namespace)?;
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("序列化 {} 失败: {}", namespace, e))?;
    let _guard = lock_persistence();
    write_atomic(&path, &content)
}

/// 清空指定 namespace（删文件）。
pub fn reset(app: &AppHandle, namespace: &str) -> Result<(), String> {
    let path = namespace_path(app, namespace)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除 {} 失败: {}", namespace, e))?;
    }
    Ok(())
}

/// 清空所有 namespace（删整个 library 目录下的 json）。
pub fn reset_all(app: &AppHandle) -> Result<(), String> {
    for ns in ALLOWED_NAMESPACES {
        reset(app, ns)?;
    }
    Ok(())
}
