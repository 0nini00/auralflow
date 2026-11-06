import { beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ list: vi.fn(), lookup: vi.fn(), load: vi.fn(), save: vi.fn(), remove: vi.fn(), play: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ listCachedAudio: deps.list, lookupCachedMedia: deps.lookup, libraryLoad: deps.load, librarySave: deps.save, removeCachedMedia: deps.remove }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: { getState: () => ({ playQueue: deps.play }) } }));
import { createOfflineCacheLibrary } from '../src/services/offlineCache';
const file = { key:'wy-1-audio-builtinNetease-320k', path:'C:/cache/a.mp3', bytes:100000, modifiedAt:1 };
beforeEach(() => { vi.resetAllMocks(); let index: unknown = null;
  deps.load.mockImplementation(async () => index); deps.save.mockImplementation(async (_namespace, value) => { index = value; });
  deps.list.mockResolvedValue([file]); deps.lookup.mockResolvedValue(file); deps.remove.mockResolvedValue(true); });
it('列表以磁盘存在为准，写入元数据后保留歌曲名', async () => {
  const library=createOfflineCacheLibrary();
  await library.record(file.key,{id:'1',source:'wy',name:'Song',singer:'Artist',albumName:''},'320k');
  const listed=await library.list();
  expect(listed[0]).toMatchObject({key:file.key,name:'Song',singer:'Artist',quality:'320k'});
  deps.list.mockResolvedValue([]);
  expect(await library.list()).toEqual([]);
});
it('播放检查本地存在，只提交本地实体，不携带网关或远程封面', async () => {
  const library=createOfflineCacheLibrary();
  const entries=await library.list();
  await library.play(entries,0);
  const song=deps.play.mock.calls[0][0][0];
  expect(song).toMatchObject({source:'local',isLocal:true,url:'asset://C:/cache/a.mp3'});
  expect(song.gateway).toBeUndefined();
  deps.lookup.mockResolvedValue(null);
  await expect(library.play(entries,0)).rejects.toThrow('不存在');
  expect(deps.play).toHaveBeenCalledTimes(1);
});
it('删除失败向界面拒绝，不先删除索引', async () => {
  const library=createOfflineCacheLibrary();
  await library.record(file.key,{id:'1',source:'wy',name:'Song',singer:'Artist',albumName:''},'320k');
  deps.remove.mockRejectedValue(new Error('locked'));
  await expect(library.remove(await library.list())).rejects.toThrow('locked');
  expect((await library.list())[0].name).toBe('Song');
});
it('写入失败显式拒绝，但刷新仍重新读取磁盘与索引', async () => {
  const library=createOfflineCacheLibrary(); deps.save.mockRejectedValueOnce(new Error('disk busy'));
  await expect(library.record(file.key,{id:'1',source:'wy',name:'Song',singer:'Artist',albumName:''},'320k')).rejects.toThrow('disk busy');
  expect(await library.list()).toHaveLength(1);
  expect(deps.list).toHaveBeenCalledTimes(1);
});
it('同一文件元数据未变不重复写索引，元数据变化才提交', async () => {
  const library=createOfflineCacheLibrary();
  const song={id:'1',source:'wy' as const,name:'Song',singer:'Artist',albumName:''};
  await library.record(file.key,song,'320k');await library.record(file.key,song,'320k');
  expect(deps.save).toHaveBeenCalledTimes(1);
  await library.record(file.key,{...song,name:'Updated'},'320k');
  expect(deps.save).toHaveBeenCalledTimes(2);
});
it('索引坏字段明确报错，不传入视图或覆盖原数据', async () => {
  const library=createOfflineCacheLibrary(); deps.load.mockResolvedValue({[file.key]:{name:{bad:true}}});
  await expect(library.list()).rejects.toThrow('格式错误');
  expect(deps.save).not.toHaveBeenCalled();
});
