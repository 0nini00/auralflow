# AuralFlow 移动端可靠性与安全存储修复设计

日期：2026-08-19
状态：已获用户批准采用方案 A，等待书面规格复核

## 1. 背景

移动端代码审阅确认了启动状态未恢复、播放快照不一致、搜索与歌单请求竞态、缓存失效不完整、敏感凭据明文存储、Android 原生请求码冲突、版本与构建配置多真相源，以及无引用代码和测试覆盖不足等问题。

本次目标是逐项修复上述问题，同时保持现有 React Native、Zustand、TrackPlayer、WebDAV、自定义音源和 Android 原生功能的外部行为兼容。

## 2. 范围

### 2.1 包含

1. 使用 Android Keystore 支持的安全存储迁移网易云 Cookie、B站 Cookie 和 WebDAV 密码。
2. 在应用启动阶段恢复主题、播放设置、网易云账号状态和必要的本地数据。
3. 修复播放快照的进度保存、空状态删除和写入顺序。
4. 消除非核心启动任务的未处理 Promise rejection。
5. 修复搜索历史去重逻辑和搜索建议响应竞态。
6. 修复缓存清理后的内存预读失效，以及预读缓存缺少音质维度的问题。
7. 修复歌单详情请求返回顺序导致的跨页面数据覆盖。
8. 消除 Android Activity requestCode 冲突。
9. 统一应用版本来源，移除 Node 绝对路径和全局 ABI 硬编码。
10. 为自定义音源 runtime 增加生命周期释放，避免已删除或重建的 runtime 常驻。
11. 移除确认无引用且无运行时入口的代码。
12. 为新增的不变量补充自动化回归测试。
13. 未接受使用协议前，不发起应用更新和自定义音源更新网络请求。
14. WebDAV 配置只接受 HTTPS，避免 Basic 凭据通过明文 HTTP 发送，并与 release 网络策略一致。

### 2.2 明确排除

以下两个审阅问题保持现状，本次不得顺带修改：

1. 自定义音源 WebView 沙箱可被绕过。
2. 自定义音源远程更新请求缺少出站地址校验、超时和响应体限制。

runtime 生命周期释放只删除不再使用的内存和 WebView 实例，不改变脚本执行沙箱、网络权限、更新请求校验或请求协议。

## 3. 核心不变量

1. 应用进入主界面前，主题、播放设置、账号本地状态和关键配置已经完成恢复。
2. 非关键本地数据加载失败必须进入可观察错误路径，不产生未处理拒绝，也不阻塞主界面。
3. 未接受使用协议时，除读取本地数据外，不执行更新检查、WebDAV 或自定义音源更新网络请求。
4. 敏感凭据不得以明文形式保留在 AsyncStorage。
5. 安全存储迁移必须幂等：重复启动不会丢失凭据，成功迁移后删除旧明文值。
6. 播放快照最多落后实际播放进度十秒；清空队列后磁盘快照必须不存在。
7. 旧异步请求不得覆盖更新请求对应的页面或 Store 状态。
8. 缓存键必须包含影响资源内容的音质维度；清理磁盘缓存时必须同步清理内存索引。
9. APK、应用内版本显示和更新检查必须读取同一版本来源。
10. 每个 Android Activity 结果请求使用唯一 requestCode。

## 4. 设计方案

### 4.1 启动协调

在 `App.tsx` 中建立单一启动阶段，不新增第二套状态源：

- 核心恢复任务：主题、播放设置、网易云账号本地状态、自定义音源、悬浮歌词和 WebDAV 配置。
- 非核心恢复任务：本地歌单、喜欢歌曲、播放历史、本地音乐和下载记录。
- 核心任务使用 `Promise.all`，错误进入启动错误提示；非核心任务使用 `Promise.allSettled`，各 Store 保留自己的错误状态，并统一输出明确错误日志。
- 播放监听器和播放快照持久化仍只初始化一次。
- 更新检查、自定义音源启动更新和 WebDAV 自动同步都以 `pactAccepted === true` 为前置条件。

不增加隐藏默认值，也不在任一加载失败时强制把协议状态改成已接受。

### 4.2 Android Keystore 安全存储

新增原生 `SecureStorageModule`：

- Android Keystore 中生成不可导出的 AES 密钥。
- 使用 AES/GCM/NoPadding 加密每个值。
- 私有 SharedPreferences 只保存 Base64 编码的 IV 和密文。
- JS 侧提供 `getSecureItem`、`setSecureItem`、`removeSecureItem`。
- 原生模块错误必须 reject，并带稳定错误码，不返回伪成功。

迁移规则：

- 网易云 Cookie：首次读取时先查安全存储；不存在则读取旧 AsyncStorage，安全写入成功后删除旧值。
- B站 Cookie：规则相同，并保持现有内存缓存语义。
- WebDAV：URL、用户名和自动同步开关继续存 AsyncStorage；密码单独进入安全存储。旧配置中的密码成功迁移后，从 JSON 中删除。
- 写入空字符串等价于删除安全值。

### 4.3 播放快照

将快照触发判断提取为可测试纯模型：

- 队列、当前曲、索引、模式、倍速、音量、播放上下文变化时保存。
- 播放进度跨越十秒桶时保存，避免 250ms 进度事件导致持续写盘。
- 从播放变为暂停时立即保存当前进度。
- 应用进入后台时刷新一次快照。
- 所有写入通过串行队列执行，后发状态不能被先发慢写覆盖。
- 当前曲为空且队列为空时调用 `AsyncStorage.removeItem`，不保留旧快照。

### 4.4 搜索

搜索历史：

- 提取 `updateSearchHistory(history, keyword, limit)` 纯函数。
- 去除与新关键词相同的旧项，保留其他历史，再把新关键词放到首位。
- 对损坏存储做数组校验并暴露错误，不写入重复项。

搜索建议：

- 为每次建议请求递增序号。
- 只有最新序号且输入关键词仍一致的响应可以更新 UI。
- 清空输入或提交搜索时递增序号，使在途旧请求失效。

### 4.5 缓存与音质

- 使用现有 `dataCleanupService` 作为缓存清理协调层：磁盘缓存清理成功后调用 `clearPrefetchCache`。
- 设置页不再直接调用底层 `clearAllCache`。
- 播放预读键改为 `source:id:effectiveQuality`。
- 预取、读取、写入和失效使用同一键生成函数。
- 按歌曲失效时删除该歌曲所有音质的预读条目。
- 修改默认音质后无需清空其他音质缓存，新音质会自然使用独立键。

### 4.6 歌单详情竞态

- `playlistStore.fetchPlaylistDetail` 为每次请求生成递增 token。
- 只有最新 token 可以提交 `currentPlaylist`、歌曲、loading 和 error。
- 快速从歌单 A 进入歌单 B 时，A 的迟到响应被丢弃。
- 喜欢歌单的派生状态只由获胜请求更新。

### 4.7 原生请求码

为各原生模块建立互不重复的命名常量：

- 图片选择、自定义音源选择、本地音频选择、本地元数据授权、本地标签写入和悬浮窗授权分别使用独立编号。
- 本次仅调整悬浮窗授权编号，避免改变本地音乐既有流程。

### 4.8 版本和构建

以 `apps/mobile/package.json` 为单一版本配置文件：

- `version` 作为 `versionName` 和应用内 `CURRENT_VERSION`。
- 新增 `androidVersionCode` 数字字段作为 APK versionCode。
- Gradle 使用 `JsonSlurper` 读取这两个字段，并对缺失或非法值显式失败。
- `updateService.ts` 直接导入 package.json，不再硬编码版本。
- `settings.gradle` 使用 `NODE_BIN` 环境变量，未设置时使用 PATH 中的 `node`。
- `gradle.properties` 恢复 React Native 标准 ABI 列表；删除 `app/build.gradle` 的固定 `abiFilters`。
- `build-release-arm64.ps1` 改为向 Gradle 显式传入 `-PreactNativeArchitectures=arm64-v8a`，继续生成 arm64 专用发布包。
- release 缺少正式 keystore 时直接失败，不再回退 debug 签名。

### 4.9 自定义音源 runtime 生命周期

在不改变沙箱和远程更新网络行为的前提下：

- `RuntimeInstance` 增加 `dispose()`。
- dispose 时拒绝未完成请求、删除 `bridgeRoutes` 和 `ensureRequestIdRoutes`。
- RN 向 WebView 发送 `dispose` 消息，WebView 删除对应 `runtimes` 条目。
- `invalidateRuntimeCache`、删除音源、脚本替换和初始化失败都执行 dispose。
- runtime cache key 使用完整脚本 SHA-256，而不是长度和前 64 字符。

### 4.10 无引用代码清理

删除前再次执行静态引用扫描，只删除同时满足以下条件的文件：

- 没有静态或动态 import；
- 没有 React Native 注册入口；
- 没有文档或构建脚本依赖；
- 功能已经由当前实现替代。

当前候选包括：

- `src/components/MyMusicSections.tsx`
- `src/navigation/navigationHistoryModel.ts`
- `src/services/artworkColorService.ts`
- `src/utils/music.ts`
- `src/utils/responsive.ts`
- `src/services/downloadDirectoryModel.ts`

若 `ArtworkColorModule.java` 在最终扫描中仍无消费方，同时移除原生注册和 Palette 依赖；否则保留。

## 5. 错误处理

- 不新增空 `catch` 或静默成功路径。
- 安全存储、启动恢复、快照写入和版本解析失败必须保留原始错误信息。
- 非核心启动失败不阻塞 UI，但必须写入 Store error 或统一错误日志。
- 竞态被淘汰属于正常控制流，不显示错误，也不修改 loading 所有权。
- 迁移只有在安全写入确认成功后才删除旧明文。

## 6. 测试设计

新增或扩展以下测试：

1. 启动任务分类和协议网络门控模型。
2. 快照结构变化、十秒进度桶、暂停保存和空状态删除。
3. 搜索历史保留不同关键词、同词去重和数量上限。
4. 搜索建议旧请求失效。
5. 预读缓存键包含音质、按歌曲删除所有音质。
6. 歌单详情只有最新请求可提交。
7. 安全存储迁移成功、失败不删明文、重复迁移幂等。
8. runtime dispose 删除路由并拒绝挂起请求的可测试部分。
9. 版本配置解析和非法配置失败。

验证顺序：

1. 定向单元测试。
2. 移动端全部 Vitest。
3. TypeScript 检查。
4. ESLint。
5. Android debug 构建。
6. Android release 配置检查；若本机正式签名可用则执行 release 构建。
7. `aapt2 dump badging` 校验 APK versionName/versionCode。
8. 最终 diff 审计和未引用文件扫描。

## 7. 验收标准

1. 第 1、2 项排除问题对应代码行为未被修改。
2. 三类敏感凭据不再明文写入 AsyncStorage，旧值可自动迁移。
3. 冷启动立即恢复主题、播放设置和网易云登录本地状态。
4. 未同意协议时没有更新检查、自定义音源更新和 WebDAV 请求。
5. 播放十秒以上后重启，恢复进度误差不超过十秒；清空队列后不会复活。
6. 连续添加不同搜索词会完整保留历史；旧建议不会覆盖新输入。
7. 清空缓存后不会命中已删除的 file URL；不同默认音质不共用预读 URL。
8. 快速进入多个歌单详情时只显示最后进入歌单的数据。
9. 所有 Android requestCode 唯一。
10. APK 版本与 package.json 一致，release 不允许 debug 签名回退。
11. 默认 debug 构建支持标准 Android ABI，arm64 发布脚本仍可单独构建。
12. 确认无引用的重复代码被删除，新增行为具有回归测试。
13. 全部测试、类型检查、Lint 和 Android debug 构建通过。

