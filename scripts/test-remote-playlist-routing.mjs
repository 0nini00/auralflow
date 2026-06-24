import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const searchView = readFileSync(resolve(root, "src/views/SearchView.tsx"), "utf8");
const playlistDetailView = readFileSync(resolve(root, "src/views/PlaylistDetailView.tsx"), "utf8");

assert.match(
  searchView,
  /buildPlaylistDetailPath/,
  "SearchView should centralize remote playlist detail URLs",
);
assert.match(
  searchView,
  /source=\$\{playlist\.source\}/,
  "SearchView should include the playlist source in detail navigation",
);
assert.match(
  searchView,
  /state:\s*\{\s*playlist\s*\}/,
  "SearchView should pass the searched playlist metadata through router state",
);
assert.doesNotMatch(
  searchView,
  /仅网易云歌单可打开详情|仅网易云支持详情/,
  "SearchView should not block QQ playlist detail entry",
);

assert.match(
  playlistDetailView,
  /resolver\.getSource\((?:playlist|remotePlaylistInfo)\.source\)/,
  "PlaylistDetailView should load remote playlist details through the source provider",
);
assert.match(
  playlistDetailView,
  /getPlaylistDetail\(remotePlaylistInfo\)/,
  "PlaylistDetailView should call provider.getPlaylistDetail for remote playlists",
);
assert.match(
  playlistDetailView,
  /sourceParam === "wy" \|\| sourceParam === "tx"/,
  "PlaylistDetailView should accept both WY and QQ playlist source query params",
);
assert.match(
  playlistDetailView,
  /收藏到网易云账号/,
  "PlaylistDetailView should expose a NetEase collect action for remote WY playlists",
);
assert.match(
  playlistDetailView,
  /收藏到本地歌单/,
  "PlaylistDetailView should expose a local collect action for remote QQ playlists",
);
assert.match(
  playlistDetailView,
  /handleCollectRemotePlaylist/,
  "PlaylistDetailView should route remote playlist collection through a dedicated handler",
);

console.log("remote playlist routing tests passed");
