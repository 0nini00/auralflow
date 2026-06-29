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
| `src/services/sources/sourceService.ts` | 注册 `wyProvider`、`txProvider` |
| `src/services/search/` | 搜索聚合、缓存和元数据合并 |
| `src/services/builtinMusicApiClient.ts` | 内置音乐 API 请求 |
| `src/services/builtinMusicApiModel.ts` | 内置 API URL 构造和结果映射 |
| `src/services/playback/playbackResolver.ts` | 播放 URL 解析顺序 |
| `src/services/playback/customSourceBackend.ts` | 自定义音源播放解析 |
| `src/services/customSourceRuntime.ts` | 自定义音源脚本解析、测试和更新检测 |

## 播放解析流程

```text
用户播放歌曲
  -> playbackResolver.resolvePlaybackUrl
  -> 若歌曲带 MusicInfo.gateway，尝试 builtinNeteaseBackend
  -> 失败后尝试 customSourceBackend
  -> 返回 PlaybackResolvedUrl 给 playerEngine
```

内置音乐 API 请求使用浏览器 `fetch`，超时或不可用时使用 Tauri HTTP plugin。

## 自定义音源

设置页支持导入 LX Music 自定义音源脚本。导入后：

1. `customSourceStore` 保存脚本和启用状态。
2. `customSourceRuntime` 解析脚本头部信息、测试能力并检查更新。
3. 播放解析失败时，`customSourceBackend` 根据已启用脚本尝试获取播放 URL。

自定义音源不增加新的 UI 来源标签，最终歌曲仍按 `wy` 或 `tx` 展示。

## 已移除或不存在

- 没有外部网关配置。
- 没有独立网关 provider。
- 没有 Rust 网易云代理模块。
- 没有音乐 API 网关 IPC 命令。
- 没有外部网关优先或外部网关独占的播放模式。
