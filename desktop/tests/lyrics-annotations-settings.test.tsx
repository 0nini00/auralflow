import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ loadSettings: vi.fn(), patchSettings: vi.fn(), isLyricWindowOpen: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ ...deps, setLyricWindowPinned: vi.fn() }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: vi.fn() }));
import { DesktopLyricSettingsSection } from '../src/views/settings/DesktopLyricSettingsSection';
import { useSettingsStore } from '../src/stores/settingsStore';
import { seedSettings } from './helpers/settingsFixture';
let renderer: ReactTestRenderer;
const control = (label: string) => renderer.root.findAllByProps({ className: 'af-setting-row' }).find(row => row.findByProps({ className: 'af-setting-row-label' }).children[0] === label)?.findByType('input');
beforeEach(() => {
  vi.resetAllMocks();
  seedSettings({ lyricShowRomanization: false, lyricShowRuby: false });
  // Rust 返回合并后的完整设置
  deps.patchSettings.mockImplementation(async (patch: object) => ({ ...useSettingsStore.getState().settings, ...patch }));
  deps.isLyricWindowOpen.mockResolvedValue(false);
});
afterEach(() => act(() => renderer?.unmount()));
it('两个默认关闭的独立设置各自持久化，说明同时影响沉浸及桌面', async () => {
  await act(async () => { renderer = create(<DesktopLyricSettingsSection />); });
  expect(control('显示罗马音')).toBeDefined();
  expect(control('显示注音')).toBeDefined();
  expect(control('显示罗马音')!.props.checked).toBe(false);
  expect(control('显示注音')!.props.checked).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain('同时影响沉浸式及桌面歌词');
  await act(async () => { await control('显示罗马音')!.props.onChange({ target: { checked: true } }); });
  expect(deps.patchSettings).toHaveBeenCalledWith({ lyricShowRomanization: true });
  expect(control('显示罗马音')!.props.checked).toBe(true);
  expect(control('显示注音')!.props.checked).toBe(false);
  await act(async () => { await control('显示注音')!.props.onChange({ target: { checked: true } }); });
  expect(deps.patchSettings).toHaveBeenCalledWith({ lyricShowRuby: true });
  expect(control('显示注音')!.props.checked).toBe(true);
});
it('别的窗口改了设置（store 刷新）后控件跟着变', async () => {
  await act(async () => { renderer = create(<DesktopLyricSettingsSection />); });
  act(() => seedSettings({ lyricShowRomanization: true, lyricShowRuby: true }));
  expect(control('显示罗马音')!.props.checked).toBe(true);
  expect(control('显示注音')!.props.checked).toBe(true);
});
it('保存失败时控件回到真实值并显示原因', async () => {
  // 写入失败后 store 会重读一次真实值
  deps.loadSettings.mockResolvedValue({ lyricShowRomanization: false, lyricShowRuby: false });
  deps.patchSettings.mockRejectedValue(new Error('disk unavailable'));
  await act(async () => { renderer = create(<DesktopLyricSettingsSection />); });
  await act(async () => { await control('显示罗马音')!.props.onChange({ target: { checked: true } }); });
  expect(control('显示罗马音')!.props.checked).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain('保存读音设置失败：disk unavailable');
});
