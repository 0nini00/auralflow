# 移动端重构 · 实施记录（阶段 0–4）

> 2026-10-23 · 对应方案 [`PROPOSAL.md`](./PROPOSAL.md)
>
> 本轮只改界面层，播放核心、音源解析、缓存、WebDAV、原生模块均未动。

---

## 已完成

### 阶段 0 · 令牌与主题

| 文件 | 改动 |
|---|---|
| `theme/tokens.ts` | 正文 14→15；标题 17/20/28；页面边距 16→20；新增 `tabBarHeight: 64`、`miniPlayerGap: 6`、`radius.xxl: 28` |
| `services/themePaletteModel.ts` | 画布改暖中性 `#F3F3EF`；深色 `#0B0F0D`；新增 `primaryInk`（`#0D7A42` / `#6FE7AC`）、`isDark`、`SOURCE_COLORS`；自定义强调色自动压深/提亮到 4.5:1 |
| `components/ui/Button.tsx` | 新增 `brand` 变体（品牌绿实心 + 深绿文字）；`primary` 保留 2026-08 的「表面底 + 强调色文字」约定 |
| `components/ui/Chip.tsx` | 选中态改实心：浅色墨色、深色品牌绿 |
| `components/ui/IconButton.tsx` | `accent` tone 改用 `primaryInk` |
| `components/SectionHeader.tsx` | 标题 17px / 700 |
| `components/ActionButton.tsx` | 支持 `brand` 变体 |

### 阶段 1 · 导航壳

| 文件 | 改动 |
|---|---|
| `navigation/RootNavigator.tsx` | 根 Stack 新增 `Settings`；不再需要 Drawer |
| `navigation/types.ts` | 删除 `MainDrawerParamList` / `LibraryTopTabParamList`；`LibraryTab` 不再嵌套 TopTab |
| `navigation/navigationRef.ts` | 根容器改 Stack；push 直接派发；新增 `openMyMusicTab`；`openLibrarySection` 写 `librarySectionStore` 后切 Tab |
| `navigation/MainTabNavigator.tsx` | 4 Tab 新样式：64px 标签栏、选中胶囊、含底部安全区；音乐库单屏 |
| `components/AppTabBar.tsx` | 迷你播放器浮起 6px + 标签栏 |
| `components/PlayerBar.tsx` | 64px 浮起卡片、顶部 2px 进度线、34px 实心播放键、下一首；队列入口收敛到播放页 |
| `components/PageHeader.tsx` | push 页返回 + 标题；不再承载全局搜索与主题切换 |
| `components/LargeHeader.tsx` | 主 Tab 28px 大标题 + eyebrow + 右侧操作 |
| `components/AppShell.tsx` | 删除抽屉逻辑；Tab 页不渲染全局顶栏；push 页迷你播放器浮起 8px |
| `AppHeader.tsx` / `DrawerContent.tsx` / `MainDrawerNavigator.tsx` | 删除 |
| `navigation/SettingsNavigator.tsx` | 返回改为「分类 → 设置首页 → 我的」 |
| `stores/settingsCategoryStore.ts` | 新增 `resetToHome` |

### 阶段 2 · 音乐库合并

| 文件 | 改动 |
|---|---|
| `stores/librarySectionStore.ts` | 新增：`playlists / local / favorites / history / downloads` 五段状态 |
| `components/SegmentedChips.tsx` | 新增：横向分段芯片 |
| `components/library/PlaylistsSection.tsx` | 新增：从「我的」迁入的本地/网易云歌单，双列封面卡 + 新建/导入/导出/链接导入 + 三个编辑弹层 |
| `components/library/FavoritesSection.tsx` | 新增：我喜欢摘要卡 + 前 5 首预览 + 「查看全部」进虚拟化列表 |
| `screens/LibraryScreen.tsx` | 单屏五段：歌单/本地/收藏/历史/下载；分段切换不再走 MaterialTopTabs |
| `screens/MyMusicScreen.tsx` | 移除歌单与收藏；保留账号、快捷入口、服务与同步、设置行 |
| `screens/HomeScreen.tsx` | 大标题 + 「继续收听」卡；快捷入口改 4 格图标块（未登录自动换成本地音乐/下载） |
| `screens/SearchScreen.tsx` | 大标题「搜索」；空态增加「按风格浏览」8 格（点击发起真实搜索） |
| `components/HomeFeedSections.tsx` | 快捷入口改 4 格白色图标块 |
| `components/SongList.tsx` | `hideSourceTag` 默认改为 false，多源标签默认可见 |

### 阶段 3 · 播放与队列

| 文件 | 改动 |
|---|---|
| `screens/immersive/useImmersiveController.ts` | 播放页调色板固定为 dark |
| `screens/ImmersiveLyricsScreen.tsx` | `isDark = true`；状态栏恒 light；封面/歌词页指示点 |
| `screens/immersive/ImmersiveTopBar.tsx` | 返回图标改 `ChevronDown`（下滑关闭语义） |
| `screens/immersive/ImmersiveTransport.tsx` | 66px 品牌绿实心播放键；新增队列直入口 |
| `stores/lyricSettingsStore.ts` | 氛围色背景默认开启 |
| `components/QueueModal.tsx` | 复用现有 sheet；当前曲高亮、拖拽排序、移除/清空保留 |

### 阶段 4 · 详情与设置

| 文件 | 改动 |
|---|---|
| `components/DetailHero.tsx` | 封面 128 / 圆角 20；标题 20–22；更紧凑的元信息 |
| `components/PlaybackActionButtons.tsx` | 主操作改 `brand` 实心，随机/定位改 `secondary`，统一 44px |
| `screens/PlaylistDetailScreen.tsx` | 播放全部改品牌实心；定位/收藏/删除改 44px |
| `components/FloatingDetailHeader.tsx` | 新增：详情页悬浮返回键 + 滚过封面后淡入实底标题栏；已接入歌单/专辑/歌手/本地歌单四个详情页 |
| `components/settings/SettingsRow.tsx` | 新增：32px 图标底 + 56px 行 |
| `screens/settings/SettingsHomeScreen.tsx` | 8 类设置改 4 组行列表 |
| `screens/MyMusicScreen.tsx` | 「设置」区改为外观/播放/歌词/全部设置四行；新增「本周听歌」统计卡（7 天时长/次数/歌手数，聚合走 `@lx/core`） |

---

## 验证

```bash
pnpm mobile:typecheck   # 通过
pnpm mobile:lint        # 通过
pnpm mobile:test        # 537 例全绿
```

导航契约测试已按新根 Stack 更新，并补了 `librarySectionStore` 的 mock；沉浸播放页的布局契约测试也全部通过。

### 复核修复（细节回看）

- **360dp 详情头部换行**：128 封面 + 14 间距 + 180 文字列 = 322 > 320，360dp 机器上文字会被挤到封面下方；改为 12 间距 + 160 文字列（300），同排稳定。
- **收藏「播放全部」未撑满**：按钮原在 `flex:1` 容器内但自身没有 `flex`，只占 88px；改为按钮自身 `flex:1`。
- **本地曲库来源标签噪声**：`SongList` 默认显示来源后，本地曲库每行都出现「本地」；本地列表显式 `hideSourceTag`。
- **push 页迷你播放器安全区空白**：原先把 `bottomInset` 算进卡片高度 + `paddingBottom`，键盘隐藏播放器时会留下一条空白；改为卡片固定 64px + `marginBottom` 抬离手势条。
- **小字号对比度**：日期、统计标签、歌单卡 meta、继续收听标签从 `textSubtle`（约 3.2:1）改为 `textMuted`（约 5.5:1）。
- **触控热区**：Chip 32px 补上下 6px、Button 补 4px、首页头像/继续播放/统计「查看全部」补 hitSlop。
- **网易云歌单加载态**：加载中显示 spinner，失败显示错误 + 重试，不再误显示「还没有歌单」。
- **收藏段兜底加载**：进入收藏段时主动 `loadFromStorage`，避免冷启动直接进库时短暂空态。
- **详情骨架封面**：112 → 128，和 `DetailHero` 一致。
- **本地歌单主按钮**：播放全部改品牌实心，定位/删除改 44px。

---

## 有意保留 / 后续可做

- **队列当前曲钉住卡**：现有队列用行高亮表示当前曲，功能完整；设计稿的独立当前曲卡未单独加。
- **热搜榜**：没有真实热搜数据源，搜索空态只做「历史 + 风格浏览」，不伪造榜单。
- **动效细化**：详情页已加悬浮顶栏淡入；共享封面转场、歌词行过渡沿用现有实现，未新增全局动效层。
- **歌单卡片按压**：双列卡已统一用 `Touchable` 的 0.97 缩放反馈。
- `@react-navigation/drawer` 依赖仍在 `package.json`，已无引用，可在依赖清理时移除。
