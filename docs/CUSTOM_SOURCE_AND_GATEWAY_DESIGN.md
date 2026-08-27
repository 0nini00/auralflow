# 自定义音源与网关设计

本文记录 AuralFlow 音源解析的完整架构：从官方直连到网关、自定义源与 B 站的多层级关系，以及双端（桌面 / 移动）在沙箱执行、安全模型与版本管理上的实现差异。所有描述均与当前代码状态对齐。

---

## 1. 设计目标

1. **多源可用性**：单一音源不可用时仍能播放。官方接口、免 key 网关、用户自定义脚本、B 站四层叠加，互为兜底而非串行依赖。
2. **音质择优**：不因某条链路慢就降级到低音质。在有限时间窗口内并发竞速，优先返回更高音质的结果。
3. **用户可扩展**：导入 LX Music 自定义音源脚本即可接入新平台，无需改代码、无需 API key。
4. **安全可控**：用户脚本是主动安装的不可信代码，沙箱尽力隔离但不承诺强隔离；所有出站 HTTP 统一经 SSRF 校验，桌面走 Rust、移动走 JS，两份实现契约一致。
5. **双端一致**：音质阶梯、竞速窗口、版本比较、出站主机判定等纯逻辑收敛到 `@lx/core`，桌面与移动共享同一真相源，仅 I/O 边界不同。

---

## 2. 音源层级与优先级

解析按层级组织，各层职责独立、并发参与竞速：

| 层级 | 实现 | 职责 | 入口 |
|---|---|---|---|
| 官方直连 | `wyProvider`（weapi/eapi 加密）、`txProvider`（musicu 接口） | 用平台官方协议直取播放 URL，作为所有竞速通道失败后的兜底，不参与竞速 | `sourceService.ts` 注册到 `SourceResolver` |
| gdstudio 网关 | `createBuiltinMusicApiClient(fetchText)` | 免 key 聚合网关（`music-api.gdstudio.xyz`），通过 DI 注入 `fetchText`，双端各自实现网络层 | `@lx/core mobile-api.ts` |
| LX 自定义源 | `CustomSourceContext` 契约 + 沙箱 | 用户导入的 LX Music 脚本，沙箱内执行，经 `request`/`log`/`utils` 契约与宿主交互 | `customSourceRuntime.ts`（桌面）/ `lx_bridge`（移动） |
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

整条链有 **25s 总预算**。内置音乐 API 请求优先用浏览器 `fetch`（桌面），超时或不可用时回退 Tauri HTTP plugin；移动端经 `fetchText` DI 注入 RN 网络层。

### 3.2 质量轮次表

音质阶梯与轮次划分由 `@lx/core` 的 `buildPlaybackQualityTiers` 统一定义（`packages/core/src/playback-quality.ts`）：

- 阶梯（低→高）：`128k → 192k → 320k → flac → flac24bit`
- 首轮 = 不低于用户选定音质的全部档位（从高到低同时竞速）
- 之后每轮下调一档（单档），更高档已在首轮试过不重复

```
选 320k -> [["flac24bit","flac","320k"], ["192k"], ["128k"]]
选 128k -> [["flac24bit","flac","320k","192k","128k"]]
```

### 3.3 竞速窗口

每轮内两个通道并发：

- **通道 A — 内置网关**：内部按音质从高到低顺序试，第一个成功即当前最高可用档。
- **通道 B — 自定义音源**：已启用音源 × 本轮音质，全组合并发。

两通道并发取音质最高的成功结果。首个成功结果开启 **800ms 升级窗口**（`DEFAULT_QUALITY_UPGRADE_WINDOW_MS`）：窗口内有更高档就替换，命中本轮最高档（ceiling）则立即定稿（settle）。此逻辑由 `raceForBestQuality` 实现，两层竞速（通道之间、单通道内音源×音质之间）共用同一个 800ms 值，各层独立计时不叠加。

### 3.4 关键约束

- **backend 不跨档降级**：降级链由轮次表统一负责，否则用户选无损时首轮就可能拿到 128k。
- **quality 一律是音质标签**：`320k` / `flac`，网关回传的 br 数字串（`320`/`740`/`999`）在 backend 出口归一化；持久化缓存 key 按标签匹配，不归一化则缓存永不命中。
- **LX 自定义源不支持 192k**：运行时白名单只有 `128k/320k/flac/flac24bit`，该轮对自定义源快速失败，由网关通道承担。
- **网关不做跨源替代**：tx 曲目缺 `gateway` 元数据时（官方直连搜索结果都缺）网关直接失败，由自定义源用真实 songmid 解析。

---

## 4. `@lx/core` 相关模块

纯逻辑收敛在 `packages/core/src`，双端共享，无 I/O 依赖。

### 4.1 mobile-api.ts — 内置网关客户端

- **`createBuiltinMusicApiClient(fetchText)`**：DI 注入 `fetchText`（URL→文本），双端各自实现网络层（桌面用 `fetch`/Tauri HTTP，移动用 RN fetch），核心逻辑不耦合具体 HTTP 实现。
- **搜索空数组不算成功**：`searchSongs` 对非数组响应（HTML 错误页/限流页）抛错而非返回空，避免竞速把「快速空结果」当成功吞掉其它网关的真实数据。
- **`createRacingBuiltinMusicApiClient`**：多网关并发竞速。`searchSongs` 用 `Promise.allSettled` 取首个非空结果（全部为空才返回空）；`resolveUrl`/`getLyric` 用首个 resolve 的结果，单网关退化为直通。
- **`mapBuiltinMusicApiSong`**：把网关响应映射为 `MusicInfo`，携带 `gateway` 元数据（真实 source/trackId/lyricId/picId）。

### 4.2 resolver.ts — 源轮转

- `SourceResolver` 实现唯一的 `source-rotation` 解析模式：按 `sourceOrder` 轮询，把歌曲自身 source 提到首位。
- `DEFAULT_SOURCE_POLICY`：`sourceOrder: ["wy","tx"]`，`timeoutPerSource: 8000`，`crossSourceMatchThreshold: 0.85`。
- 自定义源经 `createCustomSourceProvider` 包装为 `MusicSource` 注册进 registry，参与轮询但不在 UI 显示为新来源。

### 4.3 CustomSourceContext 契约

`packages/core/src/sources/custom-source.ts` 定义沙箱向脚本暴露的上下文契约：

```typescript
interface CustomSourceContext {
  request: (options: RequestOptions) => Promise<any>;
  log: (msg: string) => void;
  utils: {
    md5: (input: string) => string;
    sleep: (ms: number) => Promise<void>;
    randomUserAgent: () => string;
  };
}
```

- **平台注入沙箱**：宿主实现 `request`/`log`/`utils`，脚本只能通过 `ctx` 访问能力，不直接接触宿主全局。
- `createCustomSourceProvider(script, context)` 把用户脚本包装成 `MusicSource`，注册后参与轮询。
- 脚本声明 `capabilities`（search/url/lyric/playlist），宿主据此推断支持的搜索类型。

### 4.4 raceForBestQuality

`packages/core/src/playback-quality.ts` 的 `raceForBestQuality<T>`：

- 全部候选并发，先成功者暂存为 best。
- 首个成功结果启动 800ms `upgradeWindowMs` 定时器。
- 窗口内若有更高 rank 的结果到达则替换 best；达到 `ceiling`（默认阶梯顶端 flac24bit）或全部 settled 则立即 settle。
- 失败的候选不影响其余；全部失败才抛聚合错误。
- 纯竞速会让音质随机漂移，直接等全部返回会被慢源拖住——窗口机制是二者的折中。

---

## 5. 桌面实现 — `customSourceRuntime.ts`（776 行）

桌面在 Tauri WebView 内用 `new Function` 执行用户脚本，多层缓解构造安全边界。

### 5.1 沙箱构造

```typescript
new Function('lx','window','globalThis','self','top','parent','frames',
  'fetch','WebSocket','XMLHttpRequest','document','location','navigator',
  'require','process','Buffer',
  '"use strict";\n' + script)
```

- **无原型对象承载全局**：`fakeWindow`/`fakeGlobalThis` 用 `Object.create(null)` 构造，无原型链，`window.constructor` 为 `undefined`，切断经属性链拿到 `Function` 构造器的逃逸路径。
- **静态正则拒动态执行**：`/constructor\s*\.\s*constructor|\.constructor\s*\(|\beval\s*\(|\bFunction\s*\(/` 命中即拒。
- **严格模式**：`"use strict"` 使函数体内 `this` 为 `undefined`，`this.__TAURI_INTERNALS__` 这类经全局对象直达 IPC 的逃逸直接抛错。
- **宿主全局传 `undefined`**：`self`/`top`/`parent`/`frames`/`fetch`/`document`/`location`/`navigator`/`require`/`process`/`Buffer` 均传 `undefined`，阻断经这些别名回到真实全局对象。

### 5.2 HTTP 代理与 SSRF

- 脚本的 `lx.request` 不直接 `fetch`，经 `runHttpRequest` → `outboundRequest` → Rust 侧 `proxy_http_request`（`outbound.rs`）。
- **SSRF 每跳验证**：`assert_public_url` + `is_blocked_v4`（含手动 CGNAT 100.64/10）+ `guarded_redirect_policy`（每跳复用同一判定，≤10 跳）。所有对外 reqwest client 都挂上该策略。
- **cancel 仅设 flag**：请求发出后无法真正中止，cancel 只丢弃回调；超时上限 60s。
- 拒绝 localhost/`.local`、回环/私有/链路本地/CGNAT/未指定/多播/广播/文档示例地址，IPv4-mapped IPv6 先还原再判。

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
- **`toOldMusicInfo`**：把 `MusicInfo` 映射为 lx 协议格式。tx 的 `songmid`/`songId`/`albumMid`/`strMediaMid` 分别保留——`strMediaMid` 用于拼 `M500{mid}.mp3`/`F000{mid}.flac`，`songmid` 与 `songId` 是两个不同的值不能都填 `music.id`。

### 5.5 updateAlert 流

- 脚本通过 `lx.send('updateAlert', { log, updateUrl })` 上报更新提示。
- `normalizeUpdateAlert`：`log` 截断到 1024 字符；`updateUrl` 仅接受 `http(s)://` 且 ≤1024 字符。
- 运行时上浮：仅当没有 waiter 在等时才回调消费方（避免同一 alert 双份写入）；test/check 流程通过 `waitForUpdateAlert` 消费。
- `checkCustomSourceRemoteUpdate` → `normalizeCustomSourceRemoteUrl`：GitHub/Gitee 的 `blob`/`raw` 路径自动改写为 raw 直链。

---

## 6. 移动实现 — WebView `lx_bridge`

移动端 RN 的 Hermes 引擎**不支持 `new Function`**，用户脚本无法在 JS 线程执行，改用隐藏 WebView 作为脚本运行时。

### 6.1 桥结构

- `assets/lx_bridge/index.html`（301 行）：桥主逻辑，按 runtime id（rid）为每个脚本建立独立 `lx` 闭包。
- `vendor.js`（2510 行）：预置 `CryptoJS` + `pako`，挂到 `window.__lxVendor`，供脚本的 `utils` 使用。
- 协议为 `window.ReactNativeWebView.postMessage` 双向 JSON：RN→WV `run`/`request`/`http-response`/`dispose`，WV→RN `ready`/`inited`/`updateAlert`/`error`/`http`/`request-response`。

### 6.2 沙箱构造

与桌面同构的 `new Function` 参数遮蔽，WebView 内核无 Hermes 限制：

```javascript
var runner = new Function('lx','window','globalThis','global','self',
  'fetch','WebSocket','XMLHttpRequest','document','location','navigator',
  'require','process','Buffer', '"use strict";\n' + script);
runner(lx, fakeWindow, fakeGlobalThis, fakeGlobalThis, fakeGlobalThis,
  undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, undefined);
```

同样用 `Object.create(null)` 构造 `fakeWindow`/`fakeGlobalThis`。

### 6.3 lx.request 代理回 RN

WebView 不能跨域 `fetch`，脚本的 `lx.request` 不直接发网络，而是 `postMessage({ type:'http', ... })` 回 RN，由 RN 侧 fetch 后经 `http-response` 回传。二进制 body（ArrayBuffer/TypedArray）不能过 JSON：脚本侧序列化为字符串后再透传。

### 6.4 RSA-RAW BigInt

`utils.crypto.rsaEncrypt` 用 `bigint modPow` 实现 RSA 无填充加密（m^e mod n，e=65537）——WebCrypto 不支持 RAW（无填充）模式，只能手写模幂。输入右对齐，与桌面 `node-forge` RAW 一致。SPKI DER 解析提取模数 n。

### 6.5 运行时缓存

key = `id::SHA256(script)`（移动端用 SHA256，桌面用 djb2a——移动 WebView 有 CryptoJS，桌面用快速非加密哈希即可）。

---

## 7. 安全模型

### 7.1 定位

自定义音源脚本是 **L1 尽力而为隔离**，**非强隔离**。威胁模型等同于用户主动安装的浏览器扩展：请勿放入不受信任的第三方脚本。多层缓解而非绝对边界：

| 缓解 | 桌面 | 移动 |
|---|---|---|
| 静态正则拒 `constructor.constructor`/`eval`/`Function(` | ✅ | ❌（WebView 桥当前未做静态扫描） |
| `new Function` 参数遮蔽 + 严格模式 | ✅ | ✅ |
| `Object.create(null)` 无原型全局 | ✅ | ✅ |
| 宿主全局传 `undefined` 阻断 IPC/真实全局 | ✅（`__TAURI_INTERNALS__`） | ✅ |
| HTTP 统一经 SSRF | ✅ Rust `outbound.rs` | ✅ JS `outbound-host.ts` |
| WebView 进程隔离 | — | ✅（脚本跑在独立 WebView，非 RN JS 线程） |

### 7.2 SSRF 双实现契约

双端共用 `outbound-host.ts` 的书面规则定义，但各自实现：

- **移动 `outbound-host.ts`（JS）**：`isBlockedOutboundHost` 阻 localhost/`.local` + 私有/环回/链路本地/CGNAT(100.64/10)/文档/多播 IPv4 + IPv6（`::1`/`::`/`fc00::7`/`fe80::10`/`ff00::8` + IPv4-mapped 降级）；`parseNumericIpv4` 恢复十进制 IP（RN 的 URL polyfill 不保证做 WHATWG 规范化）；**显式不做 DNS**（DNS 重绑定超出范围，已文档化）。
- **桌面 `outbound.rs`（Rust）**：`assert_public_url` + `is_blocked_v4`（含手动 CGNAT）+ `guarded_redirect_policy`（每跳验证 ≤10）+ 附着所有 reqwest client。
- 规则变更时双端必须同步，两份实现各自带测试。

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

### 8.3 自动检查节流

- **24h 自动检查节流**：更新检查带 24 小时节流，避免频繁请求远端。
- **concurrency = 2**：并发检查上限 2，控制对远端脚本仓库的请求压力。

---

## 9. 已移除或不存在

- 没有外部网关配置项 / 独立网关 provider / Rust 网易云代理模块 / 音乐 API 网关 IPC 命令。
- 没有「外部网关优先」或「外部网关独占」的播放模式。
- 没有同名搜索转译（用歌名+首位歌手去网易云搜同名曲顶上）——gdstudio 搜索结果不带 `interval`，`isSameSong` 时长校验永远被跳过，会匹配到 Live/翻唱/重录/同名不同曲；且即便匹配准确，用户点 QQ 音乐曲目却播网易云版本，元数据与音质都对不上。

---

## 相关文件索引

| 模块 | 桌面 | 移动 | 共享 |
|---|---|---|---|
| 内置网关客户端 | — | — | `packages/core/src/mobile-api.ts` |
| 音质阶梯/竞速 | — | — | `packages/core/src/playback-quality.ts` |
| 源轮转 | — | — | `packages/core/src/sources/resolver.ts` |
| CustomSourceContext 契约 | — | — | `packages/core/src/sources/custom-source.ts` |
| 版本管理 | — | — | `packages/core/src/custom-source.ts` |
| 出站主机判定（书面定义） | — | — | `packages/core/src/outbound-host.ts` |
| 自定义源运行时 | `desktop/src/services/customSourceRuntime.ts` | `apps/mobile/src/services/customSourceRuntime.ts` | — |
| 出站 SSRF（执行） | `desktop/src-tauri/src/outbound.rs` | `apps/mobile/.../outboundHttp`（JS 实现） | — |
| 脚本桥 | — | `apps/mobile/android/app/src/main/assets/lx_bridge/` | — |
| 官方直连 provider | `desktop/src/services/sources/wyProvider.ts`、`txProvider.ts` | — | — |
