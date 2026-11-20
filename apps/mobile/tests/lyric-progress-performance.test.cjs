const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, mobileRequire } = require('./helpers/loadTs.cjs');
const React = mobileRequire('react');
const { act, create } = mobileRequire('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

const palette = { text: '#ffffff', textMuted: '#aaaaaa', textSubtle: '#999999', primary: '#44aa88', primaryInk: '#44aa88', surfaceMuted: '#222222' };
function harness(t, name, props = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = { scroll: [], interpolations: 0, conversions: 0, listeners: 0, timing: [], values: [], seeks: [], warnings: [] };
  const settings = { fontSize: 20, showTranslation: true, activeColor: '', inactiveColor: '', lineGap: 4,
    fontFamily: '', textAlign: 'center', fontWeight: 700, textOpacity: 0.5, enableAnimation: true, animationIntensity: 'normal',
    chineseConversion: 'off', setFontSize: value => { settings.fontSize = value; } };
  const player = { position: 10, duration: 100 };
  const settingsListeners = new Set();
  const subscribeSettings = listener => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); };
  const useSettings = select => React.useSyncExternalStore(subscribeSettings, () => select(settings));
  const list = { scrollToIndex: value => calls.scroll.push(['index', value]), scrollToOffset: value => calls.scroll.push(['offset', value]) };
  class AnimatedValue {
    constructor(value) { this.value = value; calls.values.push(this); }
    addListener() { calls.listeners++; return 'listener'; }
    removeListener() { calls.listeners--; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { calls.interpolations++; return { value: this, config }; }
  }
  const FlatList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => list, []);
    return React.createElement('FlatList', props, props.data.map((item, index) =>
      React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))));
  });
  const native = {
    Animated: { Value: AnimatedValue, View: 'Animated.View', createAnimatedComponent: () => 'AnimatedView',
      timing: (value, options) => ({ start: () => { calls.timing.push(options); value.value = options.toValue; }, stop() {} }) },
    FlatList, View: 'View', Pressable: 'Pressable', Text: 'Text', Easing: { linear: value => value },
    PanResponder: { create: handlers => ({ panHandlers: handlers }) }, StyleSheet: { create: value => value },
  };
  const load = createLoader({
    react: React, 'react-native': native,
    '@/stores/lyricSettingsStore': { useLyricSettingsStore: useSettings, LYRIC_FONT_SIZE_MIN: 12, LYRIC_FONT_SIZE_MAX: 48 },
    '@/stores/themeStore': { useThemeStore: select => select({ mode: 'dark', systemTheme: 'dark' }), getResolvedTheme: () => 'dark', getThemePalette: () => palette },
    '@/stores/playerStore': { usePlayerStore: select => select(player) },
    '@/services/chineseConversionService': { convertChineseText: text => { calls.conversions++; return text; } },
    '@/services/logger': { logger: { warn: (...args) => calls.warnings.push(args) } },
  });
  const Component = load(`src/components/${name}.tsx`)[name];
  let currentProps = { palette, onSeek: time => calls.seeks.push(time), ...props };
  let renderer;
  act(() => { renderer = create(React.createElement(Component, currentProps)); });
  t.after(() => { act(() => renderer.unmount()); t.mock.timers.reset(); });
  return { calls, settings, player, renderer,
    update(patch = {}) { currentProps = { ...currentProps, ...patch }; act(() => {
      renderer.update(React.createElement(Component, currentProps));
      for (const listener of settingsListeners) listener();
    }); },
    tick(ms) { act(() => t.mock.timers.tick(ms)); },
    list() { return renderer.root.findByType('FlatList'); },
    slider() { return renderer.root.find(node => node.props.onLayout && (node.props.onPress || node.props.onResponderGrant)); },
  };
}
const lyrics = Array.from({ length: 30 }, (_, index) => ({ time: index / 2, text: `Line ${index}` }));
function lyricHarness(t, extra = {}) {
  const h = harness(t, 'LyricView', { lyrics, currentLineIndex: 0, showTranslation: true, ...extra });
  act(() => h.list().props.onScroll({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 10000 }, layoutMeasurement: { height: 400 } } }));
  h.tick(350);
  h.calls.scroll.length = 0;
  return h;
}

test('连续500ms短歌词逐行滚动，不等待最后一次换行结束', t => {
  const h = lyricHarness(t);
  for (let index = 1; index <= 10; index++) {
    h.update({ currentLineIndex: index }); h.tick(500);
    assert.ok(h.calls.scroll.length >= index, `第${index}行没有及时滚动`);
  }
});

test('高亮换行只更新两行文本且复用所有插值节点', t => {
  const h = lyricHarness(t);
  const renderItem = h.list().props.renderItem;
  h.calls.conversions = 0;
  h.calls.interpolations = 0;
  h.update({ currentLineIndex: 1 });
  assert.equal(h.calls.conversions, 2);
  assert.equal(h.calls.interpolations, 0);
  assert.equal(h.list().props.renderItem, renderItem);
  const row = h.renderer.root.findAllByType('Pressable')[2];
  act(() => row.props.onPress());
  assert.deepEqual(h.calls.seeks, [1]);
});

test('父级重新创建seek回调不重绘歌词行，点击使用最新回调', t => {
  const h = lyricHarness(t);
  h.calls.conversions = 0;
  h.update({ currentLineIndex: 1, onSeek: time => h.calls.seeks.push(['latest', time]) });
  assert.equal(h.calls.conversions, 2);
  act(() => h.renderer.root.findAllByType('Pressable')[2].props.onPress());
  assert.deepEqual(h.calls.seeks, [['latest', 1]]);
  h.update({ active: false }); h.calls.conversions = 0;
  h.update({ currentLineIndex: 4, onSeek: time => h.calls.seeks.push(['hidden', time]) });
  assert.equal(h.calls.conversions, 0);
  h.update({ active: true });
  act(() => h.renderer.root.findAllByType('Pressable')[4].props.onPress());
  assert.deepEqual(h.calls.seeks.at(-1), ['hidden', 2]);
});

test('手动浏览暂停自动跟唱，三秒恢复最新行而不是拖动前的行', t => {
  const h = lyricHarness(t);
  act(() => h.list().props.onScrollBeginDrag());
  h.update({ currentLineIndex: 4 }); h.tick(1000);
  assert.equal(h.calls.scroll.length, 0);
  act(() => h.list().props.onScrollEndDrag());
  h.update({ currentLineIndex: 8 }); h.tick(2999);
  assert.equal(h.calls.scroll.length, 0);
  h.tick(1);
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 12, animated: false, viewPosition: 0.42 }]);
});

test('隐藏歌词停止滚动和行计算，恢复时定位最新行', t => {
  const h = lyricHarness(t);
  h.update({ active: false });
  h.calls.scroll.length = 0; h.calls.conversions = 0; h.calls.interpolations = 0;
  h.update({ currentLineIndex: 8, active: false }); h.tick(1000);
  assert.equal(h.calls.scroll.length, 0);
  assert.equal(h.calls.conversions, 0);
  assert.equal(h.calls.interpolations, 0);
  h.update({ active: true });
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 12, animated: false, viewPosition: 0.42 }]);
});

test('补偿滚动在手动浏览后不抢位置，恢复使用最新行', t => {
  const h = lyricHarness(t);
  act(() => h.list().props.onScrollToIndexFailed({ index: 4, highestMeasuredFrameIndex: 0, averageItemLength: 68 }));
  act(() => h.list().props.onScrollBeginDrag());
  h.calls.scroll.length = 0;
  h.update({ currentLineIndex: 3 }); h.tick(100);
  assert.equal(h.calls.scroll.length, 0);
});

test('字号改变后重新定位当前行，手动浏览期间不抢滚动', t => {
  const h = lyricHarness(t, { currentLineIndex: 5 });
  h.settings.fontSize = 26; h.update(); h.tick(350);
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 9, animated: false, viewPosition: 0.42 }]);
  act(() => h.list().props.onScrollBeginDrag()); h.calls.scroll.length = 0;
  h.settings.fontSize = 30; h.update(); h.tick(350);
  assert.equal(h.calls.scroll.length, 0);
});

test('惯性滚动结束后才开始三秒跟唱恢复等待', t => {
  const h = lyricHarness(t);
  act(() => h.list().props.onScrollBeginDrag());
  act(() => h.list().props.onScrollEndDrag());
  assert.equal(typeof h.list().props.onMomentumScrollBegin, 'function');
  act(() => h.list().props.onMomentumScrollBegin());
  h.update({ currentLineIndex: 7 }); h.tick(3500);
  assert.equal(h.calls.scroll.length, 0);
  act(() => h.list().props.onMomentumScrollEnd()); h.tick(3000);
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 11, animated: false, viewPosition: 0.42 }]);
});

test('相同行号的新歌词仍恢复定位，补偿重试定位最新目标', t => {
  const h = lyricHarness(t, { currentLineIndex: 5 });
  h.update({ lyrics: lyrics.map(line => ({ ...line, text: 'new ' + line.text })) });
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 9, animated: false, viewPosition: 0.42 }]);
  act(() => h.list().props.onScrollToIndexFailed({ index: 9, highestMeasuredFrameIndex: 0, averageItemLength: 68 }));
  h.update({ currentLineIndex: 10 }); h.tick(100);
  assert.deepEqual(h.calls.scroll.at(-1), ['index', { index: 14, animated: false, viewPosition: 0.42 }]);
});

test('歌词动画强度变化重建插值节点，字号变化只更新排版', t => {
  const h = lyricHarness(t);
  h.calls.interpolations = 0;
  h.settings.fontSize = 26; h.update();
  assert.equal(h.calls.interpolations, 0);
  h.settings.animationIntensity = 'enhanced'; h.update();
  assert.equal(h.calls.interpolations, 30);
});

for (const name of ['ProgressBar', 'MiniProgressBar']) {
  test(`${name}原生动画无逐帧JS listener，跳变由播放tick判断`, t => {
    const h = harness(t, name, { position: 10, duration: 100 });
    assert.equal(h.calls.listeners, 0);
    h.player.position = 11; h.update({ position: 11 });
    assert.equal(h.calls.timing.at(-1).duration, 1000);
    h.player.position = 80; h.update({ position: 80 });
    assert.equal(h.calls.timing.at(-1).duration, 200);
    assert.equal(h.calls.timing.at(-1).useNativeDriver, true);
  });
}

function sliderHarness(t) {
  const h = harness(t, 'ProgressBar', { position: 10, duration: 100 });
  act(() => h.slider().props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  return h;
}
const touch = (locationX, pageX = locationX + 40) => ({ nativeEvent: { locationX, pageX } });
test('连续拖动只预览进度，松手seek一次，播放tick不覆盖手指位置', async t => {
  const h = sliderHarness(t);
  assert.equal(typeof h.slider().props.onResponderGrant, 'function');
  act(() => h.slider().props.onResponderGrant(touch(40)));
  act(() => h.slider().props.onResponderMove(touch(100)));
  assert.equal(h.calls.values[0].value, 0.5);
  h.update({ position: 20 });
  assert.equal(h.calls.values[0].value, 0.5);
  assert.deepEqual(h.calls.seeks, []);
  await act(() => h.slider().props.onResponderRelease(touch(180)));
  assert.deepEqual(h.calls.seeks, [90]);
});

test('取消拖动恢复最新播放进度，不提交seek；点按和边界拖动仍准确', async t => {
  const h = sliderHarness(t);
  assert.equal(typeof h.slider().props.onResponderGrant, 'function');
  act(() => h.slider().props.onResponderGrant(touch(40)));
  act(() => h.slider().props.onResponderMove(touch(100)));
  h.update({ position: 30 });
  act(() => h.slider().props.onResponderTerminate());
  assert.equal(h.calls.values[0].value, 0.3);
  assert.deepEqual(h.calls.seeks, []);
  act(() => h.slider().props.onResponderGrant(touch(80)));
  await act(() => h.slider().props.onResponderRelease(touch(80)));
  assert.deepEqual(h.calls.seeks, [40]);
  act(() => h.slider().props.onResponderGrant(touch(100)));
  act(() => h.slider().props.onResponderMove(touch(300)));
  assert.equal(h.calls.values[0].value, 1);
  await act(() => h.slider().props.onResponderRelease(touch(300)));
  assert.deepEqual(h.calls.seeks, [40, 100]);
});

test('拖动中时长改变取消旧手势，未测量或未知时长不接管触摸', async t => {
  const h = sliderHarness(t);
  act(() => h.slider().props.onResponderGrant(touch(100)));
  h.update({ duration: 200, position: 0 });
  await act(() => h.slider().props.onResponderRelease(touch(180)));
  assert.deepEqual(h.calls.seeks, []);
  assert.equal(h.calls.values[0].value, 0);
  h.update({ duration: 0 });
  assert.equal(h.slider().props.onStartShouldSetResponder(), false);
});

test('跳转失败恢复播放进度并报告错误，不保留成功假象', async t => {
  const h = sliderHarness(t);
  h.update({ onSeek: () => { throw new Error('seek failed'); } });
  act(() => h.slider().props.onResponderGrant(touch(100)));
  await act(async () => h.slider().props.onResponderRelease(touch(180)));
  assert.equal(h.calls.values[0].value, 0.1);
  assert.equal(h.calls.warnings.length, 1);
  assert.match(String(h.calls.warnings[0][1]), /seek failed/);
});

test('拖动中切到同样时长的另一首歌不把旧手势提交给新曲目', async t => {
  const h = sliderHarness(t);
  h.update({ trackKey: 'wy:first' });
  act(() => h.slider().props.onResponderGrant(touch(100)));
  h.update({ trackKey: 'wy:second', position: 0 });
  await act(() => h.slider().props.onResponderRelease(touch(180)));
  assert.deepEqual(h.calls.seeks, []);
  assert.equal(h.calls.values[0].value, 0);
});
