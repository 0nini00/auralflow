# 封面和歌词缓存功能实现总结

## [完成] 已完成功能

### 1️⃣ **封面缓存**
- [完成] 自动下载并缓存封面图片到本地
- [完成] 优先使用缓存，减少网络请求
- [完成] 基于 URL 的 MD5 文件命名（crypto-js）
- [完成] 30天缓存有效期

### 2️⃣ **歌词缓存**
- [完成] 自动缓存已加载的歌词
- [完成] 离线访问歌词
- [完成] 基于歌曲 ID 的文件命名
- [完成] JSON 格式持久化

### 3️⃣ **缓存管理**
- [完成] 查看缓存大小
- [完成] 清理过期缓存（30天以上）
- [完成] 清空所有缓存
- [完成] 100MB 容量限制（可配置）

---

## 文件 新增文件

```
apps/mobile/src/
├── services/
│   └── cacheService.ts          # 缓存核心服务
└── components/
    ├── CachedImage.tsx          # 带缓存的图片组件
    └── CacheSettings.tsx        # 缓存管理 UI
```

---

## 目标 核心实现

### cacheService.ts

**封面缓存**
```typescript
export async function cacheCover(url: string): Promise<string | null> {
  const filePath = getCacheFilePath(url, "cover");

  // 检查缓存
  if (await isCacheValid(filePath)) {
    return `file://${filePath}`;
  }

  // 下载并缓存
  await RNFS.downloadFile({ fromUrl: url, toFile: filePath }).promise;
  return `file://${filePath}`;
}
```

**歌词缓存**
```typescript
export async function cacheLyrics(
  song: MusicInfo,
  lyrics: Array<{ time: number; text: string }>
): Promise<void> {
  const key = `${song.source}-${song.id}`;
  const filePath = getCacheFilePath(key, "lyric");

  const data = {
    song: { id, name, singer, source },
    lyrics,
    cachedAt: Date.now(),
  };

  await RNFS.writeFile(filePath, JSON.stringify(data), "utf8");
}
```

### CachedImage.tsx

**智能图片加载**
```typescript
export function CachedImage({ uri, fallback, style, ...props }) {
  useEffect(() => {
    const loadImage = async () => {
      // 1. 尝试从缓存加载
      const cached = await getCachedCover(uri);
      if (cached) {
        setImageUri(cached);
        return;
      }

      // 2. 使用原始 URI
      setImageUri(uri);

      // 3. 异步缓存
      cacheCover(uri);
    };

    void loadImage();
  }, [uri]);

  return <Image source={{ uri: imageUri }} style={style} />;
}
```

### playerService.ts 集成

**播放时自动缓存**
```typescript
export async function playSong(song: MusicInfo) {
  // 1. 播放歌曲
  await play(song, url);

  // 2. 加载歌词（优先缓存）
  const cachedLyrics = await getCachedLyrics(song);
  if (cachedLyrics) {
    setLyrics(cachedLyrics);
  } else {
    const lyrics = await getLyrics(song);
    setLyrics(lyrics);
    await cacheLyrics(song, lyrics);
  }

  // 3. 异步缓存封面
  if (song.picUrl) {
    cacheCover(song.picUrl);
  }
}
```

---

## 数据 缓存策略

### 存储结构
```
CachesDirectory/auralflow/
├── covers/
│   ├── 1a2b3c4d.jpg
│   ├── 5e6f7g8h.jpg
│   └── ...
└── lyrics/
    ├── wy-1995065917.json
    ├── tx-0039MnYb0qxYhV.json
    └── ...
```

### 缓存配置
```typescript
const MAX_CACHE_SIZE = 100 * 1024 * 1024;  // 100MB
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000;  // 30天
```

### 文件命名
- **封面**：URL 哈希 + `.jpg`
- **歌词**：`{source}-{id}.json`

---

## 同步 使用流程

### 封面加载流程
```
用户播放歌曲
    ↓
CachedImage 组件
    ↓
检查缓存 (getCachedCover)
    ├── 有缓存 → 返回 file:// 路径 (立即显示)
    └── 无缓存 → 使用原始 URL + 异步下载到缓存
```

### 歌词加载流程
```
播放歌曲 (playSong)
    ↓
加载歌词 (loadLyrics)
    ↓
检查缓存 (getCachedLyrics)
    ├── 有缓存 → 立即显示
    └── 无缓存 → 从网络获取 + 缓存到本地
```

---

## 样式 UI 更新

### 更新的组件
- [完成] `SongList.tsx` - 使用 CachedImage
- [完成] `MiniPlayer.tsx` - 使用 CachedImage
- [完成] `PlayerScreen.tsx` - 使用 CachedImage

### 新增的组件
- [完成] `CachedImage.tsx` - 带缓存的图片组件
- [完成] `CacheSettings.tsx` - 缓存管理界面

---

## 依赖 新增依赖

```json
{
  "react-native-fs": "^2.20.0"
}
```

---

## 性能 性能提升

### 网络请求减少
- **首次播放**：下载封面 + 歌词
- **再次播放**：直接使用缓存（0 网络请求）

### 加载速度提升
- **封面**：本地读取速度 >> 网络下载
- **歌词**：即时显示，无需等待网络

### 流量节省
- 重复播放歌曲不消耗流量
- 30天内多次播放相同封面只下载一次

---

## 配置️ 配置选项

### 缓存大小限制
```typescript
const MAX_CACHE_SIZE = 100 * 1024 * 1024;  // 可调整
```

### 缓存有效期
```typescript
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000;  // 可调整
```

### 哈希算法
[完成] 已改用真正 MD5：
```typescript
import CryptoJS from "crypto-js";
const hash = CryptoJS.MD5(url).toString();  // 32 位小写十六进制
```

---

## 测试 测试建议

### 手动测试
1. [完成] 播放新歌曲 → 观察封面加载 → 检查缓存目录
2. [完成] 断开网络 → 重新播放相同歌曲 → 验证离线访问
3. [完成] 查看缓存大小 → 验证准确性
4. [完成] 清理过期缓存 → 验证文件删除
5. [完成] 清空所有缓存 → 验证完全清除

### 性能测试
```bash
# 查看缓存目录
adb shell ls -lah /data/data/cn.chenle.auralflow.mobile/cache/auralflow

# 查看缓存大小
adb shell du -sh /data/data/cn.chenle.auralflow.mobile/cache/auralflow
```

---

## 后续 后续优化

### 高优先级（均已实现 [完成]）
#### [完成] 使用真正的 MD5 哈希（而非简单哈希）
- `getCacheFileName` 改用 `crypto-js` 的 `CryptoJS.MD5(url)`（32 位小写十六进制）；切换后旧文件名不再命中，首次重新下载一次

#### [完成] 缓存预加载（播放队列附近多首）
- `playerService.prefetchNearbySongs()` — 预读上一首 + 下两首（与桌面 `PREFETCH_OFFSETS=[-1,1,2]` 一致）

#### [完成] 缓存大小自动清理（超过 100MB 时）
- `cacheEvictionModel.selectFilesToEvict()` + `cacheService.enforceCacheSizeLimit()`
- 写入封面/歌词/音频后去抖触发；超上限时按 mtime 最旧优先（LRU）淘汰，直到低于 `MAX_CACHE_SIZE`

### 中优先级
- [ ] 压缩封面图片（减少存储空间）
- [ ] 缓存命中率统计
- [ ] 后台定期清理过期缓存

### 低优先级
- [ ] 支持多质量封面（高清/缩略图）
- [ ] 歌词搜索索引（快速查找）
- [ ] 导出/导入缓存

---

## 说明 使用示例

### 在现有组件中使用
```tsx
import { CachedImage } from "@/components/CachedImage";

// 替换 Image 组件
<CachedImage
  uri={song.picUrl}
  style={styles.cover}
  fallback={<Text>AF</Text>}
/>
```

### 手动缓存
```typescript
import { cacheCover, cacheLyrics } from "@/services/cacheService";

// 缓存封面
await cacheCover("https://example.com/cover.jpg");

// 缓存歌词
await cacheLyrics(song, lyrics);
```

### 管理缓存
```typescript
import { getCacheSize, clearAllCache } from "@/services/cacheService";

// 获取缓存大小
const size = await getCacheSize();
console.log(`缓存: ${formatCacheSize(size)}`);

// 清空缓存
await clearAllCache();
```

---

## 完成 总结

[完成] **封面缓存** - 自动下载并缓存到本地
[完成] **歌词缓存** - 离线访问已播放歌曲的歌词
[完成] **缓存管理** - 清理过期文件、查看缓存大小
[完成] **性能提升** - 减少网络请求、提升加载速度
[完成] **流量节省** - 重复播放不消耗流量

**下一步建议：网易云账号登录** 安全
