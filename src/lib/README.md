# lib

与 Tauri / 环境相关的薄封装，业务层不直接调用 Tauri API。

- `tauri.ts`：封装 `invoke`、`listen`、`emit`
- `storage.ts`：调用 Rust SQLite/Preferences API
- `native.ts`：系统托盘、窗口控制、自动更新、全局快捷键
- `utils.ts`：通用工具函数
