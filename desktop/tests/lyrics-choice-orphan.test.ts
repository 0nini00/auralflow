import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 改名 / 移动后按内容把歌词选择认回来（孤儿表 + 自动重绑）。
 *
 * 桌面端的记录 id 是 `md5(路径)`，换个文件名就是另一条记录，选择若只挂在记录上就会跟着消失。
 * 记录消失时选择按 `md5(内容)` 进孤儿表，新记录进库时再按内容认回。这里钉住：
 *  1. 改名后重绑：新 id / 新 path、size 相同 → 选择被搬回（picked 的文本仍在，local-only 也搬）；
 *  2. 只有 size 吻合的记录才被读到（`hash_local_file` 调用次数即证），绝不全库哈希；
 *  3. 内容真的换了（size 不同）时不哈希、不搬回，记录停在 auto；
 *  4. 认回即清孤儿，之后不再重复读盘。
 */

const bridge = vi.hoisted(() => ({
  hashLocalFile: vi.fn(),
  libraryLoad: vi.fn(),
  librarySave: vi.fn(),
}));
vi.mock('@lx/tauri-bridge', () => bridge);
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { useLibraryStore } from '../src/stores/libraryStore';
import { LocalMusicService, type LocalSong } from '../src/services/localMusicService';
import {
  MAX_LOCAL_LYRICS_ORPHANS,
  normalizeLocalLyricsOrphanTable,
  recordLocalLyricsChoiceOrphans,
  type LocalLyricsOrphanTable,
} from '../src/services/localLyricsChoiceOrphan';
import {
  buildLocalLyricsFingerprint,
  localLyricsModeOf,
  resolveLocalLyricsChoice,
} from '../src/services/localLyricsChoiceModel';

const SIZE = 4096;
const CONTENT_HASH = 'a'.repeat(32);
const FINGERPRINT = buildLocalLyricsFingerprint(SIZE, CONTENT_HASH);
const LYRICS = '[00:01]选中的词';

const song = (extra: Partial<LocalSong> & Pick<LocalSong, 'id' | 'path'>): LocalSong => ({
  title: '日',
  artist: '歌手',
  album: '专辑',
  duration: 200,
  format: 'flac',
  size: SIZE,
  isLocal: true,
  ...extra,
});

const pickedSong = song({
  id: 'id-before',
  path: 'F:\\music\\before.flac',
  lyricsMode: 'picked',
  lyricsFingerprint: FINGERPRINT,
  lyricsSourceLabel: '网易云',
  lyricsOverride: LYRICS,
});

/** 改名 / 移动之后的同内容文件：新 id、新路径，来自扫描结果，不带任何歌词选择字段。 */
const renamedSong = song({ id: 'id-after', path: 'F:\\music\\after.flac' });

/** 让 LocalMusicService.scanDirectory 返回给定的扫描结果（本层只关心合并与重绑）。 */
const scanReturns = (songs: LocalSong[]) =>
  vi.spyOn(LocalMusicService, 'scanDirectory').mockResolvedValue(songs);

const libraryOf = () => useLibraryStore.getState();
const songsById = (id: string) => libraryOf().localSongs.find((item) => item.id === id);

/**
 * 改名 → 重新扫描 → 重新添加目录，并等到后台重绑落地。
 *
 * 两步是分开的：重新扫描只做「旧记录消失」（新文件不会自动并进曲库，这是既有的合并语义，
 * 免得把用户手动移除过的歌又拉回来）；用户重新添加目录 / 文件时新记录才进库，重绑在那时发生。
 */
const renameThenReAdd = async () => {
  scanReturns([renamedSong]);
  await libraryOf().refreshLibrary();
  libraryOf().addSongs([renamedSong]);
  // 重绑要先读一遍文件哈希（一整轮微任务），等到记录上出现明确选择为止
  await vi.waitFor(() => expect(songsById('id-after')?.lyricsMode).toBeDefined());
};

beforeEach(() => {
  vi.resetAllMocks();
  bridge.libraryLoad.mockResolvedValue(null);
  bridge.librarySave.mockResolvedValue(undefined);
  useLibraryStore.setState({ localSongs: [], scanPaths: ['F:\\music'], lyricsChoicesByHash: {}, isScanning: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('扫描合并后的自动重绑', () => {
  it('改名 / 移动（新 id + 新 path，内容不变）后把选择搬回新记录', async () => {
    useLibraryStore.setState({ localSongs: [pickedSong] });
    bridge.hashLocalFile.mockResolvedValue(CONTENT_HASH);

    scanReturns([renamedSong]);
    const result = await libraryOf().refreshLibrary();

    // 旧记录消失，选择按内容进了孤儿表；此时还没有新记录可搬，读盘次数为 0
    expect(result).toMatchObject({ removed: 1, added: 1 });
    expect(bridge.hashLocalFile).not.toHaveBeenCalled();
    expect(Object.keys(libraryOf().lyricsChoicesByHash)).toEqual([CONTENT_HASH]);
    // 用户重新添加目录 / 这些文件：新记录进库时按内容认回（先读一遍文件哈希，多等一轮微任务）
    libraryOf().addSongs([renamedSong]);
    await vi.waitFor(() => expect(songsById('id-after')?.lyricsMode).toBe('picked'));
    expect(bridge.hashLocalFile).toHaveBeenCalledTimes(1);

    // 只读了一遍文件，而且读的是改名后的新路径
    expect(bridge.hashLocalFile).toHaveBeenCalledWith('F:\\music\\after.flac');
    expect(libraryOf().localSongs.map((item) => item.id)).toEqual(['id-after']);
    expect(songsById('id-after')).toMatchObject({
      lyricsMode: 'picked',
      lyricsOverride: LYRICS,
      lyricsSourceLabel: '网易云',
      lyricsFingerprint: FINGERPRINT,
    });
    // 指纹与 size 对得上：判定仍然走 picked（不是「搬回来了但已失效」）
    expect(resolveLocalLyricsChoice(songsById('id-after') ?? {})).toMatchObject({
      mode: 'picked',
      expired: false,
      text: LYRICS,
    });
    // 认回即清孤儿：表里不留这一条
    expect(libraryOf().lyricsChoicesByHash).toEqual({});
  });

  it('「不要匹配」也随改名一起搬回，且仍然不携带任何文本', async () => {
    useLibraryStore.setState({
      localSongs: [song({
        id: 'id-before',
        path: 'F:\\music\\before.flac',
        lyricsMode: 'local-only',
        lyricsFingerprint: FINGERPRINT,
        embeddedLyrics: '[00:01]内嵌词',
      })],
    });
    bridge.hashLocalFile.mockResolvedValue(CONTENT_HASH);

    await renameThenReAdd();

    const rebound = songsById('id-after');
    expect(rebound).toMatchObject({ lyricsMode: 'local-only', lyricsFingerprint: FINGERPRINT });
    expect(rebound?.lyricsOverride).toBeUndefined();
    expect(resolveLocalLyricsChoice(rebound ?? {})).toMatchObject({ mode: 'local-only', expired: false });
  });

  it('扫描合并时只对 size 吻合的候选哈希：不同 size 的记录与孤儿一次都不读盘', async () => {
    const sameSize = [
      song({ id: 'a', path: 'F:\\music\\a.flac' }),
      song({ id: 'b', path: 'F:\\music\\b.flac' }),
    ];
    const otherSize = song({ id: 'c', path: 'F:\\music\\c.flac', size: 8192 });
    const unmatchedHash = 'b'.repeat(32);
    useLibraryStore.setState({
      localSongs: [...sameSize, otherSize],
      lyricsChoicesByHash: {
        [CONTENT_HASH]: {
          contentHash: CONTENT_HASH, size: SIZE, mode: 'picked',
          lyricsOverride: '[00:01]孤儿词', lyricsSourceLabel: '网易云', savedAt: 1,
        },
        [unmatchedHash]: { contentHash: unmatchedHash, size: 9999, mode: 'local-only', savedAt: 2 },
      },
    });
    // 两条同 size 的记录内容不同：只有 b 与孤儿内容一致
    bridge.hashLocalFile.mockImplementation(async (path: string) =>
      path === 'F:\\music\\b.flac' ? CONTENT_HASH : 'c'.repeat(32),
    );
    scanReturns([...sameSize, otherSize]);

    await libraryOf().refreshLibrary();

    // 恰好是「size 吻合的两条」：8192 那条没有对应孤儿，9999 那个孤儿没有任何记录，都不产生哈希
    expect(bridge.hashLocalFile).toHaveBeenCalledTimes(2);
    expect(bridge.hashLocalFile.mock.calls.map(([path]) => path).sort())
      .toEqual(['F:\\music\\a.flac', 'F:\\music\\b.flac']);

    expect(songsById('b')).toMatchObject({ lyricsMode: 'picked', lyricsOverride: '[00:01]孤儿词' });
    // 内容不吻合的那条保持 auto，不搬回
    expect(songsById('a')?.lyricsMode).toBeUndefined();
    expect(localLyricsModeOf(songsById('a') ?? {})).toBe('auto');
    // 没被认回的孤儿（包括 size 对不上的那条）继续留在表里等下次扫描
    expect(Object.keys(libraryOf().lyricsChoicesByHash)).toEqual([unmatchedHash]);
  });

  it('认回后记录带着指纹：之后既不再重复读盘，也不会丢失选择', async () => {
    useLibraryStore.setState({ localSongs: [pickedSong] });
    bridge.hashLocalFile.mockResolvedValue(CONTENT_HASH);

    await renameThenReAdd();
    expect(bridge.hashLocalFile).toHaveBeenCalledTimes(1);

    // 再扫描一次：记录已有明确选择，不再是重绑候选 —— 依旧零读盘，选择原样留着
    scanReturns([renamedSong]);
    await libraryOf().refreshLibrary();
    expect(bridge.hashLocalFile).toHaveBeenCalledTimes(1);
    expect(songsById('id-after')).toMatchObject({ lyricsMode: 'picked', lyricsFingerprint: FINGERPRINT });

    // 再添加一次同一个文件：同 id 已存在，直接跳过，不覆盖刚认回的选择
    libraryOf().addSongs([renamedSong]);
    expect(bridge.hashLocalFile).toHaveBeenCalledTimes(1);
    expect(songsById('id-after')).toMatchObject({ lyricsOverride: LYRICS });
  });

  it('已有明确选择的记录不参与重绑：size 吻合也不读盘、不被孤儿覆盖', async () => {
    const ownChoice = song({
      id: 'own',
      path: 'F:\\music\\own.flac',
      lyricsMode: 'picked',
      lyricsFingerprint: buildLocalLyricsFingerprint(SIZE, 'd'.repeat(32)),
      lyricsSourceLabel: 'LRCLIB',
      lyricsOverride: '[00:01]我自己的词',
    });
    useLibraryStore.setState({
      localSongs: [ownChoice],
      lyricsChoicesByHash: {
        [CONTENT_HASH]: {
          contentHash: CONTENT_HASH, size: SIZE, mode: 'picked',
          lyricsOverride: '[00:01]孤儿词', savedAt: 1,
        },
      },
    });
    scanReturns([ownChoice]);

    await libraryOf().refreshLibrary();

    expect(bridge.hashLocalFile).not.toHaveBeenCalled();
    expect(songsById('own')).toMatchObject({ lyricsOverride: '[00:01]我自己的词', lyricsSourceLabel: 'LRCLIB' });
    expect(Object.keys(libraryOf().lyricsChoicesByHash)).toEqual([CONTENT_HASH]);
  });

  it('内容被换掉（同路径但 size 变了）时选择照旧静默失效，也不会去读盘', async () => {
    // 路径没变 → id 没变 → 记录还在，只是 size 被刷新；重绑层不该对它有动作
    useLibraryStore.setState({ localSongs: [pickedSong] });
    scanReturns([song({ id: 'id-before', path: 'F:\\music\\before.flac', size: SIZE * 2 })]);

    await libraryOf().refreshLibrary();

    expect(bridge.hashLocalFile).not.toHaveBeenCalled();
    expect(resolveLocalLyricsChoice(songsById('id-before') ?? {})).toMatchObject({ mode: 'auto', expired: true });
    expect(libraryOf().lyricsChoicesByHash).toEqual({});
  });

  it('改名且内容也变了（size 不同）时不哈希、不搬回：新记录停在 auto', async () => {
    useLibraryStore.setState({ localSongs: [pickedSong] });
    const replaced = song({ id: 'id-after', path: 'F:\\music\\after.flac', size: SIZE + 512 });

    scanReturns([replaced]);
    const result = await libraryOf().refreshLibrary();
    libraryOf().addSongs([replaced]);
    // 让 addSongs 里的后台重绑有机会跑完：它连候选都取不到（size 对不上），不该有任何读盘
    await Promise.resolve();

    expect(result).toMatchObject({ removed: 1, added: 1 });
    expect(bridge.hashLocalFile).not.toHaveBeenCalled();
    const record = songsById('id-after');
    expect(record?.lyricsMode).toBeUndefined();
    expect(record?.lyricsOverride).toBeUndefined();
    expect(localLyricsModeOf(record ?? {})).toBe('auto');
    // 孤儿留着：文件也许只是被移出了扫描目录，下次扫描还能认回（上限兜底）
    expect(libraryOf().lyricsChoicesByHash).toEqual({
      [CONTENT_HASH]: expect.objectContaining({ size: SIZE, mode: 'picked', lyricsOverride: LYRICS }),
    });
  });
});

describe('孤儿表的记录与上限', () => {
  const hashOf = (index: number) => index.toString(16).padStart(32, '0');

  it('超出上限时淘汰最旧的条目，只保留最近 N 条', () => {
    const record = (index: number) =>
      song({
        id: `gone-${index}`,
        path: `F:\\music\\gone-${index}.flac`,
        lyricsMode: 'picked',
        lyricsFingerprint: buildLocalLyricsFingerprint(SIZE, hashOf(index)),
        lyricsOverride: LYRICS,
      });

    let table: LocalLyricsOrphanTable = {};
    for (let index = 0; index < MAX_LOCAL_LYRICS_ORPHANS + 5; index += 1) {
      // 逐条记入并给递增的入表时间：模拟「改名 / 移动」一件件发生
      table = recordLocalLyricsChoiceOrphans(table, [record(index)], 1_000 + index);
    }

    expect(Object.keys(table)).toHaveLength(MAX_LOCAL_LYRICS_ORPHANS);
    expect(table[hashOf(0)]).toBeUndefined();
    expect(table[hashOf(4)]).toBeUndefined();
    expect(table[hashOf(5)]).toBeDefined();
    expect(table[hashOf(MAX_LOCAL_LYRICS_ORPHANS + 4)]).toBeDefined();
  });

  it('已经失效的选择与 auto 都不进孤儿表：不制造下次扫描的白读盘', () => {
    // size 与指纹对不上（内容已被替换过）：这条选择早就失效了，搬进表只会在下次扫描里诱发一次哈希
    expect(recordLocalLyricsChoiceOrphans({}, [{ ...pickedSong, size: SIZE + 1 }], 1000)).toEqual({});
    expect(recordLocalLyricsChoiceOrphans({}, [song({ id: 'x', path: 'F:\\music\\x.flac' })], 1000)).toEqual({});
    // picked 但文本没了（旧数据 / 被外部清掉）同样没有可搬的东西
    expect(recordLocalLyricsChoiceOrphans({}, [{ ...pickedSong, lyricsOverride: '  ' }], 1000)).toEqual({});
  });

  it('读盘数据兜底：认不出的条目一律丢弃', () => {
    const table = normalizeLocalLyricsOrphanTable({
      [CONTENT_HASH]: {
        contentHash: CONTENT_HASH, size: SIZE, mode: 'picked', lyricsOverride: LYRICS, savedAt: 5,
      },
      garbage: '这不是条目',
      autoEntry: { contentHash: 'e'.repeat(32), size: SIZE, mode: 'auto', savedAt: 6 },
      textless: { contentHash: 'f'.repeat(32), size: SIZE, mode: 'picked', savedAt: 7 },
    });

    expect(Object.keys(table)).toEqual([CONTENT_HASH]);
  });
});
