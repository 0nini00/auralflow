const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createLoader, mobileRequire, mobileRoot, deferred } = require('./helpers/loadTs.cjs');

const load = createLoader({});
const documentApi = () => load('src/services/immersiveBackgroundDocument.ts');
const CONFIG = { color: '#3080c0', accent: '#3f8f7a', playing: true, active: true, reducedMotion: false };

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, data = {}) { for (const fn of listeners.get(type) || []) fn(data); },
  };
}

function runtime(options = {}) {
  const messages = [], frames = [], shaders = [], deleted = { shaders: 0, programs: 0, buffers: 0 };
  const uniforms = new Map(), callbacks = new Map(), observers = new Set();
  let nextFrame = 0, now = 0, width = 390, height = 844, hidden = false, lost = false;
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4,
    createShader: () => ({}), shaderSource: (_shader, source) => shaders.push(source), compileShader() {},
    getShaderParameter: () => options.compile !== false, getShaderInfoLog: () => 'shader compile failed',
    deleteShader: () => deleted.shaders++, createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => options.link !== false, getProgramInfoLog: () => 'program link failed',
    deleteProgram: () => deleted.programs++, useProgram() {}, createBuffer: () => ({}),
    bindBuffer() {}, bufferData() {}, deleteBuffer: () => deleted.buffers++,
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation: (_program, name) => ({ name }),
    uniform1f: (location, value) => uniforms.set(location.name, value),
    uniform1i: (location, value) => uniforms.set(location.name, value),
    uniform3fv: (location, value) => uniforms.set(location.name, [...value]), viewport() {},
    isContextLost: () => lost,
    drawArrays() {
      frames.push({ time: uniforms.get('uTime'), color: uniforms.get('uColor'), accent: uniforms.get('uAccent') });
    },
  };
  const canvas = Object.assign(eventTarget(), {
    width: 0, height: 0,
    getContext: () => options.context === false ? null : gl,
    getBoundingClientRect: () => ({ width, height }),
  });
  const document = Object.assign(eventTarget(), { getElementById: () => canvas });
  Object.defineProperty(document, 'hidden', { get: () => hidden });
  const window = Object.assign(eventTarget(), {
    ReactNativeWebView: { postMessage: (text) => messages.push(JSON.parse(text)) },
    devicePixelRatio: 3,
  });
  const context = vm.createContext({
    window, document, console, Float32Array, performance: { now: () => now },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { assert.strictEqual(target, canvas); observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    requestAnimationFrame: fn => { callbacks.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => callbacks.delete(id),
  });
  const html = documentApi().createImmersiveBackgroundDocument();
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, '背景文档必须有实际渲染脚本');
  vm.runInContext(script, context, { timeout: 1000 });
  return {
    html, messages, frames, shaders, deleted, canvas, document, window, callbacks, observers,
    configure(patch = {}) {
      vm.runInContext(documentApi().createImmersiveBackgroundUpdate({ ...CONFIG, ...patch }), context, { timeout: 1000 });
    },
    frame(time) {
      now = time;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const fn of pending) fn(time);
    },
    resize(w, h) { width = w; height = h; window.dispatch('resize'); },
    layout(w, h) { width = w; height = h; },
    observeSize(w, h) { width = w; height = h; for (const observer of observers) observer.callback(); },
    visibility(value) { hidden = value; document.dispatch('visibilitychange'); },
    lose() { lost = true; let prevented = false; canvas.dispatch('webglcontextlost', { preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
    restore() { lost = false; canvas.dispatch('webglcontextrestored'); },
    dispose() { window.dispatch('pagehide'); },
  };
}

test('背景文档无外部资产，明确阻断网络并使用core同一份着色器', () => {
  const h = runtime();
  const core = load('../../packages/core/src/immersive-background.ts');
  assert.deepEqual(h.shaders, [core.IMMERSIVE_BACKGROUND_VERTEX_SHADER, core.IMMERSIVE_BLOOM_FRAGMENT_SHADER]);
  assert.match(h.html, /default-src 'none'/);
  assert.match(h.html, /connect-src 'none'/);
  assert.doesNotMatch(h.html, /<(?:script|img|link|iframe)[^>]+(?:src|href)=/i);
  assert.deepEqual(h.messages, [{ channel: 'auralflow-immersive-background', type: 'ready' }]);
  assert.equal(h.callbacks.size, 0, '配置尚未到达时不得启动动画');
});

test('移动文档在30帧预算下绘制，暂停和active=false均无持续RAF', () => {
  const h = runtime(); h.configure();
  assert.deepEqual(h.frames[0].color, [48 / 255, 128 / 255, 192 / 255]);
  for (let time = 0; time <= 1000; time += 10) h.frame(time);
  assert.ok(h.frames.length > 20 && h.frames.length <= 31);
  h.configure({ playing: false });
  assert.equal(h.callbacks.size, 0);
  const count = h.frames.length;
  h.frame(10000);
  assert.equal(h.frames.length, count);
  h.configure({ active: false });
  assert.equal(h.callbacks.size, 0);
  h.configure();
  assert.equal(h.callbacks.size, 1);
  h.frame(10050);
  assert.ok(h.frames.at(-1).time - h.frames.at(-2).time < 0.2, '恢复不得把后台时间计入动画');
});

test('系统减弱动态和文档隐藏停止RAF，恢复不累积循环', () => {
  const h = runtime(); h.configure({ reducedMotion: true });
  assert.equal(h.frames.length, 1);
  assert.equal(h.callbacks.size, 0);
  h.configure(); h.visibility(true);
  assert.equal(h.callbacks.size, 0);
  const count = h.frames.length;
  h.configure({ color: '#ff2222' });
  assert.equal(h.frames.length, count);
  h.visibility(false);
  assert.deepEqual(h.frames.at(-1).color, [1, 34 / 255, 34 / 255]);
  assert.equal(h.callbacks.size, 1);
  h.visibility(false);
  assert.equal(h.callbacks.size, 1);
});

test('减少动态效果时颜色尺寸重绘静帧，分辨率有上限', () => {
  const h = runtime(); h.configure({ playing: false, reducedMotion: true });
  const time = h.frames[0].time;
  h.configure({ playing: false, color: '#cc6633', reducedMotion: true });
  assert.deepEqual(h.frames.at(-1), { time, color: [0.8, 0.4, 0.2], accent: [63 / 255, 143 / 255, 122 / 255] });
  h.resize(2160, 3840);
  assert.ok(h.canvas.width * h.canvas.height <= 360 * 640);
  assert.ok(Math.abs(h.canvas.width / h.canvas.height - 2160 / 3840) < 0.01);
  assert.equal(h.callbacks.size, 0);
  const count = h.frames.length;
  h.resize(0, 0); h.configure();
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.frames.length, count);
  h.resize(390, 844);
  assert.equal(h.frames.length, count + 1);
});

test('暂停时修改主题配色保留旧帧并渐变，颜色过渡结束后停止空转', () => {
  const h = runtime(); h.configure(); h.frame(40);
  h.configure({ playing: false });
  const previous = h.frames.at(-1);
  const count = h.frames.length;
  h.configure({ playing: false, color: '#cc6633' });
  assert.equal(h.frames.length, count, '接收新颜色不能先清屏或突然跳色');
  assert.equal(h.callbacks.size, 1, '加载下一曲时仍应完成颜色过渡');
  h.frame(80);
  assert.equal(h.frames.at(-1).time, previous.time, '暂停只过渡配色，不推进柔光运动时间');
  assert.ok(h.frames.at(-1).color[0] > previous.color[0] && h.frames.at(-1).color[0] < 0.8);
  for (let time = 120; time <= 12000; time += 40) h.frame(time);
  assert.deepEqual(h.frames.at(-1).color, [0.8, 0.4, 0.2]);
  assert.equal(h.callbacks.size, 0);
});

test('播放时颜色柔和过渡，重复配置不额外绘制', () => {
  const h = runtime(); h.configure();
  const count = h.frames.length;
  h.configure();
  assert.equal(h.frames.length, count);
  h.configure({ color: '#f080c0' }); h.frame(40);
  assert.ok(h.frames.at(-1).color[0] > 48 / 255 && h.frames.at(-1).color[0] < 240 / 255);
});

for (const recovery of ['visibility', 'active', 'playing']) {
  test(`零尺寸后通过${recovery}恢复时重新测量并重绘，无需窗口resize`, () => {
    const h = runtime(); h.configure(); h.frame(40);
    if (recovery === 'visibility') h.visibility(true);
    else h.configure({ [recovery]: false });
    h.resize(0, 0);
    const count = h.frames.length;
    h.layout(390, 844);
    if (recovery === 'visibility') h.visibility(false);
    else h.configure();
    assert.ok(h.frames.length > count, '恢复可见或播放状态必须补画第一帧');
    assert.equal(h.callbacks.size, 1);
    assert.equal(h.messages.some(message => message.type === 'error'), false);
  });
}

test('容器自身恢复尺寸时重新绘制静帧，不依赖window.resize或播放事件', () => {
  const h = runtime(); h.configure({ playing: false, reducedMotion: true });
  h.observeSize(0, 0);
  const count = h.frames.length;
  h.observeSize(390, 844);
  assert.equal(h.frames.length, count + 1);
  assert.equal(h.callbacks.size, 0);
  h.dispose();
  assert.equal(h.observers.size, 0);
});

test('临时pagehide停止绘图，pageshow恢复同一文档及最新主题', () => {
  const h = runtime(); h.configure(); h.frame(40);
  const count = h.frames.length;
  h.window.dispatch('pagehide', { persisted: true });
  h.configure({ color: '#cc6633' });
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.frames.length, count);
  h.window.dispatch('pageshow', { persisted: true });
  assert.ok(h.frames.length > count);
  assert.equal(h.callbacks.size, 1);
  assert.equal(h.deleted.programs, 0, '临时隐藏不销毁可恢复的图形资源');
  h.dispose();
  assert.equal(h.deleted.programs, 1);
});

test('宿主恢复时丢弃失效RAF句柄，暂停期间也重绘静帧', () => {
  const h = runtime(); h.configure(); h.frame(40);
  h.callbacks.clear();
  const count = h.frames.length;
  h.configure({ active: false });
  h.configure({ playing: false });
  assert.ok(h.frames.length > count);
  assert.equal(h.callbacks.size, 0);
  h.configure();
  assert.equal(h.callbacks.size, 1);
  h.frame(80);
  assert.ok(h.frames.length > count + 1);
});

for (const [kind, match] of [['context', /WebGL/], ['compile', /shader compile failed/], ['link', /program link failed/]]) {
  test(`${kind}失败向宿主报告并释放已创建资源`, () => {
    const h = runtime({ [kind]: false });
    assert.equal(h.messages.at(-1).type, 'error');
    assert.match(h.messages.at(-1).message, match);
    assert.equal(h.frames.length, 0);
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.deleted.shaders, h.shaders.length);
    if (kind === 'link') assert.equal(h.deleted.programs, 1);
  });
}

test('上下文丢失后保留最新配置，恢复重绘并明确通知宿主', () => {
  const h = runtime(); h.configure(); h.lose();
  assert.equal(h.callbacks.size, 0);
  assert.match(h.messages.at(-1).message, /上下文.*丢失/);
  h.configure({ playing: false, color: '#cc6633' });
  h.restore();
  assert.equal(h.messages.at(-1).type, 'restored');
  assert.deepEqual(h.frames.at(-1).color, [0.8, 0.4, 0.2]);
  assert.equal(h.callbacks.size, 0);
});

test('页面卸载取消RAF、删除GL资源并移除监听', () => {
  const h = runtime(); h.configure();
  const count = h.frames.length;
  h.dispose(); h.dispose();
  assert.equal(h.callbacks.size, 0);
  assert.deepEqual(h.deleted, { shaders: 2, programs: 1, buffers: 1 });
  for (const target of [h.canvas, h.document, h.window]) {
    assert.ok([...target.listeners.values()].every(set => set.size === 0));
  }
  h.configure(); h.frame(1000); h.resize(400, 800);
  assert.equal(h.frames.length, count);
});

test('注入只接受明确背景配置，不将任意文本拼入脚本', () => {
  for (const patch of [{ color: '#fff' }, { color: '#fff;alert(1)' }, { accent: '#fff' },
    { playing: 1 }, { active: null }, { reducedMotion: 'false' }]) {
    assert.throws(() => documentApi().createImmersiveBackgroundUpdate({ ...CONFIG, ...patch }), /配置|颜色|模式/);
  }
});

function componentHarness(options = {}) {
  const React = mobileRequire('react');
  const { act, create } = mobileRequire('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const injected = [], failures = [], instances = [];
  const appListeners = new Set(), motionListeners = new Set();
  const motion = options.motion || Promise.resolve(false);
  let appRemoved = 0, motionRemoved = 0, renderer = null;
  const appState = {
    currentState: options.appState || 'active',
    addEventListener: (_type, fn) => {
      appListeners.add(fn);
      return { remove() { appRemoved++; appListeners.delete(fn); } };
    },
  };
  const WebView = React.forwardRef((props, ref) => {
    const instance = React.useMemo(() => {
      const value = { ref, injected: [], injectJavaScript(code) { injected.push(code); this.injected.push(code); } };
      instances.push(value);
      return value;
    }, []);
    React.useImperativeHandle(ref, () => instance, [instance]);
    return React.createElement('WebView', props);
  });
  const mocks = {
    react: React,
    'react-native': {
      View: 'View', StyleSheet: { absoluteFill: { position: 'absolute', inset: 0 }, create: value => value },
      AppState: appState,
      AccessibilityInfo: { isReduceMotionEnabled: () => motion, addEventListener: (_type, fn) => { motionListeners.add(fn); return { remove() { motionRemoved++; motionListeners.delete(fn); } }; } },
    },
    'react-native-webview': { __esModule: true, default: WebView },
    '@/services/immersiveBackgroundDocument': documentApi(),
    '@/services/logger': { logger: { error() {} } },
  };
  const filename = path.join(mobileRoot, 'src/components/ImmersiveBackground.tsx');
  const ts = mobileRequire('typescript');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }, fileName: filename }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(mocks, name), `未模拟依赖：${name}`); return mocks[name];
  }, module, module.exports);
  let props = { color: '#3080c0', accent: '#3f8f7a', playing: true, active: true, onError: value => failures.push(value) };
  const webProps = () => renderer.root.findByType('WebView').props;
  function event(callback, ...args) {
    let result;
    act(() => { result = callback(...args); });
    return result;
  }
  return {
    injected, failures, instances,
    render(patch = {}) {
      props = { ...props, ...patch };
      act(() => {
        const tree = React.createElement(module.exports.ImmersiveBackground, props);
        if (renderer) renderer.update(tree);
        else renderer = create(tree);
      });
      return Object.fromEntries(Object.entries(webProps()).map(([key, value]) =>
        [key, key.startsWith('on') && typeof value === 'function' ? (...args) => event(value, ...args) : value]));
    },
    host: () => renderer.toJSON(),
    message(type, message) {
      event(webProps().onMessage, { nativeEvent: { data: JSON.stringify({ channel: 'auralflow-immersive-background', type, ...(message ? { message } : {}) }) } });
    },
    config() {
      let config;
      vm.runInNewContext(injected.at(-1), { window: { AuralFlowImmersiveBackground: { update: value => { config = value; } } } });
      return JSON.parse(JSON.stringify(config));
    },
    appState(value) { appState.currentState = value; event(() => { for (const fn of [...appListeners]) fn(value); }); },
    reduceMotion(value) { event(() => { for (const fn of motionListeners) fn(value); }); },
    detach() { instances.at(-1).ref.current = null; },
    unmount() { if (!renderer) return; act(() => renderer.unmount()); renderer = null; },
    removed: () => [appRemoved, motionRemoved],
  };
}

test('组件HTML固定，ready前不注入，ready后使用最新配置', async () => {
  const h = componentHarness();
  try {
    const first = h.render();
    const second = h.render({ color: '#cc6633', accent: '#7a5f3f', playing: false });
    assert.strictEqual(first.source, second.source);
    assert.equal(h.injected.length, 0);
    await Promise.resolve();
    h.message('ready');
    assert.deepEqual(h.config(), { color: '#cc6633', accent: '#7a5f3f', playing: false, active: true, reducedMotion: false });
    h.render({ playing: true });
    assert.equal(h.config().playing, true);
  } finally { h.unmount(); }
});

for (const terminated of ['onRenderProcessGone', 'onContentProcessDidTerminate']) {
  test(`${terminated}在后台只标记失效，返回播放器才创建新实例并恢复最新配色`, async () => {
    const h = componentHarness();
    try {
      const oldWeb = h.render(); await Promise.resolve(); h.message('ready');
      h.appState('background');
      oldWeb[terminated]({ nativeEvent: { didCrash: false } });
      assert.match(h.failures.at(-1), /进程/);
      assert.equal(h.instances.length, 1, '后台不反复创建WebView与系统争用资源');
      const oldScripts = h.instances[0].injected.length;
      h.render({ color: '#cc6633', playing: false });
      h.appState('active');
      assert.equal(h.instances.length, 2, '进程已死必须替换原生WebView，不能只重发配置');
      assert.equal(h.instances[0].injected.length, oldScripts, '不得再向已退出的进程注入脚本');
      h.message('ready');
      assert.equal(h.config().color, '#cc6633');
      assert.equal(h.config().playing, false);
      assert.equal(h.failures.at(-1), '');
      const count = h.injected.length;
      oldWeb.onMessage({ nativeEvent: { data: JSON.stringify({ channel: 'auralflow-immersive-background', type: 'ready' }) } });
      assert.equal(h.injected.length, count, '旧实例的迟到ready不能干扰新实例');
    } finally { h.unmount(); }
  });
}

test('前台渲染进程退出立即重建；健康实例切歌及前后台切换不重建', async () => {
  const h = componentHarness();
  try {
    h.render(); await Promise.resolve(); h.message('ready');
    h.render({ playing: false }); h.render({ playing: true });
    h.appState('background'); h.appState('active');
    assert.equal(h.instances.length, 1);
    const web = h.render();
    web.onRenderProcessGone({ nativeEvent: { didCrash: true } });
    assert.equal(h.instances.length, 2);
    h.message('ready');
    assert.equal(h.failures.at(-1), '');
  } finally { h.unmount(); }
});

test('背景加载超时后有效ready清除该实例的加载错误并发送最新配置', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = componentHarness();
  try {
    const web = h.render(); web.onLoadStart();
    t.mock.timers.tick(10_000);
    assert.match(h.failures.at(-1), /加载超时/);
    h.render({ color: '#cc6633', accent: '#7a5f3f' });
    h.message('ready');
    assert.equal(h.failures.at(-1), '');
    assert.equal(h.config().accent, '#7a5f3f');
    assert.equal(h.config().color, '#cc6633');
  } finally { h.unmount(); }
});

test('加载失败后新一轮加载ready清除旧加载错误并取消超时', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = componentHarness();
  try {
    const web = h.render();
    web.onError({ nativeEvent: { description: 'WebView failed' } });
    web.onLoadStart(); h.message('ready');
    assert.equal(h.failures.at(-1), '');
    const count = h.failures.length;
    t.mock.timers.tick(10_000);
    assert.equal(h.failures.length, count);
  } finally { h.unmount(); }
});

test('迟到ready只恢复加载，不清除随后收到的图形错误', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = componentHarness();
  try {
    const web = h.render(); web.onLoadStart(); t.mock.timers.tick(10_000);
    h.message('error', 'shader failed'); h.message('ready');
    assert.equal(h.failures.at(-1), 'shader failed');
  } finally { h.unmount(); }
});

for (const recovery of ['ready', 'restored']) {
  test(`${recovery}不清除随后发生的系统偏好错误`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const gate = deferred(); const h = componentHarness({ motion: gate.promise });
    try {
      const web = h.render(); web.onLoadStart(); t.mock.timers.tick(10_000);
      if (recovery === 'restored') h.message('error', '图形上下文已丢失');
      gate.reject(new Error('preference unavailable'));
      await new Promise(setImmediate);
      h.message(recovery);
      assert.match(h.failures.at(-1), /preference unavailable/);
    } finally { h.unmount(); }
  });
}

test('AppState和减弱动态事件直接同步，迟到的初始偏好不能覆盖事件', async () => {
  const gate = deferred(); const h = componentHarness({ motion: gate.promise });
  try {
    h.render(); h.message('ready');
    assert.equal(h.config().reducedMotion, true, '系统偏好未返回前仅静帧');
    h.reduceMotion(true); gate.resolve(false); await Promise.resolve();
    assert.equal(h.config().reducedMotion, true);
    h.reduceMotion(false); assert.equal(h.config().reducedMotion, false);
    h.appState('background'); assert.equal(h.config().active, false);
    h.appState('active'); assert.equal(h.config().active, true);
    h.render({ active: false }); h.appState('active'); assert.equal(h.config().active, false);
  } finally { h.unmount(); }
  assert.deepEqual(h.removed(), [1, 1]);
});

test('WebView不接收手势和无障碍焦点，并拒绝任何非about:blank导航', () => {
  const h = componentHarness();
  try {
    const web = h.render(); const host = h.host();
    assert.equal(host.props.pointerEvents, 'none');
    assert.equal(host.props.accessibilityElementsHidden, true);
    assert.equal(host.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(web.scrollEnabled, false);
    assert.equal(web.allowFileAccess, false);
    assert.equal(web.allowFileAccessFromFileURLs, false);
    assert.equal(web.allowUniversalAccessFromFileURLs, false);
    assert.equal(web.mixedContentMode, 'never');
    assert.equal(web.sharedCookiesEnabled, false);
    assert.equal(web.thirdPartyCookiesEnabled, false);
    assert.equal(web.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
    for (const url of ['https://example.test', 'file:///secret', 'content://documents/1', 'auralflow://search/test']) {
      assert.equal(web.onShouldStartLoadWithRequest({ url }), false);
    }
  } finally { h.unmount(); }
});

test('宿主拒绝畸形桥消息并显式报告页面及渲染进程错误', () => {
  const h = componentHarness();
  try {
    const web = h.render();
    for (const data of ['bad json', '{}', JSON.stringify({ channel: 'other', type: 'ready' }),
      JSON.stringify({ channel: 'auralflow-immersive-background', type: 'error', message: 42 })]) {
      const before = h.failures.length;
      web.onMessage({ nativeEvent: { data } });
      assert.equal(h.failures.length, before + 1);
    }
    assert.equal(h.injected.length, 0);
    h.message('error', 'shader failed'); assert.match(h.failures.at(-1), /shader failed/);
    web.onError({ nativeEvent: { description: 'WebView failed' } }); assert.match(h.failures.at(-1), /WebView failed/);
    web.onHttpError({ nativeEvent: { statusCode: 403 } }); assert.match(h.failures.at(-1), /403/);
    web.onRenderProcessGone({ nativeEvent: { didCrash: true } }); assert.match(h.failures.at(-1), /进程/);
    web.onContentProcessDidTerminate(); assert.match(h.failures.at(-1), /进程/);
    h.message('restored'); assert.equal(h.failures.at(-1), '');
  } finally { h.unmount(); }
});

test('组件卸载断开监听和文档运行时，迟到偏好不再注入', async () => {
  const gate = deferred(); const h = componentHarness({ motion: gate.promise });
  h.render(); h.message('ready'); h.detach(); h.unmount();
  let disposed = false;
  vm.runInNewContext(h.injected.at(-1), { window: { AuralFlowImmersiveBackground: { dispose: () => { disposed = true; } } } });
  assert.equal(disposed, true);
  const count = h.injected.length;
  gate.resolve(false); await Promise.resolve();
  h.appState('active'); h.reduceMotion(false);
  assert.equal(h.injected.length, count);
  assert.deepEqual(h.removed(), [1, 1]);
});

test('读取系统减弱动态偏好失败会明确报告并维持静态', async () => {
  const h = componentHarness({ motion: Promise.reject(new Error('preference unavailable')) });
  try {
    h.render(); h.message('ready'); await new Promise(setImmediate);
    assert.match(h.failures.at(-1), /preference unavailable/);
    assert.equal(h.config().reducedMotion, true);
  } finally { h.unmount(); }
});

test('系统偏好恢复仅清除自身错误，不遮蔽随后发生的图形失败', async () => {
  const h = componentHarness({ motion: Promise.reject(new Error('preference unavailable')) });
  try {
    h.render(); h.message('ready'); await new Promise(setImmediate);
    h.reduceMotion(false);
    assert.equal(h.failures.at(-1), '');
  } finally { h.unmount(); }
  const broken = componentHarness({ motion: Promise.reject(new Error('preference unavailable')) });
  try {
    broken.render(); broken.message('ready'); await new Promise(setImmediate);
    broken.message('error', 'shader failed'); broken.reduceMotion(false);
    assert.equal(broken.failures.at(-1), 'shader failed');
  } finally { broken.unmount(); }
});

for (const [source, recovery] of [['load', 'ready'], ['graphics', 'restored']]) {
  test(`系统偏好恢复后重新显示尚未解决的${source}错误`, async () => {
    const gate = deferred(); const h = componentHarness({ motion: gate.promise });
    try {
      const web = h.render();
      if (source === 'load') web.onError({ nativeEvent: { description: 'WebView failed' } });
      else h.message('error', 'shader failed');
      const unresolved = h.failures.at(-1);
      gate.reject(new Error('preference unavailable'));
      await new Promise(setImmediate);
      assert.match(h.failures.at(-1), /preference unavailable/);
      h.reduceMotion(false);
      assert.equal(h.failures.at(-1), unresolved);
      h.message(recovery);
      assert.equal(h.failures.at(-1), '');
    } finally { h.unmount(); }
  });

  test(`${recovery}先恢复并清除标记后，偏好恢复不再复活旧${source}错误`, async () => {
    const gate = deferred(); const h = componentHarness({ motion: gate.promise });
    try {
      const web = h.render();
      if (source === 'load') web.onError({ nativeEvent: { description: 'WebView failed' } });
      else h.message('error', 'shader failed');
      gate.reject(new Error('preference unavailable'));
      await new Promise(setImmediate);
      h.message(recovery);
      assert.match(h.failures.at(-1), /preference unavailable/);
      h.reduceMotion(false);
      assert.equal(h.failures.at(-1), '');
    } finally { h.unmount(); }
  });
}
