import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicInfo } from "@lx/core";

const fixture = vi.hoisted(() => ({ search: vi.fn(), hasTx: true }));
vi.mock("@/services/sources/sourceService", () => ({
  getSource: (id: string) => (id === "tx" && fixture.hasTx ? { search: fixture.search } : undefined),
}));

import {
  clearCrossSourceVariantCache,
  findTxVariants,
} from "../src/services/playback/crossSourceFallbackService";

const song = { id: "100", source: "wy", name: "江南", singer: "林俊杰", interval: 267 } as MusicInfo;
const txMatch = { id: "tx-1", source: "tx", name: "江南", singer: "林俊杰", interval: 268 } as MusicInfo;

beforeEach(() => {
  fixture.search.mockReset();
  fixture.hasTx = true;
  clearCrossSourceVariantCache();
});

describe("跨源降级：QQ 同名曲检索", () => {
  it("搜索失败上抛原因，不伪装成「没有匹配」", async () => {
    fixture.search.mockRejectedValue(new Error("QQ Music request failed: 503"));

    await expect(findTxVariants(song)).rejects.toThrow("QQ Music request failed: 503");
  });

  it("失败不落缓存：下一次调用会重新搜索并拿到结果", async () => {
    fixture.search.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ songs: [txMatch] });

    await expect(findTxVariants(song)).rejects.toThrow("timeout");
    await expect(findTxVariants(song)).resolves.toEqual([txMatch]);
    expect(fixture.search).toHaveBeenCalledTimes(2);
  });

  it("搜索成功但没有匹配是正常的空结果，并被缓存", async () => {
    fixture.search.mockResolvedValue({ songs: [{ ...txMatch, name: "别的歌" }] });

    await expect(findTxVariants(song)).resolves.toEqual([]);
    await expect(findTxVariants(song)).resolves.toEqual([]);
    expect(fixture.search).toHaveBeenCalledTimes(1);
  });

  it("只处理网易云曲目，其它来源不发起搜索", async () => {
    await expect(findTxVariants({ ...song, source: "tx" } as MusicInfo)).resolves.toEqual([]);
    expect(fixture.search).not.toHaveBeenCalled();
  });
});
