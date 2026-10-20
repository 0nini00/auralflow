import { NativeModules } from "react-native";
import type { MusicInfo } from "@lx/core";
import { getLyrics } from "./musicApi";
import { createLocalMediaResolver, type LocalAudioAssets } from "./localMediaAssetsService";

/**
 * 只读原生资产：内嵌标签 / 同目录旁挂的歌词与文件内容 SHA-256。
 *
 * 这是本地曲歌词的唯一来源；结果不做任何持久化，也不联网。
 */
async function readLocal(song: MusicInfo): Promise<LocalAudioAssets> {
  if (!song.url || !/^(file|content):\/\//.test(song.url)) throw new Error("本地歌曲缺少可读取的音频 URI");
  const native = NativeModules.LocalMusicModule as { readAudioAssets?: (uri: string) => Promise<LocalAudioAssets> } | undefined;
  if (!native?.readAudioAssets) throw new Error("本地资料读取原生模块不可用，请安装新版 APK");
  const result = await native.readAudioAssets(song.url);
  if (!result || typeof result.signature !== "string" || !result.signature || !Array.isArray(result.warnings)
    || result.warnings.some(issue => typeof issue !== "string")
    || (result.lyrics !== undefined && typeof result.lyrics !== "string")) {
    throw new Error("本地资料读取结果无效");
  }
  return result;
}

const resolver = createLocalMediaResolver({
  readLocal,
  parse: raw => getLyrics({ source: "local", id: "local-lyrics", name: "", singer: "", albumName: "", localLyrics: raw }),
});
export const resolveLocalMediaAssets = resolver.resolve;
