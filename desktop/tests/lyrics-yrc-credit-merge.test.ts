import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ getSource: vi.fn(), getCachedLyrics: vi.fn(), saveCachedLyrics: vi.fn(), fetch: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: deps.getSource }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));
vi.mock('@/services/persistentCache', () => ({
  getCachedLyrics: deps.getCachedLyrics,
  saveCachedLyrics: deps.saveCachedLyrics,
  isCacheableEmptyLyricResult: () => false,
}));

import { __lyricsInternals } from '../src/services/lyricsService';

const { parseProviderLyrics } = __lyricsInternals;

/** 构造网易云 eapi 富文本元信息行(真实接口形态,含 li/or 附加字段) */
const rich = (ms: number, label: string, name: string) =>
  `{"t":${ms},"c":[{"tx":"${label}"},{"tx":"${name}","li":"http://p1.music.126.net/x.jpg","or":"orpheus://nm/artist/home?id=1&type=artist"}]}`;

beforeEach(() => {
  vi.resetAllMocks();
  deps.getCachedLyrics.mockResolvedValue(null);
  deps.saveCachedLyrics.mockResolvedValue(undefined);
  deps.getSource.mockReturnValue(null);
  deps.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe('网易云 yrc 主轨的元信息行(对齐 lx-music-desktop wy/lyric.js)', () => {
  it('yrc 非空即独占:lrc 同批元信息行时间漂移超容差也不得重复', () => {
    // 真实形态:yrc 的富文本元信息行全部 t=0,而 lrc 的同批行 t 随行递增;
    // 旧逻辑 mergeMissingLines 按「同文本 ±1200ms」去重,第 4 行(制作人 1389ms)起
    // 漂移超出容差被判为不同行,「制作人」等在头部整批重复(实测孤勇者 67→78 行)。
    const yrc = [
      rich(0, '作词: ', '唐恬'),
      rich(0, '作曲: ', '钱雷'),
      rich(0, '编曲: ', '钱雷'),
      rich(0, '制作人: ', '钱雷'),
      rich(0, '吉他: ', '高飞'),
      '[46590,5630](46590,380,0)我(46970,300,0)肯(47270,780,0)定',
    ].join('\n');
    const lrc = [
      rich(0, '作词: ', '唐恬'),
      rich(463, '作曲: ', '钱雷'),
      rich(926, '编曲: ', '钱雷'),
      rich(1389, '制作人: ', '钱雷'),
      rich(2315, '吉他: ', '高飞'),
      '[00:46.590]我肯定',
    ].join('\n');

    const lines = parseProviderLyrics({ lyric: lrc, yrc });

    for (const text of ['作词: 唐恬', '作曲: 钱雷', '编曲: 钱雷', '制作人: 钱雷', '吉他: 高飞']) {
      expect(lines.filter((line) => line.text === text)).toHaveLength(1);
    }
    // 正文采用 yrc 逐字轨(词级时间轴保留),不混入 lrc 的行级行
    const body = lines.find((line) => line.text === '我肯定');
    expect(body?.words).toHaveLength(3);
    expect(lines).toHaveLength(6);
  });

  it('yrc 主轨时翻译/罗马音优先取 ytlrc/yromalrc(与逐字轨对齐)', () => {
    const lines = parseProviderLyrics({
      lyric: '[00:01.00]hi',
      yrc: '[1000,500](1000,500,0)hi',
      tlyric: '[00:01.00]嗨-lrc轨',
      ytlyric: '[00:01.00]嗨-yrc轨',
      romaLyric: '[00:01.00]ha-lrc',
      yromaLyric: '[00:01.00]ha-yrc',
    });
    expect(lines[0].tr).toBe('嗨-yrc轨');
    expect(lines[0].roma).toBe('ha-yrc');
  });

  it('无 ytlrc/yromalrc 时退回 lrc 对齐的 tlyric/romaLyric', () => {
    const lines = parseProviderLyrics({
      lyric: '[00:01.00]hi',
      yrc: '[1000,500](1000,500,0)hi',
      tlyric: '[00:01.00]嗨',
      romaLyric: '[00:01.00]ha',
    });
    expect(lines[0].tr).toBe('嗨');
    expect(lines[0].roma).toBe('ha');
  });

  it('yrc 解析不出任何行时整轨退回 lrc(元信息行保留)', () => {
    const lines = parseProviderLyrics({
      yrc: '不是任何已知格式的内容',
      lyric: `${rich(0, '作词: ', '周杰伦')}\n[00:01.000]故事的小黄花`,
    });
    expect(lines.map((line) => line.text)).toEqual(['作词: 周杰伦', '故事的小黄花']);
  });

  it('仅 lrc 主轨时元信息行照常保留(回扫搜索匹配路径)', () => {
    const lines = parseProviderLyrics({
      // 旧版 web 接口(/api/song/lyric)返回标准 LRC 元信息行
      lyric: '[00:00.000] 作词 : 周杰伦\n[00:01.000]故事的小黄花',
      tlyric: '[00:00.950]\n[00:01.950]',
    });
    expect(lines[0].text).toBe('作词 : 周杰伦');
    expect(lines[0].tr).toBeUndefined();
    expect(lines[1].text).toBe('故事的小黄花');
  });
});
