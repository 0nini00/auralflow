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
| `components/ui/Button.tsx` | 新增 `brand` 变体（`actionFill` 深绿实心 + 白字）；`primary` 保留 2026-08 的「表面底 + 强调色文字」约定 |
| `components/ui/Chip.tsx` | 选中态改实心：浅色墨色、深色 `actionFill` |
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
| `screens/immersive/ImmersiveTransport.tsx` | 66px 主题深绿实心播放键 + 白图标；新增队列直入口 |
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

### 播放页亮度复核（2026-10-23）

用户反馈：竖屏播放器的进度条和播放/暂停键太亮，其他按键显得暗。调整：

- **进度条**：传入播放器固定 dark palette（不再跟全局浅色主题走）；轨道/缓冲改中性半透明白，填充改为 70% 主题色，滑块 12px→8px、颜色改 `primaryInk`；高度 4→3。
- **播放键**：最终是 66px 深绿实心（`actionFill`）+ 白图标 + 中性阴影，去掉绿色光晕；尺寸仍 66。
- **活跃图标**：`tone="primary"` 会映射到 `primaryText`（深色），在深色播放页上几乎看不见；新增 `tone="accent"`，播放模式/喜欢/悬浮歌词/睡眠定时改用它（`primaryInk` 浅绿）。
- 结果：白色控件（上一首/下一首/更多/顶栏）保持清晰，绿色只做小面积强调，播放键靠尺寸与描边保持主操作层级。

### 按钮填充统一（2026-10-23）

用户要求：所有按钮的绿色填充默认用「文案绿」（如「音乐云盘」的 `#0D7A42`），不再用品牌荧光绿。

- 新增 `palette.actionFill` / `palette.onActionFill`：浅色/深色都固定 `#0D7A42` + 白字（5.4:1）；自定义强调色会按同色相压深并保证白字 4.5:1。
- 已替换：`Button` 的 `brand` 变体、迷你播放器播放键、竖屏播放器播放键、首页继续收听播放键、歌单编辑弹层确认键、深色选中 Chip、私人 FM 大播放键、新建歌单确认键/加号、启动重试键。
- 全站绿色**文字 / 图标 / 选中态文字**统一到 `primaryInk`（`color: palette.primary`、`color={palette.primary}`、条件三元都已替换），避免同一屏出现「荧光绿文字 + 深绿按钮」两种绿。
- 实心选中芯片/开关用 `actionFill` + `onActionFill`（如睡眠定时选项、歌词强度/字体、歌单广场分类、音源测试状态）；浅色底选中态仍用 `primaryInk` 文字/边框。
- 刷新控件、进度条、色板预览与封面占位使用 `palette.primary`（跟随当前主题色，默认深绿）；批量替换时曾误伤这些填充，已逐一恢复。
- 深色播放器的播放键现在是深绿实心 + 白图标；比原来的实心亮绿暗一档，和白色上一首/下一首保持同一明度层级。

### 主题色预设与调色盘（2026-10-23）

用户要求：外观里设计几个主题色，第一个默认用「上面的绿」；再加一个调色盘可选任意颜色。

- `DEFAULT_ACCENT_COLOR` 从品牌荧光绿 `#3BD877` 改为深行动绿 `#0D7A42`；旧值在 `migrateAccentColor` 中自动迁移，现有安装不会停在亮绿。
- 预设 8 色：默认绿 `#0D7A42` / 松针 `#146B52` / 湖蓝 `#1D6FA5` / 靛青 `#3B4FA8` / 暮紫 `#6B4BA8` / 赭橙 `#A9531A` / 莓红 `#A8324F` / 岩灰 `#4A5450`。
- 新增 `components/settings/ThemeColorPicker.tsx`：可展开的 HSV 调色盘（饱和度/明度选区 + 色相条 + Hex 输入）；拖动时只更新本地预览，松手才写回主题 store，避免每帧 AsyncStorage 落盘。
- `buildPrimaryInk` / `buildActionFill` 改为「先直接使用主题色，只有对比度不足 4.5:1 才压深/提亮」；这样预设色的文字和按钮不会被额外压暗，选什么看到什么。
- 选中态浅底统一改用 `primaryInk` 的 alpha，深色主题下也看得见；实心选中芯片仍是 `actionFill + onActionFill`。

### 设置二级页细节优化（2026-10-23）

- `SettingsCard` 圆角 12→16、加 `overflow:hidden`，选中底色不再顶到方角；`SettingsPage` 卡片间距 12→16。
- 设置顶栏标题 18→17，与全局 PageHeader 一致；二级页卡片标题统一 15/700（播放/账号/关于/同步）。
- 卡内行统一 12px 水平内边距：音质选中行用负 margin 抵消卡片 padding，标题、行、分隔线对齐；选中行文字/图标改 `primaryInk`，浅底改 `primaryInk` alpha，深色主题可见。
- 关于页版本行去掉多余水平缩进；单行链接卡去掉底部多余 hairline。
- 账号卡「登录 / 验证并登录」、音源「粘贴导入 / 确认导入」、WebDAV「保存配置」改 `brand` 深绿主操作。
- 账号卡 VIP 角标改深橙 `#B45309`（白字对比度达标），ID 行改 `textMuted`；开关/分段选中态统一 `actionFill` / `primaryInk`。

### 设置返回层级修复（2026-10-23）

用户反馈：从「我的」直接打开外观/播放/歌词等设置，返回时却先回「全部设置」，应该直接回「我的」。

- `settingsCategoryStore` 新增 `fromSettingsHome` 来源标记：
  - 「我的」直达二级页 → `false`，顶栏/系统返回直接 pop 回「我的」。
  - 「全部设置」首页进入二级页 → `true`，返回先回设置首页；设置首页再返回才 pop 回「我的」。
- 顶栏返回与 Android 返回拦截共用同一判断；新增 `tests/settings-navigation.test.cjs` 锁定两种来源的 store 行为。
- 覆盖入口：我的 → 外观 / 播放与音质 / 歌词与浮窗 / 音乐云盘 / 自定义音源 / WebDAV 同步 / 全部设置。

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
