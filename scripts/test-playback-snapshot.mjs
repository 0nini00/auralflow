import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTsModule(relativePath, options = {}) {
  const sourcePath = resolve(__dirname, relativePath);
  assert.equal(existsSync(sourcePath), true, `${relativePath} should exist`);

  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const moduleRequire = (id) => {
    if (options.requireStubs && Object.prototype.hasOwnProperty.call(options.requireStubs, id)) {
      return options.requireStubs[id];
    }
    return require(id);
  };

  vm.runInNewContext(transpiled.outputText, {
    exports: module.exports,
    module,
    require: moduleRequire,
    console,
    Date,
    ...(options.context ?? {}),
  }, { filename: sourcePath });

  return module.exports;
}

const playbackSnapshot = loadTsModule("../src/services/playback/playbackSnapshot.ts", {
  requireStubs: {
    "@/stores/playerStore": {
      usePlayerStore: {
        getState: () => {
          throw new Error("getPlaybackSnapshotFromStore should not be needed for pure builder tests");
        },
      },
    },
  },
});

assert.equal(typeof playbackSnapshot.buildPlaybackSnapshot, "function", "playback snapshot builder should be exported");
assert.equal(typeof playbackSnapshot.applyPlaybackSnapshotToStorePatch, "function", "snapshot-to-store patch adapter should be exported");

const queue = [
  { id: "prev", source: "wy", name: "Prev", singer: "Artist A", img: "prev.jpg" },
  { id: "current", source: "local", name: "Current Song", singer: "Artist B", albumName: "Album B", picUrl: "cover.jpg" },
  { id: "next", source: "kw", name: "Next", singer: "Artist C", img: "next.jpg" },
];

const snapshot = playbackSnapshot.buildPlaybackSnapshot({
  current: queue[1],
  queue,
  currentIndex: 1,
  status: "playing",
  progress: 42.5,
  duration: 180,
  volume: 0.75,
  isMuted: false,
  playbackRate: 1.25,
  repeatMode: "all",
  isShuffle: true,
  fmMode: false,
  error: null,
}, 123456);

assert.deepEqual(
  JSON.parse(JSON.stringify({
    hasTrack: snapshot.hasTrack,
    status: snapshot.status,
    isPlaying: snapshot.isPlaying,
    progress: snapshot.progress,
    duration: snapshot.duration,
    progressRatio: snapshot.progressRatio,
    volume: snapshot.volume,
    playbackRate: snapshot.playbackRate,
    repeatMode: snapshot.repeatMode,
    isShuffle: snapshot.isShuffle,
    queueIndex: snapshot.queueIndex,
    queueLength: snapshot.queueLength,
    canGoPrevious: snapshot.canGoPrevious,
    canGoNext: snapshot.canGoNext,
    updatedAt: snapshot.updatedAt,
  })),
  {
    hasTrack: true,
    status: "playing",
    isPlaying: true,
    progress: 42.5,
    duration: 180,
    progressRatio: 42.5 / 180,
    volume: 0.75,
    playbackRate: 1.25,
    repeatMode: "all",
    isShuffle: true,
    queueIndex: 1,
    queueLength: 3,
    canGoPrevious: true,
    canGoNext: true,
    updatedAt: 123456,
  },
  "snapshot should normalize the shared playback state contract",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.track)),
  {
    id: "current",
    source: "local",
    name: "Current Song",
    singer: "Artist B",
    albumName: "Album B",
    coverUrl: "cover.jpg",
  },
  "snapshot should expose normalized track metadata for external publishers",
);

const emptySnapshot = playbackSnapshot.buildPlaybackSnapshot({
  current: null,
  queue: [],
  currentIndex: -1,
  status: "idle",
  progress: Number.NaN,
  duration: Number.POSITIVE_INFINITY,
  volume: 2,
  isMuted: false,
  playbackRate: 0,
  repeatMode: "off",
  isShuffle: false,
  fmMode: false,
  error: "no track",
}, 99);

assert.equal(emptySnapshot.hasTrack, false, "empty snapshot should report no active track");
assert.equal(emptySnapshot.progress, 0, "snapshot should clamp invalid progress to zero");
assert.equal(emptySnapshot.duration, 0, "snapshot should clamp invalid duration to zero");
assert.equal(emptySnapshot.volume, 1, "snapshot should clamp volume into [0, 1]");
assert.equal(emptySnapshot.canGoNext, false, "empty snapshot should not expose next capability");

const patch = playbackSnapshot.applyPlaybackSnapshotToStorePatch(snapshot);
assert.deepEqual(
  JSON.parse(JSON.stringify({
    current: patch.current,
    status: patch.status,
    progress: patch.progress,
    duration: patch.duration,
    volume: patch.volume,
    playbackRate: patch.playbackRate,
    repeatMode: patch.repeatMode,
    isShuffle: patch.isShuffle,
  })),
  {
    current: queue[1],
    status: "playing",
    progress: 42.5,
    duration: 180,
    volume: 0.75,
    playbackRate: 1.25,
    repeatMode: "all",
    isShuffle: true,
  },
  "snapshot adapter should produce the read-only store patch used by lyric windows",
);

const playerSyncSource = readFileSync(resolve(__dirname, "../src/stores/playerSync.ts"), "utf8");
assert.match(playerSyncSource, /PlaybackSnapshot/, "playerSync state messages should carry the unified playback snapshot");
assert.match(playerSyncSource, /getPlaybackSnapshotFromStore/, "main window sync should publish snapshots from the store");
assert.match(playerSyncSource, /applyPlaybackSnapshotToStorePatch/, "lyric window sync should hydrate store fields from snapshots");
assert.doesNotMatch(
  playerSyncSource,
  /interface StateSnapshot[\s\S]*current:[\s\S]*progress:[\s\S]*duration:/,
  "playerSync should not maintain a separate hand-written state snapshot shape",
);

const nativeControlsSource = readFileSync(resolve(__dirname, "../src/hooks/useNativeControls.ts"), "utf8");
assert.match(nativeControlsSource, /getPlaybackSnapshotFromStore/, "native controls should make play-state decisions from the unified snapshot");

console.log("playback snapshot tests passed");
