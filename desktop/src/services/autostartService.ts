import { invoke } from "@tauri-apps/api/core";

/**
 * 开机自启：直接调用 tauri-plugin-autostart 注册的 IPC 命令。
 *
 * 不引入 @tauri-apps/plugin-autostart 的 JS 包，避免为一个开关多加一份前端依赖；
 * Rust 侧插件初始化与 capabilities 里的 autostart:default 仍然必需。
 */
export function isAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>("plugin:autostart|is_enabled");
}

export function enableAutostart(): Promise<void> {
  return invoke<void>("plugin:autostart|enable");
}

export function disableAutostart(): Promise<void> {
  return invoke<void>("plugin:autostart|disable");
}
