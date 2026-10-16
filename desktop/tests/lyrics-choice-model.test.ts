import { describe, expect, it } from 'vitest';
import type { LocalSong } from '../src/services/localMusicService';
import { mergeLibraryRefreshResults } from '../src/stores/libraryRefreshModel';
import {
  buildLocalLyricsChoicePatch,
  buildLocalLyricsFingerprint,
  formatLocalLyricsChoiceLabel,
  isLocalLyricsChoiceBound,
  localLyricsModeOf,
  parseLocalLyricsFingerprint,
  resolveLocalLyricsChoice,
} from '../src/services/localLyricsChoiceModel';

/**
 * 歌词选择的三态与指纹绑定（纯模型）+ 重新扫描的保留规则。
 *
 * 「不匹配」由 `lyricsMode: "local-only"` 表达，空串只表示「没有文本」；指纹是「大小 + 内容 md5」
 * 的复合串，内容变了（size 不同）即静默失效回 auto——这三条是两端一致的语义，钉在这里。
 */

const fingerprint = buildLocalLyricsFingerprint(4096, 'abc123');

const pickedSong: LocalSong = {
  id: 'local-a',
  path: 'F:\\music\\a.flac',
  title: 'A',
  artist: '吴亦凡',
  album: '专辑',
  duration: 200,
  format: 'flac',
  size: 4096,
  isLocal: true,
  embeddedLyrics: '[00:01]内嵌词',
  lyricsOverride: '[00:01]选中的词',
  lyricsMode: 'picked',
  lyricsFingerprint: fingerprint,
  lyricsSourceLabel: '网易云',
};

describe('指纹编解码', () => {
  it('指纹是「大小 + 内容 md5」的复合串，缺一半或旧格式都不算指纹', () => {
    expect(buildLocalLyricsFingerprint(4096, 'abc123')).toBe('4096:abc123');
    expect(parseLocalLyricsFingerprint(fingerprint)).toEqual({ size: 4096, contentHash: 'abc123' });
    // 旧格式（只有 md5，没有大小）无法判定内容是否变过：一律按未绑定处理
    expect(parseLocalLyricsFingerprint('abc123')).toBeNull();
    expect(parseLocalLyricsFingerprint('4096:')).toBeNull();
    expect(parseLocalLyricsFingerprint('not-a-size:abc')).toBeNull();
    expect(parseLocalLyricsFingerprint(undefined)).toBeNull();
  });

  it('绑定判定只认「选择时的大小 == 记录当前大小」', () => {
    expect(isLocalLyricsChoiceBound({ lyricsFingerprint: fingerprint }, 4096)).toBe(true);
    expect(isLocalLyricsChoiceBound({ lyricsFingerprint: fingerprint }, 4097)).toBe(false);
    // 拿不到当前大小就不承认选择：宁可退回自动匹配，也不拿不确定的指纹当真
    expect(isLocalLyricsChoiceBound({ lyricsFingerprint: fingerprint }, undefined)).toBe(false);
    expect(isLocalLyricsChoiceBound({}, 4096)).toBe(false);
  });
});

describe('三态判定', () => {
  it('picked：只认选中的那一份文本，来源标注原样透出', () => {
    expect(resolveLocalLyricsChoice(pickedSong)).toEqual({
      mode: 'picked',
      expired: false,
      text: '[00:01]选中的词',
      lyricsFingerprint: fingerprint,
      lyricsSourceLabel: '网易云',
    });
  });

  it('picked：内容变了（size 对不上指纹）→ 静默失效回 auto，且不再沿用选中的文本', () => {
    const view = resolveLocalLyricsChoice({ ...pickedSong, size: 8192 });
    expect(view).toMatchObject({ mode: 'auto', expired: true, text: '[00:01]内嵌词' });
    expect(view.lyricsSourceLabel).toBeUndefined();
    expect(view.lyricsFingerprint).toBeUndefined();
  });

  it('picked：选中的文本没了 → 同样失效，不拿文件里的词冒充', () => {
    expect(resolveLocalLyricsChoice({ ...pickedSong, lyricsOverride: '' })).toMatchObject({ mode: 'auto', expired: true });
    expect(resolveLocalLyricsChoice({ ...pickedSong, lyricsOverride: '   ' })).toMatchObject({ mode: 'auto', expired: true });
  });

  it('local-only：绑定成立时不透出来源标注，没有本地词就是权威空', () => {
    const withText = resolveLocalLyricsChoice({ ...pickedSong, lyricsMode: 'local-only' });
    expect(withText).toEqual({
      mode: 'local-only', expired: false, text: '[00:01]选中的词', lyricsFingerprint: fingerprint,
    });
    expect(withText.lyricsSourceLabel).toBeUndefined();

    const empty = resolveLocalLyricsChoice({
      ...pickedSong, lyricsMode: 'local-only', lyricsOverride: undefined, embeddedLyrics: undefined,
    });
    expect(empty).toEqual({ mode: 'local-only', expired: false, lyricsFingerprint: fingerprint });
    expect(empty.text).toBeUndefined();
    expect(empty.expired).toBe(false);
  });

  it('被清空的按曲文本不算文本，文件自身的词仍然生效', () => {
    // 空串不再屏蔽内嵌词：内嵌标签本来就是自动链的第一档
    expect(resolveLocalLyricsChoice({ ...pickedSong, lyricsMode: 'auto', lyricsOverride: '' }))
      .toMatchObject({ mode: 'auto', expired: false, text: '[00:01]内嵌词' });
  });

  it('无法识别的 mode 一律回落到 auto，并按 auto 的文本规则处理', () => {
    expect(localLyricsModeOf({ lyricsMode: 'nope' as never })).toBe('auto');
    expect(resolveLocalLyricsChoice({ ...pickedSong, lyricsMode: 'nope' as never }))
      .toMatchObject({ mode: 'auto', expired: false, text: '[00:01]选中的词' });
  });

  it('状态文案按已判定的 view 生成，失效的选择不显示成「正在使用」', () => {
    expect(formatLocalLyricsChoiceLabel(resolveLocalLyricsChoice(pickedSong))).toBe('正在使用：网易云');
    expect(formatLocalLyricsChoiceLabel(resolveLocalLyricsChoice({ ...pickedSong, lyricsMode: 'local-only' })))
      .toBe('不匹配（只用本地歌词）');
    // 指纹失效 → view 已经是 auto，文案必须跟着说「自动匹配」
    expect(formatLocalLyricsChoiceLabel(resolveLocalLyricsChoice({ ...pickedSong, size: 1 }))).toBe('自动匹配');
  });
});

describe('三个动作的记录补丁', () => {
  it('恢复自动匹配：清掉文本、指纹与来源标注', () => {
    expect(buildLocalLyricsChoicePatch({ type: 'auto' })).toEqual({
      lyricsMode: 'auto', lyricsFingerprint: undefined, lyricsSourceLabel: undefined,
      lyricsOverride: undefined, lyricsTranslationOverride: undefined, lyricsRomanizationOverride: undefined,
    });
  });

  it('不要匹配：记下指纹但清掉文本与来源标注', () => {
    expect(buildLocalLyricsChoicePatch({ type: 'local-only', fingerprint })).toMatchObject({
      lyricsMode: 'local-only', lyricsFingerprint: fingerprint, lyricsOverride: undefined,
    });
  });

  it('选中一条：写文本、指纹与来源标注，并清掉对不上新词的译文 / 罗马音', () => {
    expect(buildLocalLyricsChoicePatch({
      type: 'picked', fingerprint, sourceLabel: 'LRCLIB', text: '[00:01]新词',
    })).toEqual({
      lyricsMode: 'picked', lyricsFingerprint: fingerprint, lyricsSourceLabel: 'LRCLIB',
      lyricsOverride: '[00:01]新词', lyricsTranslationOverride: undefined, lyricsRomanizationOverride: undefined,
    });
  });
});

describe('重新扫描不覆盖歌词选择', () => {
  const scanned = (extra: Partial<LocalSong>): LocalSong => ({ ...pickedSong, ...extra });

  it('扫描结果不会覆盖三字段与用户文本，只有 size 随文件刷新', () => {
    const result = mergeLibraryRefreshResults({
      scanPaths: ['F:\\music'],
      localSongs: [pickedSong],
      scanResults: [{
        path: 'F:\\music',
        ok: true,
        songs: [scanned({ title: '文件里的新标题', embeddedLyrics: '[00:01]新的内嵌', size: 8192 })],
      }],
    });

    expect(result.songs).toHaveLength(1);
    expect(result.songs[0]).toMatchObject({
      // 用户可能改过标题：桌面端没有字段级编辑账本，扫描结果一律不回填（size 除外）
      title: 'A',
      lyricsMode: 'picked',
      lyricsFingerprint: fingerprint,
      lyricsSourceLabel: '网易云',
      lyricsOverride: '[00:01]选中的词',
      size: 8192,
    });
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('文件被换掉（size 变了）之后选择静默失效回 auto，选中的词不再生效', () => {
    const result = mergeLibraryRefreshResults({
      scanPaths: ['F:\\music'],
      localSongs: [pickedSong],
      scanResults: [{ path: 'F:\\music', ok: true, songs: [scanned({ size: 8192 })] }],
    });

    expect(resolveLocalLyricsChoice(result.songs[0])).toMatchObject({
      mode: 'auto', expired: true, text: '[00:01]内嵌词',
    });
  });

  it('改名 / 移动（新路径 = 新 id）在纯合并层不搬选择，只把消失的记录交出来', () => {
    // 跨改名的重绑要读新文件的哈希，而扫描路径不许重算哈希（见设计），所以纯合并层不做重绑：
    // 它只交出 removedSongs，由 store 记进孤儿表、等新记录进库时按内容认回
    // （见 tests/lyrics-choice-orphan.test.ts）。
    const result = mergeLibraryRefreshResults({
      scanPaths: ['F:\\music'],
      localSongs: [pickedSong],
      scanResults: [{
        path: 'F:\\music',
        ok: true,
        songs: [scanned({ id: 'local-b', path: 'F:\\music\\renamed.flac', lyricsMode: undefined, lyricsFingerprint: undefined, lyricsSourceLabel: undefined, lyricsOverride: undefined })],
      }],
    });

    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    // 扫描到的新记录不并进 songs，只记进 added（既有合并语义：免得把用户手动移除过的歌又拉回来），
    // 所以这里 renamed 是 undefined —— 新记录要等用户重新添加目录 / 文件时才进库。
    const renamed = result.songs.find((song) => song.id === 'local-b');
    expect(renamed).toBeUndefined();
    expect(localLyricsModeOf(renamed ?? {})).toBe('auto');
    // 旧记录整条交出来（含歌词选择三字段）：它是孤儿表唯一的输入
    expect(result.removedSongs).toEqual([pickedSong]);
  });
});
