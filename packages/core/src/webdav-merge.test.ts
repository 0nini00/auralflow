import { describe, expect, it } from "vitest";

import {
  isNumericPlaylistId,
  isWebdavLocalPlaylistRef,
  mergeWebdavLocalPlaylists,
  mergeWebdavSongs,
  scrubSyncedCloudPlaylistRefs,
  type WdLocalPlaylist,
} from "./webdav-merge";
import type { MusicInfo } from "./sources/types";

/**
 * 这套用例锚定一个回归：同步文件 `userList` 里的云端歌单引用（网易云 / QQ）
 * 一旦被当成“本地歌单”，就会在双端产生 0 首歌曲的假歌单，并被上传回同步文件。
 */

function song(source: MusicInfo["source"], id: string): MusicInfo {
  return { source, id, name: `${source}-${id}` } as MusicInfo;
}

describe("isNumericPlaylistId", () => {
  it("识别纯数字 id（含数字与含空白字符串）", () => {
    expect(isNumericPlaylistId("1234567890")).toBe(true);
    expect(isNumericPlaylistId(1234567890)).toBe(true);
    expect(isNumericPlaylistId(" 42 ")).toBe(true);
  });

  it("拒绝非数字 id", () => {
    for (const id of ["playlist_1720000000000_abc", "webdav-local-k3f9", "12a", "", "  ", undefined, null, {}]) {
      expect(isNumericPlaylistId(id), String(id)).toBe(false);
    }
  });
});

describe("isWebdavLocalPlaylistRef", () => {
  it("云端引用（纯数字 id，source 为 wy/tx）判为云端", () => {
  for (const source of ["wy", "tx", "netease", "qq"]) {
      expect(isWebdavLocalPlaylistRef({ id: "5183457", source }), source).toBe(false);
    }
  });

  it("被桌面端旧逻辑污染成 source: local 的云端条目仍判为云端", () => {
    expect(isWebdavLocalPlaylistRef({ id: "5183457", source: "local" })).toBe(false);
    expect(isWebdavLocalPlaylistRef({ id: "5183457" })).toBe(false);
  });

  it("本地歌单（桌面端 playlist_ 前缀 / 移动端 webdav-local 前缀）判为本地", () => {
    expect(isWebdavLocalPlaylistRef({ id: "playlist_1720000000000_ab12cd", source: "local" })).toBe(true);
    expect(isWebdavLocalPlaylistRef({ id: "webdav-local-k3f9x" })).toBe(true);
  });

  it("无 source 的非数字 id 走本地兜底（兼容旧版数据）", () => {
    expect(isWebdavLocalPlaylistRef({ id: "my-mixed-list" })).toBe(true);
    expect(isWebdavLocalPlaylistRef({ id: "playlist_1", source: undefined })).toBe(true);
  });

  it("空/异常条目不会崩，按本地兜底处理", () => {
    expect(isWebdavLocalPlaylistRef({})).toBe(true);
    expect(isWebdavLocalPlaylistRef({ id: null, source: null })).toBe(true);
  });
});

describe("mergeWebdavLocalPlaylists", () => {
  const local: WdLocalPlaylist = {
    id: "playlist_a",
    name: "本地",
    songs: [song("wy", "1")],
    createdAt: 1,
    updatedAt: 100,
  };

  it("远端较新时采用远端元数据，但歌曲取并集", () => {
    const remote: WdLocalPlaylist = { ...local, name: "远端改名", songs: [song("tx", "2")], updatedAt: 200 };
    const [merged] = mergeWebdavLocalPlaylists([local], [remote]);
    expect(merged.name).toBe("远端改名");
    expect(merged.songs.map((s) => `${s.source}:${s.id}`)).toEqual(["wy:1", "tx:2"]);
  });

  it("本地较新时保留本地元数据", () => {
    const remote: WdLocalPlaylist = { ...local, name: "旧名字", updatedAt: 50 };
    const [merged] = mergeWebdavLocalPlaylists([local], [remote]);
    expect(merged.name).toBe("本地");
  });

  it("不同步删除：远端没有的本地歌单保留", () => {
    const merged = mergeWebdavLocalPlaylists([local], []);
    expect(merged.map((p) => p.id)).toEqual(["playlist_a"]);
  });

  it("mergeWebdavSongs 按 source:id 去重且保持首次出现顺序", () => {
    const merged = mergeWebdavSongs([song("wy", "1"), song("tx", "1")], [song("wy", "1"), song("wy", "2")]);
    expect(merged.map((s) => `${s.source}:${s.id}`)).toEqual(["wy:1", "tx:1", "wy:2"]);
  });
});

/**
 * 清理被误物化的云端歌单引用。
 *
 * 背景：旧版移动端的归类逻辑是 `source === "local" ⇒ 本地`（不看 id），而旧版桌面端
 * 又把云端歌单引用以 `source: "local"` + 纯数字 id 上传，于是这些引用被物化成本地歌单
 * 并持久化。归类修好之后，**已落盘的那批不会自己消失**，也没有任何清理路径 ——
 * 这个函数就是那道缺失的清理。
 */
describe("scrubSyncedCloudPlaylistRefs", () => {
  const trueLocal = {
    id: "playlist_1720000000000_ab12cd",
    name: "我自己的精选",
    songs: [song("wy", "1")],
  };
  const pollutedRef = { id: "889957174", name: "温水-o喜欢的音乐", songs: [] as MusicInfo[] };
  const pollutedRefWithSongs = { id: "17853696222", name: "周杰伦", songs: [song("wy", "2")] };

  it("剔除被旧版逻辑物化的云端歌单引用（纯数字 id + 0 首）", () => {
    const { kept, dropped, suspicious } = scrubSyncedCloudPlaylistRefs([
      trueLocal,
      pollutedRef,
      pollutedRefWithSongs,
    ]);

    expect(dropped.map((item) => item.id)).toEqual(["889957174"]);
    expect(kept.map((item) => item.id)).toEqual([
      "playlist_1720000000000_ab12cd",
      "17853696222",
    ]);
    expect(kept).toContain(trueLocal);
    expect(kept).toContain(pollutedRefWithSongs);
  });

  it("含歌曲的纯数字 id 条目保守保留并标记可疑（不静默删用户数据）", () => {
    const { kept, dropped, suspicious } = scrubSyncedCloudPlaylistRefs([pollutedRefWithSongs]);

    expect(dropped).toHaveLength(0);
    expect(suspicious.map((item) => item.id)).toEqual(["17853696222"]);
    expect(kept).toEqual([pollutedRefWithSongs]);
  });

  it("真本地歌单（桌面 playlist_ 与移动端 local- 两种前缀）一个都不动", () => {
    const items = [
      { id: "playlist_1720000000000_ab12cd", name: "来自桌面", songs: [] },
      { id: "local-1758000000000-ab12cd34", name: "来自手机", songs: [] },
    ];

    const { kept, dropped, suspicious } = scrubSyncedCloudPlaylistRefs(items);

    expect(kept).toEqual(items);
    expect(dropped).toHaveLength(0);
    expect(suspicious).toHaveLength(0);
  });

  it("已经干净时返回空结果，调用方可据此跳过备份与日志", () => {
    const { kept, dropped, suspicious } = scrubSyncedCloudPlaylistRefs([trueLocal]);

    expect(kept).toEqual([trueLocal]);
    expect(dropped).toHaveLength(0);
    expect(suspicious).toHaveLength(0);
  });

  it("空 / null / 缺字段输入不崩", () => {
    expect(scrubSyncedCloudPlaylistRefs([])).toEqual({ kept: [], dropped: [], suspicious: [] });
    expect(scrubSyncedCloudPlaylistRefs(null)).toEqual({ kept: [], dropped: [], suspicious: [] });
    expect(scrubSyncedCloudPlaylistRefs(undefined).kept).toHaveLength(0);
    // songs 字段缺失视为 0 首 ⇒ 纯数字 id 仍应被剔除
    expect(scrubSyncedCloudPlaylistRefs([{ id: "123" }]).dropped).toHaveLength(1);
  });

  it("数组里的 null 条目不会被当成歌单保留", () => {
    const { kept } = scrubSyncedCloudPlaylistRefs([null, { id: "playlist_x", name: "x", songs: [] }]);

    expect(kept.map((item) => item.id)).toEqual(["playlist_x"]);
  });
});
