import { create, act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { SongAddMenuButton } from '../src/components/SongAddMenuButton';
vi.mock('@/stores/favoritesStore', () => ({ useFavoritesStore: vi.fn() }));
vi.mock('@/stores/playlistStore', () => ({ usePlaylistStore: vi.fn() }));
vi.mock('@/stores/wyAccountStore', () => ({ useWyAccountStore: vi.fn() }));
const song = { id: 'one', source: 'wy' as const, name: 'Song', singer: 'Singer', albumName: 'Album' };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });
it('菜单行的可见文字属于实际收藏按钮，不使用覆盖在按钮外的文字', () => {
  act(() => { renderer = create(<SongAddMenuButton song={song} label="收藏 / 加入歌单" className="af-immersive-more-action" />); });
  const button = renderer.root.findByType('button');
  expect(button.findAllByType('span').map(node => node.children.join(''))).toContain('收藏 / 加入歌单');
  expect(button.props['aria-haspopup']).toBe('menu');
  expect(button.props['aria-label']).toBe('收藏 / 加入歌单');
  expect(button.findAllByType('svg')).toHaveLength(2);
});
it('不传文字的其他调用继续保持原来的紧凑图标按钮', () => {
  act(() => { renderer = create(<SongAddMenuButton song={song} />); });
  const button = renderer.root.findByType('button');
  expect(button.findAllByType('span')).toHaveLength(0);
  expect(button.findAllByType('svg')).toHaveLength(1);
  expect(button.props['aria-label']).toBe('添加到');
});
