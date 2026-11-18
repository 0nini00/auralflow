//! 配置持久化模块
//! 使用 JSON 文件存储用户设置，路径由 Tauri app_data_dir 提供

use crate::atomic_file::{lock_persistence, write_atomic};
use crate::logging::ResultExt;
use crate::models::AppSettings;
use crate::secret_store;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

const CONFIG_FILE_NAME: &str = "auralflow_settings.json";

/// 设置变更事件：`patch_settings` 每次成功落盘且确有字段变化后，发给**所有**窗口。
///
/// 载荷只有 `changedKeys`（变化了的顶层字段名，camelCase），**不带任何值**：
/// 每个窗口（含只有一个解锁按钮的 `lyric-unlock`）都会收到它，而设置里有
/// `wyCookie` / `webdavPassword` 这样的凭证。前端收到后自行 `load_settings` 取值。
const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// 需要加密落盘的凭证字段。
///
/// 这些值可直接用于冒充用户身份，明文落盘等于把账号交给任何能读该文件的进程。
/// 新增凭证字段时必须同步登记到这里 —— 漏登记不会报错，只会静默明文落盘。
fn credential_fields(settings: &mut AppSettings) -> Vec<&mut Option<String>> {
    vec![
        &mut settings.wy_cookie,
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
/// 这是设置的**唯一修改入口**：前端的 `patch_settings` 命令，以及 Rust 自己的写入
/// （歌词窗置顶/几何、主窗口位置、迷你播放器位置、关闭确认的答复）全部经过这里，
/// 所以「设置变了要通知前端」也只在这里做一次（见 `SETTINGS_CHANGED_EVENT`）。
/// 另一处会写文件的是首次启动时落默认值（`load_settings_locked`），那不改变任何值，不发事件。
///
/// 全程持有持久化写锁：load / merge / save 是一次 read-modify-write，
/// 拆开会让并发调用方（多个 WebView、歌词窗位置持久化任务）互相覆盖。
pub fn patch_settings(app: &AppHandle, patch: Value) -> Result<AppSettings, String> {
    let _guard = lock_persistence();

    let current = load_settings_locked(app)?;
    let (updated, changed_keys) = apply_patch(&current, patch)?;

    save_settings_locked(app, &updated)?;
    // 落盘成功之后才通知：前端收到事件再读，一定读得到这次写入。
    emit_settings_changed(app, &changed_keys);
    Ok(updated)
}

/// 把 patch 合并进当前设置，返回新设置与**值确实变了**的顶层字段名。纯计算，不做 IO。
fn apply_patch(current: &AppSettings, patch: Value) -> Result<(AppSettings, Vec<String>), String> {
    let before =
        serde_json::to_value(current).map_err(|e| format!("序列化当前配置失败: {}", e))?;
    reject_unknown_keys(&before, &patch)?;

    let mut merged = before.clone();
    merge_json(&mut merged, patch);
    let updated: AppSettings = serde_json::from_value(merged)
        .map_err(|e| format!("合并配置后反序列化失败: {}", e))?;

    // 用「经过 AppSettings 归一化之后」的结果来比，而不是合并出来的原始 JSON：
    // patch 里的 `0` 与结构体序列化出的 `0.0` 在 JSON 层不相等，直接比会把没变的字段报成变了。
    let after =
        serde_json::to_value(&updated).map_err(|e| format!("序列化更新后的配置失败: {}", e))?;
    Ok((updated, changed_top_level_keys(&before, &after)))
}

/// 两份设置之间值不同的顶层字段名，按字典序（顺序稳定，与 serde_json 是否保序无关）。
fn changed_top_level_keys(before: &Value, after: &Value) -> Vec<String> {
    let (Some(before_map), Some(after_map)) = (before.as_object(), after.as_object()) else {
        return Vec::new();
    };
    let mut keys: Vec<String> = after_map
        .iter()
        .filter(|(key, value)| before_map.get(key.as_str()) != Some(*value))
        .map(|(key, _)| key.clone())
        .collect();
    keys.sort();
    keys
}

/// 通知所有窗口设置已变更。没有字段变化（例如窗口位置原样重写一遍）就不发：
/// 事件的含义是「值变了」，空事件只会让每个窗口白醒一次。
///
/// 发不出去只记日志：写入已经成功，不能因为通知失败把这次写入报成失败。
fn emit_settings_changed(app: &AppHandle, changed_keys: &[String]) {
    if changed_keys.is_empty() {
        return;
    }
    app.emit(SETTINGS_CHANGED_EVENT, settings_changed_payload(changed_keys))
        .log_warn("[settings] 通知前端设置变更失败");
}

/// 事件载荷。只有字段名，没有值（理由见 `SETTINGS_CHANGED_EVENT`）；
/// 前端的类型登记在 `@lx/tauri-bridge` 的 `TauriEventPayloads`。
fn settings_changed_payload(changed_keys: &[String]) -> Value {
    json!({ "changedKeys": changed_keys })
}

/// 校验 patch 顶层字段都存在于 AppSettings。
///
/// AppSettings 带 `#[serde(default)]`，未知字段会被 serde 静默丢弃：
/// 前端把 `lyricFontSize` 拼成 `lyricFontSizee` 时调用会「成功」返回但什么都没改，
/// 重启后设置回退且无任何报错。这里显式失败，让拼写错误在开发期即暴露。
fn reject_unknown_keys(base: &Value, patch: &Value) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_reports_only_the_keys_whose_value_changed() {
        let current = AppSettings::default();
        let (updated, changed) = apply_patch(
            &current,
            json!({ "lyricFontSize": 40, "volume": current.volume }),
        )
        .unwrap();
        assert_eq!(updated.lyric_font_size, 40);
        // volume 写的是原值：出现在 patch 里不等于变了
        assert_eq!(changed, vec!["lyricFontSize".to_string()]);
    }

    #[test]
    fn rewriting_the_same_values_reports_no_change() {
        // 两种真实场景：窗口位置原样重写一遍；JSON 里的整数写进浮点字段。
        let current = AppSettings {
            main_window_x: Some(120.0),
            ..AppSettings::default()
        };
        let (_, changed) = apply_patch(
            &current,
            json!({ "mainWindowX": 120, "lyricTextPositionX": 0 }),
        )
        .unwrap();
        assert!(changed.is_empty(), "没变的字段被报成变了: {:?}", changed);
    }

    #[test]
    fn event_payload_names_secret_fields_but_never_carries_their_values() {
        let (_, changed) = apply_patch(
            &AppSettings::default(),
            json!({ "wyCookie": "MUSIC_U=secret-cookie", "webdavPassword": "secret-password" }),
        )
        .unwrap();
        let payload = settings_changed_payload(&changed);
        assert_eq!(
            payload,
            json!({ "changedKeys": ["webdavPassword", "wyCookie"] })
        );
        assert!(!payload.to_string().contains("secret"));
    }

    #[test]
    fn unknown_keys_are_rejected() {
        let error = apply_patch(&AppSettings::default(), json!({ "lyricFontSizee": 30 }))
            .unwrap_err();
        assert!(error.contains("lyricFontSizee"), "{}", error);
    }
}

