# 自定义音源、音源轮询与 API 网关重构设计

> 对应 `REFACTOR_PLAN.md` 中 Phase 1 的 Provider 抽象部分。本文把“自定义音源、多音源轮询、音乐 API 网关”三件事统一放到 `packages/core/sources/` 架构下解决。

---

## 1. 现状与问题

当前 `desktop/` 里的实现大致是：

1. 内置 wy/tx 直接在业务代码里写网络请求，没有统一接口。
2. 自定义音源脚本格式私有，执行环境随项目绑定，迁移到新框架要重写适配层。
3. “音源轮询”逻辑散落在播放器/搜索/下载多个地方，规则不一致。
4. API 网关一般是外部 HTTP 服务，没有客户端抽象，配置和切换较脏。

## 2. 重构目标

1. **统一源接口**：一首歌曲、一个歌单，无论从 wy/tx 还是自定义脚本获取，都走同一套 `MusicSource`。
5. **UI 只呈现两个来源**：应用界面只展示“网易云（wy）”和“QQ 音乐（tx）”。自定义音源和 API 网关是后端解析机制，不是新的用户可见来源。
2. **自定义脚本可移植**：脚本只依赖有限 API，换到 V2 后用户脚本能基本无缝继承。
3. **轮询可配置**：哪些源参与、先后顺序、超时重试、跨源匹配策略，全部集中到一个 `SourceResolver` 里。
4. **网关显式化**：把网关当作“传输层客户端”，每个 provider 可以决定是否走网关，而不是在代码里硬耦合。

---

## 3. 核心抽象

### 3.1 MusicSource 接口

已经定义在 `packages/core/sources/musicSource.ts`。

```ts
export interface MusicSource {
  readonly id: string;
  readonly name: string;
  readonly supportedSearchTypes: SearchType[];

  search(keyword: string, type: SearchType, page?: number): Promise<SearchResult>;
  getMusicUrl(music: MusicInfo, quality?: string): Promise<string | null>;
  getMusicDetail(music: MusicInfo): Promise<MusicInfo>;
  getLyric(music: MusicInfo): Promise<LyricResult>;
  getPlaylistDetail(playlist: PlaylistInfo): Promise<MusicInfo[]>;
}
```

### 3.2 新增：SourceResolver

所有“请求 URL 或搜索结果时按顺序尝试多个源”的逻辑都不应出现在 UI，而是交给 `SourceResolver`。

```ts
export interface SourceResolutionPolicy {
  /** 解析模式 */
  mode: "source-rotation" | "gateway-first" | "gateway-only";
  /** 参与轮询的源 ID 列表，固定至少包含 ['wy', 'tx']，可追加自定义源 */
  sourceOrder: string[];
  /** 每个源超时时间（毫秒） */
  timeoutPerSource: number;
  /** 每个源重试次数 */
  retryPerSource: number;
  /** 跨源匹配相似度阈值，0~1；大于 0 表示自动开启跨源匹配 */
  crossSourceMatchThreshold: number;
  /** 音质偏好列表，如 ['flac', '320k', '128k'] */
  qualityPreference: string[];
}
```

```ts
export interface SourceResolver {
  resolveMusicUrl(music: MusicInfo): Promise<ResolvedUrl | null>;
  resolveLyric(music: MusicInfo): Promise<LyricResult>;
  resolveSearch(keyword: string, type: SearchType): Promise<SearchResult>;
  resolvePlaylist(playlist: PlaylistInfo): Promise<MusicInfo[]>;
}
```

---

## 4. 自定义音源脚本

### 4.1 脚本格式

自定义脚本导出一个符合 `CustomSourceScript` 约定的对象。它比一般 provider 更简单，因为我们提供一个封装层帮它补齐成完整 `MusicSource`。

```ts
// custom-source-example.js
export default {
  id: "my_custom",
  name: "我的自定义源",
  version: "1.0.0",
  author: "xxx",
  homepage: "https://example.com",

  // 声明支持的能力
  capabilities: ["search", "url", "lyric", "playlist"],

  async search({ keyword, type, page }, { request, log }) {
    const result = await request({
      url: "https://gateway.example.com/search",
      params: { keyword, type, page },
    });
    return result.data;
  },

  async getUrl({ music, quality }, { request }) {
    const result = await request({
      url: "https://gateway.example.com/url",
      params: { name: music.name, artist: music.singer, quality },
    });
    return result.data.url;
  },

  async getLyric({ music }, { request }) {
    const result = await request({
      url: "https://gateway.example.com/lyric",
      params: { name: music.name },
    });
    return { lyric: result.data.lyric };
  },

  async getPlaylistDetail({ playlist }, { request }) {
    const result = await request({
      url: "https://gateway.example.com/playlist",
      params: { id: playlist.id },
    });
    return result.data.songs;
  },
};
```

### 4.2 沙箱执行环境

自定义脚本运行在 **独立于主业务的 Web Worker** 中，并注入一个受限的 `context`：

```ts
export interface CustomSourceContext {
  /** 受控的 HTTP 请求 */
  request: (options: RequestOptions) => Promise<any>;
  /** 轻量日志 */
  log: (msg: string) => void;
  /** 工具函数 */
  utils: {
    md5: (s: string) => string;
    randomUserAgent: () => string;
    sleep: (ms: number) => Promise<void>;
  };
}
```

**禁止暴露**：`window`、`document`、`localStorage`、`eval`、文件系统、原生能力。

加载流程：

1. 用户把 `.js` 脚本放到指定目录（或粘贴到设置里）。
2. Rust 端读取文件，持久化到 SQLite。
3. 启动时主进程把脚本字符串传给渲染进程的 custom-source worker。
4. worker 内用 `new Function` 或 ES module loader 实例化脚本，包装成 `CustomSourceProvider`。
5. 该 provider 注册到 `SourceRegistry`，和 wy/tx 平起平坐。

### 4.3 自定义脚本转 MusicSource

```ts
export function createCustomProvider(
  script: CustomSourceScript,
  context: CustomSourceContext
): MusicSource {
  return {
    id: script.id,
    name: script.name,
    supportedSearchTypes: inferSearchTypes(script.capabilities),

    async search(keyword, type, page) {
      if (!script.search) return {};
      return script.search({ keyword, type, page }, context);
    },

    async getMusicUrl(music, quality) {
      if (!script.getUrl) return null;
      return script.getUrl({ music, quality }, context);
    },

    // ... 其他方法同理
  };
}
```

---

## 5. 音源轮询 / fallback 设计

### 5.1 请求 URL 时的轮询流程

```
resolveMusicUrl(music)
  ├─ 如果 music.source 在 sourceOrder 中
  │    ├─ 先按音质偏好 iterate
  │    └─ 同源失败 → 重试 → 跨源匹配（可选）
  ├─ 跨源匹配时
  │    ├─ 用歌名+歌手+时长搜索候选
  │    ├─ 按相似度/时长差距排序
  │    └─ 取最佳候选URL返回
  └─ 全部失败返回 null
```

### 5.2 搜索时的聚合

用户搜索“周杰伦 晴天”时：

1. 同时调用多个源（或按 `sourceOrder` 串行，取决于性能）。
2. 每个源返回自己的 `MusicInfo[]`。注意 ID 是源内 ID，不同源之间不能混用。
3. `SourceResolver` 做归一化：
   - 按 `name + singer + albumName` 去重。
   - 对于重复歌曲，合并来源信息（如显示 “wy/tx” 都有）。
   - 保留每个来源的源内 ID，用于后续播放时回到对应源。
4. UI 显示统一结果。

### 5.3 返回结果增加 ` ResolvedSource`

解决 URL 到底来自哪个源、音质如何、是否走网关：

```ts
export interface ResolvedUrl {
  url: string;
  sourceId: string;
  quality: string;
  /** 原始 provider 返回的额外信息，如签名过期时间 */
  meta?: Record<string, any>;
  /** 是否来自网关 */
  viaGateway?: boolean;
}
```

---

## 6. API 网关

### 6.1 网关的定位

**网关不是音源，而是“传输客户端”**。它可以为不同音源提供统一的鉴权、缓存、代理和协议转换。

V2 把网关作为与“源轮询”并列的第二种 URL 解析机制。设置里可选择模式：

| 模式 | 说明 |
|---|---|
| `source-rotation` | 只用 `wy` / `tx` / 自定义脚本轮询 |
| `gateway-first` | 先请求网关，失败降级到源轮询 |
| `gateway-only` | 只走网关 |

### 6.2 GatewayClient 抽象

```ts
export interface GatewayConfig {
  baseUrl: string;
  key?: string;
  timeout: number;
  /** 是否对请求结果做本地缓存 */
  cacheEnabled: boolean;
}

export interface GatewayClient {
  call<T>(method: string, params: Record<string, any>): Promise<T>;
  isAvailable(): Promise<boolean>;
}
```

### 6.3 GatewayProvider

网关模式下，把网关包装成一个独立的 provider：

```ts
class GatewayProvider implements MusicSource {
  constructor(private gateway: GatewayClient) {}

  async getMusicUrl(music, quality) {
    const url = await this.gateway.call("url", {
      name: music.name,
      artist: music.singer,
      quality,
    });
    return url;
  }
}
```

`SourceResolver` 根据当前模式决定先调用 `GatewayProvider` 还是 `wy/tx` provider。网关返回的歌曲仍然按 `wy` 或 `tx` 标记 UI 来源；若网关未返回来源，则使用默认标签 `wy`（可配置）。

### 6.4 网关可以做的事

- 统一处理 Cookie/Session。
- 对源站做反代，绕过地区或 CORS 限制。
- 集中签名、加密、限流。
- 缓存高频请求（歌单详情、歌词）。

Rust 端如果提供本地网关，也可以把一部分逻辑下沉到 Rust，前提是用户选择开启。

---

## 7. 数据流示例

### 7.1 播放一首歌时的 URL 解析

```
用户点击播放
  ↓
playerService.play(music)
  ↓
sourceResolver.resolveMusicUrl(music, policy)
  ↓
  ├─ wyProvider.getMusicUrl(music, 'flac') → 失败
  ├─ wyProvider.getMusicUrl(music, '320k') → 失败
  ├─ 跨源匹配：txProvider.search(...)
  │     └─ 找到相似歌曲 txMusic
  │     └─ txProvider.getMusicUrl(txMusic, 'flac') → 成功
  ↓
返回 ResolvedUrl { url, sourceId: 'tx', quality: 'flac' }
  ↓
playerEngine 用 HTMLAudioElement 加载 url
```

### 7.2 自定义脚本作为源轮询的一个环节

```
sourceOrder = ['wy', 'tx', 'my_custom']

resolveMusicUrl(music)
  ├─ wy → fail
  ├─ tx → fail
  ├─ my_custom Provider.getMusicUrl(music, quality)
  │     └─ worker 中执行用户脚本
  │     └─ script.getUrl({ music, quality }, context)
  │     └─ context.request(...) 发请求
  │     └─ 返回 url
  ↓
ResolvedUrl { url, sourceId: 'wy' | 'tx', viaGateway?: false }
```

> 自定义脚本不增加新的 UI 来源标签。最终 UI 仍然只展示 `wy` 或 `tx`。

---

## 8. 安全与隔离

1. **自定义脚本默认禁用**：用户必须手动开启并同意风险。
2. **运行环境隔离**：Web Worker + 受限 context，无 DOM/本地存储/原生能力。
3. **请求白名单**：脚本只能发起 HTTP/HTTPS 请求，无法访问局域网敏感端口。
4. **超时控制**：每个脚本调用都有硬性超时，避免死循环或长耗时。
5. **错误隔离**：某个 provider/脚本崩溃不影响其他源和主应用。
6. **签名/校验（可选）**：未来支持对脚本做 hash 校验或签名验证。

---

## 9. 迁移建议

### 从旧版自定义脚本迁移

旧版脚本格式一般是导出若干函数：

```js
export const apis = {
  'music/song/url': async (...) => {...},
  'music/song/info': async (...) => {...},
}
```

V2 提供兼容层：

```ts
export function adaptLegacyCustomScript(script: LegacyScript): CustomSourceScript {
  return {
    id: script.id,
    name: script.name,
    capabilities: ['url', 'lyric'],
    getUrl: ({ music, quality }) =>
      script.apis['music/song/url'](music, quality),
    getLyric: ({ music }) =>
      script.apis['music/song/lyric'](music),
  };
}
```

这样旧脚本不需要重写，只需要加载进 V2 的沙箱即可。

### 内置源迁移

wy/tx 原有代码先找出来“纯 API 逻辑”和“Electron 依赖逻辑”：

- **纯 API 逻辑** → 移到 `packages/core/sources/{wy,tx}/api.ts`。
- **HTTP 客户端配置** → 放到 `packages/core/http/HttpClient.ts`。
- **Cookie/代理等桌面能力** → 通过 `tauri-bridge` 注入，provider 不直接依赖。

---

## 10. 结论

> **不要把自定义音源做成“插件商店”**，而是把它当作一个 `MusicSource` provider 的实现；通过 `SourceResolver` 统一管理音源轮询和 fallback；把 API 网关抽象成可配置的传输层客户端，让 provider 按需使用。

这样设计的好处：

1. 内置源、自定义脚本、网关三者互不污染。
2. 轮询规则集中可配置，不再散落在各页面。
3. 旧版自定义脚本可以通过兼容层迁移。
4. 未来即便要做真正的插件系统，也只需要在现有 provider 接口上包一层即可。
