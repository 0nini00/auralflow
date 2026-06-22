import type { MusicInfo, MusicSource, PlaylistInfo, SearchResult, SearchType } from "./types";

/**
 * 自定义音源脚本在沙箱中暴露的上下文。
 * 只包含 HTTP 请求、日志和常用工具函数。
 */
export interface CustomSourceContext {
  request: (options: RequestOptions) => Promise<any>;
  log: (msg: string) => void;
  utils: {
    md5: (input: string) => string;
    sleep: (ms: number) => Promise<void>;
    randomUserAgent: () => string;
  };
}

export interface RequestOptions {
  url: string;
  method?: "GET" | "POST";
  params?: Record<string, any>;
  data?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface CustomSourceScript {
  id: string;
  name: string;
  version: string;
  capabilities: ("search" | "url" | "lyric" | "playlist")[];

  search?: (
    params: { keyword: string; type: SearchType; page?: number },
    ctx: CustomSourceContext
  ) => Promise<SearchResult>;

  getUrl?: (
    params: { music: MusicInfo; quality?: string },
    ctx: CustomSourceContext
  ) => Promise<string | null>;

  getLyric?: (
    params: { music: MusicInfo },
    ctx: CustomSourceContext
  ) => Promise<{ lyric?: string; tlyric?: string; romaLyric?: string }>;

  getPlaylistDetail?: (
    params: { playlist: PlaylistInfo },
    ctx: CustomSourceContext
  ) => Promise<MusicInfo[]>;
}

/**
 * 把用户脚本包装成 MusicSource，注册到 SourceRegistry 参与轮询。
 * UI 不显示该 provider 为新的来源。
 */
export function createCustomSourceProvider(
  script: CustomSourceScript,
  context: CustomSourceContext
): MusicSource {
  return {
    id: script.id,
    name: script.name,
    supportedSearchTypes: inferSearchTypes(script.capabilities),

    async search(keyword, type, page) {
      if (!script.search) return {};
      return script.search({ keyword, type, page }, context);
    },

    async getMusicUrl(music, quality) {
      if (!script.getUrl) return null;
      return script.getUrl({ music, quality }, context);
    },

    async getMusicDetail(music) {
      // 自定义脚本不负责补全详情，直接透传
      return music;
    },

    async getLyric(music) {
      if (!script.getLyric) return {};
      return script.getLyric({ music }, context);
    },

    async getPlaylistDetail(playlist) {
      if (!script.getPlaylistDetail) return [];
      return script.getPlaylistDetail({ playlist }, context);
    },
  };
}

function inferSearchTypes(
  capabilities: CustomSourceScript["capabilities"]
): SearchType[] {
  const types: SearchType[] = [];
  if (capabilities.includes("search") || capabilities.includes("url")) {
    types.push("song");
  }
  if (capabilities.includes("playlist")) {
    types.push("playlist");
  }
  return types;
}
