import { hashLocalFile } from '@lx/tauri-bridge';
import {
  buildLocalLyricsChoicePatch,
  buildLocalLyricsFingerprint,
  isLocalLyricsChoiceBound,
  localLyricsModeOf,
  parseLocalLyricsFingerprint,
  DEFAULT_LOCAL_LYRICS_MODE,
  type LocalLyricsChoiceFields,
  type LocalLyricsChoicePatch,
  type LocalLyricsMode,
} from '@/services/localLyricsChoiceModel';

/**
 * 改名 / 移动后把歌词选择认回来的「孤儿表」。
 *
 * 为什么需要它：桌面端的曲库记录 id 是 `md5(路径)`（Rust 侧 `local_audio.rs` 生成），文件一改名 /
 * 一移动就是**另一条记录**；而选择只挂在记录上，于是用户刚选好的词会随着一次重命名凭空消失。
 * 记录无法跨路径追踪，但内容可以：选择本来就绑定在内容指纹上，所以记录消失时把选择按
 * `md5(内容)` 搬进这张表，扫描合并后再按内容认回新记录。
 *
 * 代价控制：认回要读一遍文件算 md5（整文件读盘），因此先用条目上的 `size` 做一级筛选，
 * 只有 size 恰好与某个孤儿条目相同时才真的去哈希（见 `rebindLocalLyricsChoices`）。
 * 孤儿表通常空着或只有几条 → 候选集极小，绝不对整库每个文件哈希。
 *
 * 为什么要有上限：文件是被真的删掉（不是改名）时孤儿永远认不回来，没有上限就会随
 * 「删歌 / 换目录 / 反复改名」无限堆积，而每条都背着整份歌词文本。
 */
export const MAX_LOCAL_LYRICS_ORPHANS = 200;

/** 孤儿表里的一条：一份被解开绑定的选择，以及重新绑定它需要的全部证据。 */
export interface LocalLyricsOrphanEntry {
  /** md5(内容)：表的键，也是重绑时要核对的东西。 */
  contentHash: string;
  /** 做出选择时文件的大小（字节）：先比它再决定要不要读文件（零 IO 的一级筛选）。 */
  size: number;
  /** 搬过来的选择；表里不会有 auto——auto 不是选择，没有可搬的东西。 */
  mode: Exclude<LocalLyricsMode, 'auto'>;
  /** picked 的那一份文本；local-only 没有文本。 */
  lyricsOverride?: string;
  /** 面板上显示过的来源标注（不参与判定，原样搬回去）。 */
  lyricsSourceLabel?: string;
  /** 入表时间，只用于超限淘汰（越旧越先被丢）。 */
  savedAt: number;
}

/** 按内容哈希索引的孤儿表：`contentHash → entry`。 */
export type LocalLyricsOrphanTable = Record<string, LocalLyricsOrphanEntry>;

/**
 * 重绑只需要的记录形状：不 import `LocalSong`，避免服务之间互相依赖
 * （与 `localLyricsChoiceModel.LocalLyricsChoiceInput` 同一手法）。
 */
export interface LocalLyricsOrphanSong extends LocalLyricsChoiceFields {
  id: string;
  path: string;
  size?: number;
  lyricsOverride?: string;
}

export interface LocalLyricsOrphanRebind {
  /** 认回成功的记录 id → 写回记录的补丁（与用户在面板上做出的选择完全同形）。 */
  patchById: Map<string, LocalLyricsChoicePatch>;
  /** 已完成使命的孤儿哈希：调用方从表里删掉它们。 */
  consumedHashes: string[];
}

/**
 * 把一批「这次扫描合并会消失的记录」上的选择记进孤儿表。
 *
 * 只在选择**此刻仍然成立**时记（`isLocalLyricsChoiceBound`）：大小已经对不上的选择早就失效了
 * （`resolveLocalLyricsChoice` 已按 auto 处理），搬进表只会在下次扫描里白白触发一次读盘。
 *
 * 相同内容的多个文件（内容完全一样的重复曲）共用同一个哈希键，后来者覆盖前者：两种情况下
 * 能认回的文本都只是「这一份内容对应的选择」，没有区别。
 */
export function recordLocalLyricsChoiceOrphans(
  table: LocalLyricsOrphanTable,
  removedSongs: readonly LocalLyricsOrphanSong[],
  now: number,
): LocalLyricsOrphanTable {
  let next: LocalLyricsOrphanTable | null = null;
  for (const song of removedSongs) {
    const entry = orphanEntryOf(song, now);
    if (!entry) continue;
    next = { ...(next ?? table), [entry.contentHash]: entry };
  }
  // 没记下任何东西就返回原对象：zustand 的引用比较据此跳过无谓的写盘与重渲染。
  if (!next) return table;
  return evictExcessOrphans(next);
}

/**
 * 删掉已被认回的孤儿条目。没有可删的就返回原对象（理由同上）。
 */
export function dropLocalLyricsOrphans(
  table: LocalLyricsOrphanTable,
  contentHashes: readonly string[],
): LocalLyricsOrphanTable {
  if (contentHashes.length === 0) return table;
  const next: LocalLyricsOrphanTable = { ...table };
  for (const contentHash of contentHashes) delete next[contentHash];
  return next;
}

/**
 * 读盘数据的兜底：旧版本没有这张表，手改 / 损坏的 JSON 也可能塞进任何东西。
 * 认不出的条目一律丢弃——重绑会拿它去覆盖曲库记录，不能拿不确定的数据当真。
 */
export function normalizeLocalLyricsOrphanTable(raw: unknown): LocalLyricsOrphanTable {
  if (!raw || typeof raw !== 'object') return {};
  const table: LocalLyricsOrphanTable = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = normalizeOrphanEntry(key, value);
    if (entry) table[entry.contentHash] = entry;
  }
  return evictExcessOrphans(table);
}

/**
 * 自动重绑：对**没有选择**的记录，按内容把孤儿表里的选择认回来。
 *
 * 「只对 size 吻合者哈希」就落在下面两步的顺序里：先用 `size` 在孤儿表里取候选（纯内存比较，
 * 零 IO），只有取到候选才 `hashLocalFile`——每一次调用都是一遍整文件读盘，扫描路径上绝不允许
 * 全库遍历哈希；孤儿表通常是空的，于是常态是零次调用。
 *
 * 认回后记录上带着指纹，下一次扫描时它已不是「没有选择」的记录，不会再被哈希：
 * 同一份内容不会被反复读盘。
 */
export async function rebindLocalLyricsChoices({
  songs,
  table,
}: {
  songs: readonly LocalLyricsOrphanSong[];
  table: LocalLyricsOrphanTable;
}): Promise<LocalLyricsOrphanRebind> {
  const patchById = new Map<string, LocalLyricsChoicePatch>();
  const consumedHashes: string[] = [];

  const orphansBySize = groupOrphanEntriesBySize(table);
  if (orphansBySize.size === 0) return { patchById, consumedHashes };

  for (const song of songs) {
    // 已经有明确选择的记录不碰：不清、不读盘。用户的意志优先于孤儿表里的旧选择。
    if (localLyricsModeOf(song) !== DEFAULT_LOCAL_LYRICS_MODE) continue;
    if (typeof song.size !== 'number' || !Number.isFinite(song.size)) continue;

    // 一级筛选（廉价、零 IO）：size 与任何孤儿条目都不吻合就绝不打开文件。
    const candidates = orphansBySize.get(song.size);
    if (!candidates?.length) continue;

    const contentHash = await hashLocalFileQuietly(song.path);
    if (!contentHash) continue;
    // 一个候选就可能是几 MB 的读盘，所以哈希每条记录只算一次，再与候选逐个比对。
    const matched = candidates.find((entry) => entry.contentHash === contentHash);
    if (!matched) continue;
    // 文本没了的选择搬回去也是失效的。理论上不会出现（入表与读盘都已筛过），
    // 兜住的是被外部改坏的持久化数据。
    if (matched.mode === 'picked' && !matched.lyricsOverride?.trim()) continue;

    // 指纹按**记录当前的大小**重建：size 相等是这次匹配的前提，所以重建出来的串与
    // 「用户此刻重新选一次」得到的完全一样（见 buildLocalLyricsFingerprint）。
    const fingerprint = buildLocalLyricsFingerprint(song.size, matched.contentHash);
    patchById.set(
      song.id,
      buildLocalLyricsChoicePatch(
        matched.mode === 'picked'
          ? {
              type: 'picked',
              fingerprint,
              sourceLabel: matched.lyricsSourceLabel ?? '',
              text: matched.lyricsOverride ?? '',
            }
          : { type: 'local-only', fingerprint },
      ),
    );
    consumedHashes.push(matched.contentHash);
  }

  return { patchById, consumedHashes };
}

/**
 * 一条即将消失的记录 → 一条孤儿条目（不值得记则 null）。
 */
function orphanEntryOf(song: LocalLyricsOrphanSong, now: number): LocalLyricsOrphanEntry | null {
  // 与 'auto' 字面量比较（而不是 DEFAULT_LOCAL_LYRICS_MODE）才能让 TS 把 mode 收窄成
  // 「不是 auto 的那两态」，与条目类型的定义对上。
  const mode = localLyricsModeOf(song);
  if (mode === 'auto') return null;
  if (!isLocalLyricsChoiceBound(song, song.size)) return null;
  const parsed = parseLocalLyricsFingerprint(song.lyricsFingerprint);
  if (!parsed) return null;
  // picked 的文本就是选择的全部内容：文本没了（旧数据 / 被外部清掉）等于没有选择。
  if (mode === 'picked' && !song.lyricsOverride?.trim()) return null;
  return {
    contentHash: parsed.contentHash,
    size: parsed.size,
    mode,
    ...(mode === 'picked' ? { lyricsOverride: song.lyricsOverride } : {}),
    ...(song.lyricsSourceLabel?.trim() ? { lyricsSourceLabel: song.lyricsSourceLabel } : {}),
    savedAt: now,
  };
}

function normalizeOrphanEntry(key: string, value: unknown): LocalLyricsOrphanEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof LocalLyricsOrphanEntry, unknown>>;
  // 键与条目里的 contentHash 以条目自身为准；条目缺了就退回表键（旧格式的可能差异）。
  const contentHash = typeof raw.contentHash === 'string' && raw.contentHash.trim()
    ? raw.contentHash.trim()
    : key.trim();
  if (!contentHash) return null;
  if (raw.mode !== 'picked' && raw.mode !== 'local-only') return null;
  if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size < 0) return null;
  const lyricsOverride = typeof raw.lyricsOverride === 'string' ? raw.lyricsOverride : undefined;
  if (raw.mode === 'picked' && !lyricsOverride?.trim()) return null;
  const lyricsSourceLabel = typeof raw.lyricsSourceLabel === 'string' ? raw.lyricsSourceLabel : undefined;
  return {
    contentHash,
    size: raw.size,
    mode: raw.mode,
    ...(lyricsOverride ? { lyricsOverride } : {}),
    ...(lyricsSourceLabel ? { lyricsSourceLabel } : {}),
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
  };
}

/**
 * 超限淘汰：只保留最近 N 条（`savedAt` 最旧的先丢）。
 *
 * 为什么选这个策略：孤儿表的命就是「被认回」，认不回的条目只会越来越旧（文件真被删了、
 * 或内容改得对不上了），所以「越旧越先丢」不需要额外维护命中计数就能自然收敛；
 * 反过来，刚改名 / 刚移动的那批选择才最可能马上要认回，它们的时间戳最新，会被留住。
 * N 的取值见 MAX_LOCAL_LYRICS_ORPHANS 的说明。
 */
function evictExcessOrphans(table: LocalLyricsOrphanTable): LocalLyricsOrphanTable {
  const entries = Object.values(table);
  if (entries.length <= MAX_LOCAL_LYRICS_ORPHANS) return table;
  const kept = [...entries]
    .sort((left, right) => left.savedAt - right.savedAt)
    .slice(entries.length - MAX_LOCAL_LYRICS_ORPHANS);
  const next: LocalLyricsOrphanTable = {};
  for (const entry of kept) next[entry.contentHash] = entry;
  return next;
}

/** `size → 该大小的所有孤儿`；只有命中的记录才会被读盘，因此候选桶要按大小现成。 */
function groupOrphanEntriesBySize(
  table: LocalLyricsOrphanTable,
): Map<number, LocalLyricsOrphanEntry[]> {
  const grouped = new Map<number, LocalLyricsOrphanEntry[]>();
  for (const entry of Object.values(table)) {
    const bucket = grouped.get(entry.size);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.size, [entry]);
  }
  return grouped;
}

/**
 * 算内容哈希；失败（扫描之后文件又被删掉 / 挪走 / 读不出来）当作没匹配上。
 * 一次重绑不该让整次刷新失败，孤儿留在表里等下次扫描（上限兜底）。
 */
async function hashLocalFileQuietly(path: string): Promise<string | null> {
  try {
    const contentHash = (await hashLocalFile(path)).trim();
    return contentHash ? contentHash : null;
  } catch {
    return null;
  }
}
