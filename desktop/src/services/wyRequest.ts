/**
 * 桌面端唯一的 weapi 请求通道。
 *
 * 账号层（`wyAccountService`）与音源层（`wyProvider`）此前各有一份 weapi POST：
 * 请求头、csrf 提取、空响应与非 JSON 的处理、登录失效的判定全都各写各的——
 * 同一个过期 Cookie，账号页会提示重新登录，播放取链却只报一句普通错误。
 * 请求的形状在 `@lx/core/wy-request`，这里只负责经 tauri-plugin-http 发出去。
 */
import { fetch } from "@tauri-apps/plugin-http";
import {
  WyAuthExpiredError,
  buildWyWeapiRequest,
  extractWyCsrfToken,
  isWyAuthExpiredCode,
  parseWyResponseText,
} from "@lx/core";
import { weapi } from "@/lib/crypto/weapi";

export type WyJson = Record<string, unknown>;

/** 单次 `/v3/song/detail` 能带的歌曲数上限，超出后服务端会截断。 */
const SONG_DETAIL_CHUNK_SIZE = 500;

/**
 * 发一条 weapi 请求，返回解析后的响应体，**不**检查业务 code。
 *
 * 少数接口的非 200 code 有业务含义（如歌单增删曲的 502），由调用方自己判；
 * 其余一律用 `assertWyOk` 收口。
 * @param cookie 已按接口需要处理好的 Cookie（是否改写成 PC 形态由调用方决定）。
 */
export async function sendWyWeapi(path: string, data: WyJson, cookie: string): Promise<WyJson> {
  const { params, encSecKey } = await weapi({ ...data, csrf_token: extractWyCsrfToken(cookie) });
  const request = buildWyWeapiRequest({ path, params, encSecKey, cookie });
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  return parseWyResponseText(await response.text(), { path, status: response.status });
}

/** 业务 code 不是 200 就抛错；登录失效抛带类型的错误，上层据此清会话。 */
export function assertWyOk(body: WyJson): void {
  if (body.code === 200) return;
  if (isWyAuthExpiredCode(body.code)) throw new WyAuthExpiredError();
  throw new Error(String(body.message || `网易云接口错误 code=${String(body.code)}`));
}

type WySong = Record<string, unknown>;

/**
 * 按 id 批量取歌曲详情，并把 `privileges` 并回每首歌的 `privilege` 字段。
 * 分块并发请求；`request` 决定走 weapi 还是 eapi。
 */
export async function fetchWySongDetails(
  ids: number[],
  request: (data: WyJson) => Promise<WyJson>,
): Promise<WySong[]> {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += SONG_DETAIL_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + SONG_DETAIL_CHUNK_SIZE));
  }

  const songs = await Promise.all(chunks.map(async (chunk) => {
    const body = await request({
      c: JSON.stringify(chunk.map((id) => ({ id }))),
      ids: JSON.stringify(chunk),
    });
    const rawSongs = (body.songs as WySong[] | undefined) ?? [];
    const privileges = new Map(
      ((body.privileges as WySong[] | undefined) ?? []).map((item) => [Number(item.id), item]),
    );
    return rawSongs.map((song) => ({
      ...song,
      privilege: privileges.get(Number(song.id)) ?? song.privilege,
    }));
  }));

  return songs.flat();
}
