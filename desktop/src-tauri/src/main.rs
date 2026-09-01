// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atomic_file;
mod commands;
mod config;
mod library;
mod lyric_window;
mod models;
mod outbound;
mod secret_store;
mod tray;

/// 设置窗口 AppUserModelID：音量混音器/任务栏据此匹配快捷方式（应用名+图标），
/// 否则 WebView2 进程显示为 "Microsoft Edge WebView2" 默认图标。
#[cfg(target_os = "windows")]
unsafe fn set_app_user_model_id(hwnd: isize, app_id: &str) {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::ffi::OsStr::new(app_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(appid: *const u16) -> i32;
    }
    // 进程级设置即可：所有窗口（含歌词窗）统一归属
    let _ = SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
    let _ = hwnd;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .setup(|app| {
            // 音量混音器/任务栏显示正确的应用名与图标：
            // WebView2 进程默认显示 "Microsoft Edge WebView2"，显式设置 AUMID 后
            // 系统会按安装包的快捷方式（含图标）归属音量条目。
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                let hwnd = app
                    .get_webview_window("main")
                    .and_then(|w| w.hwnd().ok())
                    .map(|h| h.0 as isize)
                    .unwrap_or(0);
                if hwnd != 0 {
                    unsafe {
                        set_app_user_model_id(hwnd, "cn.chenle.auralflow");
                    }
                }
            }
            // 系统托盘
            let _ = tray::setup(app.handle());
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
            // 压缩/解压 fallback
            commands::zlib_inflate,
            commands::zlib_deflate,
            // 运行时可配置目标的出站代理（WebDAV / 自定义音源）
            outbound::proxy_http_request,
            // B站 API
            commands::bili_get_json,
            commands::bili_cache_audio,
            commands::cache_remote_audio,
            commands::cache_remote_image,
            commands::lookup_cached_media,
            commands::get_song_cache_stats,
            commands::clear_song_cache,
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
