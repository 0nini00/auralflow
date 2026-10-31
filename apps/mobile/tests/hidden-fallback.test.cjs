const assert = require("node:assert/strict");
const test = require("node:test");
const { createLoader } = require("./helpers/loadTs.cjs");

// 纯逻辑直接用 core 源码，避免在测试里复制一份匹配规则。
const pure = createLoader({});
const core = {
  ...pure("../../packages/core/src/song-variant.ts"),
  ...pure("../../packages/core/src/hidden-source.ts"),
};

const song = { id: "2034742057", source: "wy", name: "江南", singer: "林俊杰", interval: 267 };

function kwSource(qualitys = ["320k"]) {
  return {
    id: "kw-script",
    name: "酷我源",
    enabled: true,
    sources: { kw: { actions: ["musicUrl"], qualitys } },
  };
}

function kwTrack(id, singer, interval) {
  return { source: "kw", id, name: "江南", singer, interval };
}

function setup(options = {}) {
  const state = { sources: options.sources ?? [kwSource()] };
  const calls = { search: [], request: [], probe: [] };
  const load = createLoader({
    "@lx/core": core,
    "@/services/playbackQualityModel": {
      // 测试里没有真实别名表，两个归一化都保持「原样透传」语义：
      // 脚本回传什么档位就是什么档位，便于断言链路没有改写它。
      normalizePlaybackQuality: (value) => value,
      normalizeSourceQualityLabel: (label) => label,
    },
    "./hiddenSourceSearchers": {
      hiddenSourceSearchers: [
        {
          id: "kw",
          search: async (keyword) => {
            calls.search.push(keyword);
            return options.tracks ?? [];
          },
        },
      ],
    },
    "@/services/customSourceRuntime": {
      requestCustomSourceMusicUrl: async (...args) => {
        calls.request.push(args);
        if (options.request) return options.request(...args);
        return { url: "https://kw.example/a.mp3", quality: "320k" };
      },
    },
    "./streamProbe": {
      probeStreamUrl: async (url, headers, timeoutMs) => {
        calls.probe.push({ url, headers, timeoutMs });
        if (options.probe) return options.probe(url);
        return { ok: true };
      },
    },
    "@/stores/customSourceStore": { useCustomSourceStore: { getState: () => state } },
    "@/services/logger": { logger: { debug() {}, info() {}, warn() {}, error() {} } },
  });
  return { service: load("src/services/hiddenFallbackService.ts"), calls, state };
}

test("没有脚本声明对应平台时不发起搜索", async () => {
  const { service, calls } = setup({ sources: [] });

  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  assert.deepEqual(groups, []);
  assert.deepEqual(calls.search, []);
  assert.deepEqual(calls.request, []);
});

test("按歌名 / 歌手 / 时长严格匹配，搜索阶段不触碰脚本", async () => {
  const { service, calls } = setup({
    tracks: [kwTrack("93157", "林俊杰", 267), kwTrack("2", "其他歌手", 267), kwTrack("3", "林俊杰", 300)],
  });

  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].platform, "kw");
  assert.deepEqual(groups[0].tracks.map((track) => track.id), ["93157"]);
  assert.deepEqual(calls.request, []);
});

test("预算不足时返回空结果且不发起搜索", async () => {
  const { service, calls } = setup({ tracks: [kwTrack("93157", "林俊杰", 267)] });

  const groups = await service.startHiddenSearch(song, Date.now() - 5_000);

  assert.deepEqual(groups, []);
  assert.deepEqual(calls.search, []);
});

test("取链成功时回传平台元数据并保留原曲", async () => {
  const { service, calls } = setup({ tracks: [kwTrack("93157", "林俊杰", 267)] });
  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  const resolved = await service.resolveHiddenFromGroups(
    groups,
    song,
    ["320k"],
    Date.now() + 5_000,
  );

  assert.deepEqual(resolved, {
    url: "https://kw.example/a.mp3",
    quality: "320k",
    resolverName: "kw/酷我源",
  });
  assert.equal(calls.request.length, 1);
  const [api, music, quality, alert, platform] = calls.request[0];
  assert.equal(api.id, "kw-script");
  assert.equal(music, song);
  assert.equal(quality, "320k");
  assert.equal(alert, undefined);
  assert.deepEqual(platform, {
    source: "kw",
    songmid: "93157",
    interval: 267,
    albumName: undefined,
    picUrl: undefined,
    extra: undefined,
  });
});

test("脚本全部失败时返回 null", async () => {
  const { service } = setup({
    tracks: [kwTrack("93157", "林俊杰", 267)],
    request: async () => {
      throw new Error("脚本不支持 kw");
    },
  });
  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  const resolved = await service.resolveHiddenFromGroups(
    groups,
    song,
    ["320k"],
    Date.now() + 5_000,
  );

  assert.equal(resolved, null);
});

test("预算耗尽时不再调脚本", async () => {
  const { service, calls } = setup({ tracks: [kwTrack("93157", "林俊杰", 267)] });
  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  const resolved = await service.resolveHiddenFromGroups(
    groups,
    song,
    ["320k"],
    Date.now() - 5_000,
  );

  assert.equal(resolved, null);
  assert.deepEqual(calls.request, []);
});

test("一次性入口 resolveHiddenFallback 串起搜索与取链", async () => {
  const { service, calls } = setup({ tracks: [kwTrack("93157", "林俊杰", 267)] });

  const resolved = await service.resolveHiddenFallback(song, ["320k"], Date.now() + 5_000);

  assert.equal(resolved.url, "https://kw.example/a.mp3");
  assert.equal(calls.search.length, 1);
  assert.equal(calls.request.length, 1);
  assert.equal(calls.probe.length, 1);
});

test("候选地址被判死链时换下一个候选", async () => {
  const { service, calls } = setup({
    tracks: [kwTrack("93157", "林俊杰", 267), kwTrack("93158", "林俊杰", 267)],
    request: async (...args) => {
      const songmid = args[4].songmid;
      return { url: `https://kw.example/${songmid}.mp3`, quality: "320k" };
    },
    probe: async (url) =>
      url.includes("93157")
        ? { ok: false, definitive: true, reason: "HTTP 403" }
        : { ok: true },
  });
  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  const resolved = await service.resolveHiddenFromGroups(
    groups,
    song,
    ["320k"],
    Date.now() + 5_000,
  );

  assert.equal(resolved.url, "https://kw.example/93158.mp3");
  assert.equal(calls.request.length, 2);
  assert.equal(calls.probe.length, 2);
});

test("探活无结论时不否掉候选", async () => {
  const { service, calls } = setup({
    tracks: [kwTrack("93157", "林俊杰", 267)],
    probe: async () => ({ ok: false, definitive: false, reason: "无响应（>2.5s）" }),
  });
  const groups = await service.startHiddenSearch(song, Date.now() + 5_000);

  const resolved = await service.resolveHiddenFromGroups(
    groups,
    song,
    ["320k"],
    Date.now() + 5_000,
  );

  assert.equal(resolved.url, "https://kw.example/a.mp3");
  assert.equal(calls.probe.length, 1);
});
