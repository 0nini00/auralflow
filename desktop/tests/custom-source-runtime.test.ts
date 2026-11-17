import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomSourceAccess } from "../src/services/customSourceAccess";
import type { CustomSourceItem, MusicInfo } from "@lx/core";

const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/services/outboundHttp", () => ({ outboundRequest: network.request }));
vi.mock("../src/utils/compression", () => ({ deflateBytes: vi.fn(), inflateBytes: vi.fn(), zlibFormatFromOptions: vi.fn() }));
import { checkCustomSourceUpdate, requestCustomSourceMusicUrl, testCustomSource, testCustomSourceDeep, invalidateRuntimeCache } from "../src/services/customSourceRuntime";

const song: MusicInfo = { id: "1", source: "wy", name: "测试曲", singer: "歌手" };
const initialized = `
  lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } });
`;
function api(script: string): CustomSourceItem {
  return { id: "runtime-test", name: "测试源", description: "", script, enabled: true,
    allowShowUpdateAlert: true, createdAt: 1, updatedAt: 1, testStatus: "idle", updateStatus: "idle" };
}
let enabled: boolean;
let access: ReturnType<typeof createCustomSourceAccess>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  network.request.mockReset();
  enabled = true;
  access = createCustomSourceAccess(() => enabled);
});
afterEach(() => {
  access.invalidate();
  invalidateRuntimeCache("runtime-test");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("自定义脚本运行生命周期", () => {
  it("已经失效的令牌不能启动脚本", async () => {
    const operation = access.capture();
    access.invalidate();
    await expect(requestCustomSourceMusicUrl(api(`${initialized}
      lx.request('https://example.com', {}, () => {});
      lx.on(lx.EVENT_NAMES.request, () => Promise.resolve('https://example.com/song.mp3'));
    `), song, "128k", operation)).rejects.toThrow("未启用");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("正常启用时保留脚本取链与运行时复用", async () => {
    const source = api(`${initialized}
      lx.on(lx.EVENT_NAMES.request, () => Promise.resolve('https://example.com/song.mp3'));
    `);
    const result = await requestCustomSourceMusicUrl(source, song, "128k", access.capture());
    expect(result.url).toBe("https://example.com/song.mp3");
    expect((await requestCustomSourceMusicUrl(source, song, "128k", access.capture())).url).toBe(result.url);
  });
  it("关闭后在途取链立即失效，晚到HTTP回调不再进入脚本", async () => {
    let finish!: (value: unknown) => void;
    network.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const source = api(`${initialized}
      lx.on(lx.EVENT_NAMES.request, () => new Promise(resolve => {
        lx.request('https://example.com/request', {}, () => {
          lx.request('https://example.com/late', {}, () => {});
          resolve('https://example.com/song.mp3');
        });
      }));
    `);
    const pending = requestCustomSourceMusicUrl(source, song, "128k", access.capture());
    const outcome = pending.then(() => "resolved", (error: Error) => error.name);
    await vi.advanceTimersByTimeAsync(0);
    expect(network.request).toHaveBeenCalledTimes(1);
    enabled = false;
    access.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([outcome, Promise.resolve("still-pending")])).toBe("CustomSourceDisabledError");
    finish({ status: 200, ok: true, headers: {}, text: async () => "ok" });
    await vi.advanceTimersByTimeAsync(0);
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("关闭清理初始化等待和更新等待定时器", async () => {
    const pending = testCustomSource(api("// intentionally not initialized"), access.capture());
    const outcome = pending.then(() => "resolved", (error: Error) => error.name);
    access.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([outcome, Promise.resolve("still-pending")])).toBe("CustomSourceDisabledError");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("同一 runtime 只上浮第一次 updateAlert", async () => {
    const alerts: Array<{ log: string }> = [];
    const source = api(`${initialized}
      lx.send(lx.EVENT_NAMES.updateAlert, { log: "第一次", updateUrl: "https://example.com/new" });
      lx.send(lx.EVENT_NAMES.updateAlert, { log: "第二次" });
      lx.on(lx.EVENT_NAMES.request, () => Promise.resolve("https://example.com/song.mp3"));
    `);

    await requestCustomSourceMusicUrl(source, song, "128k", access.capture(), (alert) => {
      alerts.push(alert);
    });

    // 脚本在初始化/取链里重复 send 不能让同一个更新弹窗反复上浮
    expect(alerts).toHaveLength(1);
    expect(alerts[0].log).toBe("第一次");
  });
});

// 取链测试的编排在 @lx/core；这里锁住桌面端的接线：运行时缓存的去留、取消令牌与超时守卫。
describe("深度测试接线", () => {
  // 脚本每执行一次就发一次启动请求：用网络调用次数数出脚本被执行了几遍
  const booting = "lx.request('https://example.com/boot', {}, () => {});";
  const UPDATE_ALERT_WAIT_MS = 800;
  async function deepTest(source: CustomSourceItem, extraMs = 0) {
    const pending = testCustomSourceDeep(source, access.capture());
    await vi.advanceTimersByTimeAsync(UPDATE_ALERT_WAIT_MS + extraMs);
    return pending;
  }
  beforeEach(() => {
    network.request.mockReturnValue(new Promise(() => {}));
  });

  it("取链通过后保留测试用的运行时，播放不再重新执行脚本", async () => {
    const source = api(`${booting}${initialized}
      lx.on(lx.EVENT_NAMES.request, ({ info }) => Promise.resolve('https://example.com/' + info.musicInfo.songmid + '.mp3'));
    `);
    expect(await deepTest(source)).toEqual({
      ok: true,
      message: "初始化正常；取链测试 1/1 通过（wy 通过:128k）",
      sources: { wy: { type: "music", actions: ["musicUrl"], qualitys: ["128k"] } },
      updateAlert: undefined,
    });
    expect((await requestCustomSourceMusicUrl(source, song, "128k", access.capture())).url).toBe("https://example.com/1.mp3");
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it("全部平台取链失败时丢弃运行时，下次取链重新执行脚本", async () => {
    const source = api(`${booting}${initialized}
      lx.on(lx.EVENT_NAMES.request, () => Promise.reject(new Error('上游\\n  拒绝')));
    `);
    expect(await deepTest(source)).toMatchObject({
      ok: false,
      message: "初始化正常；取链测试 0/1 通过（wy 失败:取链失败：上游 拒绝）",
    });
    await expect(requestCustomSourceMusicUrl(source, song, "128k", access.capture())).rejects.toThrow("上游");
    expect(network.request).toHaveBeenCalledTimes(2);
  });

  it("未声明 musicUrl 时只验证初始化，测试用的运行时不进入播放缓存", async () => {
    const source = api(`${booting}
      lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: [], qualitys: [] } } });
    `);
    expect(await deepTest(source)).toMatchObject({ ok: true, message: "初始化正常；未声明 musicUrl，仅验证初始化" });
    await expect(requestCustomSourceMusicUrl(source, song, "128k", access.capture())).rejects.toThrow("音源不支持 wy 的播放链接解析");
    expect(network.request).toHaveBeenCalledTimes(2);
  });

  it("脚本初始化抛错时报告初始化失败", async () => {
    expect(await deepTest(api("throw new Error('boom');"))).toEqual({
      ok: false,
      message: "初始化失败：boom",
      sources: undefined,
      updateAlert: undefined,
    });
  });

  it("取链迟迟不返回时按超时记为该平台失败", async () => {
    const source = api(`${initialized}
      lx.on(lx.EVENT_NAMES.request, () => new Promise(() => {}));
    `);
    expect((await deepTest(source, 20_000)).message).toBe("初始化正常；取链测试 0/1 通过（wy 失败:取链失败：取链测试超时（20000ms））");
  });

  it("取链途中关闭功能时以失效错误结束，不写成测试失败", async () => {
    const source = api(`${initialized}
      lx.on(lx.EVENT_NAMES.request, () => new Promise(() => {}));
    `);
    const outcome = testCustomSourceDeep(source, access.capture()).then(() => "resolved", (error: Error) => error.name);
    await vi.advanceTimersByTimeAsync(UPDATE_ALERT_WAIT_MS);
    access.invalidate();
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([outcome, Promise.resolve("still-pending")])).toBe("CustomSourceDisabledError");
  });
});

describe("远端更新检查接线", () => {
  const CHECK_UPDATE_ALERT_WAIT_MS = 5_000;
  const header = (version: string) => `/*\n * @name 测试源\n * @version ${version}\n */\n`;
  const source = () => ({ ...api(`${header("1.0.0")}${initialized}`), homepage: "https://example.com/source.js" });

  it("脚本没有上报更新时拉取 homepage 指向的远端脚本比对版本", async () => {
    network.request.mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: {}, text: async () => `${header("1.1.0")}${initialized}` });
    const pending = checkCustomSourceUpdate(source(), access.capture());
    await vi.advanceTimersByTimeAsync(CHECK_UPDATE_ALERT_WAIT_MS);
    expect((await pending).updateAlert).toEqual({ log: "发现新版本：v1.0.0 -> v1.1.0", updateUrl: "https://example.com/source.js" });
    expect(network.request).toHaveBeenCalledWith("https://example.com/source.js", {
      method: "GET",
      headers: { Accept: "text/plain,application/javascript,*/*" },
    });
  });

  // 文案与移动端共用 @lx/core 的同一份（全角冒号）；此前桌面端单独用半角冒号。
  it("远端脚本请求失败时更新检查明确失败", async () => {
    network.request.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", headers: {}, text: async () => "" });
    const outcome = expect(checkCustomSourceUpdate(source(), access.capture())).rejects.toThrow("远端音源请求失败：HTTP 404 Not Found");
    await vi.advanceTimersByTimeAsync(CHECK_UPDATE_ALERT_WAIT_MS);
    await outcome;
  });
});
