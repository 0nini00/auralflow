# stores

Zustand 全局状态。

推荐模块：

- `playerStore.ts`：当前播放、队列、进度、播放模式
- `queueStore.ts`：播放队列（可独立，也可并入 playerStore）
- `libraryStore.ts`：本地歌单、播放历史、收藏
- `settingsStore.ts`：设置、主题、Cookie、网关配置
- `downloadStore.ts`：下载任务列表与状态

原则：store 只保存状态和 actions，不直接发 HTTP / 不直接操作文件。
