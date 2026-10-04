import { describe, expect, it } from 'vitest';
import * as parser from './parser';

describe('显式歌词读音数据', () => {
  it('ruby 转成纯文本和完整有序片段，不生成其他字的读音', () => {
    const [line] = parser.parseLrc('[00:01.00]あの<ruby>日<rt>ひ</rt></ruby>へ');
    expect(line).toEqual({ time: 1, text: 'あの日へ', ruby: [
      { text: 'あの' }, { text: '日', reading: 'ひ' }, { text: 'へ' },
    ] });
  });
  it('支持 rb/rp、多个 rt 与转义实体，保留未知标签为文本', () => {
    const [line] = parser.parseLrc('[00:01]<ruby><rb>東</rb><rp>(</rp><rt>とう</rt><rp>)</rp>京<rt>きょう</rt></ruby>&amp;<img src=x>');
    expect(line.text).toBe('東京&<img src=x>');
    expect(line.ruby).toEqual([{ text: '東', reading: 'とう' }, { text: '京', reading: 'きょう' }, { text: '&<img src=x>' }]);
  });
  it('保留逐字时间结构，词的明确注音可独立渲染', () => {
    const [line] = parser.parseYrc('[1000,1500](1000,500,0)<ruby>日<rt>ひ</rt></ruby>(1500,1000,0)へ');
    expect(line.words?.[0]).toMatchObject({ start: 1, dur: .5, text: '日', reading: 'ひ' });
    const [timed] = parser.parseEnhancedLrc('[00:01]<00:01><ruby>日<rt>ひ</rt></ruby><00:02>へ');
    expect(timed.text).toBe('日へ');
    expect(timed.words?.[0]).toMatchObject({ text: '日', start: 1, dur: 1, reading: 'ひ' });
    expect(timed.words?.[1]).toMatchObject({ text: 'へ', start: 2 });
    expect(timed.words?.[1].dur).toBeCloseTo(.4);
  });
  it('VTT ruby 不混入 rt 文本', () => {
    expect(parser.parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<ruby>日<rt>ひ</rt></ruby>')[0])
      .toMatchObject({ time: 1, text: '日', ruby: [{ text: '日', reading: 'ひ' }] });
  });
  it('普通同时间多行不猜测罗马音，残缺 ruby 保留可见文本', () => {
    const lines = parser.parseLrc('[00:01]日\n[00:01]hi\n[00:02]<ruby>日<rt>ひ');
    expect(lines).toEqual([{ time: 1, text: '日' }, { time: 1, text: 'hi' }, { time: 2, text: '<ruby>日<rt>ひ' }]);
  });
  it('显式 romaLyric 支持 offset、多时间戳、就近对齐且不改变译文/时间/逐字', () => {
    expect(parser).toHaveProperty('mergeRomanization');
    const lines = [{ time: 1, text: '日', tr: '太阳', words: [{ text: '日', start: 1, dur: .8 }] }, { time: 2, text: '日' }];
    const merged = parser.mergeRomanization(lines, '[offset:100]\n[00:00.90][00:01.90] hi ');
    expect(merged).toEqual(lines.map(line => ({ ...line, roma: 'hi' })));
    expect(lines[0]).not.toHaveProperty('roma');
    expect(parser.mergeRomanization([{ time: 1.1, text: '日' }], '[00:01]wrong\n[00:01.12]right')[0].roma).toBe('right');
    expect(parser.mergeRomanization(lines, '[00:05]unrelated')).toEqual(lines);
  });
});

it('独立罗马音轨也支持 yromalrc 逐字格式', () => {
  expect(parser.mergeRomanization([{ time: 1, text: '日へ' }], '[1000,1000](1000,500,0)hi (1500,500,0)e')[0].roma).toBe('hi e');
});
it('重复归一化不会把已解码的转义标记重新解释为注音', () => {
  const lines = parser.parseLrc('[00:01]<ruby>日<rt>ひ</rt></ruby>&lt;ruby&gt;月&lt;rt&gt;つき&lt;/rt&gt;&lt;/ruby&gt;');
  expect(parser.mergeMissingLines(lines, [{ time: 3, text: '末尾' }])[0]).toEqual(lines[0]);
});
