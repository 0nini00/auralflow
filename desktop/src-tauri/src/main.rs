// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atomic_file;
mod commands;
mod config;
mod library;
mod logging;
mod lyric_window;
mod models;
mod outbound;
mod secret_store;
mod smtc;
mod taskbar;
mod tray;
mod window_state;

/// 应用 AUMID：必须与 tauri.conf.json 的 identifier、主窗口 additionalBrowserArgs 里的
/// `--app-user-model-id`、以及安装器写入快捷方式的 AUMID 保持一致——音量合成器/任务栏
/// 按 AUMID 匹配「同名快捷方式」来取应用名与图标，对不上就退回默认占位图标。
#[cfg(target_os = "windows")]
const APP_USER_MODEL_ID: &str = "cn.chenle.auralflow";

/// 设置进程级 AppUserModelID：所有窗口（含歌词窗）与 WebView2 子进程由此归入同一个条目。
/// 必须在创建任何窗口之前调用：窗口一旦生成，之后再改 AUMID 不会重新归类。
/// 失败只降级记日志——退回系统默认标识，不影响其它功能。
#[cfg(target_os = "windows")]
fn set_app_user_model_id(app_id: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(app_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(appid: *const u16) -> i32;
    }
    // 返回 HRESULT：负数即失败
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
    if hr < 0 {
        return Err(format!(
            "SetCurrentProcessExplicitAppUserModelID({}) 返回 0x{:08X}",
            app_id, hr as u32
        ));
    }
    Ok(())
}

/// 给主窗口补上「大图标」（WM_SETICON / ICON_BIG）：
/// 框架只设了 ICON_SMALL，窗口类也没有登记图标，因此 WM_GETICON(ICON_BIG) 与
/// GetClassLongPtr(GCLP_HICON) 都是 0——只认窗口图标的老式界面（音量合成器）
/// 会把它画成空白。图标取自自身 exe 的资源（打包时按 bundle.icon 写入），
/// 不依赖外部文件，便携运行同样有效。
#[cfg(target_os = "windows")]
fn set_main_window_big_icon(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, HICON, ICON_BIG, WM_SETICON};

    let raw = window
        .hwnd()
        .map_err(|err| format!("取窗口句柄失败: {}", err))?;
    let exe = std::env::current_exe().map_err(|err| format!("取 exe 路径失败: {}", err))?;
    let wide: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut big = HICON(null_mut());
    let count = unsafe {
        ExtractIconExW(
            PCWSTR(wide.as_ptr()),
            0,
            Some(&mut big as *mut HICON),
            None,
            1,
        )
    };
    // 取不到图标时返回 (UINT)-1；句柄为空同样视为失败
    if count == 0 || count == u32::MAX || big.0.is_null() {
        return Err("exe 资源里没有可用图标".to_string());
    }
    // 句柄交给窗口长期持有（系统只在使用期间引用它），随进程结束释放，这里不 DestroyIcon。
    let _ = unsafe {
        SendMessageW(
            HWND(raw.0),
            WM_SETICON,
            Some(WPARAM(ICON_BIG as usize)),
            Some(LPARAM(big.0 as isize)),
        )
    };
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 音量合成器/任务栏显示正确的应用名与图标：WebView2 进程默认归类为
    // "Microsoft Edge WebView2"，必须在创建任何窗口之前显式设置 AUMID（见函数注释）。
    #[cfg(target_os = "windows")]
    if let Err(err) = set_app_user_model_id(APP_USER_MODEL_ID) {
        eprintln!(
            "[app] 设置 AppUserModelID 失败，音量合成器/任务栏将退回默认图标: {}",
            err
        );
    }
    let result = tauri::Builder::default()
        // 单实例锁：重复启动时聚焦已有主窗口，而不是开一个新进程新窗口。
        // argv 透传给深链处理（与正常启动一致）。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            // 二次启动携带的深链转发给前端处理链（app 克隆成 'static 后再发射）
            if let Some(url) = argv.iter().find_map(|arg| {
                arg.strip_prefix("auralflow://")
                    .map(|_| arg.clone())
            }) {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = app.emit("deep-link-url", url);
                });
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        // 应用内自更新（Tauri updater）。
        // 检查/下载/验签/静默安装全部在 Rust 侧完成，因此不受 capabilities 里
        // http:default 出站白名单的约束；前端只拿 downloadAndInstall 的进度事件。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 运行日志落盘（失败只记 stderr，不阻断启动）
            match logging::init(app.handle()) {
                Ok(dir) => logging::announce_log_dir(&dir),
                Err(err) => eprintln!("[log] 初始化失败，本次运行不落盘: {}", err),
            }
            // 音量合成器/任务栏图标：框架只设了 ICON_SMALL，这里补上 ICON_BIG。
            // 失败只记日志降级——图标缺失不影响其它功能。
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use tauri_plugin_log::log;
                if let Some(main) = app.get_webview_window("main") {
                    if let Err(err) = set_main_window_big_icon(&main) {
                        log::warn!("[app] 设置主窗口大图标失败，音量合成器可能显示空白图标: {}", err);
                    }
                }
            }
            // 主窗口几何持久化：恢复上次的尺寸/位置/最大化状态，之后监听变化落盘。
            // 失败只记日志——窗口照旧按 tauri.conf.json 的默认尺寸居中显示。
            window_state::attach(app.handle());
            // 系统托盘
            let _ = tray::setup(app.handle());
            // Windows 系统媒体控制（SMTC）：键盘媒体键 / 系统媒体浮层 / 锁屏控制。
            // 会话必须绑在有 HWND 的主线程上，这里只排队；失败只记日志，不阻断启动。
            smtc::setup(app.handle());
            // Windows 任务栏缩略图按钮 / 悬浮预览封面：只做登记与准备，
            // 真正的窗口过程子类化要等设置开关确认打开（taskbar::set_enabled）。
            taskbar::setup(app.handle());
            // 注册深链 scheme（Windows 运行时写入注册表）
            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭主窗口时最小化到托盘，而不是退出整个应用。
            // 真正的退出走托盘菜单 → app.exit(0)。
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 配置管理
            commands::load_settings,
            commands::save_settings,
            commands::patch_settings,
            commands::reset_settings,
            commands::debug_log,
            commands::open_log_dir,
            // 压缩/解压 fallback
            commands::zlib_inflate,
            commands::zlib_deflate,
            // 运行时可配置目标的出站代理（WebDAV / 自定义音源）
            outbound::proxy_http_request,
            commands::cache_remote_audio,
            commands::cache_remote_image,
            commands::lookup_cached_media,
            commands::get_song_cache_stats,
            commands::clear_song_cache,
            // 媒体缓存按 key 定向失效（试听片段 / 坏链）
            commands::remove_cached_media,
            // Windows 系统媒体控制（SMTC）
            commands::smtc_set_enabled,
            commands::smtc_update_track,
            commands::smtc_update_progress,
            // Windows 任务栏缩略图按钮与悬浮预览封面
            commands::taskbar_set_enabled,
            commands::taskbar_update_track,
            // 下载
            commands::download_file,
            commands::cancel_download,
            commands::write_download_text_file,
            // 本地音频
            commands::scan_directory,
            commands::get_audio_info,
            commands::set_audio_metadata,
            commands::set_audio_cover,
            commands::set_audio_lyrics,
            // 用户数据持久化（B-mid）
            commands::library_load,
            commands::library_save,
            commands::library_reset,
            commands::library_reset_all,
            // 桌面歌词窗口
            commands::toggle_lyric_window,
            commands::toggle_lyric_window_from_player,
            commands::unlock_lyric_window_from_player,
            commands::get_lyric_window_state,
            commands::prepare_lyric_window_lock,
            commands::is_lyric_window_open,
            commands::set_lyric_window_pinned,
            commands::set_lyric_window_locked,
        ])
        .run(tauri::generate_context!());

    if result.is_err() {
        std::process::exit(1);
    }
}

fn main() {
    run();
}
