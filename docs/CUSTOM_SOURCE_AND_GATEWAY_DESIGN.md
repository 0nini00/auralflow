# 自定义音源与内置音乐 API 当前实现

本文记录当前代码状态。旧外部网关方案已经移除，实际实现只保留源轮询和内置音乐 API 元数据解析。

## 当前边界

- UI 来源只展示 `wy`、`tx` 和 `local`。
- `packages/core` 只保留 `source-rotation` 解析模式。
- `MusicInfo.gateway` 表示内置音乐 API 的真实来源和曲目 ID，是播放/歌词解析元数据，不是独立 UI 来源。
- Rust 后端不提供网易云网关代理；网易云账号和二维码登录请求由前端 `wyAccountService.ts` 通过 weapi/eapi 加密和 Tauri HTTP plugin 发起。

## 相关文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/sources/types.ts` | `MusicInfo`、`MusicSource` 和 `MusicGatewayInfo` 类型 |
| `packages/core/src/sources/resolver.ts` | `SourceResolver` 和 `source-rotation` 策略 |
| `packages/core/src/playback-quality.ts` | 音质阶梯、分轮次表和择优竞速（双端共用的唯一真相源） |
| `src/services/sources/sourceService.ts` | 注册 `wyProvider`、`txProvider` |
| `src/services/search/` | 搜索聚合、缓存和元数据合并 |
| `src/services/builtinMusicApiClient.ts` | 内置音乐 API 请求 |
| `src/services/builtinMusicApiModel.ts` | 内置 API URL 构造和结果映射 |
| `src/services/playback/playbackResolver.ts` | 播放 URL 解析轮次编排 |
| `src/services/playback/customSourceBackend.ts` | 自定义音源播放解析 |
| `src/services/customSourceRuntime.ts` | 自定义音源脚本解析、测试和更新检测 |

## 播放解析流程

内置网关与自定义音源是**并发竞速**关系，不是先后兜底关系。音质分轮次，
轮内竞速、轮间降档：

```text
用户播放歌曲
  -> resolvePlaybackUrl
  -> 命中持久化缓存则直接返回
  -> bili 走独立分支（无音质分层，不进竞速）
  -> 按轮次表逐轮竞速：
       首轮 = 不低于用户所选音质的全部档位（例：选 320k -> flac24bit + flac + 320k）
       之后每轮下调一档（192k -> 128k）
     每轮内：
       通道 A 内置网关   （内部按音质从高到低顺序试，第一个成功即最高可用档）
       通道 B 自定义音源 （已启用音源 × 本轮音质，全组合并发）
       两通道并发，取音质最高的成功结果；首个成功结果开启 800ms 升级窗口，
       窗口内有更高档就换，命中本轮最高档则立即定稿
  -> 所有轮次都失败 -> 官方直连 provider 兜底（不参与竞速）
  -> 返回 PlaybackResolvedUrl 给 playerEngine
```

约束：

- backend 内部**不得**自行降到本轮之外的档位。降级链由轮次表统一负责，
  否则用户选无损时首轮就可能拿到 128k。
- 流转中的 `quality` 一律是音质标签（`320k` / `flac`），网关回传的 br 数字串
  在 backend 出口归一化——持久化缓存 key 按标签匹配，不归一化则缓存永不命中。
- LX 自定义音源不支持 `192k`（运行时白名单只有 `128k/320k/flac/flac24bit`），
  该轮对自定义音源通道会快速失败，由网关通道承担。
- 网关通道**不做跨源替代**。tx 曲目缺 `gateway` 元数据时（官方直连搜索的结果都缺），
  网关通道直接失败，由自定义音源用真实 songmid 解析。曾有过「同名搜索转译」——
  用「歌名 + 首位歌手」去网易云搜同名曲顶上——已移除：gdstudio 搜索结果不带
  `interval`，`isSameSong` 的时长校验因此永远被跳过，只剩「歌名相同 + 歌手重合」，
  会匹配到 Live / 翻唱 / 重录 / 同名不同曲；且即便匹配准确，用户点的是 QQ 音乐
  的曲目却播网易云版本，元数据与音质都对不上。

整条链有 25s 总预算。内置音乐 API 请求使用浏览器 `fetch`，超时或不可用时使用 Tauri HTTP plugin。

## 自定义音源

设置页支持导入 LX Music 自定义音源脚本。导入后：

1. `customSourceStore` 保存脚本和启用状态。
2. `customSourceRuntime` 解析脚本头部信息、测试能力并检查更新。
3. 播放解析时，`customSourceBackend` 把所有已启用脚本与本轮音质的组合并发送出竞速。

自定义音源不增加新的 UI 来源标签，最终歌曲仍按 `wy` 或 `tx` 展示。
列表顺序（设置页的上移/下移）只影响展示与日志，不决定竞速胜负。

## 已移除或不存在

- 没有外部网关配置。
- 没有独立网关 provider。
- 没有 Rust 网易云代理模块。
- 没有音乐 API 网关 IPC 命令。
- 没有外部网关优先或外部网关独占的播放模式。
