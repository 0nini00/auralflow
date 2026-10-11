import { describe, expect, it } from 'vitest';
import { detectLyricSourceType, parseLyricSource, parseYrc, mergeMissingLines } from './parser';

/**
 * 网易云 eapi(桌面端实际走的接口)会把「作词/作曲/编曲」这类元信息写成
 * 富文本 JSON 行,而不是标准 `[mm:ss]`;此前整行被丢弃,表现为「歌词里没有
 * 作词/作曲/歌手等信息」,而返回标准 LRC 的 tx 源不受影响。
 */
const RICH_CREDIT = '{"t":0,"c":[{"tx":"作词: "},{"tx":"林夕","li":"http://p1.music.126.net/x.jpg","or":"orpheus://nm/artist/home?id=228547"}]}';
const RICH_CREDIT_2 = '{"t":1000,"c":[{"tx":"作曲: "},{"tx":"柳重言"}]}';
const RICH_CREDIT_SPLIT = '{"t":2000,"c":[{"tx":"编曲: "},{"tx":"杨阳"},{"tx":"/"},{"tx":"黄钰"}]}';

describe('网易云 eapi 富文本歌词行', () => {
  it('标准 LRC 解析保留作词/作曲/编曲行', () => {
    const lrc = [RICH_CREDIT, RICH_CREDIT_2, RICH_CREDIT_SPLIT, '[00:09.920]还没好好的感受'].join('\n');
    const lines = parseLyricSource({ type: 'lrc', content: lrc });
    expect(lines.map((line) => line.text)).toEqual([
      '作词: 林夕',
      '作曲: 柳重言',
      '编曲: 杨阳/黄钰',
      '还没好好的感受',
    ]);
    expect(lines[0].time).toBe(0);
    expect(lines[1].time).toBe(1);
    expect(lines[2].time).toBe(2);
    expect(lines[3].time).toBeCloseTo(9.92, 3);
  });

  it('auto 探测该格式仍判为 lrc,并保留元信息行', () => {
    const lrc = [RICH_CREDIT, '[00:09.920]还没好好的感受'].join('\n');
    expect(detectLyricSourceType(lrc)).toBe('lrc');
    expect(parseLyricSource({ content: lrc }).map((line) => line.text)).toEqual(['作词: 林夕', '还没好好的感受']);
  });

  it('逐字轨(yrc)里的元信息行按行级时间保留', () => {
    const yrc = [
      RICH_CREDIT,
      RICH_CREDIT_2,
      '[14360,1740](14360,470,0)你(14830,420,0)说(15250,420,0)的(15670,430,0)话',
    ].join('\n');
    const lines = parseYrc(yrc);
    expect(lines.map((line) => line.text)).toEqual(['作词: 林夕', '作曲: 柳重言', '你说的话']);
    expect(lines[0].time).toBe(0);
    expect(lines[0].words).toBeUndefined();
    // 正文行仍保留逐字时间轴
    expect(lines[2].words).toHaveLength(4);
    expect(lines[2].time).toBeCloseTo(14.36, 3);
  });

  it('yrc 与 lrc 合并时同一元信息行不会重复', () => {
    const yrc = [RICH_CREDIT, '[14360,1740](14360,470,0)你'].join('\n');
    const lrc = [RICH_CREDIT, '[00:14.360]你'].join('\n');
    const merged = mergeMissingLines(parseYrc(yrc), parseLyricSource({ type: 'lrc', content: lrc }));
    expect(merged.filter((line) => line.text === '作词: 林夕')).toHaveLength(1);
  });

  it('非 JSON 或残缺 JSON 行不会被误当元信息', () => {
    const lines = parseLyricSource({ type: 'lrc', content: '{"t":0,"c":[{"tx":"作词: "}\n[00:01.00]正常行' });
    expect(lines.map((line) => line.text)).toEqual(['正常行']);
  });

  it('普通 LRC 完全不受影响', () => {
    const lines = parseLyricSource({ type: 'lrc', content: '[00:01.00]第一行\n[00:02.50]第二行' });
    expect(lines.map((line) => line.text)).toEqual(['第一行', '第二行']);
    expect(lines[1].time).toBeCloseTo(2.5, 3);
  });
  it('时间戳用整数毫秒换算,小数毫秒不会拼出解析器认不出的格式', () => {
    // 1999.9995 若先算秒(1.9999995)再乘回 1000,会得到 fraction=1000 → `[00:01.1000]`,
    // 该行会因时间戳格式非法被整行丢弃。
    const lines = parseLyricSource({
      type: 'lrc',
      content: '{"t":1999.9995,"c":[{"tx":"小数毫秒"}]}\n[00:03.000]正常行',
    });
    expect(lines.map((line) => line.text)).toEqual(['小数毫秒', '正常行']);
    expect(lines[0].time).toBeCloseTo(2, 3);
    expect(lines[1].time).toBe(3);
  });

  it('跨分钟的时间戳换算正确', () => {
    const lines = parseLyricSource({
      type: 'lrc',
      content: '{"t":125500,"c":[{"tx":"两分零五秒"}]}',
    });
    expect(lines[0].time).toBeCloseTo(125.5, 3);
  });
});