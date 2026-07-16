import {
  SourceRegistry,
  SourceResolver,
  DEFAULT_SOURCE_POLICY,
  type MusicSource,
  type SourceTag,
} from "@lx/core";
import { wyProvider } from "./wyProvider";
import { txProvider } from "./txProvider";
import { biliProvider } from "./biliProvider";

/**
 * 全局 SourceRegistry：注册内置音源 wy / tx。
 * 自定义音源在播放时由 customSourceBackend 直接走 customSourceStore，
 * 不通过此 registry/resolver。
 */
const registry = new SourceRegistry();

export function registerSource(source: MusicSource): void {
  registry.register(source);
}

registerSource(wyProvider);
registerSource(txProvider);
registerSource(biliProvider);

/**
 * SourceResolver 目前仅被 lyricsService 通过 getSource() 用于取 Provider 歌词。
 * wy/tx 在启动时静态注册，快照方式足够。
 */
const resolver = new SourceResolver(
  new Map(registry.list().map((s) => [s.id, s])),
  DEFAULT_SOURCE_POLICY,
);

export { registry, resolver };
export type { SourceTag };
