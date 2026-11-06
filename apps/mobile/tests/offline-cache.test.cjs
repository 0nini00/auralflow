const test=require('node:test');
const assert=require('node:assert/strict');
const {createLoader}=require('./helpers/loadTs.cjs');
test('离线缓存播放只构造本地歌曲，丢失文件明确失败',async()=>{
  const plays=[]; let exists=true;
  const load=createLoader({'react-native-fs':{exists:async()=>exists}, './playerService':{playQueue:async(...args)=>plays.push(args)}});
  const service=load('src/services/offlineCache.ts');
  const entry={key:'wy-1-320k',name:'Song',singer:'Artist',source:'wy',quality:'320k',path:'/cache/song.audio',size:12,cachedAt:1};
  await service.playOfflineCache([entry],0);
  assert.equal(plays[0][0][0].isLocal,true); assert.equal(plays[0][0][0].source,'local');
  assert.equal(plays[0][0][0].url,'file:///cache/song.audio');
  exists=false; await assert.rejects(service.playOfflineCache([entry],0),/不存在/); assert.equal(plays.length,1);
});
test('列表元数据不能覆盖磁盘真实路径',()=>{
  const model=createLoader({})('src/services/audioCacheListModel.ts');
  const result=model.reconcileAudioCacheEntries({'wy-1-320k':{path:'/old',name:'Song',singer:'Artist',source:'wy',quality:'320k',cachedAt:1}},[{base:'wy-1-320k',path:'/actual.audio',size:12}]);
  assert.equal(result.entries[0].path,'/actual.audio');
});
