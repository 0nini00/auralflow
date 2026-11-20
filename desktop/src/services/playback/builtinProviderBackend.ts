import { throwIfAborted } from './cancellation';
import { buildSongKey } from '@lx/core';
import { getSource } from "@/services/sources/sourceService";
import { canConfirmBuiltinProviderQuality } from "@/services/builtinMusicApiModel";
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from "./types";

export const builtinProviderBackend: PlaybackBackend = {
  id: "builtinProvider",
  name: "内置音源",

  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const variants = request.variants?.length ? request.variants : [request.primary];
    const trace: PlaybackAttempt[] = [];

    for (const music of variants) {
      if (music.source === "local") continue;
      const provider = getSource(music.source);
      if (!provider) continue;

      for (const quality of request.qualityPreference) {
        const candidateId = `builtinProvider:${buildSongKey(music)}:${quality}`;
        if (request.excludedCandidateIds?.has(candidateId)) continue;
        try {
          throwIfAborted(request.signal);
          if (request.exactQuality && !canConfirmBuiltinProviderQuality(music)) {
            throw new Error('QQ 官方普通取链无法确认精确音质，请使用支持所选音质的音源');
          }
          const url = await provider.getMusicUrl(music, quality, request.signal);
          if (!url) throw new Error("未返回播放地址");
          if (request.excludedUrls?.has(url)) throw new Error('播放地址已被本次播放拒绝');
          trace.push({
            backend: "builtinProvider",
            resolverName: provider.name,
            source: music.source,
            quality,
            status: "success",
          });
          return {
            url,
            music,
            quality,
            backend: "builtinProvider",
            resolverName: provider.name,
            trace,
            candidateId,
          };
        } catch (error) {
          throwIfAborted(request.signal);
          trace.push({
            backend: "builtinProvider",
            resolverName: provider.name,
            source: music.source,
            quality,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const detail = trace.map((item) => `${item.source.toUpperCase()} ${item.quality}: ${item.error ?? item.status}`).join("\n");
    throw new Error(detail || "内置音源播放解析失败");
  },
};
