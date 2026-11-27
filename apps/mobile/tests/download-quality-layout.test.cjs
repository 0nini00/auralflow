const assert = require('node:assert/strict');
const test = require('node:test');
const { React, renderer, host, createNativeRenderer } = require('./helpers/renderNative.cjs');
const { createLoader } = require('./helpers/loadTs.cjs');

const { act } = renderer;
const { PLAYBACK_QUALITY_OPTIONS } = createLoader({})('src/services/playbackQualityModel.ts');
const { buildThemePalette } = createLoader({})('src/services/themePaletteModel.ts');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const song = { id: 'song', source: 'wy', name: '歌曲', singer: '歌手' };

async function renderModal(t, kind, { bottom = 48, busy = false } = {}) {
  const base = createNativeRenderer();
  const events = [];
  const h = createNativeRenderer({
    'react-native': { ...base.native, Modal: host('Modal'), ScrollView: host('ScrollView'), Platform: { OS: 'android' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom, left: 0, right: 0 }) },
    '@/stores/themeStore': {
      useThemeStore: select => select({ mode: 'light', systemTheme: 'light', accentColor: '#17a34a' }),
      getResolvedTheme: mode => mode,
      getThemePalette: buildThemePalette,
    },
    '@/services/downloadService': {
      getLastSelectQuality: async () => '320k',
      saveLastSelectQuality: async quality => events.push(['saved', quality]),
    },
  });
  const name = kind === 'batch' ? 'BatchDownloadModal' : 'DownloadQualityModal';
  const Component = h.load(`src/components/${name}.tsx`)[name];
  const props = {
    visible: true,
    song,
    songs: [song, { ...song, id: 'second' }],
    busy,
    pendingQuality: busy ? '320k' : null,
    onClose: () => events.push(['closed']),
    onDownload: (...args) => events.push(['download', ...args]),
  };
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(Component, props)); });
  t.after(() => act(() => tree.unmount()));
  const buttons = () => tree.root.findAllByType('Pressable');
  const select = quality => buttons().find(node => node.props.accessibilityLabel?.startsWith('下载音质，' + quality));
  return { tree, events, props, select, buttons };
}

for (const kind of ['single', 'batch']) {
  test(`${kind}下载弹层选项可以滚动，底部操作独立并避让安全区`, async t => {
    const h = await renderModal(t, kind);
    const scrolls = h.tree.root.findAllByType('ScrollView');
    assert.equal(scrolls.length, 1, '短视口必须提供真实滚动容器');
    const scroll = scrolls[0];
    const scrollStyle = flat(scroll.props.style);
    assert.equal(scrollStyle.flexShrink, 1, '滚动区应收缩给固定底部操作让位');
    assert.equal(scrollStyle.minHeight, 0);
    const options = scroll.findAll(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('下载音质，'));
    assert.equal(options.length, PLAYBACK_QUALITY_OPTIONS.length);
    assert.equal(scroll.findAll(node => node.type === 'Pressable' && /取消|确认批量/.test(node.props.accessibilityLabel ?? '')).length, 0);
    const panel = h.buttons().find(node => flat(node.props.style).maxHeight === '80%');
    assert.ok(panel);
    assert.equal(flat(panel.props.style).paddingBottom, 48);
  });

  test(`${kind}滚动改造后保留音质选择、下载回调和忙碌态`, async t => {
    const h = await renderModal(t, kind);
    await act(async () => h.select('Hi-Res').props.onPress());
    if (kind === 'batch') {
      assert.equal(h.events.length, 0, '批量下载仍须确认后才开始');
      await act(async () => h.buttons().find(node => node.props.accessibilityLabel?.startsWith('确认批量下载')).props.onPress());
      assert.deepEqual(h.events, [
        ['saved', 'flac24bit'],
        ['download', ...[h.props.songs[0], 'flac24bit']],
        ['download', ...[h.props.songs[1], 'flac24bit']],
        ['closed'],
      ]);
    } else {
      assert.deepEqual(h.events, [['download', 'flac24bit']]);
    }
    const pending = await renderModal(t, kind, { busy: true });
    assert.equal(pending.select('Hi-Res').props.disabled, true);
  });
}
