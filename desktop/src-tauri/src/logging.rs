//! 运行日志落盘（tauri-plugin-log）
//!
//! 目录由 Tauri 的 `app_log_dir()` 决定（Windows：`%LOCALAPPDATA%\cn.chenle.auralflow\logs`），
//! 轮转由插件自带的 `RotatingFile` 完成：当前文件 `auralflow.log` 超过 `LOG_MAX_FILE_BYTES`
//! 就改名归档为 `auralflow_<日期>_<时间>.log`，磁盘上最多留 `LOG_KEEP_FILES` 个文件。
//!
//! 前端 `console.warn/error` 经 `@tauri-apps/plugin-log` 转发进同一文件，因此在 release
//! （记 info 起）里也不会丢 —— 用户报「播放断了 / 同步失败」时至少有证据可查。
//!
//! 初始化是 **fail-soft** 的：拿不到目录、建不了文件只把原因写 stderr，绝不阻断启动 ——
//! 日志是诊断设施，不能反过来让应用起不来。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_log::log::LevelFilter;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// 日志文件主干名：当前文件 `auralflow.log`，归档 `auralflow_2026-02-14_10-00-00.log`。
pub const LOG_FILE_STEM: &str = "auralflow";

/// 单个日志文件上限 2 MiB。
pub const LOG_MAX_FILE_BYTES: u128 = 2 * 1024 * 1024;

/// 磁盘上最多保留的日志文件数（含正在写的那个）。
pub const LOG_KEEP_FILES: usize = 3;

/// 换算成 `RotationStrategy::KeepSome` 的参数。
///
/// 插件只数**归档**文件，不含正在写的那个，所以总份数要减一；并且它归档时要算
/// `keep_count - 1`，给 0 会 usize 下溢 panic，因此下限钉在 1。
pub fn archived_keep_count(total_files: usize) -> usize {
    total_files.saturating_sub(1).max(1)
}

/// 落盘级别：release 记 info 起 —— 前端转发的 warn/error 一律不能丢；
/// debug 构建放宽到 debug，方便本地排查。
pub fn level_for_build(debug_build: bool) -> LevelFilter {
    if debug_build {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

/// 启动横幅：把日志目录打成一行，用户报问题时只需要给这个路径。
pub fn log_dir_banner(dir: &Path) -> String {
    format!("日志目录 = {}", dir.display())
}

/// 日志目录；不存在则建出来（「打开日志目录」要求目录已存在，
/// 而插件初始化失败时目录可能还没被创建）。
pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("获取日志目录失败: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {}", e))?;
    Ok(dir)
}

/// 初始化日志落盘，成功时返回日志目录。**调用方不得因 Err 阻断启动**。
pub fn init(app: &AppHandle) -> Result<PathBuf, String> {
    let builder = tauri_plugin_log::Builder::new()
        // 插件默认自带 Stdout + LogDir 两个 target，这里全部重列：
        // 保留默认再追加会让同一个文件被两个 RotatingFile 同时写，轮转状态互相打架。
        .clear_targets()
        .target(Target::new(TargetKind::Stdout))
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_STEM.to_string()),
        }))
        .level(level_for_build(cfg!(debug_assertions)))
        .max_file_size(LOG_MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(archived_keep_count(LOG_KEEP_FILES)))
        .timezone_strategy(TimezoneStrategy::UseLocal);

    // 用 split 而不是 `app.plugin(Builder::new()...)`：走 Builder 时插件初始化失败会
    // 让 Tauri 的 initialize_plugins 报错并终止启动，这里把「挂 logger」与「注册 IPC 插件」
    // 拆成两步，各自 fail-soft。
    let (plugin, max_level, logger) = builder
        .split(app)
        .map_err(|e| format!("初始化日志通道失败: {}", e))?;

    // 先挂 logger 再注册插件：反过来插件注册失败会把文件日志一起丢掉。
    if let Err(err) = tauri_plugin_log::attach_logger(max_level, logger) {
        eprintln!("[log] 挂载全局 logger 失败: {}", err);
    }
    if let Err(err) = app.plugin(plugin) {
        eprintln!("[log] 注册日志插件失败，前端转发不可用: {}", err);
    }

    log_dir(app)
}

/// 把启动横幅写进日志（同时进 stdout 与文件）。单独成函数是为了让横幅格式可单测。
pub fn announce_log_dir(dir: &Path) {
    tauri_plugin_log::log::info!("{}", log_dir_banner(dir));
}

/// 用系统文件管理器打开目录。
///
/// 桌面端只面向 Windows：explorer.exe 是文件管理器入口，它即使成功也可能返回非 0
/// 退出码，所以只看能否启动、不等退出码。
pub fn open_in_file_manager(dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：不给 explorer 弹一个控制台窗口。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer")
            .arg(dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开日志目录失败: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(format!("打开目录仅 Windows 有实现: {}", dir.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_log::log::Level;

    #[test]
    fn rotation_policy_matches_spec() {
        // 单文件 2 MiB、最多 3 份是产品规格，改这两个常量等于改规格。
        assert_eq!(LOG_MAX_FILE_BYTES, 2 * 1024 * 1024);
        assert_eq!(LOG_KEEP_FILES, 3);
        assert_eq!(archived_keep_count(LOG_KEEP_FILES), 2);
    }

    #[test]
    fn archived_keep_count_reserves_active_file() {
        // 总份数减一给正在写的 auralflow.log 让位。
        assert_eq!(archived_keep_count(1), 1);
        // 插件的 rotate 会算 keep_count - 1：下限必须是 1，否则 usize 下溢 panic。
        assert_eq!(archived_keep_count(0), 1);
    }

    #[test]
    fn release_level_keeps_warn_and_error() {
        let level = level_for_build(false);
        assert_eq!(level, LevelFilter::Info);
        // log 的 LevelFilter 顺序是「越啰嗦越大」：不比 Info 更啰嗦的都要落盘。
        assert!(Level::Warn <= level);
        assert!(Level::Error <= level);
        // release 不把 debug 灌进用户的日志文件。
        assert!(Level::Debug > level);
    }

    #[test]
    fn debug_build_logs_debug() {
        assert_eq!(level_for_build(true), LevelFilter::Debug);
    }

    #[test]
    fn log_dir_banner_shows_path() {
        assert_eq!(
            log_dir_banner(Path::new("C:/Users/测试 用户/AppData/Local/cn.chenle.auralflow/logs")),
            "日志目录 = C:/Users/测试 用户/AppData/Local/cn.chenle.auralflow/logs"
        );
    }
}
