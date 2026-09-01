//! 原子文件写入
//!
//! config.rs 与 library.rs 共用：先写同目录临时文件并 fsync，再 rename 覆盖目标。
//! rename 在同一卷内是原子操作，因此进程在任意时刻崩溃都只会留下
//! 「旧文件完整」或「新文件完整」两种状态，不会出现截断的半份 JSON。
//!
//! 同时提供进程内写锁：patch 类操作是 read-modify-write，
//! 多个 WebView（main / lyric / lyric-unlock）与后台任务并发写同一文件时，
//! 无锁会导致后写者用陈旧快照整体覆盖，前一次更新静默丢失。

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// 全局持久化写锁。粒度取整个 app_data_dir 下的 JSON 持久化，
/// 写入本身是毫秒级，不值得为每个文件维护独立锁。
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// 获取持久化写锁。锁中毒时取回内部值继续 —— 被保护的是文件而非内存结构，
/// 前一个持有者 panic 不会让磁盘数据进入不一致状态，
/// 静默 return 反而会让后续写入永久失效。
pub fn lock_persistence() -> MutexGuard<'static, ()> {
    match write_lock().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// 原子写入文本内容。调用方需自行持有 `lock_persistence()`。
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法确定父目录: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;

    // 临时文件与目标同目录，确保 rename 不跨卷。
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("无法确定文件名: {}", path.display()))?;
    let tmp_path = parent.join(format!(".{}.tmp", file_name));

    {
        let mut file = File::create(&tmp_path)
            .map_err(|e| format!("创建临时文件失败 {}: {}", tmp_path.display(), e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
        // fsync：确保数据真正落盘，否则 rename 后仍可能因掉电丢失内容。
        file.sync_all()
            .map_err(|e| format!("同步临时文件失败: {}", e))?;
    }

    // std 的 fs::rename 在 Windows 上走 MoveFileExW + MOVEFILE_REPLACE_EXISTING，
    // 目标已存在时直接覆盖（已实测），因此无需先 remove —— 那样反而会制造
    // 「旧文件已删、新文件未就位」的丢数据窗口。
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("提交文件失败 {}: {}", path.display(), e)
    })
}
