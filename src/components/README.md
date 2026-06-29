# components

当前目录保存可复用 React 组件和播放器相关组件。

## 主要组件

| 文件 | 用途 |
|---|---|
| `Layout/` | 主窗口布局、侧边栏和顶部栏 |
| `PlayerBar.tsx` | 底部播放器、播放队列入口、沉浸式歌词入口 |
| `ImmersiveLyricsOverlay.tsx` | 沉浸式歌词覆盖层，底栏按歌词工具、播放控制和辅助工具分组 |
| `MusicCard.tsx` | 歌曲、歌单等卡片 |
| `SongAddMenuButton.tsx` | 添加到喜欢、本地歌单或网易云歌单 |
| `MetadataEditModal.tsx` | 本地音频元数据编辑 |
| `SoundEffectPanel.tsx` | 均衡器、声像、混响和变调控制 |
| `WyCookieLoginModal.tsx` | 网易云 Cookie 登录、二维码登录、登录失败回滚 |
| `CustomSourceUpdateModal.tsx` | 自定义音源更新提示 |
| `UpdateModal.tsx` | 应用更新提示 |
| `PactModal.tsx` | 用户协议弹窗 |
| `CursorEffect.tsx` | 可选鼠标拖尾效果 |
| `DeepLinkHandler.tsx` | `auralflow://` 深链处理 |
| `VirtualList.tsx` | 大列表虚拟滚动 |

组件应只组合 UI 和调用 hooks/stores/services，跨模块业务规则放到 `src/services` 或 `src/stores`。
