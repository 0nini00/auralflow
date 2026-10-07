const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { mobileRoot, mobileRequire } = require('./helpers/loadTs.cjs');
function render(props) {
  const ts = mobileRequire('typescript');
  const filename = path.join(mobileRoot, 'src/components/CommentVoiceContent.tsx');
  const mocks = {
    react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: v => v } },
    'lucide-react-native': { Play: 'Play', Square: 'Square', AudioLines: 'AudioLines' },
    '@/theme/tokens': { spacing: { xxs: 4, xs: 8, s: 12 }, radius: { md: 12 }, touch: { minTarget: 44 }, typography: { body: 14, caption: 12 } },
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: filename }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, module, module.exports);
  return module.exports.CommentVoiceContent(props);
}
function all(node, type) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(n => all(n, type));
  return [...(node.type === type ? [node] : []), ...all(node.props?.children, type)];
}
const palette = { text: '#111111', textMuted: '#666666', surfaceMuted: '#eeeeee', primary: '#222222', danger: '#cc0000' };
const idle = { item: null, token: 0, phase: 'idle', error: null };
const voice = { url: 'https://example.test/audio.m4a', duration: 14 };
const props = { itemId: 'comment:A', data: { content: '保留附文', voice }, palette, playback: idle, onToggle() {} };

test('语音条保留附文并显示时长和可访问按钮，点击传递资源与唯一ID', () => {
  const calls = [];
  const tree = render({ ...props, onToggle: item => calls.push(item) });
  const texts = all(tree, 'Text').flatMap(n => n.props.children);
  assert.ok(texts.includes('保留附文'));
  assert.ok(texts.join('').includes('14'));
  const button = all(tree, 'Pressable')[0];
  assert.equal(button.props.accessibilityRole, 'button');
  assert.match(button.props.accessibilityLabel, /播放语音/);
  button.props.onPress();
  assert.deepEqual(calls, [{ id: 'comment:A', voice }]);
});

for (const phase of ['preparing', 'loading', 'playing', 'stopping', 'error']) {
  test(`语音条明确显示 ${phase} 状态`, () => {
    const tree = render({ ...props, playback: { item: { id: 'comment:A', voice }, token: 1, phase, error: phase === 'error' ? 'HTTP 403' : null } });
    const text = all(tree, 'Text').flatMap(n => n.props.children).join('');
    if (phase === 'preparing' || phase === 'loading' || phase === 'stopping') assert.equal(all(tree, 'ActivityIndicator').length, 1);
    if (phase === 'playing') assert.equal(all(tree, 'Square').length, 1);
    if (phase === 'error') assert.match(text, /HTTP 403/);
  });
}

test('无效语音给出错误，不造可播放按钮；普通文字评论不受影响', () => {
  const broken = render({ ...props, data: { content: '', voiceError: '语音不可用：地址缺失' } });
  assert.equal(all(broken, 'Pressable').length, 0);
  assert.match(all(broken, 'Text').flatMap(n => n.props.children).join(''), /地址缺失/);
  const plain = render({ ...props, data: { content: '普通评论' } });
  assert.equal(all(plain, 'Pressable').length, 0);
  assert.deepEqual(all(plain, 'Text')[0].props.children, ['普通评论']);
});

function sheetModule(voice) {
  const ts = mobileRequire('typescript');
  const filename = path.join(mobileRoot, 'src/screens/immersive/ImmersiveCommentsSheet.tsx');
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect() {},
  };
  const mocks = {
    react,
    'react-native': Object.assign(Object.fromEntries(['ActivityIndicator','FlatList','Image','Modal','Pressable','Text','TextInput','View'].map(k => [k,k])), { StyleSheet: { create: v => v, absoluteFill: {} }, Alert: {} }),
    'lucide-react-native': { Heart: 'Heart', MessageCircle: 'MessageCircle', Send: 'Send', X: 'X' },
    '@/services/musicApi': {}, '@/services/wyPlaylistService': {},
    '@/stores/accountStore': { useAccountStore: selector => selector({ isLoggedIn: false }) },
    '@/components/CommentVoiceContent': { CommentVoiceContent: 'CommentVoiceContent' },
    '@/hooks/useCommentVoicePlayback': { useCommentVoicePlayback: () => voice },
  };
  const source = fs.readFileSync(filename, 'utf8') + '\nexports.CommentRow = CommentRow;';
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: filename }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; },module,module.exports);
  return module.exports;
}

test('真实评论行把正文和引用语音都接入同一面板控制器', () => {
  const { CommentRow } = sheetModule({});
  const tree = CommentRow({ comment: { id: 'A', content: '附文', voice, nickname: '测试', createdAt: 0, likedCount: 0, beReplied: [{ nickname: '引用', content: '', voice }] }, palette, playback: idle, onToggle: props.onToggle });
  const content = all(tree, 'CommentVoiceContent');
  assert.equal(content.length, 2);
  assert.notEqual(content[0].props.itemId, content[1].props.itemId);
  assert.strictEqual(content[0].props.onToggle, content[1].props.onToggle);
  assert.deepEqual(content.map(c => c.props.data.voice), [voice, voice]);
});

test('真实评论弹窗先停止语音会话再关闭，原生返回键走相同路径', async () => {
  const { deferred } = require('./helpers/loadTs.cjs');
  const gate = deferred(), events = [];
  const voice = { playback: idle, player: null, controller: { stop: async resume => { events.push(['stop', resume]); await gate.promise; return true; }, toggle() {} } };
  const { ImmersiveCommentsSheet } = sheetModule(voice);
  const tree = ImmersiveCommentsSheet({ visible: true, song: { source: 'wy', id: '1' }, palette, onClose: () => events.push(['close']) });
  all(tree, 'Modal')[0].props.onRequestClose();
  assert.deepEqual(events, [['stop', true]]);
  gate.resolve(); await new Promise(setImmediate);
  assert.deepEqual(events, [['stop', true], ['close']]);
});

function hookHarness() {
  const { createLoader } = require('./helpers/loadTs.cjs');
  const { createCommentVoiceController } = createLoader({})('src/services/commentVoiceController.ts');
  const slots = [], effects = [], events = [];
  let cursor = 0;
  const react = {
    createElement: (type, props) => ({ type, props }),
    useCallback: callback => callback,
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useMemo(factory, dependencies) { const index = cursor++; if (!slots[index] || dependencies.some((v,i) => v !== slots[index].dependencies[i])) slots[index] = { value: factory(), dependencies }; return slots[index].value; },
    useEffect(effect, dependencies) { const index = cursor++; if (!slots[index] || dependencies.some((v,i) => v !== slots[index].dependencies[i])) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { cleanup: effect(), dependencies }; }); },
  };
  const mocks = {
    react, 'react-native': { StyleSheet: { create: v => v } }, 'react-native-video': { __esModule: true, default: 'Video' },
    '@/services/commentVoiceController': { createCommentVoiceController },
    '@/services/mediaAudioSession': { createMediaAudioSession: () => ({ start: async () => { events.push('pauseSong'); return true; }, close: async resume => events.push(['close', resume]) }) },
    '@/services/logger': { logger: { warn: (...args) => events.push(['warn', ...args]) } },
  };
  const ts = mobileRequire('typescript');
  const filename = path.join(mobileRoot, 'src/hooks/useCommentVoicePlayback.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: filename }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(name => { assert.ok(Object.hasOwn(mocks,name), name); return mocks[name]; }, module, module.exports);
  return { events, render(visible = true, songId = 'A') { cursor = 0; const result = module.exports.useCommentVoicePlayback(visible, songId); effects.splice(0).forEach(effect => effect()); return result; } };
}

test('真实语音 hook 只创建一个前台播放器，焦点丢失不恢复歌曲', async () => {
  const h = hookHarness();
  let ui = h.render();
  assert.equal(ui.player, null);
  await ui.controller.toggle({ id: 'comment:A', voice });
  ui = h.render();
  assert.equal(ui.player.type, 'Video');
  const video = ui.player.props;
  assert.equal(video.playInBackground, false);
  assert.equal(video.playWhenInactive, false);
  assert.equal(video.repeat, false);
  assert.equal(video.source.uri, voice.url);
  video.ref.current = { release: async () => h.events.push('stopVoice') };
  video.onAudioFocusChanged({ hasAudioFocus: false });
  await new Promise(setImmediate);
  assert.equal(h.render().player, null);
  video.ref.current = null; await new Promise(setImmediate);
  assert.deepEqual(h.events.slice(-2), ['stopVoice', ['close', false]]);
});

test('真实语音 hook 在切歌和隐藏时取消恢复，旧媒体结束事件无效', async () => {
  const h = hookHarness();
  let ui = h.render();
  await ui.controller.toggle({ id: 'comment:A', voice });
  ui = h.render();
  const oldEnd = ui.player.props.onEnd;
  const detach = ui.player.props.ref;
  detach.current = { release: async () => h.events.push('stopVoice') };
  h.render(false, 'B'); await new Promise(setImmediate);
  detach.current = null;
  oldEnd(); await new Promise(setImmediate);
  assert.equal(h.render(false, 'B').player, null);
  assert.equal(h.events.some(e => Array.isArray(e) && e[0] === 'close' && e[1] === true), false);
});

test('真实语音 hook 等待原生释放确认，而非只等待 React ref 脱离', async () => {
  const { deferred } = require('./helpers/loadTs.cjs');
  const gate = deferred();
  const h = hookHarness(); let ui = h.render();
  await ui.controller.toggle({ id: 'comment:A', voice }); ui = h.render();
  const ref = ui.player.props.ref;
  const instance = { pause() {}, release: () => { h.events.push('releaseVoice'); return gate.promise; } };
  if (typeof ref === 'function') ref(instance); else ref.current = instance;
  const ending = ui.controller.ended(ui.playback.token);
  await new Promise(setImmediate);
  assert.ok(h.events.includes('releaseVoice'));
  assert.equal(h.events.some(e => Array.isArray(e) && e[0] === 'close'), false);
  assert.equal(h.render().player.props.paused, true);
  gate.resolve(); await ending;
  assert.equal(h.render().player, null);
  assert.deepEqual(h.events.slice(-2), ['releaseVoice', ['close', true]]);
});
