//! 系统托盘
//!
//! 在右下角（Windows）/ 右上角（macOS）/ 右上角（Linux）提供托盘菜单：
//!   播放/暂停 · 上一首 · 下一首 · 显示主窗口 · 退出
//!
//! 菜单点击通过 emit("native-action", ...) 派给前端，由 useNativeControls
//! hook 接住并调 player store 的对应方法。
//! 真正的"播放/暂停"动作仍由前端处理（Audio 在 webview 层）。

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// 在 Tauri setup 钩子里调用，构建托盘 + 菜单 + 事件路由
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let play_pause = MenuItem::with_id(app, "play-pause", "播放 / 暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let toggle_lyric = MenuItem::with_id(app, "toggle-lyric", "桌面歌词", true, None::<&str>)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show-window", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 AuralFlow", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &play_pause,
            &prev,
            &next,
            &separator,
            &toggle_lyric,
            &separator2,
            &show,
            &quit,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("auralflow-tray")
        .tooltip("AuralFlow")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show-window" => show_main_window(app),
                "toggle-lyric" => {
                    if let Err(err) = crate::lyric_window::toggle(app) {
                        eprintln!("[tray] toggle lyric window failed: {}", err);
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                action => {
                    // 把动作派到前端（前端持有播放器状态）
                    let _ = app.emit("native-action", action);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击托盘 = 显示/激活主窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
