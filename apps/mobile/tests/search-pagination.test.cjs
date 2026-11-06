const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, deferred } = require('./helpers/loadTs.cjs');

function setup(options = {}) {
  const calls = [], cache = new Map();
  const core = { createBuiltinMusicApiClient: () => ({ searchSongs: async (...args) => { calls.push(['gateway',...args]); return []; } }), normalizeSearchKeyword: s => s.trim() };
  const load = createLoader({
    '@lx/core': core,
    './searchResultCache': {
      getCachedResult: (s,q,n) => cache.get(`${s}:${q}:${n}`),
      setCachedResult: (s,q,r,n) => cache.set(`${s}:${q}:${n}`,r),
    },
    './songMetadataMerge': { mergeDuplicateSongs: songs => songs },
    './txPlaylistService': { searchTxSongs: async (...args) => { calls.push(['tx',...args]); return [{id:'tx2',source:'tx'}]; }, searchTxPlaylists: async () => [] },
    './wySearchService': { searchWySongsViaCloudSearch: async (...args) => { calls.push(['wy',...args]); if(options.failDirect) throw new Error('direct'); return [{id:'wy2',source:'wy'}]; } },
    './wyMusicMapper': {}, './wyDirectProvider': {},
    '@/utils/fetchWithTimeout': { fetchWithTimeout: async url => { calls.push(['http',url]); return {ok:true,text:async()=>JSON.stringify(options.payload ?? {code:200,result:{artists:[{id:1,name:'Singer'}]}})}; } },
  });
  return { api:load('src/services/musicApi.ts'), calls, core };
}

test('搜索歌曲分页传给真实来源并使用独立缓存键', async () => {
  const h=setup();
  await h.api.searchSongs('wy','song',1);
  await h.api.searchSongs('wy','song',2);
  await h.api.searchSongs('wy','song',2);
  assert.deepEqual(h.calls.map(call=>call.slice(0,4)), [['wy','song',100,1],['wy','song',100,2]]);
});
test('切换网关后仍保持同一页大小避免漏过歌曲',async()=>{
  const h=setup({failDirect:true});await h.api.searchSongs('wy','song',2);
  assert.deepEqual(h.calls.find(call=>call[0]==='gateway').slice(1),['netease','song',2,100,'wy']);
});
test('HTTP成功但业务拒绝时分类显式失败且不写空缓存',async()=>{
  const h=setup({payload:{code:301,message:'login required'}});
  await assert.rejects(h.api.searchCategoryPage('wy','artists','song',1),/301/);
  await assert.rejects(h.api.searchCategoryPage('wy','artists','song',1),/301/);
  assert.equal(h.calls.filter(call=>call[0]==='http').length,2);
});
test('歌手第二页使用offset，不再反复返回第一页', async () => {
  const h=setup();
  const page=await h.api.searchCategoryPage('wy','artists','song',2);
  assert.match(h.calls[0][1],/offset=30/);
  assert.equal(page.result.artists[0].name,'Singer');
});
test('移动会话快歌曲先展示，失败分类重试不重搜歌曲', async () => {
  const h=setup(), slow=deferred(), calls=[];
  const pure=createLoader({});
  const core={...h.core,...pure('../../packages/core/src/paged-search.ts')};
  const load=createLoader({'@lx/core':core,'./musicApi':h.api,'./songMetadataMerge':{mergeDuplicateSongs:s=>s}});
  let fail=true;
  const session=load('src/services/searchSession.ts').createMobileSearchSession('song',undefined,async(source,category,keyword,page)=>{
    calls.push(`${source}:${category}:${page}`);
    if(category==='albums') return slow.promise;
    if(category==='artists'&&fail) throw new Error('retry');
    return {result:{songs:category==='songs'?[{source,id:source}]:[],artists:[],albums:[],playlists:[]},hasMore:false};
  });
  const pending=session.start();
  await new Promise(setImmediate);
  assert.equal(session.getSnapshot().filter(s=>s.source.category==='songs').every(s=>s.status==='ready'),true);
  fail=false;await session.retry('artists');
  assert.equal(calls.filter(c=>c.includes(':songs:')).length,2);
  slow.resolve({result:{songs:[],artists:[],albums:[],playlists:[]},hasMore:false});await pending;
});
