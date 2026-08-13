# 沉浸全屏播放器 对齐 lx 改造清单

> 调研对象：`F:\auralflow\.alma\lx-mobile-ref`（LX-Mobile）的 `screens/PlayDetail`
> 对照对象：本项目 `apps/mobile/src/screens/immersive/*`（`ImmersiveLyricsScreen` + 组件族）
> 说明：lx 深度耦合其 store/event/plugin/主题/多语言系统，不可直接照搬，本清单按「交互/能力对齐」落地到本项目自建的沉浸屏。

---

## 0. 结论先行

本项目沉浸屏在「信息密度」上**已部分反超 lx**（更多菜单含喜欢/歌单/分享/倍速/音效/简繁转换等，lx 的更多里也没有全部）；lx 的真正差距集中在 **PlayInfo 进度区 / 顶部标题区 / 封面交互 / 两种布局模式**。

**优先级建议**：P0（快赢、低风险）→ P1（中等改动）→ P2（横屏第二套布局，重）。

---

## 1. 差异对比表

| 能力 | lx (PlayDetail) | 本项目沉浸屏 | 差距 | 优先级 |
|------|----------------|--------------|------|--------|
| **PagerView：封面页 ⇄ 歌词页** | ✅ 竖屏两页滑动 | ✅ 手机 PagerView | 对齐 | — |
| **旋转封面** | ✅ 封面页圆形旋转、`isCoverSpin` 开关 | ✅ `ImmersiveCoverPage` 圆形旋转 | 对齐 | — |
| **封面长按菜单** | ✅ 下载歌曲/封面 | ✅ `onLongPress→openCoverMenu(下载封面/歌曲)` | 对齐 | — |
| **底部进度条(带拖拽)** | ✅ `ProgressBar` 无缓冲拖动 | ✅ `ProgressBar` 拖动 seek | 对齐 | — |
| **缓冲进度显示** | ✅ `BufferedBar` 灰条 | ❌ 无 | **缺** | **P0** |
| **时间显示 当前/总长** | ✅ 当前时间 + 中央状态 + 总长 | ✅ `ImmersiveTransport` | 对齐 | — |
| **中央信息区（当前歌词/播放状态）** | ✅ 进度条下行中央 | ⚠️ 有但位置在顶部/进度条 | 微调 | P2 |
| **上一首按钮** | ✅ 竖屏也显示 | ⚠️ 手机竖屏隐藏（`isTablet` 才显示） | 差异 | P1 |
| **顶部歌名 Marquee 跑马灯** | ✅ 超长滚动 | ❌ `ImmersiveTopBar` 静态 `numberOfLines` | **缺** | **P0** |
| **顶部队列/设置按钮** | ✅ 竖屏右上 slider 面板 | ✅ 右上「设置」，More 里有队列 | 对齐 | — |
| **更多按钮直排** | ✅ 桌面歌词/收藏/播放模式/评论/更多 直排 | ✅ 播放模式+更多(收起) | 差异 | P1 |
| **点击歌词行 seek** | ✅ 打开开关后可点行跳转 | ✅ `LyricView` 点击 `onSeek(item.time)` | 对齐 | — |
| **竖屏/横屏两套布局** | ✅ 双布局自动切换 | ❌ 仅竖屏(+平板分支) | **缺** | **P2** |
| **歌词资源多源择优** | ✅ 优先级链 逐字→词(逐字降级)→翻译 | ⚠️ 需核对 | 待查 | P1 |
| **离开歌词页自动保持亮屏** | ✅ 歌词页 `screenkeepAwake` | ✅ `isLyricsPage && </*KeepAwake*/` | 对齐 | — |

---

## 2. P0 —— 快赢、低风险（各约半天）

### P0-1 缓冲进度显示（BufferedBar）
- **现状**：`ProgressBar` 仅 `position/duration/onSeek`，无缓冲。
- **对齐**：参考 lx `ProgressBar.tsx`，新增可选 `buffered?: number`（0..1），在已播条下层画一条更淡的缓冲条（`c-primary-light-300-alpha-800`），拖拽时仅预览不跟随缓冲。
- **数据源**：需从播放器暴露 `bufferedSeconds`（本项目 track-player 若已有 buffered 事件则取用，否则先置 `undefined` 隐藏，避免造 API）。

### P0-2 顶部标题 Marquee 跑马灯
- **现状**：`ImmersiveTopBar` 歌名/歌手静态单行省略。
- **对齐**：参考 lx `Marquee.tsx`（`Animated.loop` + `translateX` + 复制文本），抽一个 `Marquee` 组件，歌名过长时滚动，短则不滚。
- **改造**：新建 `components/Marquee.tsx`；`ImmersiveTopBar` 歌名用 `Marquee` 包裹（歌手保持静态）。

---

## 3. P1 —— 中等改动

### P1-1 手机竖屏显示「上一首」
- **现状**：`ImmersiveTransport` 仅平板显示 `SkipBack`（注释自称参考 lx 竖屏极简，但与 lx 实际不符——lx 竖屏也显示 prev/next/play 三键）。
- **对齐**：手机竖屏也渲染上一首，`mainControls` 改为 `⏮ ⏯ ⏭ ⏹ 更多`。注意单曲模式下一首的边界（`playPrevious`/`playNext` 已处理 FM/随机/历史）。

### P1-2 更多按钮能力核对（lx 直排项 vs 本项目 More 菜单）
- lx 直排：桌面歌词(平台特有,跳过)、**收藏**、**播放模式**、评论(MV)、更多。
- 本项目 PlayInfo：播放模式 + 更多(内含喜欢/歌单/分享/音量/睡眠/队列/翻译/简繁/海报/音效/倍速)。
- **建议**：把「喜欢」提升为底部常驻主键（与播放模式并列），对齐 lx 把核心操作放主屏而非收进 More，评论/更多保持收起。

### P1-3 歌词资源多源择优核对
- **待查**：`useImmersiveController` 中 `lyrics` 的来源链（逐字→词→翻译→空），确认与 lx 的 `plugins/lyric` 择优一致；不一致则补对齐。

---

## 4. P2 —— 横屏第二套布局（重，独立里程碑）

- lx `Horizontal/index.tsx`：`flexDirection:row`，左 45% = 封面+迷你歌词+播放控制，右 55% = 完整歌词。
- 本项目有 `isTablet` 分支（`ImmersiveStage` 单屏），但**没有横屏手机双栏布局**。
- **建议**：作为独立阶段，复用现有 `ImmersiveCoverPage`/`LyricView`/`ImmersiveTransport` 拼装 `HorizontalLayout`，监听窗口 `width>height` 切换。改动大、需充分回归，故单列不并入本轮。

---

## 5. 建议的执行顺序

1. **P0-2 Marquee**（纯前端、零风险）→ **P0-1 缓冲条**（需确认 buffered 数据源）
2. **P1-1 手机上一首**、**P1-3 歌词择优核对**
3. **P1-2 喜欢上提主屏**
4. **P2 横屏布局**（单独迭代）

> 覆盖范围：全部 `apps/mobile`，桌面端不变。