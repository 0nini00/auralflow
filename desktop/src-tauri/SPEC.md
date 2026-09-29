---
id: desktop-native
type: submodule-design
status: draft
title: 桌面端 Rust 后端 — 系统边界与出站守卫
parent: desktop
tags: [auralflow, desktop, rust]
---

## 职责

Rust 侧承担 WebView 做不到或不该做的事，经 Tauri IPC 暴露给前端。四类：

- **出站网络守卫**：出站请求的校验与执行。这是 `core/outbound-host.ts`（书面定义）的 Rust 实现，也是**真正实施拦截的那一份**——桌面端出站请求由 Rust 发出。对外只暴露三个入口：`assert_public_url`、`guarded_redirect_policy`（每跳复用同一判定，≤10 跳）、`proxy_http_request`。
- **文件与媒体**：本地音乐扫描（walkdir + audiotags/lofty 双库读写标签与内嵌封面）、三层媒体缓存（song-audio 2GiB、song-covers 512MiB、bili-audio 1GiB；命中刷新 mtime，因此是真正的 LRU）、流式下载（可取消、180ms 进度节流、2GiB 上限，完成后写标签与旁挂 lrc）、原子写入、用户数据持久化。
- **窗口与系统集成**：独立透明歌词窗口（复用前端 dist，按窗口 label 路由；锁定 = 鼠标穿透 + 150ms 光标轮询 + 悬停解锁小窗，置顶 1.5s 巡检 + token/epoch 防竞态）、系统托盘、应用生命周期。
- **凭据加密**：`secret_store.rs` 用 Windows DPAPI 按当前用户加密 Cookie 与 WebDAV 密码，密文以 `DPAPI:v1:<base64>` 存放，与明文可区分，因此历史明文文件无需迁移步骤；**仅支持 Windows，其他平台编译期失败**——静默退回明文会让「凭证已加密」变成假承诺。

**结构**：`main.rs` 声明 9 个顶层模块（含 `commands`、`outbound`、`secret_store`、`tray`）。IPC 命令按领域拆成 `commands/` 下的 8 个子模块（settings / compression / media_cache / bili / downloads / local_audio / library / lyric_window），以 `mod { include!(...) }` 引入后由 `commands.rs` 统一 `pub use`，`main.rs` 继续按 `commands::<name>` 引用——因此**命令名、参数与返回值在拆分前后保持不变**。注意 `library` 与 `lyric_window` 各有两份文件：顶层的是领域逻辑与窗口生命周期，`commands/` 下的是命令面。

窗口能力按最小权限分三套 capability：`main` / `lyric` / `lyric-unlock`。只有 `main` 带 `updater:default`（歌词窗不需要更新能力）。

**应用自更新**：`tauri-plugin-updater` 在 `main.rs` 注册，`tauri.conf.json` 的 `plugins.updater` 给出公钥、清单地址与 Windows `installMode: passive`。要点：

- 检查与下载都读 GitHub Releases 上的静态清单 `latest.json`；**安装包签名强制校验、无法关闭**。清单里任何已列出的平台条目只要不完整，整份清单判废（症状是「检查更新失败」而不是「有新版本」）。
- Windows 上安装是**终态**：插件 `ShellExecuteW` 调起安装器后立即 `std::process::exit(0)`，因此前端必须自己把「安装中」画成终态，不能等 Promise 返回。
- 装完**由安装器把应用重新拉起**：`restart_after_install` 默认 true，NSIS 传 `/R /ARGS`，`installer.nsi` 用 `nsis_tauri_utils::RunAsUser` 执行；该分支只在 silent / passive 模式下生效，所以 `installMode` 不能改成会要交互的 `basicUi`。
- **updater 的检查与下载都在 Rust 侧发起，不受 `capabilities` 里 `plugin-http` 静态白名单约束**，只认 `plugins.updater.endpoints`。改这两处时别以为白名单能兜住。
- 构建侧：`bundle.createUpdaterArtifacts: true`，构建时必须注入 `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`。私钥与口令在 `F:\auralflow-secrets\`（`updater-signing.properties`），**丢失即再也无法向已安装的用户推送更新**。发布走 `desktop/build-release.ps1`。
- **尚未真机验证**：下载 → 验签 → 静默安装 → 自动重开这条链路，目前只做完服务端核验（清单可抓、清单里的签名与安装包 `.sig` 逐字节一致、资产 URL 可下载），**客户端执行必须实机跑一次才算数**。第一版带更新器的是 0.4.0，之前的所有版本都不含更新器、只能手动装。
- 新增依赖带进一份独立的 `reqwest 0.13`（项目自身用 0.12），crate 树里有**两份 reqwest**：只影响编译时间，不影响行为。同理，`windows` 已从 0.61 对齐到 0.62，避免两份并存。

## 边界

**允许**：Tauri v2（`protocol-asset`、`tray-icon`）、`tauri-plugin-updater`、reqwest、walkdir、audiotags/lofty、base64、Windows 系统 API。

**禁止**：

- **不依赖 `@lx/core`**——Rust 侧没有、也不应有 JS 包的 path 依赖。这意味着 `outbound-host.ts` 与 `outbound.rs` 是同一套规则的两次实现，**必须人工逐条同步，且没有任何自动化校验**。规则变更时这是首要检查项。两边归一化分工不同：Rust 侧由 `reqwest::Url` 自身完成部分归一化（IDNA、尾点剥离等），JS 侧全部手写。
- 不做只有前端知道的业务判断：播放编排、音质轮次选择、歌词解析都在 JS 侧。
- 不扫描、不删除用户磁盘上的历史文件；用户数据只做透明 IO（命名空间经白名单限制），Rust 不复刻前端 schema。

**出站守卫契约**（两端共同的显式边界）：只允许 http/https；拒绝 localhost / `.localhost` / `.local` / 回环 / 私有 / 链路本地 / CGNAT / 未指定 / 多播 / 广播 / 文档示例地址，以及标准库没有判定、必须手写的 `0.0.0.0/8`、`192.0.0.0/16`、`198.18.0.0/15`、`240.0.0.0/4`（2026 复盘补进本模块，此前只存在于 JS 侧，使桌面端比移动端宽松）。**显式不做 DNS 解析后校验**，因此 DNS rebinding 不在拦截范围内——该场景要求用户主动填入恶意地址或安装恶意音源，与「用户自带脚本同权」的威胁模型一致。固定白名单域名走 `plugin-http` 的静态 scope 直连；用户可配置的动态目标（WebDAV、音源脚本请求）统一走 `proxy_http_request`。响应体上限 16MB，超时上限 60s。

**两处与 JS 侧有意保留的差异**（都不构成 SSRF 面）：`http:example.com` 这类缺 `://` 的写法 JS 直接拒、Rust 交给 WHATWG 归一化后照常校验 host；「形似 IPv4 但解析失败」的 fail-closed 只在 JS 侧实现——Rust 侧该情形经 `reqwest::Url` 归一化后只可能落到公开 IP。

**测试现状**：`outbound.rs` 有 4 个 `#[test]`（四段不可路由网段 + IPv4-mapped 继承关系 + `assert_public_url` 端到端），`secret_store.rs` 有 6 个；两者都由根目录 `pnpm test:rust` 执行，CI 在 windows runner 上跑同一命令——**不再是「有测试而无人运行」**。缺口是跨语言一致性没有测试：JS 侧 20 例与 Rust 侧 4 例各测各的，没有任何一处断言「同一批 URL 两边结论相同」，所以本节的「两端一致」目前仍然只是人工维护的声明。
