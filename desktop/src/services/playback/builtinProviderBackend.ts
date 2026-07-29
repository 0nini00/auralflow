import { resolver } from "@/services/sources/sourceService";
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from "./types";

export const builtinProviderBackend: PlaybackBackend = {
  id: "builtinProvider",
  name: "内置音源",

  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const variants = request.variants?.length ? request.variants : [request.primary];
    const trace: PlaybackAttempt[] = [];

    for (const music of variants) {
      if (music.source === "local") continue;
      const provider = resolver.getSource(music.source);
      if (!provider) continue;

      for (const quality of request.qualityPreference) {
        try {
          const url = await provider.getMusicUrl(music, quality);
          if (!url) throw new Error("未返回播放地址");
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
          };
        } catch (error) {
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
