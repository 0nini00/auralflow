import { describe, expect, it } from "vitest";

import {
  isNumericPlaylistId,
  isWebdavLocalPlaylistRef,
  mergeWebdavLocalPlaylists,
  mergeWebdavSongs,
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
  it("云端引用（纯数字 id，source 为 wy/tx/bili）判为云端", () => {
    for (const source of ["wy", "tx", "bili", "netease", "qq"]) {
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
