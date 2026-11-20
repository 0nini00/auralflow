const test = require('node:test');
const assert = require('node:assert/strict');
const { React, renderer, host, createNativeRenderer } = require('./helpers/renderNative.cjs');
const { createLoader } = require('./helpers/loadTs.cjs');

test('搜索页各分类使用独立虚拟滚动宿主，无关分类回包不改变歌曲数据引用', async () => {
  const empty = () => ({ songs: [], artists: [], albums: [], playlists: [] });
  const pure = createLoader({ './musicApi': { emptySearchResults: empty } });
  const { createSearchResultCollector } = pure('src/services/searchSession.ts');
  let notify;
  const state = { source: { category: 'songs', platform: 'wy' }, status: 'ready', result: { ...empty(), songs: Array.from({ length: 1000 }, (_, id) => ({ id: String(id), name: `Song${id}`, singer: 'Artist', source: 'wy' })) }, hasMore: false };
  const artist = { source: { category: 'artists', platform: 'wy' }, status: 'ready', result: { ...empty(), artists: [{ id: 'artist', source: 'wy', name: 'Artist' }] }, hasMore: false };
  const base = createNativeRenderer();
  const results = name => ({ ListHeaderComponent, ListFooterComponent, ...props }) => React.createElement(name, props, ListHeaderComponent, ListFooterComponent);
  const mocks = {
    'react-native': { ...base.native, TextInput: host('TextInput') },
    'react-native-linear-gradient': { LinearGradient: host('Gradient') },
    '@/components/ScreenScaffold': { ScreenScaffold: host('Scaffold'), ScreenScrollView: host('ScrollView') },
    '@/components/LargeHeader': { LargeHeader: host('LargeHeader') },
    '@/components/SectionHeader': { SectionHeader: host('SectionHeader') },
    '@/components/SummaryCardGrid': { SummaryCardGrid: host('SummaryCardGrid') },
    '@/components/ui/Toast': {}, '@/components/ScreenState': { EmptyState: host('Empty'), ErrorState: host('Error'), LoadingState: host('Loading') },
    '@/components/PlaybackErrorState': { PlaybackErrorState: host('PlaybackError') },
    '@/components/SongList': { SongList: results('SongList') },
    '@/components/SearchResultSections': { ArtistResultList: results('Artists'), AlbumResultList: results('Albums'), PlaylistResultList: results('Playlists') },
    '@/services/searchSession': { createSearchResultCollector, createMobileSearchSession: (_query, onChange) => { notify = onChange; return { start: async () => onChange([state, artist]), dispose() {} }; } },
    '@/services/playerService': {}, '@/services/playbackUiAction': {},
    '@/services/searchSuggestionService': { getSearchSuggestions: async () => [] },
    '@/services/searchHistoryService': { getSearchHistory: async () => [], addSearchHistory: async () => {} },
    '@/services/logger': { logger: { error() {} } }, '@/navigation/navigationRef': {},
    '@/services/searchDetailNavigation': {}, '@/services/searchFallbackDetailModel': {},
    '@/stores/searchQueryStore': { useSearchQueryStore: select => select({ setLastKeyword: () => {} }) },
  };
  // 固定动作引用模拟实际store，避免把测试替身的不稳定回调当作页面更新。
  const setLastKeyword = () => {};
  mocks['@/stores/searchQueryStore'].useSearchQueryStore = select => select({ setLastKeyword });
  const { SearchScreen } = createNativeRenderer(mocks).load('src/screens/SearchScreen.tsx');
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(SearchScreen, { initialKeyword: 'song', onNavigateToPlayer() {} })); });
    const before = tree.root.findByType('SongList');
    assert.equal(before.props.virtualized, true);
    const songs = before.props.songs;
    assert.equal(tree.root.findAllByType('ScrollView').length, 0);
    await renderer.act(async () => notify([state, { ...artist, result: { ...artist.result, artists: [...artist.result.artists, { id: 'second', source: 'wy', name: 'Second' }] } }]));
    assert.strictEqual(tree.root.findByType('SongList').props.songs, songs);
    await renderer.act(async () => tree.root.findByType('SummaryCardGrid').props.onPress('artists'));
    assert.equal(tree.root.findAllByType('SongList').length, 0);
    assert.equal(tree.root.findAllByType('ScrollView').length, 0);
    assert.equal(tree.root.findByType('Artists').props.virtualized, true);
    assert.equal(tree.root.findByType('Artists').props.artists.length, 2);
  } finally { if (tree) await renderer.act(async () => tree.unmount()); }
});
