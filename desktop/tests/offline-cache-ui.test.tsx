import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ list:vi.fn(),play:vi.fn(),remove:vi.fn() }));
vi.mock('@/services/offlineCache',()=>({offlineCache:api}));
vi.mock('../src/components/VirtualList',()=>({VirtualList:({items,renderItem}:any)=><div>{items.map((item:any)=><div key={item.key}>{renderItem(item)}</div>)}</div>}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn(async () => true) }));
import { OfflineCacheLibrary } from '../src/components/OfflineCacheLibrary';
let view:ReactTestRenderer;
const items=[{key:'a',name:'A',singer:'Artist',quality:'320k',bytes:100,path:'/a',albumName:''},{key:'b',name:'B',singer:'Artist',quality:'320k',bytes:100,path:'/b',albumName:''}];
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const button=(text:string)=>view.root.findAllByType('button').find(node=>node.children.join('').includes(text))!;
beforeEach(async()=>{vi.resetAllMocks();api.list.mockResolvedValue(items);api.play.mockResolvedValue(undefined);vi.stubGlobal('window',{confirm:()=>true});await act(async()=>{view=create(<OfflineCacheLibrary/>)});await act(async()=>{button('离线缓存曲库').props.onClick();await flush()})});
afterEach(()=>{act(()=>view.unmount());vi.unstubAllGlobals()});
it('点击单曲只校验该曲，不被其他已淘汰文件阻塞',async()=>{
  await act(async()=>{button('A').props.onClick();await flush()});
  expect(api.play).toHaveBeenCalledWith([items[0]],0);
});
it('部分批删失败后刷新真实列表并保留失败消息',async()=>{
  await act(async()=>{button('全选').props.onClick()});
  api.remove.mockRejectedValue(new Error('B locked'));api.list.mockResolvedValue([items[1]]);
  await act(async()=>{button('删除所选').props.onClick();await flush()});
  expect(view.root.findByProps({role:'alert'}).children).toContain('B locked');
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(view.root.findByProps({role:'status'}).children.join('')).toContain('1 首');
});
