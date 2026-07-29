import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  buildImmersiveQueuePanelModel,
  buildPlayerQueueItems,
  buildPlayerQueueManagementModel,
  getPlayerQueueSummary,
  shouldShowPlayerQueue,
} from "@/services/playerQueueModel";

function song(id: string, source: MusicInfo["source"] = "wy"): MusicInfo {
  return {
    id,
    name: `song-${id}`,
    singer: `artist-${id}`,
    albumName: "album",
    source,
  };
}

describe("player queue model", () => {
  it("builds queue items with current item marker", () => {
    expect(buildPlayerQueueItems([song("1"), song("2", "tx")], 1)).toEqual([
      { key: "wy:1:0", index: 0, title: "song-1", subtitle: "artist-1", isCurrent: false },
      { key: "tx:2:1", index: 1, title: "song-2", subtitle: "artist-2", isCurrent: true },
    ]);
  });

  it("summarizes queue state", () => {
    expect(getPlayerQueueSummary([], -1)).toBe("播放队列为空");
    expect(getPlayerQueueSummary([song("1"), song("2")], 0)).toBe("正在播放第 1 / 2 首");
    expect(getPlayerQueueSummary([song("1"), song("2")], 5)).toBe("共 2 首歌曲");
  });

  it("only shows queue when it has songs", () => {
    expect(shouldShowPlayerQueue([])).toBe(false);
    expect(shouldShowPlayerQueue([song("1")])).toBe(true);
  });

  it("builds queue management state for clearing and removable items", () => {
    expect(buildPlayerQueueManagementModel([], -1)).toEqual({
      canClearQueue: false,
      clearLabel: "清空",
      items: [],
    });

    expect(buildPlayerQueueManagementModel([song("1"), song("2"), song("3")], 1)).toEqual({
      canClearQueue: true,
      clearLabel: "清空",
      items: [
        { index: 0, canRemove: true, removeLabel: "移除", statusLabel: null },
        { index: 1, canRemove: false, removeLabel: null, statusLabel: "播放中" },
        { index: 2, canRemove: true, removeLabel: "移除", statusLabel: null },
      ],
    });
  });

  it("builds immersive lyrics queue panel state", () => {
    expect(buildImmersiveQueuePanelModel([], -1)).toEqual({
      show: false,
      triggerLabel: "播放列表",
      title: "播放列表",
      closeLabel: "关闭",
      summary: "播放队列为空",
      items: [],
      management: {
        canClearQueue: false,
        clearLabel: "清空",
        items: [],
      },
    });

    expect(buildImmersiveQueuePanelModel([song("1"), song("2", "tx")], 0)).toEqual({
      show: true,
      triggerLabel: "播放列表",
      title: "播放列表",
      closeLabel: "关闭",
      summary: "正在播放第 1 / 2 首",
      items: [
        { key: "wy:1:0", index: 0, title: "song-1", subtitle: "artist-1", isCurrent: true },
        { key: "tx:2:1", index: 1, title: "song-2", subtitle: "artist-2", isCurrent: false },
      ],
      management: {
        canClearQueue: true,
        clearLabel: "清空",
        items: [
          { index: 0, canRemove: false, removeLabel: null, statusLabel: "播放中" },
          { index: 1, canRemove: true, removeLabel: "移除", statusLabel: null },
        ],
      },
    });
  });
});
