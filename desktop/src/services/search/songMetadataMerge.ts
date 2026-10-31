import type { MusicInfo } from "@lx/core";
import { isSameSong } from "@lx/core";

/**
 * 桌面端搜索结果元数据合并。
 * 匹配规则统一由 @lx/core（song-variant）提供，本模块只负责合并编排。
 */

function mergeMetadata(primary: MusicInfo, metadata: MusicInfo): MusicInfo {
  const cover = primary.picUrl || primary.img || metadata.picUrl || metadata.img;
  return {
    ...primary,
    // 只补展示字段，绝不接管 gateway（解析身份）。
    //
    // 曾经的 `gateway: primary.gateway || metadata.gateway` 会把元数据方的解析身份
    // 挂到另一条平台的曲目上：tx 链路的主链是官方 musicu 结果，元数据方是网关的
    // joox 结果，两者 id 属于完全不同的命名空间（QQ songmid 对 JOOX base64 id）。
    // 而网关条目普遍不带 interval，isSameSong 退化成「歌名 + 歌手」两重校验，
    // 同名 Live / 翻唱 / 重录很容易通过，于是 QQ 歌曲被贴上某首 JOOX 曲目的 id，
    // 播放解析就会去取别人的录音，甚至直接取到空地址。
    //
    // 缺 gateway 的 wy 曲目仍可解析：getBuiltinMusicApiGateway 会用自身 id 兜底
    // （wy 的 id 与 netease 网关 id 同源）。tx 曲目本就该走官方直连，不需要网关身份。
    albumName: primary.albumName || metadata.albumName,
    interval: primary.interval || metadata.interval,
    quality: primary.quality || metadata.quality,
    picUrl: primary.picUrl || cover,
    img: primary.img || cover,
  };
}

export function mergeSongSearchMetadata(
  primarySongs: MusicInfo[],
  metadataSongs: MusicInfo[],
): MusicInfo[] {
  const usedMetadataIndexes = new Set<number>();
  const merged = primarySongs.map((song) => {
    const metadataIndex = metadataSongs.findIndex((candidate, index) => {
      return !usedMetadataIndexes.has(index) && isSameSong(song, candidate);
    });
    if (metadataIndex < 0) return song;

    usedMetadataIndexes.add(metadataIndex);
    return mergeMetadata(song, metadataSongs[metadataIndex]);
  });

  for (let index = 0; index < metadataSongs.length; index += 1) {
    if (!usedMetadataIndexes.has(index)) merged.push(metadataSongs[index]);
  }

  return merged;
}
