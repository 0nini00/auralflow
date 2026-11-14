import { expect, it } from 'vitest';
import { getMenuPosition, getSelectMenuPosition } from '../src/utils/menuPosition';

it('菜单按各自尺寸在下方或上方显示，并限制水平位置', () => {
  const viewport = { width: 800, height: 600 };
  expect(getMenuPosition({ right: 300, top: 100, bottom: 130 }, { width: 180, height: 230 }, viewport)).toEqual({ left: 120, top: 136 });
  expect(getMenuPosition({ right: 790, top: 550, bottom: 580 }, { width: 340, height: 320 }, viewport)).toEqual({ left: 450, top: 224 });
  expect(getMenuPosition({ right: 30, top: 20, bottom: 50 }, { width: 340, height: 320 }, { width: 200, height: 200 })).toEqual({ left: 8, top: 8 });
});

it('下拉选择的菜单与触发器左对齐、至少同宽，放不下时翻到上方并钉住下边缘', () => {
  const viewport = { width: 800, height: 600 };
  // 下方放得下：贴在触发器下方，窄触发器撑到最小宽度
  expect(getSelectMenuPosition({ top: 100, bottom: 136, left: 300, width: 148 }, 3, viewport))
    .toEqual({ top: 142, bottom: 'auto', left: 300, width: 180, maxHeight: 320 });
  // 下方放不下 5 项而上方更宽裕：向上展开，下边缘离触发器上沿一个间距
  expect(getSelectMenuPosition({ top: 500, bottom: 536, left: 300, width: 220 }, 5, viewport))
    .toEqual({ top: 'auto', bottom: 106, left: 300, width: 220, maxHeight: 320 });
  // 贴着右边缘：水平方向收回视口内
  expect(getSelectMenuPosition({ top: 100, bottom: 136, left: 700, width: 148 }, 3, viewport).left).toBe(612);
  // 两侧都放不下完整列表：留在空间更大的一侧，高度压进可用空间后内部滚动
  expect(getSelectMenuPosition({ top: 100, bottom: 136, left: 300, width: 180 }, 40, { width: 800, height: 300 }))
    .toEqual({ top: 142, bottom: 'auto', left: 300, width: 180, maxHeight: 150 });
});
