const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createLoader, mobileRoot } = require("./helpers/loadTs.cjs");

const readSource = (file) => fs.readFileSync(path.join(mobileRoot, "src", file), "utf8");

for (const isWyLoggedIn of [false, true]) {
  test(`登录态 ${isWyLoggedIn} 下快捷入口仅保留歌曲收藏和听歌统计`, () => {
    const { buildLibraryQuickActions } = createLoader({})("src/services/libraryQuickActions.ts");
    for (const favoritesCount of [0, 3]) {
      const actions = buildLibraryQuickActions({
        favoritesCount,
        likedCoverUri: "https://example.test/cover.jpg",
        // 兼容旧调用数据的运行时断言，登录不能重新引入已移除的入口。
        isWyLoggedIn,
      });
      assert.deepEqual(actions.map(({ action }) => action), ["openLikedPlaylist", "openListeningStats"]);
      assert.equal(actions[0].title, "我喜欢");
      assert.equal(actions[0].subtitle, favoritesCount ? "3 首歌曲" : "还没有喜欢的歌曲");
      assert.equal(actions[0].coverUri, "https://example.test/cover.jpg");
    }
  });
}

test("入口模型及调用方不再传递专用登录条件", () => {
  for (const file of ["services/libraryQuickActions.ts", "screens/MyMusicScreen.tsx"]) {
    assert.equal(/isWyLoggedIn|wyAccountActions/.test(readSource(file)), false, file);
  }
});

for (const screen of ["FollowedArtistsScreen", "SubscribedAlbumsScreen"]) {
  test(`${screen} 专属页面已删除`, () => {
    assert.equal(fs.existsSync(path.join(mobileRoot, "src/screens", `${screen}.tsx`)), false);
  });
}

test("移动端不再保留专属入口、路由、服务或歌手专辑订阅调用", () => {
  const sourceRoot = path.join(mobileRoot, "src");
  const removedFeature = /FollowedArtists|SubscribedAlbums|关注(?:的)?歌手|收藏(?:的)?专辑|\/(?:artist|album)\/(?:sub|unsub|follow|unfollow)|(?:artist|album)[._](?:sub|unsub|follow)|(?:subscribe|unsubscribe|follow|unfollow)(?:Artist|Album)/i;
  const offenders = fs.readdirSync(sourceRoot, { recursive: true })
    .filter((file) => /\.[jt]sx?$/.test(file))
    .filter((file) => removedFeature.test(readSource(file)));
  assert.deepEqual(offenders, []);
});

test("普通详情、歌曲收藏、歌单和相似歌曲的路由注册及类型仍保留", () => {
  const navigator = readSource("navigation/RootNavigator.tsx");
  const types = readSource("navigation/types.ts");
  for (const route of ["ArtistDetail", "AlbumDetail", "LikedSongs", "PlaylistDetail", "LocalPlaylistDetail", "SimilarSongs", "ListeningStats"]) {
    assert.match(navigator, new RegExp(`name="${route}"`));
    assert.match(types, new RegExp(`\\b${route}:`));
  }
  for (const screen of ["ArtistDetailScreen", "AlbumDetailScreen", "LikedSongsScreen"]) {
    assert.equal(fs.existsSync(path.join(mobileRoot, "src/screens", `${screen}.tsx`)), true);
  }
});

test("普通歌手和专辑详情保持 push 导航及父歌手参数", () => {
  const dispatched = [];
  const load = createLoader({
    "@react-navigation/native": {
      createNavigationContainerRef: () => ({
        isReady: () => true,
        getRootState: () => ({ routes: [{ name: "Main", state: { key: "main-stack" } }] }),
        dispatch: (action) => dispatched.push(action),
      }),
      StackActions: { push: (name, params) => ({ type: "PUSH", payload: { name, params } }) },
    },
    "@/stores/settingsCategoryStore": {},
  });
  const navigation = load("src/navigation/navigationRef.ts");
  assert.equal(navigation.openFollowedArtistsScreen, undefined);
  assert.equal(navigation.openSubscribedAlbumsScreen, undefined);
  const artist = { id: "artist-1", name: "歌手", source: "wy" };
  const album = { id: "album-1", name: "专辑", artistName: "歌手", source: "wy" };
  navigation.openArtistDetailScreen(artist);
  navigation.openAlbumDetailScreen(album, artist);
  assert.deepEqual(dispatched, [
    { type: "PUSH", payload: { name: "ArtistDetail", params: { artist } }, target: "main-stack" },
    { type: "PUSH", payload: { name: "AlbumDetail", params: { album, parentArtist: artist } }, target: "main-stack" },
  ]);
});

function loadAssets(cookie, postWyWeapi) {
  return createLoader({
    "./wyAccountService": { getWyCookie: async () => cookie },
    "./wyPlaylistService": { postWyWeapi },
  })("src/services/wyAssetService.ts");
}

test("资产服务不再导出歌手关注和专辑收藏 API", () => {
  const assets = loadAssets("test-cookie", () => assert.fail("加载模块不应发起网络请求"));
  assert.equal(assets.getFollowedArtists, undefined);
  assert.equal(assets.getSubscribedAlbums, undefined);
  assert.equal(typeof assets.getSimilarSongs, "function");
});

test("相似歌曲保留原请求、真实歌曲映射及无 ID 过滤", async () => {
  const requests = [];
  const assets = loadAssets("test-cookie", async (...args) => {
    requests.push(args);
    return { code: 200, songs: [{ id: 42, name: "歌曲", ar: [{ id: 7, name: "歌手" }], al: { name: "专辑" }, dt: 120000 }, {}] };
  });
  const songs = await assets.getSimilarSongs("song-1", 10, 20);
  assert.deepEqual(requests, [["/v1/discovery/simiSong", { songid: "song-1", limit: 10, offset: 20 }, "test-cookie"]]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0].id, "42");
  assert.equal(songs[0].singer, "歌手");
  assert.equal(songs[0].albumName, "专辑");
  assert.equal(songs[0].interval, 120);
});

test("相似歌曲未登录和远端失败仍明确抛错", async () => {
  const signedOut = loadAssets(null, () => assert.fail("未登录不得发起请求"));
  await assert.rejects(signedOut.getSimilarSongs("song-1"), /请先登录/);
  const rejected = loadAssets("test-cookie", async () => ({ code: 500, message: "服务错误" }));
  await assert.rejects(rejected.getSimilarSongs("song-1"), /服务错误/);
});

test("歌单订阅请求和收藏歌单分组不受歌手专辑移除影响", () => {
  const load = createLoader({});
  const { buildWyPlaylistSubscribeRequest } = load("src/services/wyPlaylistSubscribeModel.ts");
  const { buildWyPlaylistGroups } = load("src/services/libraryPlaylistGroups.ts");
  for (const subscribe of [true, false]) {
    assert.deepEqual(buildWyPlaylistSubscribeRequest("playlist-1", subscribe), {
      path: "/playlist/subscribe", payload: { id: "playlist-1", t: subscribe ? 1 : 2 }, pcCookie: true,
    });
  }
  const playlist = { id: "playlist-1", source: "wy", subscribed: true };
  const collected = buildWyPlaylistGroups([playlist], "user-1", undefined).find((group) => group.key === "collected");
  assert.deepEqual(collected.playlists, [playlist]);
  assert.equal(collected.count, 1);
});
