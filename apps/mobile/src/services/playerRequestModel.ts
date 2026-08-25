import type { MusicInfo } from "@lx/core";

export function buildMobilePlayRequestKey(music: MusicInfo): string {
  const localUrl = music.isLocal && music.url ? music.url : "";
  return `${music.source}:${music.id}:${localUrl}:${music.quality ?? ""}`;
}
