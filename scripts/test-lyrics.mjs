import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));
const useLyricsSource = readFileSync(resolve(__dirname, "../src/hooks/useLyrics.ts"), "utf8");

assert.match(
  useLyricsSource,
  /auralflow:lyrics:v3:/,
  "lyrics cache keys should be versioned so stale duplicate and blank-line lyric caches are ignored",
);

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
    ...(options.context ?? {}),
  }, { filename: sourcePath });
  return module.exports;
}

const toPlain = (value) => JSON.parse(JSON.stringify(value));

const lyricPayloads = {
  shifted_duplicate: {
    yrc: [
      "[10000,2600](10000,800,0)这一(10800,800,0)句(11600,600,0)会(12200,400,0)重复",
      "[16000,1800](16000,900,0)下一(16900,900,0)句",
    ].join("\n"),
    lyric: [
      "[00:10.42]这一句会重复",
      "[00:16.00]下一句",
    ].join("\n"),
  },
  harmony_line: {
    yrc: "[30000,1600](30000,800,0)主唱(30800,800,0)一句",
    lyric: [
      "[00:30.05]和声一句",
      "[00:30.44]主唱一句",
    ].join("\n"),
  },
  identical_translation: {
    lyric: "[00:05.00]同一句歌词",
    tlyric: "[00:05.00]同一句歌词",
  },
  real_translation: {
    lyric: "[00:07.00]同一句歌词",
    tlyric: "[00:07.00]Translated line",
  },
};

const parser = loadTsModule("../src/services/lyrics/parserCore.ts");
const matchScore = loadTsModule("../src/services/lyrics/matchScore.ts");

const parsedWithBlankTimedLines = parser.parseLyricSource({
  type: "lrc",
  content: [
    "[00:01.00]第一句",
    "[00:02.00]",
    "[00:03.00]第二句",
    "[00:04.00]   ",
  ].join("\n"),
});
assert.deepEqual(
  toPlain(parsedWithBlankTimedLines.map((line) => line.text)),
  ["第一句", "第二句"],
  "blank timestamp-only lyric lines should not render as invisible rows with extra spacing",
);

const { getLyrics } = loadTsModule("../src/services/lyricsService.ts", {
  requireStubs: {
    "@tauri-apps/plugin-http": {
      fetch: async () => {
        throw new Error("local lyric tests should not call network");
      },
    },
    "@/services/sources/sourceService": {
      resolver: {
        getSource: () => ({
          getLyric: async (music) => lyricPayloads[music.id],
        }),
      },
    },
    "@/services/lyrics/parserCore": parser,
    "@/services/lyrics/matchScore": matchScore,
  },
});

const shiftedResult = await getLyrics({
  id: "shifted_duplicate",
  name: "shifted duplicate",
  singer: "tester",
  albumName: "",
  source: "wy",
});

assert.equal(shiftedResult.error, undefined, "shifted duplicate fixture should parse lyrics");
assert.deepEqual(
  toPlain(shiftedResult.lines.map((line) => line.text)),
  ["这一句会重复", "下一句"],
  "same yrc/lrc text with a small timestamp drift should not render as duplicate lyric lines",
);
assert.equal(
  shiftedResult.lines[0].words?.length,
  4,
  "deduping a shifted lrc line should keep the yrc word timing",
);

const harmonyResult = await getLyrics({
  id: "harmony_line",
  name: "harmony",
  singer: "tester",
  albumName: "",
  source: "wy",
});

assert.equal(harmonyResult.error, undefined, "harmony fixture should parse lyrics");
assert.deepEqual(
  toPlain(harmonyResult.lines.map((line) => line.text)),
  ["主唱一句", "和声一句"],
  "nearby lrc lines with different text should be preserved as harmony or parallel lyric lines",
);
assert.equal(
  harmonyResult.lines.find((line) => line.text === "主唱一句")?.words?.length,
  2,
  "preserved yrc lyric lines should keep word timing after merging lrc fallback lines",
);

const identicalTranslationResult = await getLyrics({
  id: "identical_translation",
  name: "identical translation",
  singer: "tester",
  albumName: "",
  source: "wy",
});

assert.equal(
  identicalTranslationResult.lines[0]?.tr,
  undefined,
  "translation text identical to the source lyric should not be displayed as a duplicate line",
);

const realTranslationResult = await getLyrics({
  id: "real_translation",
  name: "real translation",
  singer: "tester",
  albumName: "",
  source: "wy",
});

assert.equal(
  realTranslationResult.lines[0]?.tr,
  "Translated line",
  "real translated lyrics should still be attached to the source line",
);

{
  let shouldFail = true;
  const { getLyrics: getRetryableLyrics } = loadTsModule("../src/services/lyricsService.ts", {
    requireStubs: {
      "@tauri-apps/plugin-http": {
        fetch: async () => {
          throw new Error("retry cache test should not call network");
        },
      },
      "@/services/sources/sourceService": {
        resolver: {
          getSource: () => ({
            getLyric: async () => {
              if (shouldFail) throw new Error("temporary lyric failure");
              return { lyric: "[00:09.00]第二次成功" };
            },
          }),
        },
      },
      "@/services/lyrics/parserCore": parser,
      "@/services/lyrics/matchScore": matchScore,
    },
  });

  const failedFirst = await getRetryableLyrics({
    id: "retry-after-failure",
    name: "retry after failure",
    singer: "tester",
    albumName: "",
    source: "wy",
  });
  assert.equal(failedFirst.error, "获取歌词失败", "first failed lyric request should surface an error");

  shouldFail = false;
  const retried = await getRetryableLyrics({
    id: "retry-after-failure",
    name: "retry after failure",
    singer: "tester",
    albumName: "",
    source: "wy",
  });
  assert.equal(
    retried.error,
    undefined,
    "failed lyric requests should not be cached forever when a later retry succeeds",
  );
  assert.deepEqual(
    toPlain(retried.lines.map((line) => line.text)),
    ["第二次成功"],
    "a later successful lyric retry should return fresh parsed lyrics",
  );
}

const visualizerTypesSource = readFileSync(resolve(__dirname, "../src/components/playerVisualizers/types.ts"), "utf8");
assert.match(
  visualizerTypesSource,
  /showTranslation:\s*boolean/,
  "player lyric visualizer props should carry the translation display setting",
);

const lyricsVisualizerSource = readFileSync(resolve(__dirname, "../src/components/playerVisualizers/LyricsVisualizer.tsx"), "utf8");
assert.match(
  lyricsVisualizerSource,
  /showTranslation/,
  "player lyric visualizer should read the translation display setting",
);
assert.match(
  lyricsVisualizerSource,
  /line\.tr/,
  "player lyric visualizer should render translated lyric text attached to each line",
);
assert.match(
  lyricsVisualizerSource,
  /af-lyric-translation/,
  "player lyric visualizer should render translations in a dedicated styled element",
);

const playerViewSource = readFileSync(resolve(__dirname, "../src/views/PlayerView.tsx"), "utf8");
assert.match(
  playerViewSource,
  /lyricShowTranslation/,
  "player view should load and subscribe to the shared lyric translation setting",
);
assert.match(
  playerViewSource,
  /showTranslation=\{showTranslation\}/,
  "player view should pass the translation setting to the lyric visualizer",
);
assert.match(
  playerViewSource,
  /handleTranslationToggle/,
  "player view should expose a direct lyric translation toggle",
);
assert.match(
  playerViewSource,
  /patchSettings\(\{ lyricShowTranslation: next \}\)/,
  "player lyric translation toggle should persist the setting",
);
assert.match(
  playerViewSource,
  /broadcastLyricSettings\(\{ lyricShowTranslation: next \}\)/,
  "player lyric translation toggle should sync the setting with lyric windows and settings",
);
assert.match(
  playerViewSource,
  /aria-pressed=\{showTranslation\}/,
  "player lyric translation toggle should expose its on/off state",
);
assert.match(
  playerViewSource,
  /--af-lyric-font-stack/,
  "player lyrics should define a dedicated lyric font stack",
);
assert.match(
  playerViewSource,
  /"Noto Sans CJK SC"[\s\S]*"Noto Sans JP"[\s\S]*"Source Han Sans SC"/,
  "player lyric font stack should follow Folia's multilingual sans fallback order",
);
assert.match(
  playerViewSource,
  /--af-lyric-translation-font-stack/,
  "player lyric translations should define their own readable fallback stack",
);
assert.match(
  playerViewSource,
  /system-ui[\s\S]*"Segoe UI"[\s\S]*"Noto Sans CJK SC"/,
  "player lyric translation font stack should follow Folia's system-first translation stack",
);
assert.match(
  playerViewSource,
  /font-weight:\s*600;[\s\S]*color:\s*var\(--af-accent-primary\)/,
  "current lyric typography should use Folia-like medium-bold emphasis instead of over-heavy text",
);

console.log("lyrics tests passed");
