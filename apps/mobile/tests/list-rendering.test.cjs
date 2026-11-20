const test = require('node:test');
const assert = require('node:assert/strict');
const { React, renderer, host, createNativeRenderer } = require('./helpers/renderNative.cjs');
const { act } = renderer;
const noop = () => {};

test('下载进度变化不重新计算稳定的已完成行，列表按窗口渲染', async () => {
  let completedRenders = 0;
  const base = createNativeRenderer();
  const SectionList = ({ sections, renderItem }) => React.createElement('SectionList', { sections },
    sections.flatMap(section => section.data.slice(0, 2).map((item, index) =>
      React.createElement(React.Fragment, { key: `${section.kind}:${index}` }, renderItem({ item, index, section })))));
  const h = createNativeRenderer({
    'react-native': { ...base.native, SectionList },
    '@/stores/downloadStore': { useDownloadStore: selector => selector({ removeDownloadRecord: noop, removeDownload: noop, cancelDownload: noop, pauseDownload: noop, resumeDownload: noop, downloadSong: noop, removeFailedDownload: noop }) },
    '@/stores/playerStore': { usePlayerStore: { getState: () => ({ play: noop }) } },
    '@/components/IconButton': { IconButton: host('IconButton') },
    '@/components/PlaybackErrorState': { PlaybackErrorState: host('PlaybackErrorState') },
    '@/components/CachedImage': { CachedImage: host('Image') },
    '@/components/Touchable': { Touchable: host('Touchable') },
    '@/services/downloadListMetadataModel': {
      buildCompletedDownloadMetadata: () => { completedRenders++; return {}; },
      buildDownloadingMetadata: () => ({}), buildFailedDownloadMetadata: () => ({}), formatDownloadSpeed: () => '',
    },
    '@/services/playbackUiAction': {},
  });
  const { DownloadList } = h.load('src/components/DownloadList.tsx');
  const downloads = Array.from({ length: 1000 }, (_, id) => ({ song: { id: String(id), source: 'wy', name: 'Song' }, quality: '320k', localPath: '/audio' }));
  const active = { song: { id: 'active', source: 'wy', name: 'Active' }, quality: '320k', progress: 0 };
  let tree;
  try {
    await act(async () => { tree = renderer.create(React.createElement(DownloadList, { downloads, downloading: [active], onNavigateToPlayer: noop })); });
    assert.equal(completedRenders, 2);
    const initial = completedRenders;
    await act(async () => tree.update(React.createElement(DownloadList, { downloads, downloading: [{ ...active, progress: 0.05 }], onNavigateToPlayer: noop })));
    assert.equal(completedRenders, initial);
    assert.strictEqual(tree.root.findByType('SectionList').props.sections.find(section => section.kind === 'completed').data, downloads);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test('分类搜索长结果由虚拟列表持有，渲染根部不创建全部行', async () => {
  let images = 0;
  const h = createNativeRenderer({
    '@/components/ActionButton': { ActionButton: host('ActionButton') },
    '@/components/Touchable': { Touchable: host('Touchable') },
    '@/components/CachedImage': { CachedImage: () => { images++; return null; } },
  });
  const { ArtistResultList } = h.load('src/components/SearchResultSections.tsx');
  const artists = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: 'Artist', avatarUrl: 'https://example.org/cover' }));
  let tree;
  try {
    await act(async () => { tree = renderer.create(React.createElement(ArtistResultList, { artists, virtualized: true, ListHeaderComponent: React.createElement('Header') })); });
    assert.equal(images, 0);
    assert.strictEqual(tree.root.findByType('FlatList').props.data, artists);
    assert.equal(tree.root.findByType('FlatList').props.ListHeaderComponent.type, 'Header');
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test('虚拟SongList只交给FlatList窗口，不再调度分批挂载或复制全列表', async () => {
  const h = createNativeRenderer({
    './CachedImage': { CachedImage: host('Image') },
    './DownloadQualityModal': { DownloadQualityModal: host('DownloadQualityModal') },
    './AddToLocalPlaylistModal': { AddToLocalPlaylistModal: host('AddToLocalPlaylistModal') },
    './ActionMenuSheet': { ActionMenuSheet: host('ActionMenuSheet') },
    './VariantPickerSheet': { VariantPickerSheet: host('VariantPickerSheet') },
    './IconButton': { IconButton: host('IconButton') }, './Touchable': { Touchable: host('Touchable') },
    '@/stores/favoritesStore': { useFavoritesStore: selector => selector({ isFavorite: () => false }) },
    '@/stores/downloadStore': { useDownloadStore: selector => selector({ downloadSong: noop }) },
    '@/stores/playerStore': { usePlayerStore: selector => selector({ currentSong: null }) },
    '@/services/playerService': { queueSongToPlayNext: noop },
    '@/services/shareMusicService': {}, '@/services/hapticService': {},
    '@/services/downloadService': { getLastSelectQuality: async () => null },
    '@/navigation/navigationRef': {}, '@/utils/modalSequence': {},
  });
  const { SongList } = h.load('src/components/SongList.tsx');
  const songs = Array.from({ length: 1000 }, (_, id) => ({ source: 'wy', id: String(id), name: 'Song', singer: 'Artist' }));
  let slices = 0;
  songs.slice = function (...args) { slices++; return Array.prototype.slice.apply(this, args); };
  let tree;
  try {
    await act(async () => { tree = renderer.create(React.createElement(SongList, { songs, virtualized: true, onPlay: noop })); });
    assert.equal(h.interactions.length, 0);
    assert.equal(slices, 0);
    assert.strictEqual(tree.root.findByType('FlatList').props.data, songs);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
