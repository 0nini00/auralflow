import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const searchView = readFileSync(resolve(root, "src/views/SearchView.tsx"), "utf8");
const playlistDetailView = readFileSync(resolve(root, "src/views/PlaylistDetailView.tsx"), "utf8");

assert.match(
  searchView,
  /usePlaylistStore/,
  "SearchView should use the local playlist store for QQ playlist collection",
);
assert.match(
  searchView,
  /handleCollectPlaylist/,
  "SearchView should route playlist collection through one source-aware handler",
);
assert.match(
  searchView,
  /playlist\.source === "wy"[\s\S]*wySetSubscribed\(playlist\.id,\s*true\)/,
  "WY playlist collection should subscribe directly through the NetEase account",
);
assert.match(
  searchView,
  /playlist\.source === "tx"[\s\S]*provider\.getPlaylistDetail\(playlist\)[\s\S]*importPlaylist\(/,
  "QQ playlist collection should fetch songs and import a local playlist",
);
assert.match(
  searchView,
  /updatePlaylistCover\(created\.id,\s*playlist\.picUrl\)/,
  "Imported QQ local playlists should keep the source cover",
);
assert.match(
  searchView,
  /收藏到网易云账号/,
  "WY collection button should say it saves to the NetEase account",
);
assert.match(
  searchView,
  /收藏到本地歌单/,
  "QQ collection button should say it saves to local playlists",
);
assert.match(
  searchView,
  /getUnavailableSearchMessage/,
  "SearchView should check for source/type combinations that are not open",
);
assert.match(
  searchView,
  /QQ 音乐暂不支持歌手搜索/,
  "QQ singer searches should display a feature-not-open message",
);

assert.match(
  playlistDetailView,
  /fallbackRemoteSource/,
  "PlaylistDetailView should have a remote fallback for old search playlist URLs",
);
assert.match(
  playlistDetailView,
  /\?\s*"wy"\s*:\s*null/,
  "Numeric playlist URLs without a source should fall back to WY remote playlist detail",
);

console.log("search playlist collect tests passed");
