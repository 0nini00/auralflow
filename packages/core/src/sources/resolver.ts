import type {
  MusicInfo,
  MusicSource,
  PlaylistInfo,
  SearchResult,
  SearchType,
  SourceTag,
} from "./types";

export type UrlResolutionMode = "source-rotation";

export interface SourceResolutionPolicy {
  /** 轮询顺序，至少包含 ['wy', 'tx']，可追加自定义源 id */
  sourceOrder: string[];
  /** 每个源超时时间（毫秒） */
  timeoutPerSource: number;
  /** 每个源重试次数 */
  retryPerSource: number;
  /** 跨源匹配相似度阈值，0~1；大于 0 表示自动开启跨源匹配 */
  crossSourceMatchThreshold: number;
  /** 音质偏好，如 ['flac', '320k', '128k'] */
  qualityPreference: string[];
  /** 来源未知时的默认 UI 标签 */
  defaultSourceTag: SourceTag;
}

export interface ResolvedUrl {
  url: string;
  /** 用于 UI 展示，只能是 wy / tx */
  sourceId: SourceTag;
  quality: string;
}

/**
 * 默认策略：自动跨源匹配，音质从高到低。
 */
export const DEFAULT_SOURCE_POLICY: SourceResolutionPolicy = {
  sourceOrder: ["wy", "tx"],
  timeoutPerSource: 8000,
  retryPerSource: 1,
  crossSourceMatchThreshold: 0.85,
  qualityPreference: ["flac", "320k", "128k"],
  defaultSourceTag: "wy",
};

export class SourceResolver {
  constructor(
    private readonly registry: Map<string, MusicSource>,
    private readonly policy: SourceResolutionPolicy = DEFAULT_SOURCE_POLICY
  ) {}

  setPolicy(policy: SourceResolutionPolicy): void {
    Object.assign(this.policy, policy);
  }

  async resolveMusicUrl(music: MusicInfo): Promise<ResolvedUrl | null> {
    return this.resolveByRotation(music);
  }

  async resolveSearch(
    keyword: string,
    type: SearchType
  ): Promise<SearchResult> {
    const sources = this.activeSources();
    const results = await Promise.all(
      sources.map((s) =>
        this.withTimeout(s.search(keyword, type, 1), this.policy.timeoutPerSource).catch(
          () => ({}) as SearchResult
        )
      )
    );

    return this.mergeSearchResults(results);
  }

  async resolvePlaylist(playlist: PlaylistInfo): Promise<MusicInfo[]> {
    const source = this.registry.get(playlist.source);
    if (!source) return [];
    return this.withTimeout(
      source.getPlaylistDetail(playlist),
      this.policy.timeoutPerSource
    ).catch(() => []);
  }

  private mergeSearchResults(results: SearchResult[]): SearchResult {
    const merged: SearchResult = { songs: [], playlists: [] };
    const seen = new Set<string>();

    for (const result of results) {
      for (const song of result.songs ?? []) {
        const key = `${song.name}|${song.singer}|${song.interval ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.songs!.push(song);
      }
      for (const playlist of result.playlists ?? []) {
        const key = `${playlist.source}:${playlist.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.playlists!.push(playlist);
      }
    }

    return merged;
  }

  private async resolveByRotation(music: MusicInfo): Promise<ResolvedUrl | null> {
    const order = this.buildSourceOrderFor(music);

    for (const sourceId of order) {
      const source = this.registry.get(sourceId);
      if (!source) continue;

      for (let attempt = 0; attempt <= this.policy.retryPerSource; attempt++) {
        const url = await this.trySourceUrl(source, music);
        if (url) {
          return this.buildResolvedUrl(url, music, sourceId);
        }
      }

      if (this.policy.crossSourceMatchThreshold > 0) {
        const matched = await this.crossSourceMatch(music, sourceId);
        if (matched) return matched;
      }
    }

    return null;
  }

  private async trySourceUrl(
    source: MusicSource,
    music: MusicInfo
  ): Promise<string | null> {
    for (const quality of this.policy.qualityPreference) {
      const url = await this.withTimeout(
        source.getMusicUrl(music, quality),
        this.policy.timeoutPerSource
      ).catch(() => null);
      if (url) return url;
    }
    return null;
  }

  private async crossSourceMatch(
    music: MusicInfo,
    failedSourceId: string
  ): Promise<ResolvedUrl | null> {
    const candidates = this.activeSources().filter((s) => s.id !== failedSourceId);

    for (const source of candidates) {
      const searchResult = await this.withTimeout(
        source.search(`${music.name} ${music.singer}`, "song"),
        this.policy.timeoutPerSource
      ).catch(() => ({}) as SearchResult);

      const matched = (searchResult.songs ?? []).find((candidate) =>
        this.isSameTrack(candidate, music)
      );

      if (matched) {
        const url = await this.trySourceUrl(source, matched);
        if (url) {
          return this.buildResolvedUrl(url, matched, source.id);
        }
      }
    }

    return null;
  }

  private isSameTrack(a: MusicInfo, b: MusicInfo): boolean {
    if (a.name !== b.name) return false;
    if (a.singer !== b.singer) return false;
    if (a.interval && b.interval) {
      const diff = Math.abs(a.interval - b.interval);
      if (diff > 5) return false;
    }
    return true;
  }

  private buildSourceOrderFor(music: MusicInfo): string[] {
    const { sourceOrder } = this.policy;
    const sourceId = music.source;
    if (sourceOrder.includes(sourceId)) {
      const rotated = [
        sourceId,
        ...sourceOrder.filter((id) => id !== sourceId),
      ];
      return Array.from(new Set(rotated));
    }
    return sourceOrder;
  }

  /** 按 sourceId 获取注册的音源提供者 */
  getSource(sourceId: string): MusicSource | undefined {
    return this.registry.get(sourceId);
  }

  private activeSources(): MusicSource[] {
    return this.policy.sourceOrder
      .map((id) => this.registry.get(id))
      .filter((s): s is MusicSource => !!s);
  }

  private buildResolvedUrl(
    url: string,
    music: MusicInfo,
    resolvedSourceId: string,
  ): ResolvedUrl {
    const sourceId: SourceTag =
      resolvedSourceId === "wy" || resolvedSourceId === "tx" || resolvedSourceId === "local"
        ? resolvedSourceId
        : music.source;

    return {
      url,
      sourceId,
      quality: music.quality ?? this.policy.qualityPreference[0] ?? "unknown",
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Source request timeout after ${ms}ms`));
      }, ms);
      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
