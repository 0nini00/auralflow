const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLoader, deferred } = require('./helpers/loadTs.cjs');
const options = { timeout: 5000 };
const sessionPath = path.join(__dirname, '../src/services/mediaAudioSession.ts');

function fixture({ state = 'playing', ready = state === 'playing', foreground = 'active' } = {}) {
  const calls = [];
  const logs = [];
  const events = new Map();
  const gates = new Map();
  let nativeState = state;
  let playWhenReady = ready;
  let track = { id: 'wy-1', url: 'fixture:one' };
  let index = 0;
  let interruptions = 0;
  const listen = (name, listener) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(listener);
    return { remove: () => events.get(name).delete(listener) };
  };
  const appState = { currentState: foreground, addEventListener: (_, listener) => listen('app', listener) };
  const invoke = async (name, effect) => {
    calls.push(name);
    // 原生命令先执行、桥接确认可迟到；与 MusicModule 的 play/pause 顺序一致。
    const result = effect();
    const gate = gates.get(name)?.shift();
    if (gate) { gate.entered.resolve(); await gate.wait.promise; }
    return result;
  };
  const native = {
    getActiveTrack: () => invoke('getActiveTrack', () => track),
    getActiveTrackIndex: () => invoke('getActiveTrackIndex', () => index),
    getPlaybackState: () => invoke('getPlaybackState', () => ({ state: nativeState })),
    getPlayWhenReady: () => invoke('getPlayWhenReady', () => playWhenReady),
    pause: () => invoke('pause', () => { nativeState = 'paused'; playWhenReady = false; }),
    play: () => invoke('play', () => { nativeState = 'playing'; playWhenReady = true; }),
    addEventListener: listen,
  };
  const store = {
    currentSong: { source: 'wy', id: '1' }, currentIndex: 0, currentUrl: 'fixture:one',
    isPlaying: state === 'playing', position: 37, queue: ['one', 'two'], lyrics: ['unchanged'],
    pause: async () => {
      calls.push('store.pause');
      const request = requests.beginPlaybackRequest();
      await native.pause();
      if (requests.isCurrentPlaybackRequest(request)) store.syncPlayerState('paused');
    },
    resume: async () => { throw new Error('must not use store.resume'); },
    syncPlayerState: next => { calls.push('sync:' + next); store.isPlaying = next === 'playing'; },
  };
  const load = createLoader({
    'react-native': { AppState: appState },
    'react-native-track-player': {
      __esModule: true, default: native,
      State: { Playing: 'playing', Buffering: 'buffering', Loading: 'loading', Paused: 'paused', None: 'none' },
      Event: { RemoteDuck: 'duck', RemotePause: 'remotePause', RemoteStop: 'remoteStop', PlaybackActiveTrackChanged: 'track' },
    },
    '@/stores/playerStore': { usePlayerStore: { getState: () => store } },
    '@/services/logger': { logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) } },
  });
  const requests = load('src/services/playbackRequest.ts');
  const { createMediaAudioSession } = load('src/services/mediaAudioSession.ts');
  const session = createMediaAudioSession(() => { interruptions++; });
  return {
    session, calls, native, store, requests, logs,
    get interruptions() { return interruptions; },
    get ready() { return playWhenReady; },
    listeners: () => [...events.values()].reduce((sum, set) => sum + set.size, 0),
    emit(name, data) { if (name === 'app') appState.currentState = data; for (const listener of [...(events.get(name) ?? [])]) listener(data); },
    changeTrack(value) { track = { ...track, ...value }; },
    changeIndex(value) { index = value; },
    block(name) {
      const gate = { entered: deferred(), wait: deferred() };
      if (!gates.has(name)) gates.set(name, []);
      gates.get(name).push(gate);
      return gate;
    },
  };
}

// 缺少生产模块时以明确的能力断言失败，不用 ENOENT 代替红灯。
test('共享会话模块提供同步创建接口', options, () => {
  assert.equal(fs.existsSync(sessionPath), true, '需要新增 mediaAudioSession.ts');
});

if (fs.existsSync(sessionPath)) {
  test('开始暂停原歌，关闭只原地恢复一次，不重写歌曲状态', options, async () => {
    const h = fixture();
    const queue = h.store.queue; const lyrics = h.store.lyrics;
    assert.equal(await h.session.start(), true);
    assert.equal(await h.session.start(), true);
    assert.equal(h.interruptions, 0);
    assert.equal(h.ready, false);
    await Promise.all([h.session.close(), h.session.close()]);
    assert.equal(h.calls.filter(call => call === 'store.pause').length, 1);
    assert.equal(h.calls.filter(call => call === 'play').length, 1);
    assert.equal(h.store.isPlaying, true);
    assert.equal(h.store.position, 37);
    assert.equal(h.store.queue, queue); assert.equal(h.store.lyrics, lyrics);
    assert.equal(h.listeners(), 0);
    assert.equal(await h.session.start(), false);
  });

  test('创建后可立即关闭，之后 start 不读原生也不恢复', options, async () => {
    const h = fixture(); await h.session.close();
    assert.equal(await h.session.start(), false);
    assert.deepEqual(h.calls, []); assert.equal(h.listeners(), 0);
  });

  for (const state of ['paused', 'none']) test('原先' + state + '不自动开歌', options, async () => {
    const h = fixture({ state });
    assert.equal(await h.session.start(), true); await h.session.close();
    assert.equal(h.calls.includes('pause'), false); assert.equal(h.calls.includes('play'), false);
  });

  test('创建时已在后台不能启动媒体', options, async () => {
    const h = fixture({ foreground: 'background' });
    assert.equal(await h.session.start(), false); await h.session.close();
    assert.equal(h.calls.includes('pause'), false); assert.equal(h.calls.includes('play'), false);
  });

  for (const resume of [true, false]) test('pause 等待期间 close(' + resume + ')等待暂停确认并取消 start', options, async () => {
    const h = fixture(); const gate = h.block('pause');
    const starting = h.session.start(); await gate.entered.promise;
    let finished = false;
    const closing = h.session.close(resume).then(() => { finished = true; });
    await Promise.resolve(); assert.equal(finished, false);
    gate.wait.resolve(); assert.equal(await starting, false); await closing;
    assert.equal(h.calls.includes('play'), resume);
  });

  test('close(false)可以撤销尚未完成的默认恢复，重复关闭不重试', options, async () => {
    const h = fixture(); await h.session.start(); const gate = h.block('getActiveTrack');
    const closing = h.session.close(); await gate.entered.promise;
    const cancelled = h.session.close(false); gate.wait.resolve();
    await Promise.all([closing, cancelled, h.session.close()]);
    assert.equal(h.calls.includes('play'), false);
  });

  for (const method of ['getActiveTrack', 'getActiveTrackIndex', 'getPlaybackState', 'getPlayWhenReady', 'pause']) {
    test('start 等待 ' + method + ' 时新意图取消媒体及恢复', options, async () => {
      const h = fixture(); const gate = h.block(method);
      const starting = h.session.start(); await gate.entered.promise;
      h.requests.beginPlaybackRequest(); gate.wait.resolve();
      assert.equal(await starting, false); await h.session.close();
      assert.equal(h.calls.includes('play'), false); assert.equal(h.interruptions, 1);
      assert.equal(h.listeners(), 0);
    });
  }

  test('pause 后回读等待中新意图取消媒体', options, async () => {
    const h = fixture(); const pause = h.block('pause');
    const starting = h.session.start(); await pause.entered.promise;
    const gate = h.block('getPlayWhenReady'); pause.wait.resolve(); await gate.entered.promise;
    h.requests.beginPlaybackRequest(); gate.wait.resolve();
    assert.equal(await starting, false); await h.session.close();
    assert.equal(h.calls.includes('play'), false);
  });

  for (const method of ['getActiveTrack', 'getActiveTrackIndex', 'getPlaybackState', 'getPlayWhenReady', 'play']) {
    test('close 等待 ' + method + ' 时手动暂停不得被迟到恢复覆盖', options, async () => {
      const h = fixture(); await h.session.start(); const gate = h.block(method);
      const closing = h.session.close(); await gate.entered.promise;
      await h.store.pause(); gate.wait.resolve(); await closing;
      assert.equal(h.ready, false); assert.equal(h.store.isPlaying, false);
      assert.equal(h.calls.at(-1), 'sync:paused'); assert.equal(h.interruptions, 1);
    });
  }

  test('恢复后的状态回读迟到不能覆盖后续手动暂停', options, async () => {
    const h = fixture(); await h.session.start(); const play = h.block('play');
    const closing = h.session.close(); await play.entered.promise;
    const read = h.block('getPlaybackState'); play.wait.resolve(); await read.entered.promise;
    await h.store.pause(); read.wait.resolve(); await closing;
    assert.equal(h.ready, false); assert.equal(h.store.isPlaying, false);
  });

  for (const change of [h => h.changeTrack({ id: 'wy-2' }), h => h.changeTrack({ url: 'fixture:new' }), h => h.changeIndex(1), h => { h.store.currentUrl = null; }]) {
    test('歌曲或恢复凭据变化时不重建原生队列', options, async () => {
      const h = fixture(); await h.session.start(); change(h); await h.session.close();
      assert.equal(h.calls.includes('play'), false);
    });
  }

  for (const [event, data] of [['app', 'background'], ['app', 'inactive'], ['duck', { paused: true, permanent: false }], ['duck', { paused: false, permanent: true }], ['remotePause'], ['remoteStop'], ['track']]) {
    test(event + ' 中断只回调一次，回前台不恢复', options, async () => {
      const h = fixture(); await h.session.start(); h.emit(event, data); h.emit(event, data); h.emit('app', 'active');
      await h.session.close(); assert.equal(h.interruptions, 1); assert.equal(h.calls.includes('play'), false);
      assert.equal(h.listeners(), 0);
    });
  }

  test('焦点恢复不是中断，也不自动开始歌曲', options, async () => {
    const h = fixture(); await h.session.start(); h.emit('duck', { paused: false, permanent: false });
    assert.equal(h.interruptions, 0); assert.equal(h.calls.includes('play'), false); await h.session.close(false);
  });

  for (const method of ['getActiveTrack', 'getActiveTrackIndex', 'getPlaybackState', 'getPlayWhenReady', 'pause']) {
    test('start 的 ' + method + ' 失败显式拒绝', options, async () => {
      const h = fixture(); const gate = h.block(method); const error = new Error(method + ' failure');
      const starting = h.session.start(); const rejected = assert.rejects(starting, error);
      await gate.entered.promise; gate.wait.reject(error); await rejected;
      await assert.rejects(h.session.close(), error); assert.equal(h.calls.includes('play'), false); assert.equal(h.listeners(), 0);
    });
  }

  for (const method of ['getActiveTrack', 'getActiveTrackIndex', 'getPlaybackState', 'getPlayWhenReady', 'play']) {
    test('close 的 ' + method + ' 失败显式拒绝且不重复执行', options, async () => {
      const h = fixture(); await h.session.start(); const gate = h.block(method); const error = new Error(method + ' failure');
      const closing = h.session.close(); const rejected = assert.rejects(closing, error);
      await gate.entered.promise; gate.wait.reject(error); await rejected;
      await assert.rejects(h.session.close(), error); assert.equal(h.listeners(), 0);
    });
  }

  test('中断监听启动的异步清理失败有日志', options, async () => {
    const h = fixture(); const gate = h.block('pause'); const error = new Error('pause failed');
    const starting = h.session.start(); const rejected = assert.rejects(starting, error);
    await gate.entered.promise; h.emit('app', 'background'); gate.wait.reject(error); await rejected;
    await assert.rejects(h.session.close(), error);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(h.logs.some(args => args.includes(error)), true);
  });
}

for (const cancel of [h => h.emit('app', 'background'), h => h.session.close(false)]) {
  test('原地恢复已发出但确认未回时取消，不遗留后台播放', options, async () => {
    const h = fixture(); await h.session.start(); const gate = h.block('play');
    const closing = h.session.close(); await gate.entered.promise;
    cancel(h); gate.wait.resolve(); await closing;
    assert.equal(h.ready, false); assert.equal(h.store.isPlaying, false);
  });
}

test('缓冲但已无播放意图时不擅自恢复歌曲', options, async () => {
  const h = fixture({ state: 'buffering', ready: false });
  assert.equal(await h.session.start(), true); await h.session.close();
  assert.equal(h.calls.includes('play'), false);
});

test('MV 只依赖统一会话，具有前后台及音频中断边界', options, () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/MvPlayerScreen.tsx'), 'utf8');
  assert.match(source, /createMediaAudioSession/);
  assert.doesNotMatch(source, /mvAudioSession|startMvAudioSession/);
  assert.match(source, /playInBackground={false}/);
  assert.match(source, /playWhenInactive={false}/);
  assert.match(source, /onAudioBecomingNoisy=/);
  assert.match(source, /onAudioFocusChanged=/);
  const quality = source.slice(source.indexOf('const handleQuality'), source.indexOf('const enterFullscreen'));
  assert.doesNotMatch(quality, /createMediaAudioSession/);
});

function mvFixture() {
  const { mobileRequire } = require('./helpers/loadTs.cjs');
  const ts = mobileRequire('typescript');
  const slots = []; let cursor = 0; let pendingEffects = []; let tree;
  const sessions = []; const logs = []; const reads = [];
  let fetchGate = null;
  const slot = init => { const index = cursor++; return slots[index] ??= init(); };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: value => slot(() => ({ current: value })),
    useState: value => { const state = slot(() => ({ value })); return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }]; },
    useCallback: (callback, deps) => { const memo = slot(() => ({})); if (!equal(memo.deps, deps)) Object.assign(memo, { callback, deps }); return memo.callback; },
    useEffect: (effect, deps) => { const memo = slot(() => ({})); if (!equal(memo.deps, deps)) { memo.deps = deps; pendingEffects.push(() => { memo.cleanup?.(); memo.cleanup = effect(); }); } },
  };
  const native = {
    ActivityIndicator: 'ActivityIndicator', StatusBar: 'StatusBar', Text: 'Text', View: 'View',
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: value => value, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  const mocks = {
    react: { __esModule: true, default: React, ...React }, 'react-native': native,
    'react-native-video': { __esModule: true, default: 'Video' },
    'react-native-keep-awake': { __esModule: true, default: 'KeepAwake' },
    'lucide-react-native': {}, '@/components/IconButton': { IconButton: 'IconButton' },
    '@/components/ChoiceChip': { ChoiceChip: 'ChoiceChip' },
    '@/services/logger': { logger: { error: (...args) => logs.push(args) } },
    '@/services/playerService': { formatTime: String },
    '@/services/orientationService': { restoreOrientationPreference: async () => {}, setLandscapePreferred: async () => {} },
    '@/services/wyMvService': { fetchWyMvPlaybackSource: async (_, resolution) => {
      reads.push(resolution); if (fetchGate) await fetchGate.promise;
      return { url: 'fixture:mv-' + resolution, resolution };
    } },
    '@/services/mediaAudioSession': { createMediaAudioSession: onInterrupted => {
      const session = { start: async () => true, closes: [], close: async resume => { session.closes.push(resume ?? true); }, onInterrupted };
      sessions.push(session); return session;
    } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/MvPlayerScreen.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(mocks, name), 'MV test 未声明依赖: ' + name); return mocks[name];
  }, module, module.exports);
  const props = { mvId: '1', title: 'MV', artist: 'Artist', onBack() {} };
  const render = () => {
    cursor = 0; pendingEffects = []; tree = module.exports.MvPlayerScreen(props);
    for (const effect of pendingEffects) effect();
  };
  function all(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => all(child));
    if (!node || typeof node !== 'object') return [];
    return [node, ...all(node.props?.children)];
  }
  render();
  return {
    sessions, logs, reads, render,
    blockFetch() { fetchGate = deferred(); return fetchGate; },
    find: (type, label) => all().find(node => node.type === type && (label === undefined || node.props.accessibilityLabel === label)),
    async settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); render(); },
    unmount() { for (const state of slots) state.cleanup?.(); },
  };
}

test('MV 切清晰度及重播复用会话，保留退出页面才恢复歌曲的行为', options, async () => {
  const h = mvFixture(); await h.settle();
  assert.ok(h.find('Video')); assert.equal(h.sessions.length, 1);
  h.find('ChoiceChip', '720P 清晰度').props.onPress(); await h.settle();
  assert.equal(h.sessions.length, 1); assert.equal(h.find('Video').props.source.uri, 'fixture:mv-720');
  h.find('Video').props.onEnd(); await h.settle();
  assert.deepEqual(h.sessions[0].closes, []); assert.equal(h.find('Video').props.paused, true);
  h.find('IconButton', '重播').props.onPress(); await h.settle();
  assert.equal(h.sessions.length, 1); assert.equal(h.find('Video').props.paused, false);
  h.unmount(); await h.settle(); assert.deepEqual(h.sessions[0].closes, [true]);
});

test('MV 焦点丢失关闭时不恢复，迟到结束不能再次恢复', options, async () => {
  const h = mvFixture(); await h.settle(); const video = h.find('Video');
  video.props.onAudioFocusChanged({ hasAudioFocus: false }); await h.settle();
  assert.deepEqual(h.sessions[0].closes, [false]); assert.equal(h.find('Video'), undefined);
  video.props.onEnd(); await h.settle(); assert.deepEqual(h.sessions[0].closes, [false]); h.unmount();
});

test('MV 卸载关闭尚未开始的会话，不遗留原生媒体', options, async () => {
  const h = mvFixture(); h.unmount(); await h.settle();
  assert.deepEqual(h.sessions[0].closes, [true]); assert.equal(h.find('Video'), undefined);
});

test('start 调用后同步 close 仍不会读原生或暂停歌曲', options, async () => {
  const h = fixture(); const starting = h.session.start(); await h.session.close();
  assert.equal(await starting, false); assert.deepEqual(h.calls, []);
});

test('取消恢复的回读期间用户手动播放优先，不补发暂停', options, async () => {
  const h = fixture(); await h.session.start(); const play = h.block('play');
  const closing = h.session.close(); await play.entered.promise;
  const read = h.block('getActiveTrack'); h.emit('app', 'background'); play.wait.resolve(); await read.entered.promise;
  h.requests.beginPlaybackRequest(); await h.native.play(); h.store.syncPlayerState('playing');
  read.wait.resolve(); await closing;
  assert.equal(h.ready, true); assert.equal(h.store.isPlaying, true);
  assert.equal(h.calls.filter(call => call === 'store.pause').length, 1);
});

test('恢复后的状态回读失败保持显式拒绝', options, async () => {
  const h = fixture(); await h.session.start(); const play = h.block('play');
  const closing = h.session.close(); const error = new Error('resume state failed');
  const rejected = assert.rejects(closing, error);
  await play.entered.promise; const read = h.block('getPlaybackState'); play.wait.resolve();
  await read.entered.promise; read.wait.reject(error); await rejected; assert.equal(h.listeners(), 0);
});

test('暂停确认后状态回读失败不能报告媒体已启动', options, async () => {
  const h = fixture(); const pause = h.block('pause'); const starting = h.session.start();
  const error = new Error('pause state failed'); const rejected = assert.rejects(starting, error);
  await pause.entered.promise; const read = h.block('getPlayWhenReady'); pause.wait.resolve();
  await read.entered.promise; read.wait.reject(error); await rejected;
  await assert.rejects(h.session.close(), error); assert.equal(h.listeners(), 0);
});

test('MV 耳机断开不恢复，媒体失败后仍由退出页面恢复歌曲', options, async () => {
  const noisy = mvFixture(); await noisy.settle(); noisy.find('Video').props.onAudioBecomingNoisy(); await noisy.settle();
  assert.deepEqual(noisy.sessions[0].closes, [false]); noisy.unmount();
  const failed = mvFixture(); await failed.settle(); failed.find('Video').props.onError({ error: { code: 'E_MEDIA' } }); await failed.settle();
  assert.equal(failed.find('Video').props.paused, true); assert.deepEqual(failed.sessions[0].closes, []);
  assert.ok(failed.find('IconButton', '重试')); assert.ok(failed.logs.length);
  failed.find('IconButton', '重试').props.onPress(); await failed.settle();
  assert.equal(failed.sessions.length, 1); assert.equal(failed.find('Video').props.paused, false);
  failed.unmount(); await failed.settle(); assert.deepEqual(failed.sessions[0].closes, [true]);
});

test('MV 重试取链仍失败时不得重新播放旧 source', options, async () => {
  const h = mvFixture(); await h.settle();
  h.find('Video').props.onError({ error: { code: 'E_MEDIA' } }); await h.settle();
  const gate = h.blockFetch(); h.find('IconButton', '重试').props.onPress();
  gate.reject(new Error('retry failed')); await h.settle();
  assert.equal(h.find('Video').props.paused, true);
  assert.deepEqual(h.sessions[0].closes, []);
  h.unmount();
});

for (const cancel of ['stop(false)', 'interrupted(videoToken)']) {
  test(`真实控制器在恢复等待期间 ${cancel} 必须同步撤销恢复`, options, async () => {
    const h = fixture();
    const { createCommentVoiceController } = createLoader({})('src/services/commentVoiceController.ts');
    const controller = createCommentVoiceController({ createSession: () => h.session, stopMedia: async () => {}, onChange() {}, onError(error) { throw error; } });
    await controller.toggle({ id: 'voice:A', voice: { url: 'https://example.test/audio.m4a', duration: 14 } });
    const token = controller.getState().token;
    const read = h.block('getActiveTrack');
    const ending = controller.ended(token); await read.entered.promise;
    const cancelling = cancel === 'stop(false)' ? controller.stop(false) : controller.interrupted(token);
    read.wait.resolve(); await Promise.all([ending, cancelling]);
    assert.equal(h.ready, false);
    assert.equal(h.calls.filter(call => call === 'play').length, 0);
  });
}
