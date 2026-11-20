# 移动端性能审查

审查日期：2026-11-20。代码基线：`85752f97fdd46aa9b71f8d80bac24bcda50fb093`。

后续处理：用户已授权逐项修复；实现结果和最终验证见 [移动端性能修复与验证](mobile-performance-fix-plan-2026-11-20.md)。下文保留审查时的原始发现和证据。

用户反馈：播放时滚动与切页、播放器与歌词操作、启动与搜索及切歌等待，三类场景均不流畅。

结论：存在多项能解释卡顿或等待的具体实现问题，主要集中在同步计算、列表更新范围、重复缓存工作和异步任务生命周期。不同问题有不同触发条件，不能把所有场景归为一个原因。

本轮只审查和验证，未修改业务代码。目录范围为 `apps/mobile/src` 的 303 个 TS/TSX 文件、`App.tsx`、21 个自定义 Android Java/Kotlin 文件，以及移动端实际依赖的共享 core 模块。对渲染、播放、搜索、下载、缓存、启动、本地媒体和状态持久化链路进行了深入跟踪；静态展示与设置代码以订阅、effect、循环和动画筛查为主，并未逐个运行全部页面交互。

验证使用实际源码：纯函数直接执行，React 组件经真实 TSX 转译后，分别使用 React test renderer 或 hooks/虚拟时钟宿主计数，外部服务和原生宿主按边界替换。ADB 未发现连接设备，因此没有 Android release 构建的帧时间、Hermes CPU、GPU 或内存实测；下文 Node 耗时和堆增量仅用于展示同步工作量，不代表手机上的数字。

## 确认的问题

### 1. [P1] 搜索回包重复触发平方级分组和全列表更新

位置：[SearchScreen.tsx:218](F:/auralflow/apps/mobile/src/screens/SearchScreen.tsx:218)、[searchSession.ts:21](F:/auralflow/apps/mobile/src/services/searchSession.ts:21)、[song-variant.ts:139](F:/auralflow/packages/core/src/song-variant.ts:139)。

六路分类搜索的任意状态变化都会重新收集全部结果，创建新的 `songs` 数组；即使只是歌手分类返回，`groupSongResults` 仍重新运行。分组通过 `groups.find(...variants.some(isSameSong))` 扫描已有歌曲，循环内反复做字符串标准化；歌曲不同名时也产生平方级比较。随后 `withSongVariants` 为每组重新分配歌曲对象，使行组件的 memo 失效。

实际组件复现：已有 150 首歌，仅追加歌手分类结果，歌曲分组重复一次，150 个 SongItem 全部重渲染。对照组只修改输入框文字，SongItem 重渲染为 0。

实际分组函数、互不重名的合成歌曲、桌面 Node 测量：

| 歌曲数 | 字符串 normalize 调用次数 | 单次同步耗时 |
| ---: | ---: | ---: |
| 150 | 22,650 | 20ms |
| 1,000 | 1,001,000 | 585ms |
| 3,000 | 9,003,000 | 5,385ms |

触发条件是搜索回包与持续加载更多；数据越多越明显。修复应保留未变化分类及歌曲对象的引用，并按预计算的标准化歌名建立候选索引，再保持原有歌手交集、时长容差和输入顺序语义。单纯在页面再加一层 memo 无法解决引用变化和算法开销。

### 2. [P1] MP3 下载后处理在 JS 线程转换整首音频

位置：[downloadService.ts:645](F:/auralflow/apps/mobile/src/services/downloadService.ts:645)、[base64.ts:39](F:/auralflow/apps/mobile/src/utils/base64.ts:39)、[id3TagWriter.ts:180](F:/auralflow/apps/mobile/src/services/id3TagWriter.ts:180)。

在线 MP3 下载完成后，程序把整曲读成 Base64，在 JS 中解码、复制音频并插入 ID3，再逐字节编码为 Base64 写回。读写操作虽然异步，两个操作之间的转换是连续同步执行的；当前只排除大于 25MiB 的文件。

真实转换函数、合成音频字节、桌面 Node/V8 测量：

| 音频大小 | 同步转换总耗时 | V8 heapUsed 净增量 |
| ---: | ---: | ---: |
| 1MiB | 111ms | 43MiB |
| 5MiB | 476ms | 213MiB |
| 10MiB | 978ms | 427MiB |

堆增量包含该次字符串分配，不是设备总内存峰值。该问题发生在 MP3 下载后处理期间，会与播放界面、搜索和触摸处理争用 JS 执行时间。应把标签处理移到原生后台文件操作，并保留现有临时文件提交和失败不发布损坏文件的约束。

### 3. [P2] 虚拟列表仍运行旧的分批挂载循环

位置：[SongList.tsx:160](F:/auralflow/apps/mobile/src/components/SongList.tsx:160)、[SongList.tsx:385](F:/auralflow/apps/mobile/src/components/SongList.tsx:385)。

`mountedCount` 的 effect 没有区分 `virtualized` 模式。FlatList 已经获得完整 `songs` 数据，却仍不断通过 InteractionManager 增加计数、更新根组件，并复制一个虚拟列表根本不使用的 `visibleSongs` 数组。

实际组件计数：1,000 首歌产生 38 次多余更新、39 次 FlatList 渲染和累计 20,855 个数组元素复制；10,000 首则为 398 次更新、399 次渲染和 2,008,955 个元素复制。首轮渲染包含在渲染次数内。打开长歌单、收藏、本地库或云盘可触发。

应仅在 legacy 模式执行增量挂载和切片；这是旧路径未隔离造成的额外工作，无需更换列表框架。

### 4. [P2] 搜索及下载列表最终仍全量挂载

位置：[SearchScreen.tsx:676](F:/auralflow/apps/mobile/src/screens/SearchScreen.tsx:676)、[DownloadList.tsx:203](F:/auralflow/apps/mobile/src/components/DownloadList.tsx:203)。

搜索在 ScreenScrollView 中使用默认的非虚拟 SongList，分批挂载只是推迟创建，最终仍保留全部已加载结果；歌手、专辑、歌单分类同样全量 map，分页没有已挂载条目上限。下载页面也用 map 创建全部已完成记录，并将活动任务进度和稳定的已完成列表放在同一个更新范围。

实际 DownloadList 测试：1,000 条已完成记录保持同一数组引用，仅一个活动任务从 0 更新到 5%，仍重新计算 1,000 次完成记录元数据，渲染 1,001 次 CachedImage。下载配置 `progressDivider: 5`，每个任务可能多次触发上述更新。导航未配置页面失焦冻结，已挂载页面的订阅也没有焦点门控。

应让长搜索和下载列表拥有真正的虚拟滚动容器，并使活动任务进度仅更新对应行。首页五首与最近播放八首等明确限量预览不需要同样改造。

### 5. [P2] 列表封面启动两套缓存，并重复检查文件系统

位置：[CachedImage.tsx:67](F:/auralflow/apps/mobile/src/components/CachedImage.tsx:67)、[cacheService.ts:80](F:/auralflow/apps/mobile/src/services/cacheService.ts:80)、[cacheService.ts:193](F:/auralflow/apps/mobile/src/services/cacheService.ts:193)。

每个封面一边由 FastImage 加载显示 URL，一边无条件调用 RNFS 缓存。网易云默认列表图被规整为 300×300，后台缓存又将同一图片改成 600×600；它们是不同 URL 和缓存路径。RNFS 每次调用还检查四个目录及目标文件，命中缓存也不免除这些调用。应用侧只有同路径去重，没有跨图片的并发上限。

真实 cacheService 加替代文件系统/未完成下载的计数：100 张不同冷封面调用 RNFS.exists 500 次、发起 100 个未完成下载；100 张磁盘命中图仍检查 500 次。这里证明的是应用层提交量，不声称 100 个实际网络连接同时传输。

应明确列表显示、离线封面、原生播放器封面的缓存职责，避免每次挂载都双下载；缓存目录初始化应在成功后复用，并限制必要的后台缓存任务。修复须保留离线封面和通知栏等已有消费路径。

### 6. [P2] 600ms 延迟滚动会饿死连续短歌词行

位置：[LyricView.tsx:327](F:/auralflow/apps/mobile/src/components/LyricView.tsx:327)。

每次相邻歌词切换都会清掉前一次滚动定时器，再等待 600ms。若连续歌词的实际切换间隔短于 600ms，前一个滚动永远不会执行，表现为高亮变化但列表停住，随后突然追赶。

真实组件加可控时钟复现：每 500ms 切换一行，连续十行共 5 秒，滚动调用为 0；最后一次更新后再等 600ms 才调用一次。快歌词或加速播放能触发。应调整滚动任务调度，使连续换行不会持续推迟执行，并在执行时读取最新目标；保留手动浏览暂停自动滚动的行为。

### 7. [P2] 慢音源与连续切歌会累积过时的解析工作

位置：[playbackResolution.ts:42](F:/auralflow/apps/mobile/src/services/playbackResolution.ts:42)、[playerService.ts:334](F:/auralflow/apps/mobile/src/services/playerService.ts:334)、[request-limiter.ts:90](F:/auralflow/packages/core/src/request-limiter.ts:90)。

新的播放意图只让外层 Promise 失效，已经开始的解析没有收到取消信号。每轮创建独立请求限制器；限制器默认排队 800ms 后直接放行，2,500ms 租约到期也只释放计数，不取消真实请求。因此声明的 limit=3 不能作为真实在途请求上限。

实际限制器复现：12 个同时等待且不释放的申请，约 805ms 后全部获得许可。真实 runPlaybackResolution 加可控底层任务复现：连续五个播放意图，前四个对外被替代，但五个底层操作仍在运行并最终完成。自定义源 HTTP 代理默认独立超时为 60 秒。

当前代码已阻止旧结果重新开播，也会放弃一轮结束后尚在队列中的候选；问题是仍在执行的任务和抢占前尚未结束的内部调度。应把播放意图取消传递到候选调度、脚本桥和 HTTP 请求；采用能避免慢源占满槽位的调度策略，同时让真实在途数可控。共享预读应区分请求所有权，不能取消仍由当前播放请求复用的任务；脚本桥采用请求级取消。测试未访问真实第三方音源，不能据此给出网络耗时改善比例。

### 8. [P2] 首页先等最慢分区，再等缓存写入，才发布结果

位置：[homeFeedService.ts:140](F:/auralflow/apps/mobile/src/services/homeFeedService.ts:140)、[homeFeedStore.ts:316](F:/auralflow/apps/mobile/src/stores/homeFeedStore.ts:316)。

当前首页远程区块只有推荐歌单和每日推荐，新歌/新碟已不在请求列表。两者通过 Promise.all 一起返回，store 随后等待 AsyncStorage 写入成功才 set sections。冷缓存、登录状态下，快分区不能先显示；推荐歌单来源串行尝试较慢时尤为明显。

真实 service + store 门控测试：每日推荐已完成、歌单请求未完成时，sections 为 0；两个请求均完成而磁盘写入未完成时仍为 0；磁盘完成后才变为 2。已有缓存时旧内容仍可显示，因此该问题不等于每次启动都白屏。

应按分区发布已完成的数据，持久化独立进行并显式报告保存失败，保留账号隔离和请求代次校验。这是内容等待问题，与触摸掉帧应分别衡量。

### 9. [P2] 手动导入及授权后的标签写入在 Android 主线程做 I/O

位置：[LocalMusicModule.java:109](F:/auralflow/apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java:109)、[LocalMusicModule.java:131](F:/auralflow/apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java:131)、[LocalTagEditor.java:33](F:/auralflow/apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalTagEditor.java:33)。

Activity 结果回调直接执行多选歌曲的媒体查询、标签和旁挂歌词读取，未投递到后台 executor。Android 10 及以上请求媒体写入授权后，用户批准的回调也直接重试标签写入，进入同步备份、编辑、复读和写回路径。

成功编辑路径有三次文件复制：原曲到备份、备份到编辑副本、编辑副本到原曲，分别位于 LocalTagEditor 的 37、43、63 行。若音频大小 S 与编辑后 S′ 接近，复制量约为 3S，另有标签解析及提交。这里没有测量真机时长，但线程与同步调用链明确。已有写权限的初次 @ReactMethod 调用不属于此主线程授权回调场景。

应把这些事务移入受生命周期管理的后台 executor，保留授权流程和备份恢复逻辑。不能通过删除备份减少 I/O 而牺牲文件完整性。

### 10. [P2] 全库扫描同步占用原生模块调用队列

位置：[LocalMusicModule.java:647](F:/auralflow/apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java:647)、[LocalMusicModule.java:622](F:/auralflow/apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicModule.java:622)。

scanLocalMusic 返回 Promise，但整个扫描仍同步执行在 @ReactMethod 调用内部，没有使用已有 executor。已安装 RN 0.86 的 JavaTurboModule/JReactInstance 实现把这类方法投递到共享原生模块队列，因此扫描期间会推迟同队列的其他原生调用，不能因为方法返回 Promise 就认为工作已隔离。

存在有效文件路径时，每首签名需检查音频、LRC、八个公共封面名及三个同名图片，共 13 个路径，各读 lastModified 和 length。命中旧签名仍有 26 次文件属性调用；首次或变更条目还在读标签后再次验签，为 52 次。5,000 首全部命中也有 130,000 次属性调用；这属于源码计数，不是设备耗时。

该链由用户点击扫描触发，不是普通启动自动扫描。应将扫描移到专用后台执行器，并复用同目录公共封面信息；仍须准确识别歌曲和旁挂文件的变化。

### 11. [P2] 每打开一个云歌单都序列化累计的 WebDAV 歌曲缓存

位置：[webdavSyncService.ts:648](F:/auralflow/apps/mobile/src/services/webdavSyncService.ts:648)、[webdavSyncService.ts:734](F:/auralflow/apps/mobile/src/services/webdavSyncService.ts:734)。

模块加载时无条件订阅 playlistStore，既不依赖 WebDAV 已配置，也不依赖用户正在同步。打开新云歌单后，详情发布触发 rememberCloudSongs，把此前累计的全部云歌单歌曲转换成一个 JSON 字符串写入存储，因而普通浏览也承担同步缓存成本。

真实 playlistStore.fetchPlaylistDetail 和 webdavSyncService、替代存储、没有配置同步也没有真实网络的测试：依次打开 50 个各 1,000 首的歌单，写缓存 50 次，累计序列化 1,275,000 首；第 50 次只新增 1,000 首，却序列化 50,000 首，生成 8,006,992 字节 JSON。该次同步段约 30ms，但测量含 toJSON 计数钩子成本，仅作阻塞复现，不能当作生产耗时。

应保留云歌单本地编辑后用于同步的正确快照，按歌单维护需要更新的持久化数据，避免每次详情加载重写整个历史缓存；不能简单移除订阅导致同步重新上传旧内容。

### 12. [P2] 统计页每十秒全量聚合长期历史，播放器覆盖后仍计算

位置：[listeningStatsStore.ts:127](F:/auralflow/apps/mobile/src/stores/listeningStatsStore.ts:127)、[ListeningStatsScreen.tsx:142](F:/auralflow/apps/mobile/src/screens/ListeningStatsScreen.tsx:142)。

listenTracker 每十秒保存播放检查点；record 把所有月份重新展开为新的 events 数组，统计页依赖该引用再次聚合全部历史。从统计页经 PlayerBar 打开全屏播放器时，统计页仍保留在底层导航栈中；当前没有页面冻结或焦点控制，该计算继续发生。

真实 store、tracker、统计页面测试：已有 40,000 个跨月会话，播放 30 秒产生三次 40,001 条全量聚合，共处理 120,003 条；三次聚合在 Node 上约为 28、34、33ms。当前持久化只写变化月份，测试中仅当月写入三次，并不存在每十秒把所有历史月份全部写盘的问题。

该问题需要较大的历史数据量以及统计页仍挂载，不能泛化成新安装应用每十秒必卡。应按变化会话更新派生统计，并暂停失焦页面的展示计算；播放检查点和当月可靠落盘仍须继续。

## 次要开销与交互观察

- [MiniProgressBar.tsx:20](F:/auralflow/apps/mobile/src/components/MiniProgressBar.tsx:20) 和 [ProgressBar.tsx:46](F:/auralflow/apps/mobile/src/components/ProgressBar.tsx:46) 给原生动画挂 JS listener，仅用于写入 progressRef。已安装 RN 源码会启动原生值监听，动画帧更新仍送回 JS。它造成额外的持续回调，但未测得单独足以解释明显卡顿，应排在前述大工作量之后。
- [LyricView.tsx:371](F:/auralflow/apps/mobile/src/components/LyricView.tsx:371) 的 renderItem 随目标行变化，AnimatedLyricLine 未 memo，行内插值节点每次重建。实际 30 行组件测试，一次高亮变化新建 30 个插值对象；应稳定行渲染和插值节点。封面页与歌词页同时挂载时，歌词侧仍可能工作。
- [ImmersiveTransport.tsx:56](F:/auralflow/apps/mobile/src/screens/immersive/ImmersiveTransport.tsx:56) 使用的 [ProgressBar.tsx:107](F:/auralflow/apps/mobile/src/components/ProgressBar.tsx:107) 只有点按及按下/松开事件，没有手指移动处理；按住时设置的 seekPosition 不随移动改变。沉浸页进度条支持点按定位，尚未实现连续拖动；这是交互缺失，不应仅通过修改动画时长处理。

## 验证与修复顺序

现有定向测试 61/61 通过，命令为：

```powershell
node --test --test-timeout=60000 apps\mobile\tests\search-pagination.test.cjs apps\mobile\tests\playback-resolution.test.cjs apps\mobile\tests\song-switch-responsiveness.test.cjs apps\mobile\tests\offline-cache.test.cjs apps\mobile\tests\download-regressions.test.cjs
```

这些测试覆盖分页与取消、下载完整性等功能，没有对渲染次数、工作量或帧时长设置性能断言。通过不表示没有本文列出的问题。另运行了组件计数、歌词时钟、解析取消、图片缓存计数、首页门控、搜索规模、音频转换、云歌单缓存和统计聚合复现。一次性脚本按工作区约定清理。

建议按以下依赖实施：先修搜索数据引用和分组算法、隔离虚拟列表旧循环；接着虚拟化搜索/下载列表并统一封面缓存职责；再处理歌词调度和解析取消；将音频标签及导入扫描的重 I/O 移至原生后台。保留文件事务、请求代次、账号隔离、跨源歌曲匹配等正确性约束。

业务代码未改，本轮不需要以构建成功证明性能改善。实际改善应在 Android release 包上按用户的三类场景测量 JS/UI 帧时间、输入延迟、请求在途数和内存峰值，并分别比较小数据量与长列表。
