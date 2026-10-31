const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");
const pure = createLoader({});
const core = { ...pure("../../packages/core/src/switch-step-queue.ts"), ...pure("../../packages/core/src/request-limiter.ts"), ...pure("../../packages/core/src/playback-quality.ts"), ...pure("../../packages/core/src/recommendations/heartbeat-queue.ts"), ...pure("../../packages/core/src/song-variant.ts"), ...pure("../../packages/core/src/playback-budgets.ts"), isPreviewDuration: () => false };
const song = (id, source = "tx") => ({ id, source, name: id, singer: "Artist", interval: 180 });
async function flush() { await new Promise(setImmediate); }
async function until(predicate) { for (let i=0;i<100;i++) { if(predicate())return; await flush(); } assert.fail("播放链未到达检查点"); }
function setup(overrides = {}) {
  const calls=[]; const lookups=[]; const native={};
  for(const method of ["setupPlayer","updateOptions","setRepeatMode","add","skip","remove","setRate","setVolume","play","stop","reset","pause"]) {
    native[method]=async(...args)=>{calls.push([method,...args]);};
  }
  native.getQueue=async()=>[];
  const cache={ getCachedPlaybackUrl:async track=>{lookups.push(track.id);return {url:`https://fixture.invalid/${track.id}`,quality:"320k"};}, saveCachedPlaybackUrl:async()=>{}, invalidateCachedPlaybackUrl:async()=>{} };
  const recommendations = { getPersonalFmSongs: async () => ({ songs: [], hasMore: false }), getHeartbeatModeList: async () => [] };
  const cross={findTxVariants:async()=>[],describeCrossSourceFailure:()=>"无替代歌曲"};
  const load=createLoader({
    zustand:mobileRequire("zustand"), "react-native":{AppState:{addEventListener:()=>({remove(){}})}},
    "@react-native-async-storage/async-storage":{getItem:async()=>null,setItem:async()=>{}},
    "react-native-track-player":{__esModule:true,default:native,State:{},RepeatMode:{Off:0},Event:{},AppKilledPlaybackBehavior:{},Capability:{}},
    "@lx/core":core,"@/services/androidPitchService":{}, "./playbackUrlCache":cache,"@/services/playbackUrlCache":cache,
    "@/services/playbackFailurePolicy":{},"@/services/lyricOverlayService":{isLyricOverlaySupported:()=>false},
    "@/services/listenTrackerService":{startListeningSession(){},resetListeningSession(){}},"./listenTrackerService":{startListeningSession(){},resetListeningSession(){}},
    // parseUrl / resolveWySongUrl / probeStreamUrl 默认不接线：现有用例都走缓存命中，
    // 谁真去调就抛错（TypeError 或显式错误），防止用例悄悄踩进真实解析链。
    "./musicApi":{getLyrics:async()=>[],buildStreamHeaders:()=>({}), parseUrl: overrides.parseUrl ?? (async()=>{throw new Error("网关通道未接线");})},
    "./wyDirectProvider": overrides.wyDirectProvider ?? {},
    "./wyPlaylistService":recommendations,"./customSourceRuntime":{},"../stores/customSourceStore":{},
    "./streamProbe": overrides.streamProbe ?? {},
    "./hiddenFallbackService":{startHiddenSearch:async()=>[],resolveHiddenFromGroups:async()=>null,resolveHiddenFallback:async()=>null},
    "@/services/crossSourceFallbackService":cross,
    "@/stores/playbackSettingsStore":{usePlaybackSettingsStore:{getState:()=>({defaultQuality:"320k"})}},
    "./cacheService":{CACHEABLE_AUDIO_SOURCES:new Set(),getCachedLyrics:async()=>[],cacheCover:async()=>{},cacheLyrics:async()=>{}},
    "@/services/logger":{logger:{info(){},warn(){},error(){}}},
  });
  const store=load("src/stores/playerStore.ts").usePlayerStore;
  const service=load("src/services/playerService.ts");
  return {store,service,calls,lookups,cache,cross,recommendations, load, requests: load("src/services/playbackRequest.ts")};
}
// 上限只是 runner 的安全网，不是断言：这些用例靠推进虚拟计时器消耗真实 CPU，墙钟时间只反映
// 机器速度。5000ms 在并发跑整个套件时会把它们判成超时（实测同一用例 4.2s，转译未缓存时更高）。
const options={timeout:15000};

test("12秒预算涵盖主源失败后的跨源候选，超时后迟到结果不能开播",options,async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const h=setup();const gate=deferred();let entered=false;
  h.cache.getCachedPlaybackUrl=async track=>{
    if(track.source==="wy")throw new Error("原曲不可用");
    entered=true;return gate.promise;
  };
  h.cross.findTxVariants=async()=>[song("substitute")];
  let outcome="pending";
  const playing=h.service.playQueue([song("original","wy")]);
  playing.then(()=>{outcome="resolved";},error=>{outcome=error.message;});
  await until(()=>entered);
  t.mock.timers.tick(12000);await flush();const atDeadline=outcome;
  gate.resolve({url:"https://fixture.invalid/late",quality:"320k"});await playing.catch(()=>{});await flush();
  assert.match(atDeadline,/解析超时/);
  assert.equal(h.calls.some(call=>call[0]==="play"),false);
  assert.equal(h.store.getState().loading,false);
});

for(const direction of ["next","previous"]){
  test(`手动${direction}立即取消卡住的解析，不等待旧链收口`,options,async()=>{
    const h=setup();const gate=deferred();let entered=false;
    const get=h.cache.getCachedPlaybackUrl;
    h.cache.getCachedPlaybackUrl=async track=>{if(track.id==="B"){entered=true;return gate.promise;}return get(track);};
    h.store.getState().setQueue([song("A"),song("B"),song("C")],0);
    const first=h.service.playNext();await until(()=>entered);
    const manual=direction==="next"?h.service.playNext():h.service.playPrevious();
    await flush();await flush();const beforeRelease=h.store.getState().currentSong?.id;
    gate.resolve({url:"https://fixture.invalid/stale",quality:"320k"});
    await Promise.all([first,manual]);await flush();
    assert.equal(beforeRelease,direction==="next"?"C":"A");
    assert.equal(h.store.getState().currentSong.id,direction==="next"?"C":"A");
    assert.equal(h.calls.filter(call=>call[0]==="play").length,1);
  });
}

test("清空队列立即结算挂起的解析，不能留下等待旧网络的切歌锁",options,async()=>{
  const h=setup();const gate=deferred();let entered=false;
  h.cache.getCachedPlaybackUrl=async()=>{entered=true;return gate.promise;};
  let settled=false;
  const playing=h.service.playQueue([song("A")]);playing.then(()=>{settled=true;});
  await until(()=>entered);await h.store.getState().clearQueue();await flush();
  const beforeRelease=settled;
  gate.resolve({url:"https://fixture.invalid/stale",quality:"320k"});await playing;
  assert.equal(beforeRelease,true);
  assert.equal(h.store.getState().currentSong,null);
});


test("预读超时释放在途条目，真实切歌可以重新解析",options,async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const h=setup();const gate=deferred();let lookupCount=0;
  const get=h.cache.getCachedPlaybackUrl;
  h.cache.getCachedPlaybackUrl=async track=>{lookupCount++;return lookupCount===1?gate.promise:get(track);};
  h.service.prefetchSong(song("B"));await until(()=>lookupCount===1);
  t.mock.timers.tick(12000);await flush();
  h.store.getState().setQueue([song("A"),song("B")],0);
  const playing=h.service.playNext();await flush();await flush();
  const beforeRelease=lookupCount;
  gate.resolve({url:"https://fixture.invalid/old",quality:"320k"});await playing;
  assert.equal(beforeRelease,2);
  assert.equal(h.store.getState().currentSong.id,"B");
});

test("FM续批请求同样可被手动下一首替代，旧结果不覆盖新批次",options,async()=>{
  const h=setup();const gate=deferred();let requests=0;
  h.recommendations.getPersonalFmSongs=async()=>{requests++;return requests===1?gate.promise:{songs:[song("fresh")],hasMore:false};};
  h.store.getState().setPersonalFmContext({currentBatch:[song("A")],currentBatchIndex:0,buffer:[],hasMore:true});
  const first=h.service.playNext();await until(()=>requests===1);
  const second=h.service.playNext();await flush();await flush();
  const beforeRelease=requests;
  gate.resolve({songs:[song("stale")],hasMore:false});await Promise.all([first,second]);await flush();
  assert.equal(beforeRelease,2);
  assert.equal(h.store.getState().currentSong.id,"fresh");
});

test("FM续批在Promise结算到写回之间也不能覆盖新播放意图",options,async()=>{
  for(let microtasks=0;microtasks<8;microtasks++){
    const h=setup();const gate=deferred();let entered=false;
    h.recommendations.getPersonalFmSongs=async()=>{entered=true;return gate.promise;};
    h.store.getState().setPersonalFmContext({currentBatch:[song("A")],currentBatchIndex:0,buffer:[],hasMore:true});
    const old=h.service.playNext();await until(()=>entered);
    gate.resolve({songs:[song("stale-FM")],hasMore:false});
    for(let n=0;n<microtasks;n++)await Promise.resolve();
    const latest=h.service.playQueue([song("X")]);
    await Promise.all([old,latest]);await flush();
    assert.equal(h.store.getState().currentSong.id,"X",`微任务边界 ${microtasks}`);
    assert.equal(h.store.getState().playbackContext.type,"queue");
  }
});

test("FM播后补拉不能延迟当前切歌完成或阻止下一首",options,async()=>{
  const h=setup();const gate=deferred();let entered=false;
  h.recommendations.getPersonalFmSongs=async()=>{entered=true;return gate.promise;};
  h.store.getState().setPersonalFmContext({currentBatch:[song("A")],currentBatchIndex:0,buffer:[song("B"),song("C")],hasMore:true});
  const first=h.service.playNext();await until(()=>entered);
  const second=h.service.playNext();await flush();await flush();const beforeRelease=h.store.getState().currentSong.id;
  gate.resolve({songs:[song("late-buffer")],hasMore:false});await Promise.all([first,second]);await flush();
  assert.equal(beforeRelease,"C");
});

test("顺序队尾的下一首不取消唯一在途解析或留下永久loading",options,async()=>{
  const h=setup();const gate=deferred();let entered=false;
  h.cache.getCachedPlaybackUrl=async()=>{entered=true;return gate.promise;};
  h.store.getState().setQueue([song("A"),song("B")],0);h.store.setState({playMode:"sequence"});
  const first=h.service.playNext();await until(()=>entered);
  await h.service.playNext();
  gate.resolve({url:"https://fixture.invalid/B",quality:"320k"});await first;await flush();
  assert.equal(h.store.getState().currentSong.id,"B");
  assert.equal(h.store.getState().loading,false);
  assert.equal(h.calls.filter(call=>call[0]==="play").length,1);
});


for(const kind of ["personalFm","heartbeat"]){
  test(`${kind}续批与后续播放共享同步认领的请求身份`,options,async()=>{
    const h=setup();const gate=deferred();let entered=false;
    if(kind==="personalFm"){
      h.recommendations.getPersonalFmSongs=async()=>{entered=true;return gate.promise;};
      h.store.getState().setPersonalFmContext({currentBatch:[song("A")],currentBatchIndex:0,buffer:[],hasMore:true});
    }else{
      h.recommendations.getHeartbeatModeList=async()=>{entered=true;return gate.promise;};
      h.store.getState().setHeartbeatContext({seedSongId:"A",playlistId:"list",currentBatch:[song("A")],currentBatchIndex:0,buffer:[],hasMore:true});
    }
    h.store.setState({currentSong:song("A")});
    const playing=h.service.playNext();
    const owner=h.requests.getCurrentPlaybackRequestId();
    await until(()=>entered);
    gate.resolve(kind==="personalFm"?{songs:[song("B")],hasMore:false}:[song("B")]);
    await playing;
    assert.equal(h.requests.getCurrentPlaybackRequestId(),owner);
    assert.equal(h.store.getState().currentSong.id,"B");
  });
}

test("会员直连优先：官方取链作为主源直接起播，网关与自定义源都不被唤醒",options,async()=>{
  const requested=[];
  const h=setup({
    wyDirectProvider:{resolveWySongUrl:async(track,quality)=>{requested.push(quality);return `https://official.invalid/${track.id}/${quality}`;}},
    streamProbe:{probeStreamUrl:async()=>({ok:true})},
  });
  h.load("src/services/officialPriority.ts").setVipOfficialFirst(true);
  // 探活需要缓存未命中，否则直接走持久化 URL，覆盖不到真实解析链
  h.cache.getCachedPlaybackUrl=async()=>null;
  h.store.getState().setQueue([song("vip","wy")],0);
  await h.service.playNext();
  assert.ok(requested.length>0,`官方取链应被调用: ${JSON.stringify(requested)}`);
  assert.equal(h.store.getState().currentSong.id,"vip");
  const vipAdd=h.calls.find(call=>call[0]==="add");
  assert.ok(vipAdd,`应写入原生播放队列: ${JSON.stringify(h.calls.map(call=>call[0]))}`);
  // 原生队列里的 id 带 source 前缀（wy-vip）；档位取本轮第一个请求的音质
  const vipTrack=(vipAdd[1]||[]).find(entry=>entry&&entry.id==="wy-vip");
  assert.ok(vipTrack.url.startsWith("https://official.invalid/vip/"),`应使用官方地址: ${vipTrack.url}`);
  assert.ok(h.calls.some(call=>call[0]==="play"));
});

test("非会员不启用会员直连：解析仍走网关主源",options,async()=>{
  const direct=[];
  const h=setup({
    wyDirectProvider:{resolveWySongUrl:async(track,quality)=>{direct.push(quality);return `https://official.invalid/${quality}`;}},
    parseUrl:async(song,quality)=>({url:`https://gateway.invalid/${song.id}`,quality:"320k"}),
    streamProbe:{probeStreamUrl:async()=>({ok:true})},
  });
  h.cache.getCachedPlaybackUrl=async()=>null;
  h.store.getState().setQueue([song("free","wy")],0);
  await h.service.playNext();
  assert.deepEqual(direct,[]);
  const freeAdd=h.calls.find(call=>call[0]==="add");
  const freeTrack=(freeAdd[1]||[]).find(entry=>entry&&entry.id==="wy-free");
  assert.equal(freeTrack.url,"https://gateway.invalid/free");
});
