const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, mobileRequire } = require('./helpers/loadTs.cjs');
const React = mobileRequire('react');
const { create, act } = mobileRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(t, result, error) {
  const alerts = [];
  const local = { localSongs: [], loading: false, error: null, scanProgress: null,
    scanMusic: async () => {
      if (error) throw new Error(error);
      local.localSongs = [{ id: '1', source: 'local', name: '歌曲' }];
      return result;
    },
  };
  const useLocalMusicStore = Object.assign(select => select(local), { getState: () => local });
  const mocks = {
    react: React,
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } },
    '@/theme/tokens': { layout: { pagePadding: 16 }, spacing: {} },
    '@/stores/localMusicStore': { useLocalMusicStore },
    '@/stores/historyStore': { useHistoryStore: select => select({ history: [], entries: [] }) },
    '@/stores/downloadStore': { useDownloadStore: select => select({ loading: false, error: null, loadDownloads() {} }) },
    '@/stores/themeStore': { useThemeStore: select => select({}), getResolvedTheme: () => 'dark', getThemePalette: () => ({}) },
    '@/stores/librarySectionStore': { useLibrarySectionStore: select => select({ section: 'local', requestSection() {} }) },
    '@/services/playerService': {},
    '@/components/ScreenScaffold': { ScreenScaffold: 'ScreenScaffold', ScreenScrollView: 'ScreenScrollView' },
    '@/components/ScreenState': { ErrorState: 'ErrorState', LoadingState: 'LoadingState' },
    '@/components/SongList': { SongList: ({ ListHeaderComponent, ...props }) => React.createElement('SongList', props, ListHeaderComponent) },
  };
  for (const name of ['DownloadList', 'DownloadDirectoryRow', 'HistorySection', 'ActionButton', 'SegmentedChips', 'PlaybackErrorState']) {
    mocks[`@/components/${name}`] = { [name]: name };
  }
  for (const name of ['FavoritesSection', 'PlaylistsSection']) mocks[`@/components/library/${name}`] = { [name]: name };
  const { LibraryScreen } = createLoader(mocks)('src/screens/LibraryScreen.tsx');
  let root;
  await act(async () => { root = create(React.createElement(LibraryScreen, { onNavigateToPlayer() {} })); });
  t.after(async () => { await act(async () => root.unmount()); });
  await act(async () => { await root.root.findByProps({ accessibilityLabel: '扫描本地音乐' }).props.onPress(); });
  return alerts;
}

// 标签解析失败是用户可见的部分结果，不能无提示地宣称完全成功。
test('扫描完成将逐曲警告展示给用户，较多诊断提示查看日志', async t => {
  const warnings = Array.from({ length: 7 }, (_, index) => ({ id: String(index), name: `曲目${index}`, message: '标签无法读取' }));
  const alerts = await mount(t, { total: 12, warnings });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], '扫描完成，部分标签未读取');
  assert.match(alerts[0][1], /12 首/);
  assert.match(alerts[0][1], /曲目0：标签无法读取/);
  assert.match(alerts[0][1], /另有 2 项/);
});

// 真正的查询失败仍明确报错，不显示扫描完成。
test('扫描查询失败显示失败原因', async t => {
  assert.deepEqual(await mount(t, undefined, 'MediaStore query failed'), [['扫描失败', 'MediaStore query failed']]);
});
