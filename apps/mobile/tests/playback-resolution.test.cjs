const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader, deferred, mobileRequire } = require("./helpers/loadTs.cjs");
const pure = createLoader({});
const core = { ...pure("../../packages/core/src/index.ts"), isPreviewDuration: () => false };
const song = (id, source = "tx") => ({ id, source, name: id, singer: "Artist", interval: 180 });
async function flush() { await new Promise(setImmediate); }
async function until(predicate) { for (let i=0;i<100;i++) { if(predicate())return; await flush(); } assert.fail("播放链未到达检查点"); }
function setup(overrides = {}) {
  const calls=[]; const lookups=[]; const native={}; const logs=[];
  for(const method of ["setupPlayer","updateOptions","setRepeatMode","add","skip","remove","setRate","setVolume","play","stop","reset","pause","seekTo"]) {
    native[method]=async(...args)=>{calls.push([method,...args]);};
  }
  native.getQueue=async()=>[];
  native.getState=async()=>"playing";
  const cache={ getCachedPlaybackUrl:async track=>{lookups.push(track.id);return {url:`https://fixture.invalid/${track.id}`,quality:"320k"};}, saveCachedPlaybackUrl:async()=>{}, invalidateCachedPlaybackUrl:async()=>{} };
  const recommendations = { getPersonalFmSongs: async () => ({ songs: [], hasMore: false }) };
  const cross={findTxVariants:async()=>[],describeCrossSourceFailure:()=>"无替代歌曲"};
  const load=createLoader({
    zustand:mobileRequire("zustand"), "react-native":{AppState:{addEventListener:()=>({remove(){}})}},
    "@react-native-async-storage/async-storage":{getItem:async()=>null,setItem:async()=>{}},
    "react-native-track-player":{__esModule:true,default:native,State:{Playing:"playing",Paused:"paused"},RepeatMode:{Off:0},Event:{},AppKilledPlaybackBehavior:{},Capability:{}},
    "@lx/core":core,"@/services/androidPitchService":{}, "./playbackUrlCache":cache,"@/services/playbackUrlCache":cache,
    "@/services/playbackFailurePolicy":{},"@/services/lyricOverlayService":{isLyricOverlaySupported:()=>false},
    "@/services/listenTrackerService":{startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {}},"./listenTrackerService":{startListeningSession() {}, resetListeningSession() {}, onPlaybackProgress() {}, seekListeningSession() {}, flushListeningSession: async () => {}},
    // parseUrl / resolveWySongUrl / probeStreamUrl 默认不接线：现有用例都走缓存命中，
    // 谁真去调就抛错（TypeError 或显式错误），防止用例悄悄踩进真实解析链。
    "./musicApi":{getLyrics:async()=>[],buildStreamHeaders:()=>({}), parseUrl: overrides.parseUrl ?? (async()=>{throw new Error("网关通道未接线");})},
    "./wyDirectProvider": overrides.wyDirectProvider ?? {},
    "./wyPlaylistService":recommendations,"./customSourceRuntime":overrides.customSourceRuntime??{},"../stores/customSourceStore":overrides.customSourceStore??{},
    "./txMetaService":{hydrateTxTrackMeta:async music=>music},
    "./streamProbe": overrides.streamProbe ?? {},
    "./hiddenFallbackService":{startHiddenSearch:async()=>[],resolveHiddenFromGroups:async()=>null,resolveHiddenFallback:async()=>null},
    "@/services/crossSourceFallbackService":cross,
    "@/stores/playbackSettingsStore":{usePlaybackSettingsStore:{getState:()=>({defaultQuality:overrides.defaultQuality??"320k"})}},
    "./cacheService":{CACHEABLE_AUDIO_SOURCES:new Set(),getCachedLyrics:async()=>[],cacheCover:async()=>{},cacheLyrics:async()=>{},deleteCachedAudioForMusic:overrides.deleteCachedAudioForMusic??(async()=>{})},
    "@/services/logger":{logger:{debug(...args){logs.push(["debug",...args]);},info(...args){logs.push(["info",...args]);},warn(...args){logs.push(["warn",...args]);},error(...args){logs.push(["error",...args]);}}},
  });
  const store=load("src/stores/playerStore.ts").usePlayerStore;
  const service=load("src/services/playerService.ts");
  return {store,service,calls,lookups,cache,cross,recommendations, load, logs, requests: load("src/services/playbackRequest.ts")};
}
// 上限只是 runner 的安全网，不是断言：这些用例靠推进虚拟计时器消耗真实 CPU，墙钟时间只反映
// 机器速度。5000ms 在并发跑整个套件时会把它们判成超时（实测同一用例 4.2s，转译未缓存时更高）。
const options={timeout:15000};

for (const invalidProbe of [{ ok: false, reason: "HTTP 404", definitive: true }, { ok: true, totalBytes: 300000 }]) {
  test(`网关每档快速返回${invalidProbe.ok ? "试听" : "404"}时仍尝试可用自定义源`, options, async t => {
    t.mock.timers.enable({apis:["setTimeout","Date"]});
    let customCalls = 0;
    const h = setup({
      defaultQuality: "flac",
      parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/rejected", quality }),
      customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "good", name: "good", enabled: true }] }) } },
      customSourceRuntime: { requestCustomSourceMusicUrl: async (_source, _song, quality) => { customCalls++; return { url: "https://custom.invalid/full", quality }; } },
      streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async url => url.includes("gateway.invalid") ? invalidProbe : { ok: true, totalBytes: 5000000 } },
    });
    h.cache.getCachedPlaybackUrl = async () => null;
    const pending = h.service.playSong(song("candidate"));
    let outcome;
    pending.then(() => { outcome = "played"; }, error => { outcome = error.message; });
    await flush();
    for (let elapsed = 0; elapsed < 10000; elapsed += 100) { t.mock.timers.tick(100); await flush(); }
    assert.equal(outcome, "played");
    assert.equal(h.store.getState().currentUrl, "https://custom.invalid/full");
    assert.ok(customCalls > 0);
    await pending;
  });
}

test("原生加载拒收网关地址后排除同一来源并尝试同歌曲自定义源", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const loaded = [];
  const h = setup({
    parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/native-rejected", quality }),
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "good", name: "good", enabled: true }] }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (_source, _song, quality) => ({ url: "https://custom.invalid/native-good", quality }) },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true, totalBytes: 5000000 }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  h.store.setState({ play: async (track, url) => {
    loaded.push(url);
    if (url.includes("gateway.invalid")) throw new Error("native decoder rejected");
    h.store.setState({ currentSong: track, currentUrl: url, isPlaying: true });
  } });
  let outcome;
  const pending = h.service.playSong(song("native-recovery"));
  pending.then(() => { outcome = "played"; }, error => { outcome = error.message; });
  await flush();
  for (let elapsed = 0; elapsed < 10000; elapsed += 100) { t.mock.timers.tick(100); await flush(); }
  assert.equal(outcome, "played");
  assert.deepEqual(loaded, ["https://gateway.invalid/native-rejected", "https://custom.invalid/native-good"]);
  assert.equal(h.store.getState().currentSong.id, "native-recovery");
  await pending;
});

test("连续原生错误保留已拒绝来源，按同歌曲剩余候选恢复", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const requested = [];
  const h = setup({
    parseUrl: async (_song, quality) => { requested.push(["gateway", quality]); return { url: "https://gateway.invalid/a", quality }; },
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: ["b", "c"].map(id => ({ id, name: id, enabled: true })) }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (source, _song, quality) => { requested.push([source.id, quality]); return { url: `https://custom.invalid/${source.id}`, quality }; } },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true, totalBytes: 5000000 }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  await h.service.playSong(song("repeated-native"));
  assert.equal(h.store.getState().currentUrl, "https://gateway.invalid/a");
  await h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId());
  assert.equal(h.store.getState().currentUrl, "https://custom.invalid/b");
  await h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId());
  assert.equal(h.store.getState().currentUrl, "https://custom.invalid/c");
  assert.equal(requested.filter(([id]) => id === "c").length, 1);
  assert.ok(requested.some(([id]) => id === "b"));
});

test("连续原生错误不刷新同歌曲截止时间", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const h = setup({
    parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/a", quality }),
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "slow", name: "slow", enabled: true }] }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: () => new Promise(() => {}) },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  await h.service.playSong(song("deadline-native"));
  t.mock.timers.tick(25000); await flush();
  let outcome = "pending";
  const pending = h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId());
  pending.then(() => { outcome = "played"; }, error => { outcome = error.message; });
  await flush();
  for (let elapsed = 0; elapsed < 5100; elapsed += 100) { t.mock.timers.tick(100); await flush(); }
  assert.notEqual(outcome, "pending");
  assert.notEqual(outcome, "played");
  await pending.catch(() => {});
});

test("同源flac被播放器拒收后仍可使用其320k候选", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const loaded = [];
  const h = setup({
    defaultQuality: "flac",
    parseUrl: async () => { throw new Error("gateway unavailable"); },
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "same", name: "same", enabled: true, sources: { tx: { actions: ["musicUrl"], qualitys: ["flac", "320k"] } } }] }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (_source, _song, quality) => ({ url: `https://custom.invalid/${quality}`, quality }) },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true, totalBytes: 5000000 }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  h.store.setState({ play: async (track, url) => {
    loaded.push(url);
    if (url.endsWith("flac")) throw new Error("flac decoder failure");
    h.store.setState({ currentSong: track, currentUrl: url, isPlaying: true });
  } });
  let outcome;
  const pending = h.service.playSong(song("same-source"));
  pending.then(() => { outcome = "played"; }, error => { outcome = error.message; });
  await flush();
  for (let elapsed = 0; elapsed < 30000; elapsed += 100) { t.mock.timers.tick(100); await flush(); }
  assert.equal(outcome, "played");
  assert.deepEqual(loaded, ["https://custom.invalid/flac", "https://custom.invalid/320k"]);
  await pending;
});

test("同档来源返回旋转坏URL时不重新请求已拒绝候选", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const requested = new Map();
  const loaded = [];
  const h = setup({
    parseUrl: async () => { throw new Error("gateway unavailable"); },
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: ["bad", "good"].map(id => ({ id, name: id, enabled: true, sources: { tx: { actions: ["musicUrl"], qualitys: ["320k"] } } })) }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (source, _song, quality) => {
      requested.set(source.id, (requested.get(source.id) ?? 0) + 1);
      return { url: `https://custom.invalid/${source.id}/${requested.get(source.id)}`, quality };
    } },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  h.store.setState({ play: async (track, url) => {
    loaded.push(url);
    if (url.includes("/bad/")) throw new Error("bad codec");
    h.store.setState({ currentSong: track, currentUrl: url });
  } });
  const pending = h.service.playSong(song("rotate"));
  await flush();
  for (let elapsed = 0; elapsed < 5000; elapsed += 100) { t.mock.timers.tick(100); await flush(); }
  await pending;
  assert.equal(requested.get("bad"), 1);
  assert.deepEqual(loaded, ["https://custom.invalid/bad/1", "https://custom.invalid/good/1"]);
});

test("恢复旧进度不等于健康播放，未推进五秒不能刷新恢复期限", options, async t => {
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const h = setup({
    parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/a", quality }),
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "b", name: "b", enabled: true }] }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (_source, _song, quality) => ({ url: "https://custom.invalid/b", quality }) },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  await h.service.playSong(song("resumed"));
  for (const position of [0, 1, 2, 3, 4, 5]) h.service.notePlaybackCandidateHealthy("tx:resumed", position);
  h.store.setState({ position: 50 });
  t.mock.timers.tick(60000); await flush();
  await h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId());
  h.service.notePlaybackCandidateHealthy("tx:resumed", 50);
  t.mock.timers.tick(30000); await flush();
  await assert.rejects(h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId()), /换源预算耗尽/);
});

test("探活无size而原生识别试听时清除磁盘候选并继续同曲换源", options, async () => {
  const invalidated = [];
  const h = setup({
    parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/preview", quality }),
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: [{ id: "full", name: "full", enabled: true }] }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (_source, _song, quality) => ({ url: "https://custom.invalid/full", quality }) },
    streamProbe: { PROBE_TIMEOUT_MS: 5000, probeStreamUrl: async () => ({ ok: true }) },
    deleteCachedAudioForMusic: async track => { invalidated.push(track.id); },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  await h.service.playSong(song("native-preview"));
  await h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId(), { rejectPreview: true });
  assert.equal(h.store.getState().currentUrl, "https://custom.invalid/full");
  assert.equal(h.store.getState().currentSong.id, "native-preview");
  assert.deepEqual(invalidated, ["native-preview"]);
});

for (const rejectPreview of [false, true]) {
  test(`失效缓存挂起也必须受恢复总deadline约束(preview=${rejectPreview})`, options, async t => {
    t.mock.timers.enable({apis:["setTimeout","Date"]});
    const h = setup({ parseUrl: async (_song, quality) => ({ url: "https://gateway.invalid/new", quality }), streamProbe: { probeStreamUrl: async () => ({ ok: true }) } });
    await h.service.playSong(song("cleanup-timeout"));
    h.cache.invalidateCachedPlaybackUrl = () => new Promise(() => {});
    let outcome = "pending";
    const pending = h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId(), { rejectPreview });
    pending.then(() => { outcome = "played"; }, error => { outcome = error.message; });
    await flush();
    t.mock.timers.tick(core.PLAYBACK_RESOLVE_TOTAL_BUDGET_MS + 1); await flush();
    assert.match(outcome, /解析超时|换源预算耗尽/);
    await pending.catch(() => {});
  });
}

test("失效缓存挂起时手动新意图立即结算旧恢复", options, async () => {
  const h = setup();
  await h.service.playSong(song("cleanup-cancel"));
  h.cache.invalidateCachedPlaybackUrl = () => new Promise(() => {});
  let settled = false;
  const pending = h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId(), { rejectPreview: true });
  pending.catch(() => {}).finally(() => { settled = true; });
  await flush();
  h.requests.beginPlaybackRequest(); await flush();
  assert.equal(settled, true);
  await pending.catch(() => {});
});

test("真实暂停续播保留当前候选身份，不让旋转坏地址重新抢占恢复", options, async () => {
  const requested = [];
  const h = setup({
    parseUrl: async () => { throw new Error("gateway unavailable"); },
    customSourceStore: { useCustomSourceStore: { getState: () => ({ sources: ["bad", "good"].map(id => ({ id, name: id, enabled: true, sources: { tx: { actions: ["musicUrl"], qualitys: ["320k"] } } })) }) } },
    customSourceRuntime: { requestCustomSourceMusicUrl: async (source, _song, quality) => {
      requested.push(source.id);
      return { url: `https://custom.invalid/${source.id}/${requested.length}`, quality };
    } },
    streamProbe: { probeStreamUrl: async () => ({ ok: true }) },
  });
  h.cache.getCachedPlaybackUrl = async () => null;
  await h.service.playSong(song("resumed-candidate"));
  await h.store.getState().pause();
  await h.service.resumePlayback();
  await h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId());
  assert.deepEqual(requested, ["bad", "good"]);
  assert.match(h.store.getState().currentUrl, /\/good\//);
});

test("真实seek不能把未健康候选变成健康并刷新恢复期限", options, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const h = setup();
  await h.service.playSong(song("seek-not-healthy"));
  h.service.notePlaybackCandidateHealthy("tx:seek-not-healthy", 0);
  await h.store.getState().seekTo(50);
  h.service.notePlaybackCandidateHealthy("tx:seek-not-healthy", 50);
  t.mock.timers.tick(core.PLAYBACK_RESOLVE_TOTAL_BUDGET_MS + 1); await flush();
  await assert.rejects(h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId()), /换源预算耗尽/);
});

test("小幅seek中断连续健康计量，恢复期内不能拼接跳转进度", options, async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const h = setup();
  await h.service.playSong(song("small-seek"));
  for (const position of [0, 1, 2, 3, 4]) h.service.notePlaybackCandidateHealthy("tx:small-seek", position);
  await h.store.getState().seekTo(5);
  h.service.notePlaybackCandidateHealthy("tx:small-seek", 5);
  t.mock.timers.tick(core.PLAYBACK_RESOLVE_TOTAL_BUDGET_MS + 1); await flush();
  await assert.rejects(h.service.recoverCurrentSongPlayback(h.requests.getCurrentPlaybackRequestId()), /换源预算耗尽/);
});

test("主源挂起时采用已有低档结果，并为外层探活保留预算", options, async t=>{
  t.mock.timers.enable({apis:["setTimeout","Date"]});
  const h=setup({
    defaultQuality:"flac",
    parseUrl:()=>new Promise(()=>{}),
    customSourceStore:{useCustomSourceStore:{getState:()=>({sources:[{id:"lx",name:"LX",enabled:true}]})}},
    customSourceRuntime:{requestCustomSourceMusicUrl:async()=>({url:"https://fixture.invalid/320k",quality:"320k"})},
    streamProbe:{PROBE_TIMEOUT_MS:5000,probeStreamUrl:async(_url,_headers,timeoutMs)=>{
      if(timeoutMs<=2500)return {ok:true};
      return new Promise(resolve=>setTimeout(()=>resolve({ok:true}),4900));
    }},
  });
  h.cache.getCachedPlaybackUrl=async()=>null;
  let outcome="pending";
  const playing=h.service.playSong(song("fallback"));
  playing.then(()=>{outcome="played";},error=>{outcome=error.message;});
  await flush();
  for(let elapsed=0;elapsed<30000;elapsed+=100){t.mock.timers.tick(100);await flush();}
  assert.equal(outcome,"played");
  assert.equal(h.store.getState().currentUrl,"https://fixture.invalid/320k");
  await playing;
});

test("总预算涵盖主源失败后的跨源候选，超时后迟到结果不能开播",options,async t=>{
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
  t.mock.timers.tick(core.PLAYBACK_RESOLVE_TOTAL_BUDGET_MS);await flush();const atDeadline=outcome;
  gate.resolve({url:"https://fixture.invalid/late",quality:"320k"});await playing.catch(()=>{});await flush();
  assert.match(atDeadline,/解析超时/);
  assert.equal(h.calls.some(call=>call[0]==="play"),false);
  assert.equal(h.store.getState().loading,false);
});

test("跨源替代逐个记录候选失败原因，全部失败才报终局",options,async()=>{
  const h=setup();const failures=["网络抖动：cand-a 取链超时","没有可用脚本：cand-b 无自定义源"];let attempts=0;
  h.cross.findTxVariants=async()=>[song("cand-a"),song("cand-b")];
  h.cache.getCachedPlaybackUrl=async track=>{
    if(track.source==="wy")throw new Error("原曲不可用");
    throw new Error(failures[attempts++]);
  };
  let message=null;
  await h.service.playQueue([song("original","wy")]).catch(error=>{message=error.message;});
  // 行为不变：每个候选都要试过
  assert.equal(attempts,2);
  // 每个候选的失败原因都要留档，线上能区分网络抖动与没有可用脚本
  const logged=h.logs.filter(entry=>entry[0]==="warn"&&entry[1]==="跨源替代候选解析失败");
  assert.deepEqual(logged.map(entry=>[entry[2].song,entry[2].reason]),[
    ["tx:cand-a","网络抖动：cand-a 取链超时"],
    ["tx:cand-b","没有可用脚本：cand-b 无自定义源"],
  ]);
  // 终局文案语义不变
  assert.equal(message,"原曲不可用（无替代歌曲）");
});

test("播放切换把取消信号传给跨源搜索，不再解析旧搜索候选", options, async () => {
  const h = setup();
  const gate = deferred();
  let searchSignal;
  let entered = false;
  h.cache.getCachedPlaybackUrl = async track => {
    if (track.source === "wy") throw new Error("原曲不可用");
    return { url: `https://fixture.invalid/${track.id}`, quality: "320k" };
  };
  h.cross.findTxVariants = async (_song, signal) => {
    entered = true;
    searchSignal = signal;
    return gate.promise;
  };
  const old = h.service.playQueue([song("original", "wy")]);
  await until(() => entered);
  await h.service.playQueue([song("current")]);
  gate.resolve([song("stale")]);
  await old;
  assert.equal(searchSignal?.aborted, true);
  assert.equal(h.store.getState().currentSong.id, "current");
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
  t.mock.timers.tick(core.PLAYBACK_RESOLVE_TOTAL_BUDGET_MS);await flush();
  h.store.getState().setQueue([song("A"),song("B")],0);
  const playing=h.service.playNext();await flush();await flush();
  const beforeRelease=lookupCount;
  gate.resolve({url:"https://fixture.invalid/old",quality:"320k"});await playing;
  assert.equal(beforeRelease,2);
  assert.equal(h.store.getState().currentSong.id,"B");
});

test("新的预读取消不再被消费的旧预读，避免慢源占满全局名额",options,async()=>{
  const requests = [];
  const h = setup({ streamProbe: { probeStreamUrl: async () => ({ ok: true }) }, parseUrl: (track, quality, signal) => new Promise((resolve, reject) => {
    requests.push({ id: track.id, signal, resolve, quality });
    signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }) });
  h.cache.getCachedPlaybackUrl = async () => null;
  h.service.prefetchSong(song("old"));
  await until(() => requests.length === 1);
  h.service.prefetchSong(song("new"));
  await until(() => requests.length === 2);
  const wasCancelled = requests[0].signal?.aborted;
  for (const request of requests) request.resolve({ url: `https://cdn/${request.id}`, quality: request.quality });
  await flush();
  await flush();
  assert.equal(wasCancelled, true);
});

test("实际播放复用中的预读不会被下一首预读误取消",options,async()=>{
  const requests = [];
  const h = setup({ streamProbe: { probeStreamUrl: async () => ({ ok: true }) }, parseUrl: (track, quality, signal) => new Promise(resolve => requests.push({ id: track.id, signal, resolve, quality })) });
  h.cache.getCachedPlaybackUrl = async () => null;
  h.service.prefetchSong(song("shared"));
  await until(() => requests.length === 1);
  const playing = h.service.playQueue([song("shared")]);
  await flush();
  h.service.prefetchSong(song("next"));
  await until(() => requests.length === 2);
  const wasCancelled = requests[0].signal?.aborted;
  for (const request of requests) request.resolve({ url: `https://cdn/${request.id}`, quality: request.quality });
  await playing;
  assert.equal(wasCancelled, false);
  assert.equal(requests.filter(request => request.id === "shared").length, 1);
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


test("personalFm续批与后续播放共享同步认领的请求身份",options,async()=>{
  const h=setup();const gate=deferred();let entered=false;
  h.recommendations.getPersonalFmSongs=async()=>{entered=true;return gate.promise;};
  h.store.getState().setPersonalFmContext({currentBatch:[song("A")],currentBatchIndex:0,buffer:[],hasMore:true});
  h.store.setState({currentSong:song("A")});
  const playing=h.service.playNext();
  const owner=h.requests.getCurrentPlaybackRequestId();
  await until(()=>entered);
  gate.resolve({songs:[song("B")],hasMore:false});
  await playing;
  assert.equal(h.requests.getCurrentPlaybackRequestId(),owner);
  assert.equal(h.store.getState().currentSong.id,"B");
});

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
