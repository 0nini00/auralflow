# 歌单同步与收藏

移动端歌单 / 收藏 / 历史的云端同步与本地管理。核心实现分布在 `src/services/webdavSyncService.ts`、`src/stores/playlistStore.ts`、`src/stores/webdavStore.ts`、`src/stores/biliAccountStore.ts`，合并算法为共享包 `@lx/core` 的 `webdav-merge.ts`（纯函数，可单测）。

## 1. WebDAV 同步架构

### 单飞 + 串行锁

- **单飞（single-flight）**：`autoSyncPlaylistsOnce()` 持有模块级 `autoSyncPromise`，并发调用复用同一个 Promise，避免重复拉取；内部流程固定为「下载合并 → 上传收敛」。
- **串行锁 `withSyncLock(label, fn)`**：所有 PUT / GET 操作包在锁内执行，防止双击 / 并发操作竞争同一远端文件。手动上传 / 下载 / 测试连接各自走独立 `withSyncLock` 调用，但同一类操作互斥。

```text
autoSyncPlaylistsOnce()
    ↓ 单飞 autoSyncPromise（并发复用）
    withSyncLock("自动同步", …)
        ↓ downloadPlaylistsSync({ merge: true })   // 下载合并
        ↓ uploadPlaylistsSync()                    // 上传收敛
```

## 2. LX Music 兼容格式

同步文件与 LX Music 互通，移动端读写两份远端文件：

| 文件 | 格式 | 内容 |
| --- | --- | --- |
| `playlists.json` | v2 / v3 | `defaultList`（默认列表）、`loveList`（收藏）、`userList`（用户歌单数组）、`playHistory`（播放历史） |
| `user_apis.json` | — | 自定义音源 |

移动端在 LX 格式基础上**额外同步本地歌单**：把 `playlistStore.localPlaylists`（App 自建歌单）序列化进 `userList`，下载时再还原回 `localPlaylists`，使本地歌单也能跨设备流转（桌面端本地歌单走 `playlist_xxx` id 前缀区分）。

## 3. 冲突检测

三层保护防止「云端旧数据覆盖本地新数据」：

1. **`lastModified` 比较**：每次上传写 `Date.now()` 到 `playlists.json` / `user_apis.json` 的 `lastModified` 字段；下载时比较 `remoteLm + 1000 < localMeta.lastModified`，云端更旧即拦截。
2. **本地备份**：下载覆盖前先把当前本地数据快照写回 `localStorage`（`auralflow.mobile.*` 备份键），失败仅告警不中断。
3. **`assertCloudNotStale(kind, remoteText, localCount, force)`**：解析云端 `lastModified`，若云端更旧且本地有数据 → 抛出「请强制下载」错误，提示用户 `force: true` 覆盖；`force` 跳过拦截。

> `uploadPlaylistsSync` 在覆盖远端后，把刚写入的 `body.lastModified` 写回本地 `lastModified` 标记，避免下一次下载被 `assertCloudNotStale` 误判为「云端较旧」而拦截（对齐 `uploadSourcesSync`）。

## 4. 合并策略

合并算法在 `@lx/core` 的 `webdav-merge.ts`，纯函数无副作用，规则见文件头注释：

| 方向 | 策略 | 说明 |
| --- | --- | --- |
| 下载 | **merge（非 overwrite）** | `mergeWebdavSongs` / `mergeWebdavLocalPlaylists` / `mergeWebdavCloudPlaylists`（来自 `@lx/core`）做加法合并 |
| 上传 | **overwrite** | 本地整体序列化覆盖远端 |
| 自动同步 | **download-merge-then-upload-converge** | 先下载合并入本地，再把收敛后的本地状态上传 |

合并细节（`playlistStore.mergeFromSync` 调用）：

- **收藏**：本地 + 远端按 `source:id` 取**并集**去重（`mergeWebdavSongs`，`songKey = ${source}:${id}`）。
- **历史**：按 `source:id` 并集，按输入顺序截断上限。
- **本地歌单**：同名 id 按 `updatedAt` 新者胜，歌曲保留**并集**（`mergeWebdavLocalPlaylists`）。
- **云端引用歌单（网易云等）**：按 `id` 取并集，保留较新者（`mergeWebdavCloudPlaylists`）。
- **删除永不传播**：「不同步删除：本地有而远端无的实体保留本地版本」——删歌 / 删歌单只在本地生效，不会因同步把删除扩散到其他设备。

`downloadPlaylistsSync` 默认 `merge: true`；`merge: false` 时用云端整体替换本地；`force: true` 跳过「云端较旧」拦截。

## 5. 歌单管理（playlistStore 656 行）

`src/stores/playlistStore.ts` 统一管理三类歌单与收藏，所有远端写操作经 `LatestRequestGate` 防竞态。

### 网易云歌单 CRUD

- `createWyPlaylist(name, description)` → `createWyPlaylistApi`
- `updateWyPlaylistInfo(playlistId, { name, description })` → `updateWyPlaylistInfoApi`
- `deleteWyPlaylist(playlistId)` → `deleteWyPlaylistApi`（同步从 `playlists` 移除并持久化）

### 本地歌单 CRUD（`localPlaylistModel`）

- `createLocalPlaylist` / `createLocalPlaylistWithSong(s)` / `duplicateLocalPlaylist`
- `renameLocalPlaylist` / `deleteLocalPlaylist`
- `addSongsToLocalPlaylist`（返回 `{ addedCount, skippedCount }`，去重）/ `removeSongFromLocalPlaylist`

### 收藏

- `likeSong(song)` / `unlikeSong(song)`：网易云歌曲走 `likeSongApi` / `unlikeSongApi`，其余源仅本地标记。
- `likedSongIds: Set<string>`：以 `Set` 存储，`isLiked(songId)` 为 O(1) 查找。
- `LatestRequestGate`：`playlistDetailRequestGate` 保证快速切换歌单时只保留最后一次请求结果，丢弃过期响应。

## 6. 持久化

| 数据 | 存储 key | 介质 |
| --- | --- | --- |
| 网易云歌单 | — | AsyncStorage（store 内序列化） |
| 本地歌单 | `auralflow.mobile.localPlaylists` | AsyncStorage |
| 收藏 | `auralflow.mobile.likedSongs` | AsyncStorage |

登录态下网易云歌单随 `playlistStore` 写回 AsyncStorage；本地歌单与收藏有独立 key，与同步备份用的 `localStorage` 快照区分。

## 7. B 站收藏同步（biliAccountStore）

`src/stores/biliAccountStore.ts` 管理 B 站账号与收藏夹同步：

- **收藏夹列表**：拉取当前账号可见的收藏夹并缓存。
- **`collectionCache` LRU(20)**：模块级 `Map<string, MusicInfo[]>`，写入时删旧再 set，超出 `COLLECTION_CACHE_MAX = 20` 淘汰最久未用键，避免会话内无限增长；登出 / 切号时 `collectionCache.clear()`。
- **可见性偏好持久化**：每个收藏夹的显隐偏好写入 AsyncStorage，启动时异步恢复。
- **`autoShowNewCollections`**：默认 `false`，即新拉取的收藏夹**自动隐藏**，需用户手动开启才显示，避免收藏夹列表被噪声淹没。

## 同步流程总览

```text
用户登录
    ↓
fetchPlaylists(userId) → playlistStore.playlists        // 网易云歌单
fetchLikedSongs(userId) → likedSongIds                   // 收藏 id
    ↓（用户开启 WebDAV 自动同步）
autoSyncPlaylistsOnce()  ──单飞──→  withSyncLock
    ├─ downloadPlaylistsSync(merge:true)
    │     ├─ assertCloudNotStale（云端更旧→拦截/提示强制下载）
    │     ├─ 本地备份 → localStorage
    │     └─ mergeFromSync（@lx/core 加法合并，删除不传播）
    └─ uploadPlaylistsSync()  ──overwrite──→ 收敛后状态回写云端
```

## 已知限制

- **网易云 API 需 Cookie**：所有歌单 / 收藏接口需登录态，Cookie 过期需重新登录。
- **请求频率**：可能存在频率限制，建议配合请求缓存。
- **歌单数量**：当前获取上限 1000 个，实际用户很少超过。
- **删除不跨设备**：因「删除永不传播」，在 A 设备删歌不会自动从 B 设备移除，需手动处理。
