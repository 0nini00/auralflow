---
id: core
type: module-design
status: draft
title: "@lx/core — 跨端共享纯逻辑核心"
parent: auralflow-architecture
tags: [auralflow, shared]
---

## 职责

`@lx/core` 是两端共享的唯一真相源层：凡是「两端必须给出相同答案」的规则都收敛在这里，而不是各端各写一份。它回答四类问题：

- **播什么**：音质阶梯与轮次划分（`playback-quality`）、试听片段判定（`stream-integrity`）、连点合并（`switch-step-queue`）。
- **唱到哪**：6 种歌词格式的归一化解析（`lyrics/parser`）、当前行定位（`lyrics/playbackSync`）、原生浮窗的自走时钟（`lyrics/overlay-clock`）。
- **记什么**：入历史与打点阈值（`history/listen-threshold`）、心动模式缓冲推进（`recommendations/heartbeat-queue`）、WebDAV 加法合并与歌单归类（`webdav-merge`：`isWebdavLocalPlaylistRef` 判 `userList` 的一条记录是本地歌单还是云端歌单引用，`scrubSyncedCloudPlaylistRefs` 清理历史上被误物化成「本地歌单」的云端引用）与同步拒绝的错误层级（`webdav-sync-error`：`CloudSyncRefusalError` / `CloudDataStaleError`）。同步服务与设置页一律按类型判断该拒绝属于哪一种，不匹配错误文案。已下线来源的历史条目清理也在这一层（`removed-source`：`isRemovedSource` / `dropRemovedSourceEntries`，两端在读盘后与同步合并后调用，直接丢弃、不备份）。
- **能不能连**：出站主机判定（`outbound-host`）、免 key 网关的客户端与响应映射（`mobile-api`）。

音源与领域模型的契约（`sources/`）也在这里——`MusicSource` / `MusicInfo` / `Lyric` 的形状是两端共同的词汇表。

它**不是**播放器：播放编排、队列、缓存 IO、自定义音源运行时、平台网络请求都留在两端各自实现。理由见 `auralflow-architecture` 的关键设计决策。

## 边界

**允许**：`@lx/core` 只依赖 ECMAScript 标准库，外加测试期的 `vitest`——`package.json` 里没有 `dependencies` 段。

**禁止**，且当前代码确实遵守：

- 不依赖 React / React Native / Tauri / Zustand 或任何 UI 框架：`packages/core/src` 里没有一个非相对的 bare specifier 指向这些包。
- 不触碰宿主全局：无 `window` / `document` / `globalThis` / `process` / `navigator` 引用，因此不会长出平台分支。
- 不做 IO：不发请求、不读文件、不读写存储。需要 IO 的能力以依赖注入暴露（`mobile-api` 接收一个 `fetchText`，桌面与移动各自提供实现）。
- 无构建步骤：`main` / `types` 直接指向 `src/index.ts`，两端经 tsconfig `paths` 消费源码。改完即生效，代价是没有产物隔离——在 core 里引入平台依赖会立刻让两端都编译失败。这是它保持纯净的机制，不是巧合。

**已知的边界瑕疵**（实情，非设计意图）：`sources/custom-source.ts` 里定义了一套更早的 `CustomSourceContext` 契约与 `createCustomSourceProvider` 包装器，两端运行时都未接线，仅作契约保留；`mobile-api.ts` 的 `createRacingBuiltinMusicApiClient` 多网关竞速已就绪但未接线，当前只有单网关客户端。两者都是「活在 core 里但无人使用」的代码——新增功能前先确认是否该复活它们，而不是再写一份。

## 测试

JS/TS 侧唯一有自动化测试的包：`pnpm core:test`（vitest），7 个测试文件，全部只测纯逻辑。其中 `outbound-host.test.ts` 用 Node 的 WHATWG `URL` 作参照物做差分断言，锚定「守卫判定的 host 必须等于 HTTP 客户端真正连接的 host」这一不变量——它测的不只是函数返回值，而是守卫与真实客户端的一致性。

两端其余部分依赖真机运行时，只做 `typecheck`。
