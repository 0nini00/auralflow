const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, mobileRequire } = require('./helpers/loadTs.cjs');

const React = mobileRequire('react');
const { act, create } = mobileRequire('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const songs = [
  { id: '1', source: 'wy', name: '推荐一', singer: '歌手一' },
  { id: '2', source: 'wy', name: '推荐二', singer: '歌手二' },
];

async function renderScreen(t, { getSimilarSongs, playQueue = async () => {} }) {
  let returns = 0;
  const mocks = {
    react: React,
    'react-native': { FlatList: 'FlatList', View: 'View', Text: 'Text', StyleSheet: { create: value => value } },
    'lucide-react-native': { ChevronLeft: 'ChevronLeft', Sparkles: 'Sparkles' },
    '@/stores/themeStore': {
      useThemeStore: select => select({ mode: 'dark', systemTheme: 'dark', accentColor: '#58a87a' }),
      getResolvedTheme: () => 'dark', getThemePalette: () => ({}),
    },
    '@/stores/playerStore': { usePlayerStore: select => select({ currentSong: songs[0] }) },
    '@/services/wyAssetService': { getSimilarSongs },
    '@/services/playerService': { playQueue },
    '@/components/ScreenState': { LoadingState: 'LoadingState', ErrorState: 'ErrorState', EmptyState: 'EmptyState' },
    '@/components/SongList': { SongList: props => React.createElement('SongList', props, props.ListHeaderComponent) },
  };
  for (const name of ['IconButton', 'PlaybackActionButtons', 'PlaybackErrorState', 'ScreenScaffold']) {
    mocks[`@/components/${name}`] = { [name]: name };
  }
  const { SimilarSongsScreen } = createLoader(mocks)('src/screens/SimilarSongsScreen.tsx');
  let root;
  await act(async () => {
    root = create(React.createElement(SimilarSongsScreen, {
      songId: 'seed', songName: '原歌曲', onBack: () => returns++,
    }));
  });
  t.after(async () => { await act(async () => root.unmount()); });
  return { root, props: name => root.root.findByType(name).props, returns: () => returns };
}

test('相似歌曲加载并按选中位置播放，返回入口保留', async t => {
  const requests = [];
  const plays = [];
  const h = await renderScreen(t, {
    getSimilarSongs: async id => { requests.push(id); return songs; },
    playQueue: async (queue, index) => { plays.push({ queue, index }); },
  });
  assert.deepEqual(requests, ['seed']);
  assert.deepEqual(h.props('SongList').songs, songs);
  assert.equal(h.props('SongList').highlightedIndex, 0);
  await act(async () => h.props('SongList').onPlay(songs[1], 1));
  assert.deepEqual(plays, [{ queue: songs, index: 1 }]);
  await act(async () => h.props('IconButton').onPress());
  assert.equal(h.returns(), 1);
});

test('相似歌曲未登录或网络失败显示原因，可重试和返回', async t => {
  let attempts = 0;
  const h = await renderScreen(t, { getSimilarSongs: async () => {
    if (++attempts === 1) throw new Error('请先登录网易云音乐账号');
    return songs;
  } });
  assert.equal(h.props('ErrorState').message, '请先登录网易云音乐账号');
  await act(async () => h.props('ErrorState').onRetry());
  assert.deepEqual(h.props('SongList').songs, songs);
  assert.equal(attempts, 2);
  await act(async () => h.props('IconButton').onPress());
  assert.equal(h.returns(), 1);
});

test('推荐为空仍可返回，播放失败在列表显示且可关闭', async t => {
  const empty = await renderScreen(t, { getSimilarSongs: async () => [] });
  assert.equal(empty.props('EmptyState').title, '暂无相似歌曲');
  await act(async () => empty.props('IconButton').onPress());
  assert.equal(empty.returns(), 1);

  const h = await renderScreen(t, {
    getSimilarSongs: async () => songs,
    playQueue: async () => { throw new Error('播放地址不可用'); },
  });
  await act(async () => h.props('SongList').onPlay(songs[0], 0));
  assert.equal(h.props('PlaybackErrorState').message, '播放地址不可用');
  await act(async () => h.props('PlaybackErrorState').onDismiss());
  assert.equal(h.props('PlaybackErrorState').message, null);
});
