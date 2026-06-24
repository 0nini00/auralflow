import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const albumDetailView = readFileSync(resolve(root, "src/views/AlbumDetailView.tsx"), "utf8");
const artistDetailView = readFileSync(resolve(root, "src/views/ArtistDetailView.tsx"), "utf8");

for (const [name, source, playLabel] of [
  ["AlbumDetailView", albumDetailView, "播放全部"],
  ["ArtistDetailView", artistDetailView, "播放热门"],
]) {
  assert.match(
    source,
    /pendingPlayAction/,
    `${name} should track which play action is pending`,
  );
  assert.match(
    source,
    /runPlayQueueAction/,
    `${name} should route play actions through a guarded helper`,
  );
  assert.match(
    source,
    /pendingPlayAction === 'play-all'/,
    `${name} should expose a play-all pending state`,
  );
  assert.match(
    source,
    /pendingPlayAction === 'shuffle'/,
    `${name} should expose a shuffle pending state`,
  );
  assert.match(
    source,
    /加载中/,
    `${name} should show a loading label while a play request is pending`,
  );
  assert.match(
    source,
    /Loader2 size=\{16\}[\s\S]*af-spin/,
    `${name} should show a loading spinner inside pending play buttons`,
  );
  assert.match(
    source,
    /disabled=\{songs\.length === 0 \|\| isPlayAllPending\}/,
    `${name} should disable the primary play button while that action is pending`,
  );
  assert.match(
    source,
    /disabled=\{songs\.length === 0 \|\| isShufflePending\}/,
    `${name} should disable the shuffle button while that action is pending`,
  );
  assert.match(
    source,
    new RegExp(playLabel),
    `${name} should preserve its existing primary play label when idle`,
  );
}

console.log("detail play loading ui tests passed");
