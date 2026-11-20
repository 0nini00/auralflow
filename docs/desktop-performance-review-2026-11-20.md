# 桌面端同类性能问题核查

日期：2026-11-20。基线：`40f7583`，包含此前移动端性能修复。此次仅审查和复现，没有修改业务代码。

后续处理：上述问题已按用户要求逐项修复，见 [桌面性能修复与验证](desktop-performance-fix-plan-2026-11-20.md)。下文保留审查时的原始发现。

结论：桌面端仍有类似问题，主要集中在播放解析生命周期、歌词逐帧渲染、搜索与下载列表，以及全量数据持久化。共享搜索分组算法已随移动端修复，但桌面页面自己的引用重建、全量渲染和调度逻辑没有自动改变。

## 1. 慢音源仍可突破真实并发上限，切歌不停止旧解析

位置：[customSourceBackend.ts:95](F:/auralflow/desktop/src/services/playback/customSourceBackend.ts:95)。桌面显式采用 `mode: "soft"`，维持之前行为。排队超时和租约允许仍未结束的请求不再计入额度。

真实 backend 与共享限制器、可控挂起 runtime 复现：5 个源、每源 5 个音质，虚拟时间 5 秒时已启动 25 次取链且全部仍在途；10 秒外层解析预算结束后，这 25 个底层任务仍未结束。该测试用挂起替身证明调度数量，没有声称所有真实脚本一定发出同样数量的 HTTP。

真实 playerStore 切到第二首后，旧解析仍 pending，其 CustomSourceOperation 仍 active。[playRequestState.ts:41](F:/auralflow/desktop/src/stores/player/playRequestState.ts:41) 递增代次，[playbackPipeline.ts:238](F:/auralflow/desktop/src/stores/player/playbackPipeline.ts:238) 在解析结束后检查过时结果。旧结果不能重新开播的保护是有效的，但它不等于取消工作本身。慢网络、多源和连续直接点选歌曲时，会累积无用请求；下一首连点已有合并，不能泛化为所有切歌都会无限启动。应把请求级取消传到脚本与网络，并保留共享预读消费者的所有权规则。

## 2. 歌词插值每帧使整篇歌词重新渲染

位置：[useInterpolatedPlaybackProgress.ts:88](F:/auralflow/desktop/src/hooks/useInterpolatedPlaybackProgress.ts:88)、[ScrollingLyricsVisualizer.tsx:72](F:/auralflow/desktop/src/components/playerVisualizers/ScrollingLyricsVisualizer.tsx:72)、[ImmersiveLyricsOverlay.tsx:112](F:/auralflow/desktop/src/components/ImmersiveLyricsOverlay.tsx:112)。

requestAnimationFrame 每次更新 React state，新的 currentTime 传到滚动歌词，后者对全部 lyrics 执行 map；静态行没有隔离。真实插值 hook 和歌词组件复现：300 行、同一高亮行内 10 个动画帧，LyricText 执行 3000 次，关闭罗马音显示时 LyricRomanization 仍执行 3000 次。需要把逐帧变化限定在当前行或直接更新动画属性，其余行稳定复用。

这里计数是 React 函数执行次数，不是 3000 次 DOM 节点创建，也不代表已测得实际 FPS。

## 3. 短歌词行仍会持续取消延迟滚动

位置：[autoScrollModel.ts:96](F:/auralflow/desktop/src/services/lyrics/autoScrollModel.ts:96)。每个新目标先清除上一个相邻行计时器，再延迟 600ms。

真实控制器加虚拟时钟：每 500ms 换一行，连续十行，5 秒内自动滚动次数为 0；最后一行再等待 600ms 才滚一次。这与移动端原先的“停住后跳动”根因相同，应调整任务调度而非只降低动画帧率。

## 4. 搜索结果全量挂载，无关分类回包仍更新全部歌曲

位置：[pagedSearch.ts:79](F:/auralflow/desktop/src/services/search/pagedSearch.ts:79)、[SearchView.tsx:309](F:/auralflow/desktop/src/views/SearchView.tsx:309)、[SearchView.tsx:883](F:/auralflow/desktop/src/views/SearchView.tsx:883)。

任意分类通知都重新收集全部结果并创建新的歌曲数组。分组算法虽然已优化，但页面仍重复分组、创建携带 variants 的新歌曲对象，并通过 map 挂载全部结果。

真实组件计数：已有 1000 首时，仅歌手分类回包也触发一次歌曲分组、1000 个歌曲对象重建、1000 次行内添加菜单渲染及 1000 次封面地址计算。仅修改输入框时没有重复分组，但仍重渲染 1000 个行内按钮。应稳定分类结果引用、隔离行组件并让搜索长列表使用现有虚拟列表。

## 5. 下载进度导致全部记录同步持久化和全页面更新

位置：[downloadStore.ts:249](F:/auralflow/desktop/src/stores/downloadStore.ts:249)、[downloadStore.ts:391](F:/auralflow/desktop/src/stores/downloadStore.ts:391)、[DownloadsView.tsx:106](F:/auralflow/desktop/src/views/DownloadsView.tsx:106)。

下载 store 使用 Zustand persist；每次 progress set 都遍历 tasks、序列化全部记录并同步调用 localStorage。原生进度事件间隔下限为 180ms，最多两个活动下载，因此长期积累的已完成记录会放大常态进度更新成本。该持久化路径与下载页面是否打开无关。

真实 store 和 persist 中间件、替代 localStorage 的计数：1000 条记录，10 个进度事件触发 10 次完整写入，累计序列化 10000 条记录，生成 1,989,312 字节字符串。数据为合成元信息，字节量随歌曲字段变化。

真实 DownloadsView 另测：1000 条已完成加 1 条活动下载，保持已完成条目引用不变，单次 0→5% 仍重新计算 1001 次封面地址；全部 1001 行均挂载。应隔离进度状态和持久化内容，并虚拟化列表、复用稳定行。

## 6. 收听统计每十秒提交全部历史，统计页重新全量聚合

位置：[listeningStatsStore.ts:19](F:/auralflow/desktop/src/stores/listeningStatsStore.ts:19)、[listeningStatsStore.ts:54](F:/auralflow/desktop/src/stores/listeningStatsStore.ts:54)、[StatsView.tsx:34](F:/auralflow/desktop/src/views/StatsView.tsx:34)。

桌面仍使用 upsertListeningEvent 的全数组定位与更新，并把整个 events 数组作为一个 listeningStats 命名空间提交；没有采用本轮新增的增量统计索引。统计页打开时，每个新数组又触发 aggregateListeningEvents。

真实 store、tracker 和持久化 helper，加替代 IPC 存储：已有 40000 条历史，30 秒内三次检查点分别提交 40001 条，累计传递 120003 条；单次紧凑 JSON 大小约 6,104,677 字节。这里测量提交的数据规模，未运行真实 IPC 或磁盘吞吐测试。Rust library_save 已放在 spawn_blocking 中，因此不能把磁盘写入误称为直接占据 UI 主线程；重复传输和全量序列化仍然存在。

应将历史按适当单位增量持久化，并使用差量统计。桌面路由切页通常卸载统计页，不能照搬移动端“隐藏底栈统计继续聚合”的结论；持久化检查点仍会继续。

## 7. 首页快分区被最慢请求阻挡，榜单试读还要晚启动

位置：[discoverFeedStore.ts:139](F:/auralflow/desktop/src/stores/discoverFeedStore.ts:139)、[discoverFeedStore.ts:180](F:/auralflow/desktop/src/stores/discoverFeedStore.ts:180)。

推荐歌单和榜单通过 Promise.allSettled 一起等待，全部结束后才发布各分区，随后才启动榜单歌曲试读请求。

真实 store 门控测试：榜单已返回、推荐仍挂起时，已发布榜单为 0，试读请求数为 0；推荐返回后才发布榜单并启动试读。属于首屏内容等待问题，不等于持续掉帧。应各分区独立发布，并在榜单完成后立即请求其试读歌曲。

## 8. 同曲预读只有完成缓存，没有在途请求合并

位置：[prefetchService.ts:125](F:/auralflow/desktop/src/services/playback/prefetchService.ts:125)。真实服务复现：对相同三首相邻歌曲并发发起两批预读，产生六次播放地址解析和六次歌词请求；全部完成后再调用才由缓存命中去重。它会与第 1 项的慢源任务累积叠加，应统一管理在途预读及消费者，而不是只缓存完成结果。

## 已有优化与边界

- 共享 groupSongResults 已按歌名缩小候选范围，移动端修复已对桌面生效；不要再次把原先不同名歌曲的平方级全扫描归为桌面当前问题。
- 桌面 VirtualList 的真实组件测试：10000 条、560px 视口、56px 行高时只渲染 22 行；滚到 5600px 后渲染索引 94–115。该组件不存在移动端旧分批挂载循环，但搜索和下载页尚未使用它。
- 下载标签、封面/歌词写入和目录扫描已在 Rust spawn_blocking 中执行，没有整首音频经 JS Base64 往返的移动端旧问题。
- 列表封面按显示尺寸和 DPR 请求，没有发现每张列表图同时触发 RNFS 大图下载的重复路径。
- 跨窗口播放快照只含当前曲、queueLength、queueIndex 等字段，并不每 250ms 发送整份播放队列。未将未经量化的双通道通知列为主要问题。

验证使用真实 TS/TSX 模块、React 组件、共享调度器与受控时钟/存储/网络边界，不触碰实际账号或媒体库；没有录制真实桌面 WebView 的 CPU/GPU/帧率数据。现有定向功能测试 39/39、临时 UI 测试 6/6、播放测试 3/3 通过；另完成下载持久化、统计提交、首页发布门控计数。功能测试通过并不能排除这些工作量问题。临时复现文件已清理。
