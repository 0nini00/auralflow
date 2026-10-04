// @vitest-environment jsdom
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from '../src/hooks/useDialogFocus';
import { SongAddMenu, SongAddMenuButton } from '../src/components/SongAddMenuButton';
import { DownloadQualityMenu, DownloadQualityButton } from '../src/components/DownloadQualityButton';

const actions = vi.hoisted(() => ({ favorite: vi.fn(), addSong: vi.fn(), download: vi.fn(), closeDialog: vi.fn() }));
vi.mock('@/stores/favoritesStore', () => ({ useFavoritesStore: (selector: any) => selector({ addFavorite: actions.favorite, isFavorite: () => false }) }));
vi.mock('@/stores/playlistStore', () => ({ usePlaylistStore: (selector: any) => selector({
  playlists: [{ id: 'one', name: '歌单一' }, { id: 'two', name: '歌单二' }], addSongToPlaylist: actions.addSong,
}) }));
vi.mock('@/stores/wyAccountStore', () => ({ useWyAccountStore: (selector: any) => selector({ account: null, playlists: [], addTracks: vi.fn() }) }));
vi.mock('@/stores/downloadStore', () => ({ useDownloadStore: (selector: any) => selector({ addDownload: actions.download }) }));

const song = { id: 'test', source: 'wy' as const, name: '歌曲', singer: '歌手', albumName: '专辑' };
let root: Root;
function Dialog({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open: true, containerRef: ref, onClose: actions.closeDialog });
  return <section ref={ref} role="dialog" aria-modal="true" aria-label="菜单测试">
    <button id="dialog-first">父层首项</button>{children}<button id="dialog-last">父层末项</button>
  </section>;
}
function SharedMenu({ kind }: { kind: 'song' | 'download' }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const Menu = kind === 'song' ? SongAddMenu : DownloadQualityMenu;
  return <><button aria-label="受控入口" aria-controls="existing-control" onClick={(event) => setAnchor(event.currentTarget)}>受控入口</button>
    {anchor && <Menu song={song} anchor={anchor} onClose={() => setAnchor(null)} />}
  </>;
}
function key(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => { document.activeElement!.dispatchEvent(event); });
  return event;
}
function open(label: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  act(() => { trigger.focus(); trigger.click(); });
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  return { trigger, menu, items: [...menu.querySelectorAll<HTMLButtonElement>('button')] };
}
beforeEach(() => {
  vi.clearAllMocks(); actions.download.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div><button id="outside">背景</button>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it.each(['song', 'download'] as const)('真实 %s 菜单的连续 Tab/Shift Tab 与 Escape 只作用于当前菜单', (kind) => {
  act(() => root.render(<Dialog>{kind === 'song' ? <SongAddMenuButton song={song} /> : <DownloadQualityButton song={song} />}</Dialog>));
  const { trigger, menu, items } = open(kind === 'song' ? '添加到' : '下载');
  expect(document.activeElement).toBe(items[0]);
  key('Tab'); expect(document.activeElement).toBe(items[1]);
  key('Tab'); expect(document.activeElement).toBe(items[2]);
  key('Tab', { shiftKey: true }); expect(document.activeElement).toBe(items[1]);
  expect(menu.id).not.toBe('');
  expect(trigger.getAttribute('aria-controls')?.split(/\s+/)).toContain(menu.id);
  key('Escape'); expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger); expect(actions.closeDialog).not.toHaveBeenCalled();
  expect(trigger.hasAttribute('aria-controls')).toBe(false);
});
it('Tab 进入后续本地歌单仍可执行真实组件的添加动作', () => {
  act(() => root.render(<Dialog><SongAddMenuButton song={song} /></Dialog>));
  const { items } = open('添加到'); key('Tab'); key('Tab');
  expect(document.activeElement).toBe(items[2]);
  act(() => (document.activeElement as HTMLElement).click());
  expect(actions.addSong).toHaveBeenCalledWith('two', song);
  expect(actions.favorite).not.toHaveBeenCalled(); expect(actions.closeDialog).not.toHaveBeenCalled();
});
it('Tab 进入后续音质仍派发对应音质，不调用真实下载', async () => {
  act(() => root.render(<Dialog><DownloadQualityButton song={song} /></Dialog>));
  const { items } = open('下载'); key('Tab'); key('Tab');
  expect(document.activeElement).toBe(items[2]);
  await act(async () => { (document.activeElement as HTMLElement).click(); });
  expect(actions.download).toHaveBeenCalledWith(song, '320k');
  expect(actions.closeDialog).not.toHaveBeenCalled();
});
it.each(['song', 'download'] as const)('直接调用受控 %s 菜单也声明归属，卸载恢复 anchor 原有 ARIA', (kind) => {
  act(() => root.render(<Dialog><SharedMenu kind={kind} /></Dialog>));
  const { trigger, menu, items } = open('受控入口');
  key('Tab'); expect(document.activeElement).toBe(items[1]);
  expect(trigger.getAttribute('aria-controls')?.split(/\s+/)).toContain(menu.id);
  key('Escape'); expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-controls')).toBe('existing-control');
});
it('多个菜单实例的 id 唯一，不能误把另一个 portal 当作自己的菜单', () => {
  act(() => root.render(<Dialog><SongAddMenuButton song={song} title="入口一" /><SongAddMenuButton song={song} title="入口二" /></Dialog>));
  const first = open('入口一');
  const secondTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="入口二"]')!;
  act(() => secondTrigger.click());
  const ids = secondTrigger.getAttribute('aria-controls')?.split(/\s+/) ?? [];
  const second = ids.map((id) => document.getElementById(id)).find((node) => node?.getAttribute('role') === 'menu');
  expect(second).toBeDefined(); expect(second).not.toBe(first.menu); expect(second?.id).not.toBe(first.menu.id);
});
