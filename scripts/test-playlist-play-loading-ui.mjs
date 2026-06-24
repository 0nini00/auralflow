import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playlistDetailView = readFileSync(resolve(root, "src/views/PlaylistDetailView.tsx"), "utf8");

assert.match(
  playlistDetailView,
  /pendingPlayAction/,
  "PlaylistDetailView should track which play action is currently pending",
);
assert.match(
  playlistDetailView,
  /runPlayQueueAction/,
  "PlaylistDetailView should route play-all and row playback through a shared guarded helper",
);
assert.match(
  playlistDetailView,
  /pendingPlayAction === 'play-all'/,
  "PlaylistDetailView should detect the play-all loading state",
);
assert.match(
  playlistDetailView,
  /pendingPlayAction === 'shuffle'/,
  "PlaylistDetailView should detect the shuffle loading state",
);
assert.match(
  playlistDetailView,
  /Loader2 size=\{16\}[\s\S]*af-spin/,
  "PlaylistDetailView should show a loading spinner inside pending playback buttons",
);
assert.match(
  playlistDetailView,
  /加载中/,
  "PlaylistDetailView should expose a loading label for pending play buttons",
);
assert.match(
  playlistDetailView,
  /disabled=\{songs\.length === 0 \|\| isPlayAllPending\}/,
  "play-all button should be disabled while its playback request is pending",
);
assert.match(
  playlistDetailView,
  /disabled=\{songs\.length === 0 \|\| isShufflePending\}/,
  "shuffle button should be disabled while its playback request is pending",
);

console.log("playlist play loading ui tests passed");
