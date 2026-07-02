// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod library;
mod lyric_window;
mod models;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // 系统托盘
            if let Err(err) = tray::setup(app.handle()) {
                eprintln!("[setup] 托盘初始化失败: {}", err);
            }
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
            // 压缩/解压 fallback
            commands::zlib_inflate,
            commands::zlib_deflate,
            // B站 API
            commands::bili_get_json,
            commands::bili_cache_audio,
            // 下载
            commands::download_file,
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

    if let Err(err) = result {
        eprintln!("[tauri] 应用运行失败: {}", err);
        std::process::exit(1);
    }
}

fn main() {
    run();
}
