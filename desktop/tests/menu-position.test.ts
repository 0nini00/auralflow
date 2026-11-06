import { expect, it } from 'vitest';
import { getMenuPosition } from '../src/utils/menuPosition';

it('菜单按各自尺寸在下方或上方显示，并限制水平位置', () => {
  const viewport = { width: 800, height: 600 };
  expect(getMenuPosition({ right: 300, top: 100, bottom: 130 }, { width: 180, height: 230 }, viewport)).toEqual({ left: 120, top: 136 });
  expect(getMenuPosition({ right: 790, top: 550, bottom: 580 }, { width: 340, height: 320 }, viewport)).toEqual({ left: 450, top: 224 });
  expect(getMenuPosition({ right: 30, top: 20, bottom: 50 }, { width: 340, height: 320 }, { width: 200, height: 200 })).toEqual({ left: 8, top: 8 });
});
