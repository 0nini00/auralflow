---
id: tauri-bridge
type: submodule-design
status: draft
title: "@lx/tauri-bridge — IPC 类型化包装"
parent: desktop
tags: [auralflow, desktop]
---

## 职责

单文件包（`src/index.ts`，约 430 行）：把 Tauri 的 `invoke` 包装成有名字、有参数类型、有返回值类型的方法，让桌面前端调用 Rust 命令时不必手写命令字符串，也不必在两处维护参数形状。它同时是「Rust 命令有哪些」的可读清单。

## 边界

**允许**：只依赖 `@tauri-apps/api`。不依赖 `@lx/core`；没有任何脚本段（无 `build`、无 `test`）——它是纯粹的类型与转发层，没有构建产物，`main` / `types` 直接指向 `src/index.ts`。

**禁止**：不含业务逻辑，不做参数校验或默认值填充，不持有状态。

**它不是什么（最容易被误读的一点）**：`@lx/tauri-bridge` 不是唯一 IPC 路径，也不是强制关口。`desktop/src` 有 43 处直接 `import` `@tauri-apps/*`（分布在 33 个文件）：

- `plugin-http` 的静态白名单直连——`lyricsService.ts`、`sources/wyProvider.ts`、`sources/txProvider.ts`、`wyAccountService.ts`、`builtinMusicApiClient.ts`、`search/searchSuggestions.ts`；
- 2 处直接 `invoke`——`services/outboundHttp.ts`、`utils/compression.ts`（`components/MetadataEditModal.tsx` 已改用桥的 `getAudioInfo`，`services/appBackground.ts` 只用 `convertFileSrc`，均不再直接 `invoke`）；

`desktop/src/services/README.md` 曾写「所有 IO 均经 `@lx/tauri-bridge`，services 不直接调用 Tauri 原生 API」——该表述已不成立，其正文现在写的是「系统级 IO 主要经桥，但有 43 处直接 `import @tauri-apps/*`」并列出这些例外。不要据此假设新增代码必须走桥：桥覆盖的是命令面的一部分；静态白名单直连与这些旁路 `invoke` 是有意保留的。

**无测试**：`desktop/tests` 里没有针对这个包本身的测试——31 个前端测试文件用 `vi.mock("@lx/tauri-bridge", …)` 把它整体替换掉，并不覆盖它的实现；也没有 lint 配置。
