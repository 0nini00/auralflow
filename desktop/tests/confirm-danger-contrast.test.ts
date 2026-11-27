import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(resolve(__dirname, '../src/styles/theme.css'), 'utf8');
const buttonCss = readFileSync(resolve(__dirname, '../src/styles/buttons.css'), 'utf8');

function declarations(css: string, selector: string): Record<string, string> {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(match => match[1].split(',').some(value => value.trim() === selector));
  if (!rule) throw new Error(`找不到样式规则：${selector}`);
  const block = rule[2];
  return Object.fromEntries(block.split(';').filter(value => value.includes(':')).map(value => {
    const colon = value.indexOf(':');
    return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
  }));
}

function resolveColor(value: string, tokens: Record<string, string>): string {
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  if (!variable) return value;
  const token = tokens[variable[1]];
  if (!token) throw new Error(`缺少主题颜色：${variable[1]}`);
  return resolveColor(token, tokens);
}

function luminance(color: string): number {
  const hex = color.length === 4 ? '#' + [...color.slice(1)].map(value => value + value).join('') : color;
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`应使用实心颜色：${color}`);
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

describe('危险确认按钮文字与实心填充的可读性', () => {
  for (const theme of ['light', 'dark']) {
    for (const hover of [false, true]) {
      it(`${theme}主题${hover ? '悬停' : '默认'}状态达到4.5:1`, () => {
        const tokens = { ...declarations(themeCss, ':root'), ...(theme === 'dark' ? declarations(themeCss, '[data-theme="dark"]') : {}),
          '--af-text-on-accent': '#15180f' };
        const style = { ...declarations(buttonCss, '.af-btn-primary.af-confirm-danger'),
          // 通用主按钮的悬停规则比危险按钮默认规则优先级高。
          ...(hover ? declarations(buttonCss, '.af-btn-primary:hover:not(:disabled)') : {}),
          ...(hover ? declarations(buttonCss, '.af-btn-primary.af-confirm-danger:hover:not(:disabled)') : {}) };
        const foreground = luminance(resolveColor(style.color, tokens));
        const background = luminance(resolveColor(style.background, tokens));
        const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(contrast, `危险按钮对比度 ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
