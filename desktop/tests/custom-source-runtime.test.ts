import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomSourceAccess } from "../src/services/customSourceAccess";
import type { CustomSourceItem } from "../src/stores/customSourceStore";
import type { MusicInfo } from "@lx/core";

const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/services/outboundHttp", () => ({ outboundRequest: network.request }));
vi.mock("../src/utils/compression", () => ({ deflateBytes: vi.fn(), inflateBytes: vi.fn(), zlibFormatFromOptions: vi.fn() }));
import { requestCustomSourceMusicUrl, testCustomSource, invalidateRuntimeCache } from "../src/services/customSourceRuntime";

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
});
