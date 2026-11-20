const test = require('node:test');
const assert = require('node:assert/strict');
const { React, renderer, host, createNativeRenderer } = require('./helpers/renderNative.cjs');

test('列表图片只使用原生图片缓存，加载失败才查已有离线文件', async () => {
  let downloads = 0, diskReads = 0;
  const FastImage = host('FastImage');
  FastImage.cacheControl = { immutable: 'immutable' }; FastImage.transition = { fade: 'fade' };
  const h = createNativeRenderer({
    '@d11/react-native-fast-image': FastImage,
    '@/services/cacheService': {
      cacheCover: async () => { downloads++; return 'file:///cached'; },
      getCachedCover: async () => { diskReads++; return 'file:///cached'; },
    },
    '@/services/logger': { logger: { warn() {} } },
  });
  const { CachedImage } = h.load('src/components/CachedImage.tsx');
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(CachedImage, { uri: 'https://p1.music.126.net/cover.jpg' })); });
    assert.equal(downloads, 0);
    assert.equal(diskReads, 0);
    await renderer.act(async () => tree.root.findByType('FastImage').props.onError());
    assert.equal(diskReads, 1);
    assert.equal(tree.root.findByType('FastImage').props.source.uri, 'file:///cached');
    await renderer.act(async () => tree.root.findByType('FastImage').props.onError());
    assert.equal(diskReads, 1);
    assert.equal(tree.root.findAllByType('FastImage').length, 0);
  } finally { if (tree) await renderer.act(async () => tree.unmount()); }
});
