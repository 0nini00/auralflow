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
      jsx: ts.JsxEmit.ReactJSX,
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
    setTimeout,
    clearTimeout,
    window: {
      setTimeout,
      clearTimeout,
      requestIdleCallback: (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
    },
    requestIdleCallback: (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
    ...(options.context ?? {}),
  }, { filename: sourcePath });

  return module.exports;
}

const parser = loadTsModule("../src/services/lyrics/parserCore.ts");
assert.equal(typeof parser.parseLyricSource, "function", "lyrics parser core should expose parseLyricSource");

const enhanced = parser.parseLyricSource({
  type: "enhanced-lrc",
  content: "[00:10.00]<00:10.00>逐<00:10.40>字<00:10.80>歌词",
});
assert.equal(enhanced[0]?.text, "逐字歌词", "enhanced LRC text should be parsed");
assert.deepEqual(
  JSON.parse(JSON.stringify(enhanced[0]?.words?.map((word) => word.text))),
  ["逐", "字", "歌词"],
  "enhanced LRC word timing should be preserved",
);

const vtt = parser.parseLyricSource({
  type: "vtt",
  content: "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nfirst line\n\n00:00:04.000 --> 00:00:06.000\nsecond line",
});
assert.deepEqual(
  JSON.parse(JSON.stringify(vtt.map((line) => line.text))),
  ["first line", "second line"],
  "VTT lyrics should be parsed into timeline lines",
);

const matchScore = loadTsModule("../src/services/lyrics/matchScore.ts");
assert.equal(typeof matchScore.selectBestLyricMatch, "function", "lyric match scorer should expose selectBestLyricMatch");
const best = matchScore.selectBestLyricMatch(
  { name: "夜曲", singer: "周杰伦", albumName: "十一月的萧邦", interval: "03:46" },
  [
    { id: 1, name: "晴天", artists: [{ name: "周杰伦" }], album: { name: "叶惠美" }, duration: 269000 },
    { id: 2, name: "夜曲", artists: [{ name: "周杰伦" }], album: { name: "十一月的萧邦" }, duration: 226000 },
  ],
);
assert.equal(best?.id, 2, "local lyric search should select the best scored candidate instead of the first result");

const fetchCalls = [];
const lyricsService = loadTsModule("../src/services/lyricsService.ts", {
  requireStubs: {
    "@tauri-apps/plugin-http": {
      fetch: async (url) => {
        fetchCalls.push(String(url));
        if (String(url).includes("/api/search/get/web")) {
          return {
            ok: true,
            json: async () => ({
              result: {
                songs: [
                  { id: 1, name: "晴天", artists: [{ name: "周杰伦" }], album: { name: "叶惠美" }, duration: 269000 },
                  { id: 2, name: "夜曲", artists: [{ name: "周杰伦" }], album: { name: "十一月的萧邦" }, duration: 226000 },
                ],
              },
            }),
          };
        }
        if (String(url).includes("id=2")) {
          return {
            ok: true,
            json: async () => ({ lrc: { lyric: "[00:01.00]匹配到正确歌词" } }),
          };
        }
        throw new Error(`unexpected lyrics fetch: ${url}`);
      },
    },
    "@/services/sources/sourceService": {
      resolver: { getSource: () => null },
    },
    "@/services/lyrics/parserCore": parser,
    "@/services/lyrics/matchScore": matchScore,
  },
});
const matchedLyrics = await lyricsService.getLyrics({
  id: "local-night-song",
  name: "夜曲",
  singer: "周杰伦",
  albumName: "十一月的萧邦",
  interval: "03:46",
  source: "local",
});
assert.equal(matchedLyrics.lines[0]?.text, "匹配到正确歌词", "local lyric search should fetch lyrics for the best match");
assert.equal(fetchCalls.some((url) => url.includes("id=1")), false, "local lyric search should not fetch lyrics for a worse first result");

const playerViewSource = readFileSync(resolve(__dirname, "../src/views/PlayerView.tsx"), "utf8");
assert.match(playerViewSource, /PlayerVisualizerRenderer/, "player view should render lyrics through the visualizer registry");
const registrySource = readFileSync(resolve(__dirname, "../src/components/playerVisualizers/registry.tsx"), "utf8");
assert.match(registrySource, /mode:\s*['"]lyrics['"]/, "player visualizer registry should include the default lyrics mode");

const prefetch = loadTsModule("../src/services/playback/prefetchService.ts", {
  requireStubs: {
    "@/services/lyricsService": {
      getLyrics: async () => ({ lines: [] }),
    },
    "@/services/playerEngine": {
      playerEngine: { preload: () => undefined },
    },
    "./playbackResolver": {
      resolvePlaybackUrl: async () => null,
    },
  },
});
assert.equal(typeof prefetch.prefetchNearbyTracks, "function", "playback prefetch service should expose prefetchNearbyTracks");
prefetch.clearPlaybackPrefetchCache();
const resolved = [];
const loadedLyrics = [];
const preloadedUrls = [];
const queue = [
  { id: "prev", source: "wy", name: "Prev", singer: "A", img: "prev.jpg" },
  { id: "current", source: "wy", name: "Current", singer: "B", img: "current.jpg" },
  { id: "next1", source: "wy", name: "Next 1", singer: "C", img: "next1.jpg" },
  { id: "next2", source: "wy", name: "Next 2", singer: "D", img: "next2.jpg" },
];
await prefetch.prefetchNearbyTracks({
  queue,
  currentIndex: 1,
  repeatMode: "off",
  isShuffle: false,
  fmMode: false,
  resolvePlaybackUrl: async (music) => {
    resolved.push(music.id);
    return { url: `https://audio.example/${music.id}.mp3`, quality: "320k" };
  },
  getLyrics: async (music) => {
    loadedLyrics.push(music.id);
    return { lines: [{ time: 1, text: `lyrics ${music.id}` }] };
  },
  preloadUrl: (url) => preloadedUrls.push(url),
});
assert.deepEqual(resolved, ["prev", "next1", "next2"], "prefetch should warm one previous and two next queue tracks");
assert.deepEqual(loadedLyrics, ["prev", "next1", "next2"], "prefetch should warm lyrics for nearby tracks");
assert.deepEqual(prefetch.getPrefetchedTrack(queue[2])?.lyrics?.lines?.[0]?.text, "lyrics next1");
assert.equal(prefetch.getPrefetchedTrack(queue[2])?.coverUrl, "next1.jpg");
assert.deepEqual(
  preloadedUrls,
  [
    "https://audio.example/prev.mp3",
    "https://audio.example/next1.mp3",
    "https://audio.example/next2.mp3",
  ],
);

console.log("folia borrowed feature tests passed");
