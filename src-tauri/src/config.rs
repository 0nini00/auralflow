//! 配置持久化模块
//! 使用 JSON 文件存储用户设置，路径由 Tauri app_data_dir 提供

use crate::models::AppSettings;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CONFIG_FILE_NAME: &str = "auralflow_settings.json";

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
    let path = config_path(app)?;

    if !path.exists() {
        let default = AppSettings::default();
        save_settings(app, &default)?;
        return Ok(default);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    let settings: AppSettings =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(settings)
}

/// 保存配置
pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = config_path(app)?;

    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

/// 更新部分配置字段 — 合合传入的 JSON patch 到现有配置
pub fn patch_settings(app: &AppHandle, patch: serde_json::Value) -> Result<AppSettings, String> {
    let current = load_settings(app)?;

    // 将 current 序列化为 Value，再 merge patch
    let mut current_val =
        serde_json::to_value(&current).map_err(|e| format!("序列化当前配置失败: {}", e))?;

    merge_json(&mut current_val, patch);

    let updated: AppSettings = serde_json::from_value(current_val)
        .map_err(|e| format!("合并配置后反序列化失败: {}", e))?;

    save_settings(app, &updated)?;
    Ok(updated)
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
    let default = AppSettings::default();
    save_settings(app, &default)?;
    Ok(default)
}
