import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const __dirname = dirname(fileURLToPath(import.meta.url));

function createDeferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createZustandStub() {
  return {
    create(initializer) {
      let state;
      const listeners = new Set();
      const setState = (partial) => {
        const patch = typeof partial === "function" ? partial(state) : partial;
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener(state));
      };
      const getState = () => state;
      state = initializer(setState, getState);

      const store = (selector) => (typeof selector === "function" ? selector(state) : state);
      store.getState = getState;
      store.setState = setState;
      store.subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      return store;
    },
  };
}

function loadPlayerStore({
  resolvePlaybackUrlImpl,
  playerEngine,
}) {
  const sourcePath = resolve(__dirname, "../src/stores/playerStore.ts");
  assert.equal(existsSync(sourcePath), true, "playerStore.ts should exist");

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
    if (id === "zustand") return createZustandStub();
    if (id === "@/services/playerEngine") return { playerEngine };
    if (id === "@/services/playback/playbackResolver") {
      return { resolvePlaybackUrl: resolvePlaybackUrlImpl };
    }
    if (id === "@/services/playback/prefetchService") {
      return { prefetchNearbyTracks: async () => {} };
    }
    if (id === "@lx/tauri-bridge") {
      return { patchSettings: async () => {}, loadSettings: async () => ({ defaultQuality: "320k" }) };
    }
    if (id === "./historyStore") {
      return { useHistoryStore: { getState: () => ({ add: () => {} }) } };
    }
    if (id === "./sleepTimerStore") {
      return { useSleepTimerStore: { getState: () => ({ mode: "off", remainingSec: 0 }), setState: () => {} } };
    }
    if (id === "./discoveryStore") {
      return { useDiscoveryStore: { getState: () => ({ fmNext: async () => null }) } };
    }
    if (id === "@/utils/logAsyncError") {
      return { logAsyncError: () => () => {} };
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
    Promise,
  }, { filename: sourcePath });

  return module.exports.usePlayerStore;
}

function createPlayerEngineStub() {
  const stateListeners = new Set();
  const endedListeners = new Set();
  const state = {
    currentMusic: null,
    currentUrl: null,
    status: "idle",
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    playbackRate: 1,
    error: null,
  };
  const playCalls = [];

  return {
    playCalls,
    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onEnded(listener) {
      endedListeners.add(listener);
      return () => endedListeners.delete(listener);
    },
    async play(music, url) {
      playCalls.push({ music, url });
      state.currentMusic = music;
      state.currentUrl = url;
      state.status = "playing";
      stateListeners.forEach((listener) => listener({ ...state }));
    },
    pause() {},
    resume() {},
    stop() {},
    pauseAtEnd() {},
    seek() {},
    setVolume() {},
    setPlaybackRate() {},
    preload() {},
  };
}

const songA = { id: "song-a", source: "wy", name: "Song A", singer: "Artist A" };
const songB = { id: "song-b", source: "wy", name: "Song B", singer: "Artist B" };

{
  const playerEngine = createPlayerEngineStub();
  const pending = [];
  const usePlayerStore = loadPlayerStore({
    playerEngine,
    resolvePlaybackUrlImpl: (music) => {
      const deferred = createDeferred();
      pending.push({ music, deferred });
      return deferred.promise;
    },
  });

  const store = usePlayerStore.getState();
  const first = store.playQueue([songA], 0);

  assert.equal(
    usePlayerStore.getState().current?.id,
    "song-a",
    "playQueue should expose the selected track immediately while the URL is still resolving",
  );
  assert.equal(usePlayerStore.getState().status, "loading", "playQueue should enter loading state immediately");

  const second = usePlayerStore.getState().playQueue([songA], 0);
  assert.equal(
    pending.length,
    1,
    "repeated clicks on the same track while loading should reuse the in-flight playback request",
  );

  pending[0].deferred.resolve({ music: songA, url: "https://example.com/a.mp3" });
  await Promise.all([first, second]);

  assert.equal(playerEngine.playCalls.length, 1, "the same loading request should only start playback once");
}

{
  const playerEngine = createPlayerEngineStub();
  const pending = [];
  const usePlayerStore = loadPlayerStore({
    playerEngine,
    resolvePlaybackUrlImpl: (music) => {
      const deferred = createDeferred();
      pending.push({ music, deferred });
      return deferred.promise;
    },
  });

  const first = usePlayerStore.getState().playQueue([songA], 0);
  const second = usePlayerStore.getState().playQueue([songB], 0);

  assert.equal(
    usePlayerStore.getState().current?.id,
    "song-b",
    "the latest click should become the visible loading target immediately",
  );

  const pendingA = pending.find((item) => item.music.id === "song-a");
  const pendingB = pending.find((item) => item.music.id === "song-b");
  assert.ok(pendingA, "song A should have an in-flight request");
  assert.ok(pendingB, "song B should have an in-flight request");

  pendingB.deferred.resolve({ music: songB, url: "https://example.com/b.mp3" });
  pendingA.deferred.resolve({ music: songA, url: "https://example.com/a.mp3" });
  await Promise.all([first, second]);

  assert.deepEqual(
    playerEngine.playCalls.map((call) => call.music.id),
    ["song-b"],
    "an older slow request should not override the latest play selection when it resolves later",
  );
}

console.log("player loading guard tests passed");
