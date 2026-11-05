//! 系统托盘
//!
//! 在右下角（Windows）/ 右上角（macOS）/ 右上角（Linux）提供托盘菜单：
//!   播放/暂停 · 上一首 · 下一首 · 显示主窗口 · 退出
//!
//! 菜单点击通过 emit("native-action", ...) 派给前端，由 useNativeControls
//! hook 接住并调 player store 的对应方法。
//! 真正的"播放/暂停"动作仍由前端处理（Audio 在 webview 层）。

use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

fn pending_quit() -> &'static Mutex<Option<String>> {
    static PENDING: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn complete_quit_request(
    pending: &mut Option<String>,
    request_id: &str,
    error: Option<String>,
) -> Result<(), String> {
    if pending.as_deref() != Some(request_id) {
        return Err("退出请求已失效".to_string());
    }
    *pending = None;
    match error {
        Some(error) => Err(format!("退出前保存失败: {}", error)),
        None => Ok(()),
    }
}

pub fn complete_quit(
    app: &AppHandle,
    request_id: &str,
    error: Option<String>,
) -> Result<(), String> {
    let result = {
        let mut pending = pending_quit().lock().map_err(|_| "退出请求状态锁损坏")?;
        complete_quit_request(&mut pending, request_id, error)
    };
    if let Err(err) = &result {
        tauri_plugin_log::log::error!("[quit] {}", err);
        show_main_window(app);
        return result;
    }
    app.exit(0);
    Ok(())
}

/// 在 Tauri setup 钩子里调用，构建托盘 + 菜单 + 事件路由
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let play_pause = MenuItem::with_id(app, "play-pause", "播放 / 暂停", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let toggle_lyric = MenuItem::with_id(app, "toggle-lyric", "桌面歌词", true, None::<&str>)?;
    let toggle_mini = MenuItem::with_id(app, "toggle-mini", "迷你播放器", true, None::<&str>)?;
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
            &toggle_mini,
            &separator2,
            &show,
            &quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("auralflow-tray")
        .tooltip("AuralFlow")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show-window" => show_main_window(app),
                "toggle-lyric" => {
                    let _ = crate::lyric_window::toggle(app);
                }
                "toggle-mini" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = crate::mini_player::toggle(&app).await {
                            tauri_plugin_log::log::warn!("[mini-player] {}", err);
                        }
                    });
                }
                "quit" => request_quit(app),
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
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let _tray = tray_builder.build(app)?;

    Ok(())
}

/// 显示并聚焦主窗口；同时收起迷你播放器（回到主窗口就不该再占着桌面）。
pub fn show_main_window(app: &AppHandle) {
    let _ = crate::mini_player::hide(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 退出应用（托盘菜单 / 迷你播放器右键菜单共用）。
///
/// 前端落盘成功后须带同一 requestId 应答；计时结束不代表落盘成功。
pub fn request_quit(app: &AppHandle) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let request_id = format!(
        "{}-{}",
        std::process::id(),
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    {
        let mut pending = pending_quit().lock().unwrap_or_else(|err| err.into_inner());
        if pending.is_some() {
            return;
        }
        *pending = Some(request_id.clone());
    }
    if let Err(err) = app.emit_to(
        "main",
        "app-before-quit",
        serde_json::json!({ "requestId": request_id }),
    ) {
        let _ = complete_quit(app, &request_id, Some(format!("发送保存请求失败: {}", err)));
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let timed_out = {
            let mut pending = pending_quit().lock().unwrap_or_else(|err| err.into_inner());
            if pending.as_deref() == Some(&request_id) {
                pending.take();
                true
            } else {
                false
            }
        };
        if timed_out {
            tauri_plugin_log::log::error!("[quit] 等待前端保存确认超时，已取消退出");
            show_main_window(&handle);
            let _ = handle.emit_to("main", "app-quit-failed", "等待保存确认超时，应用未退出");
        }
    });
}

#[cfg(test)]
mod quit_tests {
    use super::*;

    #[test]
    fn failed_flush_does_not_authorize_exit() {
        let mut pending = Some("request-1".to_string());
        assert!(
            complete_quit_request(&mut pending, "request-1", Some("disk full".to_string()))
                .is_err()
        );
        assert!(pending.is_none(), "失败后允许用户重试退出");
    }

    #[test]
    fn stale_ack_does_not_consume_current_quit_request() {
        let mut pending = Some("request-2".to_string());
        assert!(complete_quit_request(&mut pending, "request-1", None).is_err());
        assert_eq!(pending.as_deref(), Some("request-2"));
    }
}
