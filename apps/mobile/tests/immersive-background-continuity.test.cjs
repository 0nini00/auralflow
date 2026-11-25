const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, mobileRequire, deferred } = require('./helpers/loadTs.cjs');

const React = mobileRequire('react');
const { act, create } = mobileRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function screen(t) {
  const requests = new Map();
  let backgroundMounts = 0;
  const controller = {
    insets: { top: 24, bottom: 24, left: 0, right: 0 },
    currentSong: { id: 'a', source: 'wy', name: 'Song A', singer: 'Artist' },
    artwork: 'cover-a', isPlaying: true, currentPage: 0, isLyricsPage: false,
    palette: { background: '#000000', primary: '#58a87a', text: '#ffffff', textMuted: '#aaaaaa' },
    chromePalette: {}, sleepTimerControl: {}, queueModel: {}, lyrics: [],
  };
  const gesture = {};
  for (const method of ['enabled', 'maxPointers', 'activeOffsetY', 'failOffsetX', 'onUpdate', 'onEnd', 'onFinalize']) {
    gesture[method] = () => gesture;
  }
  const entering = { duration() { return this; }, delay() { return this; } };
  const mocks = {
    react: React,
    'react-native': {
      View: 'View', ScrollView: 'ScrollView', StatusBar: 'StatusBar', Pressable: 'Pressable', Text: 'Text',
      StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', inset: 0 } },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      AppState: { addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
    },
    'react-native-gesture-handler': {
      Gesture: { Pan: () => gesture }, GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureHandlerRootView',
    },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'Animated.View' }, FadeIn: entering, FadeInDown: entering,
      useSharedValue: value => React.useRef({ value }).current,
      useAnimatedStyle: build => build(), cancelAnimation() {}, withTiming: value => value,
      Easing: { out: value => value, in: value => value },
    },
    'react-native-pager-view': { __esModule: true, default: 'PagerView' },
    'react-native-linear-gradient': { __esModule: true, default: 'LinearGradient' },
    'react-native-keep-awake': { __esModule: true, default: 'KeepAwake' },
    '@/screens/immersive/useImmersiveController': { useImmersiveController: () => controller },
    '@/screens/immersive/immersiveFlySource': { getImmersiveFlySource: () => null },
    '@/stores/lyricSettingsStore': {
      useLyricSettingsStore: select => select({ immersiveBackground: 'bloom', fontSize: 16, showLyricProgress: true }),
    },
    '@/services/coverColorService': { fetchCoverColors: url => {
      const request = deferred(); requests.set(url, request); return request.promise;
    } },
    '@/navigation/navigationRef': {},
  };
  for (const name of ['LyricView', 'SheetFrame', 'Touchable', 'CachedImage', 'MiniLyric', 'DownloadQualityModal']) {
    mocks[`@/components/${name}`] = { [name]: name };
  }
  for (const name of ['ImmersiveTopBar', 'ImmersiveTransport', 'ImmersiveMoreMenu', 'ImmersiveCommentsSheet',
    'ImmersiveModals', 'ImmersivePlaySettingSheet', 'ImmersiveCoverPage']) {
    mocks[`@/screens/immersive/${name}`] = { [name]: name };
  }
  mocks['@/components/ImmersiveBackground'] = { ImmersiveBackground: props => {
    React.useEffect(() => { backgroundMounts++; }, []);
    return React.createElement('Background', props);
  } };
  const { ImmersiveLyricsScreen } = createLoader(mocks)('src/screens/ImmersiveLyricsScreen.tsx');
  let root;
  const render = () => React.createElement(ImmersiveLyricsScreen, { visible: true, onClose() {} });
  await act(async () => { root = create(render()); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    color: () => root.root.findByType('Background').props.color,
    mounts: () => backgroundMounts,
    async change(patch) { Object.assign(controller, patch); await act(async () => root.update(render())); },
    async resolve(url, colors) { await act(async () => requests.get(url).resolve(colors)); },
  };
}

test('切歌封面暂缺与取色等待期间保留上一帧配色，不卸载背景', async t => {
  const h = await screen(t);
  await h.resolve('cover-a', { base: '#334455', accent: '#4488cc' });
  assert.equal(h.color(), '#4488cc');
  await h.change({ currentSong: { id: 'b', name: 'Song B', source: 'wy' }, artwork: undefined, isPlaying: false });
  assert.equal(h.color(), '#4488cc', '封面尚未到达，不能清空已经绘制的颜色');
  await h.change({ artwork: 'cover-b' });
  assert.equal(h.color(), '#4488cc');
  await h.resolve('cover-b', { base: '#663322', accent: '#cc8844' });
  assert.equal(h.color(), '#cc8844');
  assert.equal(h.mounts(), 1);
});

test('新封面暂无可用颜色或快速连切时，旧异步结果不能清空或覆盖最新背景', async t => {
  const h = await screen(t);
  await h.resolve('cover-a', { base: '#334455', accent: '#4488cc' });
  await h.change({ artwork: 'cover-empty' });
  await h.resolve('cover-empty', { base: '', accent: '' });
  assert.equal(h.color(), '#4488cc');
  await h.change({ artwork: 'cover-b' });
  await h.change({ artwork: 'cover-c' });
  await h.resolve('cover-c', { base: '#663322', accent: '#cc8844' });
  await h.resolve('cover-b', { base: '#112233', accent: '#224466' });
  assert.equal(h.color(), '#cc8844');
  assert.equal(h.mounts(), 1);
});
