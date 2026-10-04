import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import { PlaylistsView } from '../src/views/PlaylistsView';
import { usePlaylistStore } from '../src/stores/playlistStore';
import { useDialogFocus } from '../src/hooks/useDialogFocus';

const network = vi.hoisted(() => ({ fetch: vi.fn(), export: vi.fn(), import: vi.fn() }));
vi.mock('@/hooks/useDialogFocus', () => ({ useDialogFocus: vi.fn() }));
vi.mock('@/stores/libraryPersistence', () => ({ attachLibraryPersistence: vi.fn() }));
vi.mock('@/stores/favoritesStore', async () => {
  const { create } = await import('zustand');
  return { useFavoritesStore: create(() => ({ favorites: [] })) };
});
vi.mock('@/stores/historyStore', async () => {
  const { create } = await import('zustand');
  return { useHistoryStore: create(() => ({ history: [] })) };
});
vi.mock('@/stores/wyAccountStore', async () => {
  const { create } = await import('zustand');
  return { useWyAccountStore: create(() => ({ account: null, playlists: [], isLoading: false, isLoaded: false, error: '', preloadPlaylistSongs: vi.fn(), refreshPlaylists: vi.fn() })) };
});
vi.mock('@/services/playlistLinkImportService', () => ({ fetchPlaylistSongsFromLink: network.fetch }));
vi.mock('@/services/playlistTransferService', () => ({ exportPlaylists: network.export, importPlaylists: network.import }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const songs = [{ id: 'song', source: 'wy', name: 'Song', singer: 'Artist', interval: 120 }] as MusicInfo[];
let renderer: ReactTestRenderer;
let pathname: string;
function Location() { pathname = useLocation().pathname; return null; }
function mount() {
  act(() => { renderer = create(<MemoryRouter initialEntries={['/playlists']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PlaylistsView /><Location /></MemoryRouter>, { createNodeMock: (element) => element.props.role === 'dialog' ? { label: element.props['aria-label'] } : null }); });
}
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join(''); }
function button(label: string) { return renderer.root.findAllByType('button').filter(node => text(node) === label).slice(-1)[0]; }
function click(label: string) { act(() => button(label).props.onClick()); }
function change(id: string, value: string) { act(() => renderer.root.findByProps({ id }).props.onChange({ target: { value } })); }
function openImport() {
  click('链接');
  change('playlist-link', 'https://music.163.com/#/playlist?id=123456');
  change('playlist-link-name', 'Imported');
}
function startImport() { act(() => button('导入').props.onClick()); }
beforeEach(() => {
  vi.mocked(useDialogFocus).mockClear();
  network.fetch.mockReset(); network.export.mockReset().mockResolvedValue(true); network.import.mockReset();
  usePlaylistStore.setState({ playlists: [] });
  vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn(), remove: vi.fn() } } });
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('歌单页面真实组件与 store', () => {
  it.each(['cancel', 'overlay', 'unmount', 'escape'])('%s 使未完成导入失效，不创建歌单也不导航', async (reason) => {
    const pending = deferred<{ songs: MusicInfo[] }>();
    network.fetch.mockReturnValue(pending.promise);
    const imported = vi.spyOn(usePlaylistStore.getState(), 'importPlaylist');
    mount(); openImport(); startImport();
    expect(network.fetch).toHaveBeenCalledOnce();
    if (reason === 'cancel') click('取消');
    if (reason === 'overlay') act(() => renderer.root.findByProps({ className: 'af-dialog-overlay' }).props.onClick());
    if (reason === 'unmount') act(() => renderer.unmount());
    if (reason === 'escape') {
      const options = vi.mocked(useDialogFocus).mock.calls.slice(-2).find(([value]) => value.open)![0];
      expect(options.closeOnEscape).not.toBe(false);
      expect(options.onClose).toBe(button('取消').props.onClick);
      expect(options.onClose).toBe(renderer.root.findByProps({ className: 'af-dialog-overlay' }).props.onClick);
      act(() => options.onClose?.());
    }
    await act(async () => { pending.resolve({ songs }); await pending.promise; });
    expect(imported).not.toHaveBeenCalled();
    expect(usePlaylistStore.getState().playlists).toEqual([]);
    expect(pathname).toBe('/playlists');
  });

  it('取消后能立即重新导入，旧成功结果不能关闭或清空新会话', async () => {
    const old = deferred<{ songs: MusicInfo[] }>();
    const current = deferred<{ songs: MusicInfo[] }>();
    network.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    mount(); openImport(); startImport(); click('取消');
    openImport(); change('playlist-link-name', 'New draft');
    expect(button('导入').props.disabled).toBe(false);
    startImport();
    await act(async () => { old.resolve({ songs }); await old.promise; });
    expect(usePlaylistStore.getState().playlists).toHaveLength(0);
    expect(renderer.root.findByProps({ id: 'playlist-link-name' }).props.value).toBe('New draft');
    expect(button('导入中…').props.disabled).toBe(true);
    await act(async () => { current.resolve({ songs }); await current.promise; });
    const imported = usePlaylistStore.getState().playlists[0];
    expect(imported.name).toBe('New draft'); expect(imported.songs).toEqual(songs);
    expect(pathname).toBe(`/playlist/${imported.id}`);
    expect(renderer.root.findAllByProps({ id: 'playlist-link' })).toHaveLength(0);
  });

  it('关闭后旧请求失败，不污染新草稿及忙碌状态', async () => {
    const old = deferred<{ songs: MusicInfo[] }>();
    network.fetch.mockReturnValue(old.promise);
    mount(); openImport(); startImport(); click('取消'); openImport();
    await act(async () => { old.reject(new Error('old network failure')); await old.promise.catch(() => {}); });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('old network failure');
    expect(button('导入').props.disabled).toBe(false);
    expect(renderer.root.findByProps({ id: 'playlist-link-name' }).props.value).toBe('Imported');
  });

  it('当前请求失败仍显示错误并允许重试', async () => {
    network.fetch.mockRejectedValueOnce(new Error('current failure')).mockResolvedValueOnce({ songs });
    mount(); openImport();
    await act(async () => button('导入').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('current failure');
    expect(button('导入').props.disabled).toBe(false);
    await act(async () => button('导入').props.onClick());
    expect(usePlaylistStore.getState().playlists).toHaveLength(1);
  });

  it('封面与标题使用真实链接，菜单按钮独立且编辑、复制、导出、删除保持可用', async () => {
    const playlist = usePlaylistStore.getState().createPlaylist('Local list', 'Description');
    mount();
    const links = renderer.root.findAllByType('a').filter(node => node.props.href === `/playlist/${playlist.id}`);
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.findAllByType('button')).toHaveLength(0);
    expect(links.some(link => text(link) === 'Local list')).toBe(true);
    const cover = links.find(link => link.props.className === 'af-playlist-cover-wrap')!;
    expect(cover.props['aria-label']).toContain('Local list');
    const menu = () => renderer.root.findAllByType('button').find(node => node.props['aria-label'] === '歌单菜单')!;
    act(() => menu().props.onClick()); click('编辑信息');
    change('playlist-name', 'Renamed'); change('playlist-desc', 'Updated'); click('保存');
    expect(usePlaylistStore.getState().playlists[0]).toMatchObject({ name: 'Renamed', description: 'Updated' });
    act(() => menu().props.onClick()); await act(async () => button('导出歌单').props.onClick());
    expect(network.export).toHaveBeenCalledWith([usePlaylistStore.getState().playlists[0]]);
    act(() => menu().props.onClick()); click('复制歌单');
    expect(usePlaylistStore.getState().playlists).toHaveLength(2);
    act(() => menu().props.onClick()); click('删除歌单');
    expect(usePlaylistStore.getState().playlists).toHaveLength(1);
  });
  it('标题链接沿原路由打开歌单，操作菜单本身不触发导航', () => {
    const playlist = usePlaylistStore.getState().createPlaylist('Keyboard list');
    mount();
    act(() => renderer.root.findByProps({ 'aria-label': '歌单菜单' }).props.onClick());
    expect(pathname).toBe('/playlists');
    const title = renderer.root.findAllByType('a').find(node => text(node) === 'Keyboard list')!;
    act(() => title.props.onClick({ button: 0, defaultPrevented: false, preventDefault() {} }));
    expect(pathname).toBe(`/playlist/${playlist.id}`);
  });

  it('两个弹窗分别注册公共 hook，独立 ref 指向有名称的 dialog，关闭复用同一回调', () => {
    mount();
    const hooks = () => vi.mocked(useDialogFocus).mock.calls.slice(-2).map(([options]) => options);
    expect(hooks()).toHaveLength(2);
    const [createOptions, importOptions] = hooks();
    expect(createOptions.open).toBe(false);
    expect(importOptions.open).toBe(false);
    expect(createOptions.containerRef).not.toBe(importOptions.containerRef);
    click('创建歌单');
    const createFocus = hooks()[0];
    expect(createFocus.open).toBe(true);
    expect(createFocus.containerRef).toBe(createOptions.containerRef);
    expect(createFocus.containerRef.current).toEqual({ label: '创建歌单' });
    expect(renderer.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe(true);
    expect(createFocus.onClose).toBe(button('取消').props.onClick);
    expect(createFocus.onClose).toBe(renderer.root.findByProps({ className: 'af-dialog-overlay' }).props.onClick);
    act(() => createFocus.onClose?.());
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    openImport();
    const importFocus = hooks()[1];
    expect(importFocus.open).toBe(true);
    expect(importFocus.containerRef).toBe(importOptions.containerRef);
    expect(importFocus.containerRef.current).toEqual({ label: '从链接导入歌单' });
    expect(hooks()[0].open).toBe(false);
  });

});
