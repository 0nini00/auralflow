import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";

export type MvResolution = 1080 | 720 | 480;

export interface MvPlaybackSource {
  mvId: string;
  url: string;
  resolution: MvResolution;
  type?: "mp4" | "hls";
}

interface WyMvUrlResponse {
  code?: number;
  message?: string;
  msg?: string;
  data?: {
    code?: number;
    url?: unknown;
    r?: unknown;
    msg?: string;
  };
}

const RESOLUTIONS: MvResolution[] = [1080, 720, 480];
const GLOBAL_FAILURE_CODES = new Set([301, 302, 401, 403, 407, 429]);

function getResolutionCandidates(preferred: MvResolution): MvResolution[] {
  const start = RESOLUTIONS.indexOf(preferred);
  return RESOLUTIONS.slice(start);
}

function inferSourceType(url: string): MvPlaybackSource["type"] {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mp4")) return "mp4";
  return undefined;
}

function isGlobalFailure(code: unknown, message?: string): boolean {
  if (typeof code === "number" && GLOBAL_FAILURE_CODES.has(code)) return true;
  return /登录|鉴权|认证|权限|禁止|限流|频繁|rate.?limit|forbidden|unauthorized/i.test(message ?? "");
}

function formatResolutionError(resolution: MvResolution, message: string): string {
  return `${resolution}p: ${message}`;
}

export async function fetchWyMvPlaybackSource(
  mvId: string,
  preferred: MvResolution = 1080,
): Promise<MvPlaybackSource> {
  const normalizedMvId = mvId.trim();
  if (!normalizedMvId) {
    throw new Error("缺少网易云 MV ID");
  }

  const cookie = (await getWyCookie()) ?? "";
  const candidates = getResolutionCandidates(preferred);
  const errors: string[] = [];

  for (const resolution of candidates) {
    const data = await postWyWeapi<WyMvUrlResponse>(
      "/song/enhance/play/mv/url",
      { id: normalizedMvId, r: resolution },
      cookie,
    );
    const outerMessage = data.message || data.msg;
    if (data.code !== 200) {
      const message = outerMessage || `API code ${String(data.code)}`;
      if (isGlobalFailure(data.code, outerMessage)) throw new Error(`获取网易云 MV 地址失败：${message}`);
      errors.push(formatResolutionError(resolution, message));
      continue;
    }
    if (data.data?.code != null && data.data.code !== 200) {
      const message = data.data.msg || `data.code ${data.data.code}`;
      errors.push(formatResolutionError(resolution, message));
      continue;
    }

    const url = typeof data.data?.url === "string" ? data.data.url.trim() : "";
    if (!url) {
      errors.push(formatResolutionError(resolution, "播放地址为空"));
      continue;
    }

    const actualResolution = Number(data.data?.r);
    const resolvedResolution = RESOLUTIONS.includes(actualResolution as MvResolution)
      ? actualResolution as MvResolution
      : resolution;
    return {
      mvId: normalizedMvId,
      url,
      resolution: resolvedResolution,
      type: inferSourceType(url),
    };
  }

  throw new Error(`网易云 MV ${normalizedMvId} 无可用播放地址：${errors.join("；")}`);
}
