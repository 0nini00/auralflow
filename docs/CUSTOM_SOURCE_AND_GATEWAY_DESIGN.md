# 自定义音源与网关设计

本文记录 AuralFlow 音源解析的完整架构：从官方直连到网关、自定义源与 B 站的多层级关系，以及双端（桌面 / 移动）在沙箱执行、安全模型与版本管理上的实现差异。所有描述均与当前代码状态对齐。

---

## 1. 设计目标

1. **多源可用性**：单一音源不可用时仍能播放。官方接口、免 key 网关、用户自定义脚本、B 站四层叠加，互为兜底而非串行依赖。
2. **音质择优**：不因某条链路慢就降级到低音质。在有限时间窗口内并发竞速，优先返回更高音质的结果。
3. **用户可扩展**：导入 LX Music 自定义音源脚本即可接入新平台，无需改代码、无需 API key。
4. **安全可控**：用户脚本是主动安装的不可信代码；桌面端参数遮蔽明确宣告「这不是安全边界」，真正隔离（独立 Worker/WebView 且不暴露 IPC）未实施（见 §7）；所有出站 HTTP 统一经 SSRF 校验，桌面走 Rust、移动走 JS，两份实现契约一致（手工同步）。
5. **双端一致**：音质阶梯、竞速窗口、版本比较、出站主机判定等纯逻辑收敛到 `@lx/core`，桌面与移动共享同一真相源，仅 I/O 边界不同。

---

## 2. 音源层级与优先级

解析按层级组织，各层职责独立、并发参与竞速：

| 层级 | 实现 | 职责 | 入口 |
|---|---|---|---|
| 官方直连 | `wyProvider`（weapi/eapi 加密）、`txProvider`（musicu 接口） | 用平台官方协议直取播放 URL，作为所有竞速通道失败后的兜底，不参与竞速 | `sourceService.ts` 注册到 `SourceRegistry` |
| gdstudio 网关 | 免 key 聚合网关（`music-api.gdstudio.xyz`，`types=search/url/lyric`） | 移动走 `@lx/core` 的 `createBuiltinMusicApiClient(fetchText)`；桌面独立实现（浏览器 fetch 优先、Tauri HTTP 兜底），网关搜索用于官方结果的元数据补充（`mergeSongSearchMetadata`）与兜底 | `packages/core/src/mobile-api.ts` / `desktop/src/services/builtinMusicApiClient.ts` |
| LX 自定义源 | `lx` 对象契约 + 参数遮蔽执行 | 用户导入的 LX Music 脚本，经注入的 `lx` 对象（EVENT_NAMES/`send`/`on`/`request`/`utils`）与宿主交互 | `customSourceRuntime.ts`（桌面）/ `lx_bridge`（移动） |
| B 站 | WBI 签名 + DASH 音频流 | 独立分支，无音质分层，不进竞速；需要 Referer 头 | `biliProvider.ts` / `biliService.ts` |

**优先级语义**：网关与自定义源是**并发竞速**关系，不是先后兜底。官方直连是竞速全败后的最后兜底，B 站走独立分支。`MusicInfo.gateway` 标记内置 API 的真实来源与曲目 ID，是播放/歌词元数据，不构成独立 UI 来源标签——最终歌曲仍按 `wy` 或 `tx` 展示。

---

## 3. 解析流程与质量轮次竞速

### 3.1 总流程

```text
用户播放歌曲
  -> resolvePlaybackUrl
  -> 命中持久化缓存则直接返回
  -> bili 走独立分支（无音质分层，不进竞速）
  -> 按轮次表逐轮竞速
  -> 所有轮次失败 -> 官方直连 provider 兜底（不参与竞速）
  -> 返回 PlaybackResolvedUrl 给播放引擎
```

总预算双端不同：桌面 12s 硬超时（`PLAYBACK_RESOLVE_TOTAL_BUDGET_MS`，超时直接抛错走错误分支）；移动端 10s 轮次预算（`RESOLVE_RACE_BUDGET_MS`，每轮开始前检查）。内置音乐 API 请求优先用浏览器 `fetch`（桌面，6s 超时），超时或不可用时回退 Tauri HTTP plugin（10s）；移动端经 `fetchText` DI 注入 RN 网络层。

### 3.2 质量轮次表

音质阶梯与轮次划分由 `@lx/core` 的 `buildPlaybackQualityTiers` 统一定义（`packages/core/src/playback-quality.ts`）：

- 阶梯（低→高）：`128k → 192k → 320k → flac → flac24bit`
- 首轮 = 不低于用户选定音质的全部档位（从高到低同时竞速）
- 之后每轮下调一档（单档），更高档已在首轮试过不重复

```
选 320k -> [["flac24bit","flac","320k"], ["192k"], ["128k"]]
选 128k -> [["flac24bit","flac","320k","192k","128k"]]
```

音质别名与 br 映射：`normalizePlaybackQuality` 统一别名（`740`→flac、`999`→flac24bit，及 `128`/`320`/`hires` 等）；网关侧 br 映射 flac24bit→999、flac→740（core `toBuiltinMusicApiBr` / 桌面 `QUALITY_BR_MAP`，一对一不降档，降档由轮次表负责）。

### 3.3 竞速窗口

每轮内两个通道并发：

- **通道 A — 内置网关**：内部按音质从高到低顺序试，第一个成功即当前最高可用档。不对每档并发：gdstudio 是免费网关，同一首歌并发多档容易触发限流；顺序高→低本身等价于择优。
- **通道 B — 自定义音源**：已启用音源 × 本轮音质，全组合并发。

两通道并发取音质最高的成功结果。首个成功结果开启 **800ms 升级窗口**（`DEFAULT_QUALITY_UPGRADE_WINDOW_MS`）：窗口内有更高档就替换，命中本轮最高档（ceiling）则立即定稿（settle）。此逻辑由 `raceForBestQuality` 实现，两层竞速（通道之间、单通道内音源×音质之间）共用同一个 800ms 值，各层独立计时不叠加。

### 3.4 关键约束

- **backend 不跨档降级**：降级链由轮次表统一负责，否则用户选无损时首轮就可能拿到 128k。
- **quality 一律是音质标签**：`320k` / `flac`，网关回传的 br 数字串（`320`/`740`/`999`）在 backend 出口归一化；持久化缓存 key 按标签匹配，不归一化则缓存永不命中。
- **LX 自定义源不支持 192k**：运行时白名单只有 `128k/320k/flac/flac24bit`，该轮对自定义源快速失败，由网关通道承担。
- **网关不做跨源替代**：wy 官方直连搜索结果由 mapper 写入 `gateway`（netease/曲目 id），天然可走网关；tx 曲目缺 `gateway` 元数据时网关直接失败，由自定义源用真实 songmid 解析（同名搜索转译已移除，见 §9）。

### 3.5 试听判定（stream-integrity）

VIP 歌曲、wy eapi 无 VIP、自定义音源脚本都可能返回 30s 试听 URL，且试听与完整版同样返回 200/206，状态码无法区分。判定收敛在 `@lx/core stream-integrity`，双端同语义：

- **`isPreviewStream`（解析期）**：由 Content-Range/Content-Length 完整字节数按音质码率估算流时长，明显短于期望时长（`song.interval`）且不足 60s 判试听。
- **`isPreviewDuration`（播放期兜底）**：解析期拿不到长度头的流式响应，靠播放器报告的实际时长判定，明显短于期望时长即试听。
- 判定为试听 → 本档作废、不写缓存不进播放器，降档重试。

---

## 4. `@lx/core` 相关模块

纯逻辑收敛在 `packages/core/src`，双端共享，无 I/O 依赖。

### 4.1 mobile-api.ts — 内置网关客户端

- **`createBuiltinMusicApiClient(fetchText)`**：DI 注入 `fetchText`（URL→文本），核心逻辑不耦合具体 HTTP 实现。**现状：仅移动端接线**（`musicApi.ts` 用 RN fetch 实现 `fetchText`）；桌面未用 core 客户端，在 `builtinMusicApiClient.ts` 独立实现（浏览器 fetch 优先，失败回退 Tauri HTTP plugin）。
- **搜索空数组不算成功**：`searchSongs` 对非数组响应（HTML 错误页/限流页）抛错而非返回空，避免竞速把「快速空结果」当成功吞掉其它网关的真实数据。
- **`createRacingBuiltinMusicApiClient`**：多网关并发竞速，能力已就绪但**未接线**。`resolveUrl`/`getLyric` 先到先得；`searchSongs` 用 `Promise.allSettled` 且空数组不视为成功，防快速空结果吞掉其它网关的真实数据；单网关退化为直通。
- **`mapBuiltinMusicApiSong`**：要求 `id`+`name` 非空，把网关响应映射为 `MusicInfo`，携带 `gateway{source,trackId,lyricId,picId}` 驱动后续网关调用；joox 封面用 `image.joox.com` 拼 `picId`；`mvId` 仅 wy 写入。
- **桌面网关搜索的用途**：以官方直连搜索为主链，网关搜索经 `mergeSongSearchMetadata` 为官方结果补充元数据（gateway/时长/封面），官方搜索失败时作兜底。

### 4.2 registry.ts — 源注册（无源轮转）

- `packages/core/src/sources/registry.ts` 只有 `SourceRegistry`（register/unregister/get）；旧文档描述的 `SourceResolver` 源轮转、`DEFAULT_SOURCE_POLICY` 与 0.85 跨源匹配阈值在代码中不存在，已随旧设计移除。
- 桌面 `sourceService.ts` 向 registry 注册 `wyProvider`/`txProvider`/`biliProvider`，供官方直连兜底（`builtinProviderBackend`）按 source 取用。
- 自定义源不进 registry、也不显示为新来源：它经 `customSourceBackend`（桌面）/ `playerService`（移动）作为独立竞速通道参与每轮解析（见 §3）。

### 4.3 lx 对象契约（双端实际注入）

双端注入给脚本的统一契约是 **`lx` 对象**（LX Music 自定义源协议，version `2.0.0`）：

- **`lx.EVENT_NAMES` / `lx.send` / `lx.on`**：脚本启动后 `send(inited, sources)` 上报能力声明（可携带 updateAlert），`send(updateAlert, …)` 上浮更新提示，`on(request, handler)` 注册取链处理器。
- **`lx.request`**：出站 HTTP 入口，双端各自代理（桌面 → Rust `proxy_http_request`，移动 → 桥代理回 RN fetch），脚本不直接触网。
- **`lx.utils`**：`crypto`（AES/MD5/RSA-RAW/randomBytes；桌面 crypto-js + node-forge，移动 WebView 内 vendor 的 CryptoJS）、`zlib`（桌面 Tauri zlib，移动 pako）、`buffer`。
- **`lx.currentScriptInfo` / `lx.version` / `lx.env`**：脚本自身元信息；协议版本 `2.0.0`；env 为 `desktop`/`mobile`。

注：`packages/core/src/sources/custom-source.ts` 还定义了更早的 `CustomSourceContext`（request/log/utils.md5/sleep/randomUserAgent）与 `createCustomSourceProvider` 包装器，双端运行时均未接线，仅作为 core 层契约保留。

### 4.4 raceForBestQuality

`packages/core/src/playback-quality.ts` 的 `raceForBestQuality<T>`：

- 全部候选并发，先成功者暂存为 best。
- 首个成功结果启动 800ms `upgradeWindowMs` 定时器。
- 窗口内若有更高 rank 的结果到达则替换 best；达到 `ceiling`（默认阶梯顶端 flac24bit）或全部 settled 则立即 settle。
- 失败的候选不影响其余；全部失败才抛聚合错误。
- 纯竞速会让音质随机漂移，直接等全部返回会被慢源拖住——窗口机制是二者的折中。

---

## 5. 桌面实现 — `customSourceRuntime.ts`（776 行）

桌面在 Tauri 主 WebView 同进程内用 `new Function` 执行用户脚本。参数遮蔽只是让脚本按预期经注入的 `lx` 对象工作——**这不是安全边界**（代码注释明确宣告，详见 §7）。

### 5.1 沙箱构造

```typescript
new Function('lx','window','globalThis','self','top','parent','frames',
  'fetch','WebSocket','XMLHttpRequest','document','location','navigator',
  'require','process','Buffer',
  '"use strict";\n' + script)
```

- **无原型对象承载全局**：`fakeWindow`/`fakeGlobalThis` 用 `Object.create(null)` 构造（`lx` 挂在其上），`window.constructor` 为 `undefined`——只让「按预期写法」拿不到 `Function` 构造器，不是边界。
- **宿主全局遮蔽**：`window` 绑 `fakeWindow`，`globalThis`/`self` 绑 `fakeGlobalThis`；`top`/`parent`/`frames`/`fetch`/`WebSocket`/`XMLHttpRequest`/`document`/`location`/`navigator`/`require`/`process`/`Buffer` 传 `undefined`。
- **严格模式**：`"use strict"` 使函数体顶层 `this` 为 `undefined`，同样只是提高门槛而非边界。
- **静态正则黑名单已移除**：旧版曾用静态正则拒 `constructor.constructor`/`eval(`/`Function(`，现已删除——字符串拼接、Unicode 转义、async 函数的 constructor 等写法无法用静态扫描穷尽，黑名单只能挡朴素写法，却让人误以为存在隔离。
- **已知逃逸路径**：任意脚本可执行 `({})['cons'+'tructor']['cons'+'tructor']('return this')()` 取回真实 `globalThis`，再经 `__TAURI_INTERNALS__` 直达 IPC，读取 `load_settings` 中的明文凭证（如 webdavPassword）。
- **真正隔离未实施**：需要独立 Worker/WebView 且不暴露 IPC，属架构变更。
- **init 30s 超时**：脚本未在 30s 内 `lx.send(inited)` 即判初始化失败。

### 5.2 HTTP 代理与 SSRF

- 脚本的 `lx.request` 不直接 `fetch`，经 `runHttpRequest` → `outboundRequest` → Rust 侧 `proxy_http_request`（`outbound.rs`）。
- **SSRF 每跳验证**：`assert_public_url` + `is_blocked_v4`（含手动 CGNAT 100.64/10）+ `guarded_redirect_policy`（每跳复用同一判定，≤10 跳）。所有对外 reqwest client 都挂上该策略。
- **cancel 仅设 flag**：请求发出后无法真正中止，cancel 只丢弃回调；超时上限 60s。
- 拒绝 localhost/`.local`、回环/私有/链路本地/CGNAT/未指定/多播/广播/文档示例地址，IPv4-mapped IPv6 先还原再判。
- **固定白名单域名走 `plugin-http` 直连**：`@tauri-apps/plugin-http` 的 scope 是静态 URL 白名单；用户可配置的动态目标（WebDAV/音源脚本请求）无法用静态白名单表达，统一走 `proxy_http_request` 由 Rust 校验。

### 5.3 运行时缓存

- **LRU Map（容量 8）**：`runtimeCache` 按 `api.id::djb2a-hash(script)` 缓存已初始化的 `RuntimeInstance`，避免每次播放都 `new Function` + 网络初始化。
- **djb2a hash**：`hashScript` 对脚本全文做 djb2a 哈希并拼长度，脚本任意位置编辑都让缓存失效（旧实现只看前 64 字符易撞）。
- 命中缓存时仍接上本次传入的 `onUpdateAlert` 监听器，避免运行时上浮的 updateAlert 被丢弃。
- 初始化失败从缓存移除，下次重试。

### 5.4 脚本信息解析与深度测试

- **`parseDesktopUserApiInfo`**：解析脚本头部块注释 `/* ... */` 中的 `@name`/`@version`/`@description`/`@author`/`@homepage`，各字段有长度上限（name 24/version 36/description 36/author 56/homepage 1024），version 走 `v?\d+(?:\.\d+){1,3}` 正则提取。
- **`testCustomSourceDeep` 两阶段**：
  1. **init**：复用 `createRuntime` 走初始化，等待 `inited` 事件与 updateAlert。
  2. **musicUrl**：选声明 musicUrl 能力的平台（优先 wy），用内置固定测试曲走真实取链——wy `2034742057`（林俊杰-江南）、tx songmid `0039MnYb0qxYhV`，超时 20s。初始化通过不代表真能取到播放地址（假阳性），深度测试覆盖端到端可用性。
- **`toOldMusicInfo`**：把 `MusicInfo` 映射为 lx 协议格式（双端同构）。tx 的 `songmid`/`songId`/`albumMid`/`strMediaMid` 分别保留（均取自 `txMeta`）——`strMediaMid` 用于拼 `M500{mid}.mp3`/`F000{mid}.flac`，`songmid` 与 `songId` 是两个不同的值不能都填 `music.id`。
- **能力白名单交集过滤**：`normalizeInitSources` 把脚本声明的 actions/qualitys 与内置白名单取交集——kg/tx/wy 仅 `musicUrl`（qualitys 限 `128k/320k/flac/flac24bit`），`local` 另有 `lyric`/`pic`；白名单之外一律裁掉。
- **musicUrl 结果收口**：返回值必须是 `^https?:` 且 ≤2048 字符的字符串，否则按失败处理；移动端在收口处再过一次 `assertPublicOutboundUrl`（下游探活/下载/播放器均不再校验）。

### 5.5 updateAlert 流

- 脚本通过 `lx.send('updateAlert', { log, updateUrl })` 上报更新提示。
- `normalizeUpdateAlert`：`log` 截断到 1024 字符；`updateUrl` 仅接受 `http(s)://` 且 ≤1024 字符。
- 运行时上浮：仅当没有 waiter 在等时才回调消费方（避免同一 alert 双份写入）；test/check 流程通过 `waitForUpdateAlert` 消费。
- `checkCustomSourceRemoteUpdate` → `normalizeCustomSourceRemoteUrl`：GitHub/Gitee 的 `blob`/`raw` 路径自动改写为 raw 直链。

---

## 6. 移动实现 — WebView `lx_bridge`

移动端 RN 的 Hermes 引擎**不支持 `new Function`**，用户脚本无法在 JS 线程执行，改用隐藏 WebView 作为脚本运行时。

### 6.1 桥结构

- **宿主组件 `LxBridgeHost`**（`customSourceWebViewBridge.tsx`）：1×1 透明隐藏 WebView，加载 `file:///android_asset/lx_bridge/index.html`；在 App 根部挂载一次常驻，避免页面切换导致 WebView 卸载重建；`waitForBridge` 12s 超时。
- `index.html`（301 行）：桥主逻辑，按 runtime id（rid）为每个脚本建立独立 `lx` 闭包环境；`dispose` 时清空 httpPending（挂起回调报错）、置空 requestHandler 并删除 runtime。
- `vendor.js`（2510 行）：预置 `CryptoJS` + `pako`，挂到 `window.__lxVendor`，供脚本的 `utils` 使用。
- 消息协议：WV→RN 经 `ReactNativeWebView.postMessage`（`ready`/`inited`/`updateAlert`/`error`/`http`/`request-response`）；RN→WV 经 `injectJavaScript` 向 `window` 派发 `MessageEvent`（`run`/`request`/`http-response`/`dispose`）。
- 每条取链请求 30s 超时，超时按失败处理。

### 6.2 沙箱构造

与桌面同构的 `new Function` 参数遮蔽（WebView 内核无 Hermes 限制）。RN 侧 `createRuntime` 先做静态扫描，命中 `/constructor\.constructor|\.constructor\(|eval\(|Function\(/` 的脚本直接拒绝（双层防御，桥内不再重复扫描）：

```javascript
var runner = new Function('lx','window','globalThis','global','self',
  'fetch','WebSocket','XMLHttpRequest','document','location','navigator',
  'require','process','Buffer', '"use strict";\n' + script);
runner(lx, fakeWindow, fakeGlobalThis, fakeGlobalThis, fakeGlobalThis,
  undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, undefined);
```

`window` 绑 `fakeWindow`，`globalThis`/`global`/`self` 绑 `fakeGlobalThis`，其余 9 个（fetch/WebSocket/XMLHttpRequest/document/location/navigator/require/process/Buffer）传 `undefined`；两个无原型对象均用 `Object.create(null)` 构造。与桌面一样，这只是参数遮蔽，不是安全边界（见 §7）。

### 6.3 lx.request 代理回 RN

WebView 不能跨域 `fetch`，脚本的 `lx.request` 不直接发网络，而是 `postMessage({ type:'http', ... })` 回 RN 的 `bridgeProxyFetch`，由 RN 侧 fetch 后经 `http-response` 回传。二进制 body（ArrayBuffer/TypedArray）不能过 JSON：`formData` 侧转 base64 占位对象透传。

出站校验在 `bridgeProxyFetch`：入口 `assertPublicOutboundUrl`（`@lx/core outbound-host`）+ 响应落地 URL 二次校验。但**重定向无法逐跳拦截**——RN 的 fetch 是 whatwg-fetch over XHR，`redirect:"manual"` 字段根本不生效，Android OkHttp 恒 `followRedirects(true)`：302 已真实发出，二次校验只能阻断响应数据回流到脚本，内网盲打点/端口探测不可防。彻底修复需要原生侧 `followRedirects(false)` 并逐跳校验，对齐桌面 `outbound.rs` 的 `guarded_redirect_policy`——未实施。

### 6.4 RSA-RAW BigInt

`utils.crypto.rsaEncrypt` 用 `bigint modPow` 实现 RSA 无填充加密（m^e mod n，e=65537）——WebCrypto 不支持 RAW（无填充）模式，只能手写模幂。输入右对齐，与桌面 `node-forge` RAW 一致。SPKI DER 解析提取模数 n。

### 6.5 运行时缓存

key = `id::SHA256(normalizeCustomSourceScript(script))`（移动端用 SHA256，桌面用 djb2a——移动 WebView 有 CryptoJS，桌面用快速非加密哈希即可）。

---

## 7. 安全模型

### 7.1 定位

自定义音源脚本是**主动安装的不可信代码**，当前**没有强隔离**。桌面代码注释明确宣告参数遮蔽「这不是安全边界」：任意脚本可经 `({})['cons'+'tructor']['cons'+'tructor']('return this')()` 取回真实 `globalThis`，再经 `__TAURI_INTERNALS__` 直达 IPC、读取明文凭证。移动端脚本跑在独立 WebView 内核（与 RN JS 线程有进程边界），但 WebView 配置宽松（`originWhitelist ["*"]`、`mixedContentMode "always"`、`allowFileAccessFromFileURLs`），攻击面偏大。真正隔离（独立 Worker/WebView 且不暴露 IPC）双端均未实施。威胁模型等同于用户主动安装的浏览器扩展：请勿放入不受信任的第三方脚本。

| 缓解 | 桌面 | 移动 |
|---|---|---|
| 静态扫描拒动态执行 | ❌（已移除——正则无法穷尽拼接/转义绕过，且造成隔离错觉） | ✅（RN 侧拒 `constructor.constructor`/`eval(`/`Function(` 脚本） |
| `new Function` 参数遮蔽 + 严格模式 | ✅（非边界，可绕过） | ✅（同左） |
| `Object.create(null)` 无原型全局 | ✅ | ✅ |
| 遮蔽 `fetch`/`document`/`require`/`process` 等宿主全局 | ✅（可经 constructor 链绕过） | ✅（同左） |
| HTTP 统一经 SSRF | ✅ Rust `outbound.rs`（`proxy_http_request`） | ✅ JS `outbound-host.ts`（桥代理 + musicUrl 收口） |
| WebView 进程隔离 | — | ✅（独立 WebView 内核，非 RN JS 线程，但配置宽松） |

### 7.2 SSRF 双实现契约

统一规则双端各实现一份：JS `@lx/core/outbound-host.ts`（书面定义）+ Rust `desktop/src-tauri/outbound.rs`。**两份实现手工同步，无自动化校验**，规则变更需人工逐条比对；各自带测试。

- **host 抽取（自写 RFC 3986，不信 `URL` 实现）**：authority 终止于 `/` `?` `#` 或反斜杠（WHATWG/OkHttp 在 special scheme 下把 `\` 规范化为 `/`）；userinfo 取 authority 内**最后一个 `@`** 之前的部分；IDNA 句点变体（`。．｡`）归一为 `.`；百分号解码恰好一次（畸形序列/解码出分隔符即拒）；`inet_aton` 全形态还原（`2130706433`/`0177.0.0.1`/`0x7f.0.0.1`/`127.1`）；IPv6 支持 `::ffff:` 尾部点分 v4。形似 IPv4/IPv6 但解析失败一律按拒绝处理（fail-closed）。
- **拦截范围（双端一致）**：localhost/`.localhost`/`.local`、回环/私有/链路本地/CGNAT(100.64/10)/未指定/多播/广播/文档示例地址，IPv4-mapped IPv6 还原后再判；**显式不做 DNS 解析后校验**（见 §7.3）。
- **桌面 `outbound.rs`（执行）**：固定白名单域名走 `@tauri-apps/plugin-http` 直连（静态 scope）；用户可配置的动态目标走 `proxy_http_request`，`assert_public_url` + `is_blocked_v4` + `guarded_redirect_policy`（每跳复用同一判定，≤10 跳），响应体上限 16MB，超时上限 60s。
- **移动（执行）**：JS 侧直接用 `assertPublicOutboundUrl`（桥代理 `bridgeProxyFetch`、musicUrl 收口、WebDAV）。**重定向只能校验最终落地 URL**（OkHttp 恒跟随，见 §6.3）。WebDAV 额外强制 `https://`（`webdavUrlModel.assertHttpsWebdavUrl`，Basic 认证含明文凭证）。

### 7.3 DNS 重绑定

双端**显式不做 DNS 解析后校验**。解析到内网的域名（DNS rebinding）不在拦截范围——该场景要求用户主动填入恶意地址或安装恶意音源，与「用户自带脚本同权」的既有威胁模型一致，不在此层处理。

---

## 8. 版本管理

### 8.1 脚本归一化与版本比较

`@lx/core` 的 `custom-source.ts` 提供双端共享的版本工具：

- **`normalizeCustomSourceScript`**：`CRLF→LF` + `trim`，用于比较脚本内容是否实质变化（更新检测时忽略行尾差异）。
- **`normalizeCustomSourceVersion`**：去掉前导 `v`，trim。
- **`compareCustomSourceVersions`**：semver-like 按数字段比较（`split('.')` → `parseInt` → 逐段比，缺失段补 0）。

### 8.2 远端更新检测

`checkCustomSourceRemoteUpdate`：
1. 从 `homepage` 取远端脚本 URL（经 `normalizeCustomSourceRemoteUrl` 改写 GitHub/Gitee blob→raw）。
2. `fetchRemoteScript` 拉远端脚本。
3. 解析本地与远端头部版本号。
4. 双方都有版本号时用 `compareCustomSourceVersions` 比较，远端更高则上报。
5. 一方无版本号时用 `normalizeCustomSourceScript` 比较脚本内容是否变化。

上层入口 `checkCustomSourceUpdate`（双端）：先跑一次测试（`testCustomSource`）捕获脚本自身 `send(updateAlert)`，无则再走上面的远端版本/内容比对。

### 8.3 自动检查节流

- **24h 自动检查节流**：更新检查带 24 小时节流，避免频繁请求远端。
- **concurrency = 2**：并发检查上限 2，控制对远端脚本仓库的请求压力。

---

## 9. 已移除或不存在

- 没有外部网关配置项 / 独立网关 provider / Rust 网易云代理模块 / 音乐 API 网关 IPC 命令。
- 没有「外部网关优先」或「外部网关独占」的播放模式。
- 没有同名搜索转译（用歌名+首位歌手去网易云搜同名曲顶上）——gdstudio 搜索结果不带 `interval`，`isSameSong` 时长校验永远被跳过，会匹配到 Live/翻唱/重录/同名不同曲；且即便匹配准确，用户点 QQ 音乐曲目却播网易云版本，元数据与音质都对不上。
- 桌面沙箱的静态正则黑名单已移除（曾拒 `constructor.constructor`/`eval(`/`Function(`，因无法穷尽拼接/转义绕过，且让人误以为存在隔离）；移动端 RN 侧保留静态扫描。
- 真正的脚本隔离（独立 Worker/WebView 且不暴露 IPC）未实施。

---

## 相关文件索引

| 模块 | 桌面 | 移动 | 共享 |
|---|---|---|---|
| 内置网关客户端 | `desktop/src/services/builtinMusicApiClient.ts`、`builtinMusicApiModel.ts` | `apps/mobile/src/services/musicApi.ts` | `packages/core/src/mobile-api.ts` |
| 音质阶梯/竞速 | — | — | `packages/core/src/playback-quality.ts` |
| 试听判定 | `desktop/src/services/playback/playbackResolver.ts`、`playerEngine.ts` | `apps/mobile/src/services/playerService.ts`、`playerStore.ts` | `packages/core/src/stream-integrity.ts` |
| 源注册 | `desktop/src/services/sources/sourceService.ts` | — | `packages/core/src/sources/registry.ts` |
| CustomSourceContext 契约（未接线） | — | — | `packages/core/src/sources/custom-source.ts` |
| 版本管理 | — | — | `packages/core/src/custom-source.ts` |
| 出站主机判定（书面定义） | — | — | `packages/core/src/outbound-host.ts` |
| 自定义源运行时 | `desktop/src/services/customSourceRuntime.ts` | `apps/mobile/src/services/customSourceRuntime.ts` | — |
| 出站 SSRF（执行） | `desktop/src-tauri/src/outbound.rs` | `@lx/core outbound-host.ts`（调用点：`customSourceRuntime.ts`、`webdavUrlModel.ts`） | — |
| 脚本桥 | — | `apps/mobile/src/services/customSourceWebViewBridge.tsx` + `apps/mobile/android/app/src/main/assets/lx_bridge/` | — |
| 官方直连 provider | `desktop/src/services/sources/wyProvider.ts`、`txProvider.ts` | — | — |
| 播放轮次竞速 | `desktop/src/services/playback/playbackResolver.ts`（+ `builtinNeteaseBackend`/`customSourceBackend`） | `apps/mobile/src/services/playerService.ts` | — |
