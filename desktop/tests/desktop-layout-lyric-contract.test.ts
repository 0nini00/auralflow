import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 用户反馈的三个桌面布局问题:
 * 1. 主页出现右滑块 + 下滑块;
 * 2. 「最近播放」全屏时右侧留白、不填满;
 * 3. 「听歌统计」全屏时只占页面一半宽。
 *
 * 这三个都是 CSS 契约级问题(浏览器实测:主页横向溢出 24px,统计页固定 900px 宽),
 * 所以用样式文件断言把契约钉住,避免以后回退。
 */
const read = (relative: string) => readFileSync(path.join(__dirname, '..', relative), 'utf8');

/** 断言 CSS 契约前先去掉注释:注释里会引用被替换掉的旧写法,否则断言会自相矛盾。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css: string, selector: string) =>
  stripComments(css).match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';

const contentScroll = rule(read('src/index.css'), '.af-content-scroll');
const homeCss = read('src/styles/home.css');
const discoverCss = read('src/styles/discover.css');
// 「最近播放」区块已从发现页撤掉，网格配方搬到 discover.css 的 `.af-discover-grid`，
// 这两条契约跟着搬家，断言内容不变。
const discoverGrid = rule(discoverCss, '.af-discover-grid');
const statsView = rule(read('src/styles/stats.css'), '.af-stats-view');
const playerCss = read('src/styles/player.css');

describe('滚动容器:两个轴都要显式声明', () => {
  it('.af-content-scroll 显式禁用横向滚动', () => {
    expect(contentScroll).toContain('overflow-y: auto');
    // 只写 overflow-y 时 overflow-x 会被提升成 auto,悬停提示会把页面撑宽
    expect(contentScroll).toContain('overflow-x: hidden');
  });
});

describe('发现页卡片网格（原「最近播放」位置）', () => {
  it('用 auto-fit,放不满的行不留空轨道', () => {
    expect(discoverGrid).toContain('repeat(auto-fit, minmax(150px, 1fr))');
    // 榜单页与歌单广场的网格用 auto-fill 是另一回事:那两处卡片自带固定列宽、
    // 不该被 auto-fit 拉伸,所以这条断言只看发现页自己的网格。
    expect(discoverGrid).not.toContain('auto-fill');
    // 卡片少时 auto-fit 会把轨道拉到整行宽,必须有宽度上限兜住
    expect(discoverCss).toContain('.af-discover-grid .af-music-card');
    expect(discoverCss).toContain('max-width: 220px');
  });

  it('卡片右缘的提示气泡右对齐,不撑出内容右边界', () => {
    const rule = homeCss.match(/\.af-music-card-action-btn\[data-tooltip\]::after \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rule).toContain('right: 0');
    expect(rule).toContain('left: auto');
  });
});

describe('听歌统计页', () => {
  it('不再固定 900px 宽,跟随内容区铺满', () => {
    expect(statsView).toContain('width: 100%');
    expect(statsView).not.toContain('max-width: 900px');
  });
});

describe('沉浸式逐字歌词', () => {
  it('卡拉OK 行关掉行级渐变,交给逐字 clip', () => {
    expect(playerCss).toContain(
      '.af-scrolling-lyric-line.af-active .af-scrolling-lyric-primary:has(.af-scrolling-karaoke-word)',
    );
    const rule = playerCss.match(
      /\.af-scrolling-lyric-line\.af-active \.af-scrolling-lyric-primary:has\(\.af-scrolling-karaoke-word\) \{[\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(rule).toContain('background-image: none');
  });

  it('非卡拉OK 行仍保留整行进度渐变', () => {
    expect(playerCss).toContain(
      '.af-scrolling-lyric-line.af-active .af-scrolling-lyric-primary:not(:has(.af-scrolling-karaoke-word))',
    );
  });

  it('未唱与已唱的对比度足够(实测需 ≥3:1)', () => {
    const base = playerCss.match(/\.af-scrolling-karaoke-word-base \{[\s\S]*?\n\}/)?.[0] ?? '';
    const fill = playerCss.match(/\.af-scrolling-karaoke-word-fill \{[\s\S]*?\n\}/)?.[0] ?? '';
    // 未唱压暗(≤0.5 alpha)、已唱纯白
    const baseAlpha = Number(base.match(/rgba\([^)]*?,\s*([\d.]+)\)/)?.[1] ?? '1');
    expect(baseAlpha).toBeLessThanOrEqual(0.5);
    expect(fill).toContain('#ffffff');
  });
});