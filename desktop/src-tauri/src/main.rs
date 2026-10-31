// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atomic_file;
mod audio_session;
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
        // 开机自启：Windows 走注册表，macOS 走 LaunchAgent。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            if let Err(err) = tray::setup(app.handle()) {
                tauri_plugin_log::log::warn!("[app] 托盘初始化失败，托盘图标与菜单不可用: {}", err);
            }
            // Windows 系统媒体控制（SMTC）：键盘媒体键 / 系统媒体浮层 / 锁屏控制。
            // 会话必须绑在有 HWND 的主线程上，这里只排队；失败只记日志，不阻断启动。
            smtc::setup(app.handle());
            // Windows 任务栏缩略图按钮 / 悬浮预览封面：只做登记与准备，
            // 真正的窗口过程子类化要等设置开关确认打开（taskbar::set_enabled）。
            taskbar::setup(app.handle());
            // 音量合成器里的应用身份：音频由 WebView2 的音频服务进程播放，那个进程不带
            // 本应用的 AUMID，系统会把它显示成「Microsoft Edge WebView2」。这里起一个后台
            // 线程，在播放期间把会话名称/图标改写成 AuralFlow + 本应用图标。
            // 失败只记日志，播放不受影响。
            audio_session::setup();
            // 缓存容量守卫：写入时已经会淘汰，但「上次运行写超上限、之后没再写」的
            // 目录会一直超着（移动端有等价的启动清理，桌面端此前没有）。放后台线程，
            // 不拖慢启动。
            let sweep_app = app.handle().clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                crate::commands::sweep_caches(&sweep_app);
            });
            // 注册深链 scheme（Windows 运行时写入注册表）
            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 默认最小化到托盘；用户可以在设置里改成关闭即退出。
                let close_to_tray = crate::config::load_settings(window.app_handle())
                    .map(|settings| settings.close_to_tray)
                    .unwrap_or(true);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                // 退出前给前端 flush 的机会（收藏/歌单/历史是 debounce 写盘）。
                api.prevent_close();
                let _ = window.app_handle().emit("app-before-quit", ());
                let handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    handle.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 配置管理
            commands::load_settings,
            commands::patch_settings,
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
            commands::get_media_cache_stats,
            commands::clear_media_cache,
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
            // 本地文件内容指纹（歌词选择绑定用，只在用户做出选择时调用）
            // 用户数据持久化（B-mid）
            commands::library_load,
            commands::library_save,
            commands::library_reset,
            // 桌面歌词窗口
            commands::toggle_lyric_window,
            commands::toggle_lyric_window_from_player,
            commands::unlock_lyric_window_from_player,
            commands::get_lyric_window_state,
            commands::prepare_lyric_window_lock,
            commands::is_lyric_window_open,
            commands::set_lyric_window_pinned,
            commands::set_lyric_window_locked,
            commands::set_lyric_window_height,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // 启动失败必须留下痕迹：此前这里直接 exit(1)，日志里什么都没有，用户只看到
        // 「窗口没起来」。日志插件这时可能还没装上，所以同时写 stderr。
        tauri_plugin_log::log::error!("[app] 启动失败: {}", err);
        eprintln!("[auralflow] 启动失败: {err}");
        std::process::exit(1);
    }
}

fn main() {
    run();
}

#[cfg(all(test, target_os = "windows"))]
mod launch_contract_tests {
    use super::APP_USER_MODEL_ID;

    /// AUMID 散落在四处：本文件的常量、`tauri.conf.json` 的 `identifier`、主窗口
    /// `additionalBrowserArgs` 里的 `--app-user-model-id`，以及歌词窗那份**必须逐字
    /// 相同**的 `additionalBrowserArgs`。任何一处单独改了都不会报错，只表现为
    /// 「音量合成器/任务栏退回默认占位图标」或「点桌面歌词没反应」，所以钉在这里。
    #[test]
    fn aumid_and_browser_args_stay_in_sync_with_tauri_conf() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json 必须是合法 JSON");

        assert_eq!(
            conf["identifier"].as_str(),
            Some(APP_USER_MODEL_ID),
            "tauri.conf.json 的 identifier 必须等于 main.rs 的 APP_USER_MODEL_ID"
        );

        let expected_flag = format!("--app-user-model-id={}", APP_USER_MODEL_ID);
        assert!(
            crate::lyric_window::ADDITIONAL_BROWSER_ARGS.contains(&expected_flag),
            "歌词窗的 additionalBrowserArgs 必须带上 {expected_flag}"
        );

        // 第一个窗口没有显式 label，Tauri 默认就叫 main。
        let main_window = conf["app"]["windows"]
            .as_array()
            .expect("tauri.conf.json 的 app.windows 必须是数组")
            .iter()
            .find(|window| window["label"].as_str().unwrap_or("main") == "main")
            .expect("tauri.conf.json 必须有主窗口（label 缺省为 main）");

        assert_eq!(
            main_window["additionalBrowserArgs"].as_str(),
            Some(crate::lyric_window::ADDITIONAL_BROWSER_ARGS),
            "主窗与歌词窗的 additionalBrowserArgs 必须逐字相同：第二份 WebView2 环境参数不一致会静默创建失败"
        );
    }
}
