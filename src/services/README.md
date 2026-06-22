# services

纯 TypeScript 业务逻辑层，不依赖 Electron/Tauri API，未来可整体移植。

## 子目录规划

- `sources/`
  - 音源 provider 抽象与实现
  - 每个 provider 实现统一接口：`search`、`getMusicUrl`、`getLyric`、`getPlaylistDetail` 等
  - 内置源：`wyProvider`、`txProvider`、`kgProvider`
  - 自定义脚本源：`customProvider`（建议用 VM 沙箱执行用户脚本）
- `playerEngine.ts`
  - 播放器核心封装
  - 基于 Web Audio API / HTMLAudioElement
  - 负责播放、暂停、切歌、进度、音质、crossfade、gapless 等
- `lyricsService.ts`
  - 歌词获取与解析（LRC / 网易云逐字歌词）
- `downloadService.ts`
  - 下载任务管理（队列、暂停、恢复、进度）
  - 实际下载交给 Tauri Rust 命令，这里只负责业务调度
- `neteaseService.ts`
  - 网易云账号相关：Cookie 校验、UID/VIP、我的歌单、收藏歌单、每日推荐、心动模式等
- `gatewayService.ts`
  - 自定义网关/音源 fallback 逻辑
- `storageService.ts`
  - 本地歌单、播放历史、设置等持久化抽象
  - 当前通过 Tauri 命令调用 SQLite，后续可替换为 IndexedDB / Rust KV

## 设计原则

1. **不要在这里 import Tauri API**。Tauri 调用应该放在 `src/lib/tauri.ts` 这样的薄封装里。
2. **Provider 必须纯函数化**，只接收输入并返回数据，不修改全局状态。
3. **所有 I/O（HTTP、文件、数据库）都走接口抽象**，方便单元测试和 future 迁移。
