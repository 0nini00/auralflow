use crate::atomic_file::{lock_persistence, write_atomic};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn validate_month(month: &str) -> Result<(), String> {
    let bytes = month.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-'
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..].iter().all(u8::is_ascii_digit)
        || !("01"..="12").contains(&&month[5..]) {
        return Err(format!("无效统计月份：{}", month));
    }
    Ok(())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("读取统计失败：{}", error))?;
    serde_json::from_str(&raw).map_err(|error| format!("统计文件损坏 {}：{}", path.display(), error))
}

pub fn load_from_dir(directory: &Path) -> Result<Value, String> {
    let _guard = lock_persistence();
    let mut months = Map::new();
    let partition_dir = directory.join("listeningStats");
    if partition_dir.exists() {
        for entry in fs::read_dir(partition_dir).map_err(|error| format!("读取统计目录失败：{}", error))? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") { continue; }
            let month = path.file_stem().and_then(|value| value.to_str()).ok_or("统计文件名无效")?;
            validate_month(month)?;
            let value = read_json(&path)?;
            if !value.is_array() { return Err(format!("统计月份不是事件数组：{}", month)); }
            months.insert(month.to_string(), value);
        }
    }
    let legacy_path = directory.join("listeningStats.json");
    let legacy = if legacy_path.exists() { read_json(&legacy_path)? } else { Value::Null };
    Ok(serde_json::json!({"months": months, "legacy": legacy}))
}

pub fn save_month_in_dir(directory: &Path, month: &str, events: &Value) -> Result<(), String> {
    validate_month(month)?;
    if !events.is_array() { return Err("统计写入内容必须是事件数组".into()); }
    let path = directory.join("listeningStats").join(format!("{}.json", month));
    let raw = serde_json::to_string(events).map_err(|error| error.to_string())?;
    let _guard = lock_persistence();
    write_atomic(&path, &raw)
}

fn library_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|path| path.join("library")).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn listening_stats_load(app: AppHandle) -> Result<Value, String> {
    let directory = library_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_from_dir(&directory))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn listening_stats_save_month(app: AppHandle, month: String, events: Value) -> Result<(), String> {
    let directory = library_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_month_in_dir(&directory, &month, &events))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("auralflow-stats-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::SeqCst)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self.0.file_name().unwrap().to_str().unwrap().starts_with("auralflow-stats-"));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test]
    fn month_write_preserves_other_month_and_legacy_until_explicit_migration_commit() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("listeningStats.json"), r#"{"events":[]}"#).unwrap();
        let jan = json!([{"sessionId":"a"}]);
        let nov = json!([{"sessionId":"b"}]);
        save_month_in_dir(&fixture.0, "2026-01", &jan).unwrap();
        save_month_in_dir(&fixture.0, "2026-11", &nov).unwrap();
        let jan_before = fs::read(fixture.0.join("listeningStats/2026-01.json")).unwrap();
        save_month_in_dir(&fixture.0, "2026-11", &json!([])).unwrap();
        assert_eq!(fs::read(fixture.0.join("listeningStats/2026-01.json")).unwrap(), jan_before);
        let loaded = load_from_dir(&fixture.0).unwrap();
        assert_eq!(loaded["months"]["2026-01"], jan);
        assert_eq!(loaded["months"]["2026-11"], json!([]));
        assert_eq!(loaded["legacy"], json!({"events":[]}));
    }
    #[test]
    fn rejects_paths_and_corrupt_files_without_overwriting() {
        let fixture = Fixture::new();
        for month in ["../escape", "2026-00", "2026-13", "20a6-01", "2026-1"] {
            assert!(save_month_in_dir(&fixture.0, month, &json!([])).is_err());
        }
        assert!(save_month_in_dir(&fixture.0, "2026-11", &json!({})).is_err());
        fs::create_dir_all(fixture.0.join("listeningStats")).unwrap();
        fs::write(fixture.0.join("listeningStats/2026-11.json"), "broken").unwrap();
        assert!(load_from_dir(&fixture.0).is_err());
        assert_eq!(fs::read_to_string(fixture.0.join("listeningStats/2026-11.json")).unwrap(), "broken");
    }
}
