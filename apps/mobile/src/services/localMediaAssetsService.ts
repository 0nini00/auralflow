import type { LyricLine, MusicInfo } from "@lx/core";

/** 原生 `readAudioAssets` 的返回形状：文件内容 SHA-256 与内嵌 / 同目录旁挂的歌词文本。 */
export interface LocalAudioAssets {
  signature: string;
  lyrics?: string;
  warnings: string[];
}

export interface LocalMediaResult {
  /**
   * `loading` / `error` 由播放链自己也可能写入（见 playerService.loadLocalMedia），
   * `local` = 拿到了文件里的歌词，`not-found` = 文件里没有歌词。
   */
  status: "loading" | "local" | "not-found" | "error";
  lyrics: LyricLine[];
  message: string;
  issues: string[];
}

interface Dependencies {
  readLocal: (song: MusicInfo) => Promise<LocalAudioAssets>;
  parse: (raw: string) => Promise<LyricLine[]>;
}

/**
 * 补全请求的身份键。
 *
 * 歌词只来自音频文件自己，因此请求身份也只剩歌曲记录本身：同一首曲（身份 / 地址 / 标签不变）
 * 复用同一次读取，任一项变了就让旧读取作废。
 */
export function localMediaInputKey(song: MusicInfo): string {
  return JSON.stringify([song.source, song.id, song.url, song.name, song.singer, song.albumName, song.interval]);
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * 本地曲歌词的唯一来源是音频文件自己：原生模块读出的内嵌标签，或同目录旁挂 `.lrc`。
 *
 * 没有联网找词、没有候选、没有缓存、也没有来源标注 —— 文件里没有歌词就是没有。
 * 永远不修改传入歌曲、曲库记录或原始音频。
 */
export function createLocalMediaResolver(deps: Dependencies) {
  async function resolve(
    song: MusicInfo,
    onUpdate: (result: LocalMediaResult) => void,
    isCurrent: () => boolean,
  ): Promise<LocalMediaResult | null> {
    const issues: string[] = [];
    const report = (status: LocalMediaResult["status"], lyrics: LyricLine[], message: string): LocalMediaResult => {
      const result = { status, lyrics, message, issues: [...issues] };
      if (isCurrent()) onUpdate(result);
      return result;
    };

    try {
      report("loading", [], "正在读取本地歌词");
      // 记录上的按曲歌词优先（用户手写、下载曲的元数据编辑都写在这里）：与桌面端同一语义，
      // 空串表示用户主动清除，此时不再回落到文件里那份词。
      const recorded = typeof song.localLyrics === "string" ? song.localLyrics : undefined;
      if (recorded !== undefined) {
        if (!recorded.trim()) return report("not-found", [], "无歌词");
        const recordedLines = await deps.parse(recorded);
        if (!isCurrent()) return null;
        return recordedLines.length ? report("local", recordedLines, "") : report("not-found", [], "无歌词");
      }
      const local = await deps.readLocal(song);
      if (!isCurrent()) return null;
      issues.push(...local.warnings);
      if (!local.lyrics || !local.lyrics.trim()) return report("not-found", [], "无歌词");
      const lyrics = await deps.parse(local.lyrics);
      if (!isCurrent()) return null;
      return lyrics.length ? report("local", lyrics, "") : report("not-found", [], "无歌词");
    } catch (error) {
      if (!isCurrent()) return null;
      issues.push(messageOf(error));
      return report("error", [], "资料读取失败，播放不受影响");
    }
  }
  return { resolve };
}
