const { createLoader, mobileRequire } = require('./loadTs.cjs');

const React = mobileRequire('react');
const { act, create } = mobileRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function createImmersiveScreen(t, options = {}) {
  let backgroundMounts = 0;
  let focused = true;
  let visible = true;
  let controllerArgs;
  const backHandlers = new Set();
  const controller = {
    insets: { top: 24, bottom: 24, left: 0, right: 0 },
    currentSong: { id: 'a', source: 'wy', name: 'Song A', singer: 'Artist', mvId: 'mv-a' },
    artwork: 'cover-a', isPlaying: true, currentPage: 0, isLyricsPage: false,
    palette: { background: '#000000', primary: '#58a87a', text: '#ffffff', textMuted: '#aaaaaa' },
    chromePalette: {}, sleepTimerControl: {}, queueModel: {}, lyrics: [],
    ...options.controller,
  };
  const gesture = {};
  for (const method of ['enabled', 'maxPointers', 'activeOffsetY', 'failOffsetX', 'onUpdate', 'onEnd', 'onFinalize']) {
    gesture[method] = () => gesture;
  }
  const entering = { duration() { return this; }, delay() { return this; } };
  const mocks = {
    react: React,
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': {
      View: 'View', ScrollView: 'ScrollView', StatusBar: 'StatusBar', Pressable: 'Pressable', Text: 'Text',
      StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', inset: 0 } },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      AppState: { addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: (_event, handler) => {
        backHandlers.add(handler);
        return { remove() { backHandlers.delete(handler); } };
      } },
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
    '@/screens/immersive/useImmersiveController': { useImmersiveController: args => {
      controllerArgs = args;
      return controller;
    } },
    '@/screens/immersive/immersiveFlySource': { getImmersiveFlySource: () => null },
    '@/stores/lyricSettingsStore': {
      useLyricSettingsStore: select => select({ fontSize: 16, showLyricProgress: true }),
    },
    '@/navigation/navigationRef': options.navigation ?? {},
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
  const render = () => React.createElement(ImmersiveLyricsScreen, { visible, onClose: options.onClose ?? (() => {}) });
  await act(async () => { root = create(render()); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    root,
    background: () => root.root.findByType('Background').props,
    props: name => root.root.findByType(name).props,
    mounts: () => backgroundMounts,
    backListeners: () => backHandlers.size,
    controllerActive: () => controllerArgs.visible,
    async invoke(name, callback) { await act(async () => root.root.findByType(name).props[callback]()); },
    async focus(value) { focused = value; await act(async () => root.update(render())); },
    async setVisible(value) { visible = value; await act(async () => root.update(render())); },
    async change(patch) { Object.assign(controller, patch); await act(async () => root.update(render())); },
    async changeTheme(primary) {
      controller.palette = { ...controller.palette, primary };
      await act(async () => root.update(render()));
    },
  };
}

module.exports = { createImmersiveScreen };
