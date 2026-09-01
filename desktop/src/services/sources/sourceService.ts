import { SourceRegistry, type MusicSource, type SourceTag } from "@lx/core";
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
 * 按 id 取内置音源。歌词、下载与播放的 builtin 通道都走这里。
 * 直接查 registry，不再另存一份快照，避免注册表出现第二真相源。
 */
export function getSource(id: string): MusicSource | undefined {
  return registry.get(id);
}

export { registry };
export type { SourceTag };
