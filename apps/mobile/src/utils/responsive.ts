import { useWindowDimensions } from 'react-native';

/**
 * 平板断点：对齐桌面 showcase 的并排布局（≈ 768dp）。
 * 移动端沉浸式/控制栏的「手机折叠态 vs 平板桌面态」统一以该断点分支。
 */
export const TABLET_MIN_WIDTH = 768;

export type DeviceForm = 'phone' | 'tablet';

export function getDeviceForm(width: number): DeviceForm {
  return width >= TABLET_MIN_WIDTH ? 'tablet' : 'phone';
}

/**
 * 设备形态钩子。width 变化（旋转/分屏/折叠屏展开）时自动重算。
 * - isTablet: 走桌面同款布局（封面 + 全屏歌词并排）
 * - isPhone:  走移动折叠态（封面默认，点一下出两行歌词）
 */
export function useDeviceForm() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  return {
    width,
    height,
    isTablet,
    isPhone: !isTablet,
    form: getDeviceForm(width),
  };
}
