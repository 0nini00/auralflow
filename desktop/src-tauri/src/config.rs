//! 配置持久化模块
//! 使用 JSON 文件存储用户设置，路径由 Tauri app_data_dir 提供

use crate::atomic_file::{lock_persistence, write_atomic};
use crate::models::AppSettings;
use crate::secret_store;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE_NAME: &str = "auralflow_settings.json";

/// 需要加密落盘的凭证字段。
///
/// 这些值可直接用于冒充用户身份，明文落盘等于把账号交给任何能读该文件的进程。
/// 新增凭证字段时必须同步登记到这里 —— 漏登记不会报错，只会静默明文落盘。
fn credential_fields(settings: &mut AppSettings) -> Vec<&mut Option<String>> {
    vec![
        &mut settings.wy_cookie,
        &mut settings.bili_cookie,
        &mut settings.bili_refresh_token,
        &mut settings.webdav_password,
    ]
}

/// 落盘前加密凭证字段。
fn encrypt_credentials(settings: &mut AppSettings) -> Result<(), String> {
    for field in credential_fields(settings) {
        if let Some(value) = field.as_deref() {
            *field = Some(secret_store::protect(value)?);
        }
    }
    Ok(())
}

/// 读取后解密凭证字段。无前缀的历史明文原样保留，下次保存时自动升级为密文。
fn decrypt_credentials(settings: &mut AppSettings) -> Result<(), String> {
    for field in credential_fields(settings) {
        if let Some(value) = field.as_deref() {
            *field = Some(secret_store::unprotect(value)?);
        }
    }
    Ok(())
}

/// 获取配置文件路径
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    Ok(data_dir.join(CONFIG_FILE_NAME))
}

/// 读取配置 — 若文件不存在则创建默认值并保存
pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let _guard = lock_persistence();
    load_settings_locked(app)
}

/// 读取配置本体。调用方须已持有 `lock_persistence()`。
fn load_settings_locked(app: &AppHandle) -> Result<AppSettings, String> {
    let path = config_path(app)?;

    if !path.exists() {
        let default = AppSettings::default();
        save_settings_locked(app, &default)?;
        return Ok(default);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let mut settings: AppSettings =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    decrypt_credentials(&mut settings)?;

    Ok(settings)
}

/// 保存配置（原子写）
pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let _guard = lock_persistence();
    save_settings_locked(app, settings)
}

/// 保存配置本体。调用方须已持有 `lock_persistence()`。
fn save_settings_locked(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = config_path(app)?;
    // 内存中的 settings 持明文，仅落盘副本加密：调用方拿到的仍是可用值。
    let mut on_disk = settings.clone();
    encrypt_credentials(&mut on_disk)?;
    let content =
        serde_json::to_string_pretty(&on_disk).map_err(|e| format!("序列化配置失败: {}", e))?;
    write_atomic(&path, &content)
}

/// 更新部分配置字段 — 合并传入的 JSON patch 到现有配置
///
/// 全程持有持久化写锁：load / merge / save 是一次 read-modify-write，
/// 拆开会让并发调用方（多个 WebView、歌词窗位置持久化任务）互相覆盖。
pub fn patch_settings(app: &AppHandle, patch: serde_json::Value) -> Result<AppSettings, String> {
    let _guard = lock_persistence();

    let current = load_settings_locked(app)?;

    // 将 current 序列化为 Value，再 merge patch
    let mut current_val =
        serde_json::to_value(&current).map_err(|e| format!("序列化当前配置失败: {}", e))?;

    reject_unknown_keys(&current_val, &patch)?;
    merge_json(&mut current_val, patch);

    let updated: AppSettings = serde_json::from_value(current_val)
        .map_err(|e| format!("合并配置后反序列化失败: {}", e))?;

    save_settings_locked(app, &updated)?;
    Ok(updated)
}

/// 校验 patch 顶层字段都存在于 AppSettings。
///
/// AppSettings 带 `#[serde(default)]`，未知字段会被 serde 静默丢弃：
/// 前端把 `lyricFontSize` 拼成 `lyricFontSizee` 时调用会「成功」返回但什么都没改，
/// 重启后设置回退且无任何报错。这里显式失败，让拼写错误在开发期即暴露。
fn reject_unknown_keys(base: &serde_json::Value, patch: &serde_json::Value) -> Result<(), String> {
    let (Some(base_map), Some(patch_map)) = (base.as_object(), patch.as_object()) else {
        return Ok(());
    };
    let unknown: Vec<&str> = patch_map
        .keys()
        .filter(|key| !base_map.contains_key(*key))
        .map(String::as_str)
        .collect();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(format!("未知的配置字段: {}", unknown.join(", ")))
    }
}

/// 递归合并 JSON — patch 中的字段覆盖 base 中同名字段
fn merge_json(base: &mut serde_json::Value, patch: serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(patch_map)) => {
            for (key, patch_val) in patch_map {
                if let Some(base_val) = base_map.get_mut(&key) {
                    merge_json(base_val, patch_val);
                } else {
                    base_map.insert(key, patch_val);
                }
            }
        }
        (base, patch) => {
            *base = patch;
        }
    }
}

/// 重置配置为默认值
pub fn reset_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let _guard = lock_persistence();
    let default = AppSettings::default();
    save_settings_locked(app, &default)?;
    Ok(default)
}
