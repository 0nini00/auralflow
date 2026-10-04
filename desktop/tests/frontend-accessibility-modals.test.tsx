// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MetadataEditModal } from '../src/components/MetadataEditModal';
import { ManualMediaMatchDialog } from '../src/components/ManualMediaMatchDialog';
import { UpdateModal } from '../src/components/UpdateModal';
import { CustomSourceUpdateModal } from '../src/components/CustomSourceUpdateModal';
import { PactModal } from '../src/components/PactModal';
import type { LocalSong } from '../src/services/localMusicService';

const api = vi.hoisted(() => ({
  audio: vi.fn(), save: vi.fn(), updateSong: vi.fn(), search: vi.fn(), settings: vi.fn(), patch: vi.fn(),
  install: vi.fn(), flush: vi.fn(), closeUpdate: vi.fn(),
  update: { latestVersion: '2', currentVersion: '1', date: null, body: '', releaseUrl: '' },
  source: { id: 'source', name: '测试源', updateStatus: 'available', updateLog: '更新说明' },
}));
vi.mock('@lx/tauri-bridge', () => ({ getAudioInfo: api.audio, loadSettings: api.settings, patchSettings: api.patch }));
vi.mock('@/services/localMusicService', () => ({ getLocalSongCover: () => '' }));
vi.mock('@/stores/libraryStore', () => ({ useLibraryStore: (selector: any) => selector({ updateSong: api.updateSong }) }));
vi.mock('@/services/manualMediaMatchService', () => ({
  saveManualMediaEdits: api.save, ManualMediaSaveError: class extends Error {}, pickManualCover: vi.fn(),
  searchManualMedia: api.search, getManualLyrics: vi.fn(), getManualCover: vi.fn(), cacheManualCover: vi.fn(),
}));
vi.mock('@/stores/updateStore', () => ({ useUpdateStore: (selector: any) => selector({ available: api.update, setAvailable: api.closeUpdate }) }));
vi.mock('@/stores/libraryPersistence', () => ({ flushLibraryPersistence: api.flush }));
vi.mock('@/services/updateService', () => ({ installPendingUpdate: api.install }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@/stores/customSourceStore', () => ({
  useCustomSourceStore: Object.assign((selector: any) => selector({ sources: [api.source], featureEnabled: true, featureReady: true }), {
    getState: () => ({ featureEnabled: true, featureReady: true }),
  }),
}));
const song = { id: 'song', path: 'C:\\test.mp3', title: '歌曲', artist: '歌手', album: '专辑' } as LocalSong;
let root: Root;
let trigger: HTMLElement;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === name)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function render(node: ReactNode) { await act(async () => { root.render(node); }); }
function escape(target: Element = document.activeElement!) { act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.search.mockResolvedValue([]); api.audio.mockResolvedValue({ lyrics: '' }); api.settings.mockResolvedValue({ pactAccepted: false }); api.flush.mockResolvedValue(undefined);
  localStorage.clear(); document.body.innerHTML = '<button id="trigger">打开</button><div id="root"></div>';
  trigger = document.getElementById('trigger')!; trigger.focus(); root = createRoot(document.getElementById('root')!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
it('元数据编辑器初始字段聚焦，保存中所有关闭入口受既有 busy 限制', async () => {
  const close = vi.fn(); let reject!: (error: Error) => void;
  api.save.mockReturnValue(new Promise((_, no) => { reject = no; }));
  await render(<MetadataEditModal song={song} onClose={close} />);
  expect(document.activeElement?.id).toBe('metadata-title');
  act(() => button('保存到本机曲库').click());
  escape(); act(() => document.querySelector<HTMLElement>('.af-dialog-overlay')!.click());
  expect(close).not.toHaveBeenCalled(); expect(api.save).toHaveBeenCalledOnce();
  await act(async () => { reject(new Error('保存失败')); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
  escape(); expect(close).toHaveBeenCalledOnce();
});
it('元数据匹配子窗 Escape 返回原入口、草稿不丢失', async () => {
  const close = vi.fn(); await render(<MetadataEditModal song={song} onClose={close} />);
  const match = button('搜索匹配歌词 / 封面'); match.focus(); act(() => match.click());
  expect(document.activeElement?.id).toBe('manual-media-query');
  escape(); expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button('搜索匹配歌词 / 封面'));
  expect((document.getElementById('metadata-title') as HTMLInputElement).value).toBe('歌曲');
});
it('手动匹配 Escape 关闭，IME Enter 不发起搜索', async () => {
  const close = vi.fn(); await render(<ManualMediaMatchDialog initialQuery="歌曲" onLyrics={vi.fn()} onCover={vi.fn()} onClose={close} />);
  const input = document.getElementById('manual-media-query')!;
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); });
  expect(api.search).not.toHaveBeenCalled(); escape(input); expect(close).toHaveBeenCalledOnce();
});
it('软件更新弹窗在安装中不关闭，失败后恢复 Escape', async () => {
  let reject!: (error: Error) => void; api.install.mockReturnValue(new Promise((_, no) => { reject = no; }));
  await render(<UpdateModal />); expect(dialog().contains(document.activeElement)).toBe(true);
  await act(async () => { button('立即更新').click(); });
  escape(); act(() => document.querySelector<HTMLElement>('.af-dialog-overlay')!.click());
  expect(api.closeUpdate).not.toHaveBeenCalled();
  await act(async () => { reject(new Error('安装失败')); });
  escape(); expect(api.closeUpdate).toHaveBeenCalledWith(null);
});
it('自定义源更新具有命名 dialog 和焦点恢复', async () => {
  await render(<CustomSourceUpdateModal />);
  expect(dialog()?.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toContain('测试源');
  expect(dialog().contains(document.activeElement)).toBe(true); escape();
  expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('须知只能明确接受，不可用 Escape 绕过', async () => {
  const accepted = vi.fn(); await render(<PactModal onAccepted={accepted} />);
  expect(dialog()?.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(button('我已阅读并同意'));
  escape(); expect(accepted).not.toHaveBeenCalled(); expect(dialog()).not.toBeNull();
  await act(async () => { button('我已阅读并同意').click(); });
  expect(accepted).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(trigger);
});
