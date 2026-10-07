import { isHttpMediaUrl } from "@/utils/mediaUrl";
import { buildBuiltinMusicApiUrl, type LyricLine, type MusicInfo } from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { getGatewayLyrics, getLyrics, searchGatewaySongs, searchSongs } from "./musicApi";
import { selectLocalMediaMatch } from "./localMediaMatchModel";

export interface LocalMediaAssets {
  status: "matched" | "not-found" | "ambiguous";
  lyrics?: LyricLine[];
  coverUrl?: string;
  candidate?: { source: string; id: string; name: string; singer: string; gatewaySource?: string; gatewayTrackId?: string };
  issues: string[];
}

type OnlineSource = "wy" | "tx";
interface AssetResult<T> { value?: T; issues: string[] }
type AssetNeeds = { lyrics: boolean; cover: boolean };
interface RoutedCandidate { song: MusicInfo; route: "direct" | "gateway" }
interface CandidateAssets { lyrics?: AssetResult<LyricLine[]>; cover?: AssetResult<string> }
interface LookupContext {
  needs: AssetNeeds;
  issues: string[];
  lyrics: Map<string, AssetResult<LyricLine[]>>;
  covers: Map<string, AssetResult<string>>;
}

const SOURCES: readonly OnlineSource[] = ["wy", "tx"];
const COVER_SIZE = 500;
const COVER_TIMEOUT_MS = 8_000;
const MAX_ASSET_NAMESPACES_PER_ROUND = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRemoteId(value: unknown): value is string {
  // 歌曲/歌词/图片 ID 是不透明标识，不接受本地路径、URI 或控制字符。
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value) && !/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(value);
}

function isOnlineCandidate(value: unknown, source: OnlineSource): value is MusicInfo {
  if (!isRecord(value) || value.source !== source || value.isLocal || value.localPath) return false;
  if (!isRemoteId(value.id) || typeof value.name !== "string" || !value.name.trim()) return false;
  if (typeof value.singer !== "string" || typeof value.albumName !== "string") return false;
  if (value.gateway === undefined) return true;
  const gateway = value.gateway;
  return isRecord(gateway) && typeof gateway.source === "string" && /^[a-z0-9_-]+$/i.test(gateway.source) &&
    isRemoteId(gateway.trackId) &&
    (gateway.picId === undefined || gateway.picId === "" || isRemoteId(gateway.picId)) &&
    (gateway.lyricId === undefined || gateway.lyricId === "" || isRemoteId(gateway.lyricId));
}

function initialRoute(song: MusicInfo): RoutedCandidate["route"] {
  if (!song.gateway) return "direct";
  // 当前官方网易 mapper 总会填 interval，并附同 ID 的 netease gateway；有 gateway 不等于已做网关召回。
  const officialWy = song.source === "wy" && song.gateway.source === "netease" &&
    song.gateway.trackId === song.id && typeof song.interval === "number";
  return officialWy ? "direct" : "gateway";
}

function namespace(candidate: RoutedCandidate): string {
  return candidate.route === "gateway"
    ? `${candidate.song.source}:gateway:${candidate.song.gateway!.source}`
    : `${candidate.song.source}:direct`;
}

function candidateKey(candidate: RoutedCandidate): string {
  const id = candidate.route === "gateway" ? candidate.song.gateway!.trackId : candidate.song.id;
  return JSON.stringify([namespace(candidate), id]);
}

function coverKey(candidate: RoutedCandidate): string {
  const song = candidate.song;
  if (!song.picUrl && !song.img && !song.gateway?.picId) return candidateKey(candidate);
  // 图片请求的真实身份是 URL 或 gateway source/picId，不是召回的 direct/gateway 路径。
  return JSON.stringify([song.picUrl || null, song.img || null, song.gateway?.source, song.gateway?.picId, COVER_SIZE]);
}

function cachedAssets(candidate: RoutedCandidate, context: LookupContext): CandidateAssets {
  return { lyrics: context.lyrics.get(candidateKey(candidate)), cover: context.covers.get(coverKey(candidate)) };
}

async function recall(source: OnlineSource, keyword: string, gatewayOnly = false): Promise<{ candidates: RoutedCandidate[]; issues: string[] }> {
  const label = gatewayOnly ? `${source}:gateway:search` : `${source}:search`;
  try {
    const result: unknown = await (gatewayOnly ? searchGatewaySongs(source, keyword) : searchSongs(source, keyword));
    if (!Array.isArray(result)) return { candidates: [], issues: [`${label}:invalid-response`] };
    const songs = result.filter((item): item is MusicInfo => isOnlineCandidate(item, source) && (!gatewayOnly || Boolean(item.gateway)));
    const issues = songs.length !== result.length ? [`${label}:invalid-candidate`] : [];
    if (!result.length) issues.push(`${label}:empty`);
    return {
      candidates: songs.map(song => ({ song: { ...song }, route: gatewayOnly ? "gateway" : initialRoute(song) })),
      issues,
    };
  } catch {
    // 不拼接上游异常：其中可能包含请求凭证、签名 URL 或本地路径。
    return { candidates: [], issues: [`${label}:failed`] };
  }
}

function onlineIdentity(song: MusicInfo): MusicInfo {
  // 不携带本地歌词、音频路径或 variants；原生 ID 与网关 ID 始终各自保留。
  return {
    source: song.source, id: song.id, name: song.name, singer: song.singer,
    albumName: song.albumName, interval: song.interval,
    gateway: song.gateway ? { ...song.gateway } : undefined,
    txMeta: song.txMeta ? { ...song.txMeta } : undefined,
  };
}

async function readLyrics(candidate: RoutedCandidate): Promise<AssetResult<LyricLine[]>> {
  const label = namespace(candidate);
  try {
    const read = candidate.route === "gateway" ? getGatewayLyrics : getLyrics;
    const lines: unknown = await read(onlineIdentity(candidate.song));
    if (!Array.isArray(lines) || lines.some(line => !isRecord(line) ||
      typeof line.time !== "number" || !Number.isFinite(line.time) || line.time < 0 || typeof line.text !== "string")) {
      return { issues: [`${label}:lyrics:invalid-response`] };
    }
    if (!lines.some(line => line.text.trim())) return { issues: [`${label}:lyrics:missing`] };
    return { value: lines, issues: [] };
  } catch {
    return { issues: [`${label}:lyrics:failed`] };
  }
}

function httpUrl(value: unknown): string | undefined {
  const url = typeof value === "string" ? value.trim() : value;
  return isHttpMediaUrl(url) ? url : undefined;
}

async function readCover(candidate: RoutedCandidate): Promise<AssetResult<string>> {
  const song = candidate.song;
  const label = namespace(candidate);
  const issues: string[] = [];
  for (const cover of [song.picUrl, song.img]) {
    if (!cover) continue;
    const url = httpUrl(cover);
    if (url) return { value: url, issues };
    issues.push(`${label}:cover:invalid-url`);
  }
  const gateway = song.gateway;
  if (!gateway?.picId?.trim()) return { issues: [...issues, `${label}:cover:missing`] };
  try {
    // 只消费搜索结果的真实 picId，不用歌曲 ID 猜测图片，更不把 QQ ID 转成 joox。
    const response = await fetchWithTimeout(buildBuiltinMusicApiUrl({
      type: "pic", source: gateway.source, id: gateway.picId, size: COVER_SIZE,
    }), { headers: { Accept: "application/json" } }, COVER_TIMEOUT_MS);
    if (!response.ok) return { issues: [...issues, `${label}:cover:http-${response.status}`] };
    // 实测 pic 为顶层 { url, from } JSON；不把接口地址或未知嵌套字段当图片。
    const body: unknown = await response.json();
    if (!isRecord(body)) return { issues: [...issues, `${label}:cover:invalid-response`] };
    const url = httpUrl(body.url);
    if (!url) return { issues: [...issues, `${label}:cover:${body.url ? "invalid-url" : "missing"}`] };
    return { value: url, issues };
  } catch {
    return { issues: [...issues, `${label}:cover:failed`] };
  }
}


function hasNeededAssets(result: LocalMediaAssets, needs: AssetNeeds): boolean {
  return result.status === "matched" && (!needs.lyrics || Boolean(result.lyrics)) && (!needs.cover || Boolean(result.coverUrl));
}

function withAssets(result: LocalMediaAssets, assets?: CandidateAssets): LocalMediaAssets {
  return {
    ...result,
    ...(!result.lyrics && assets?.lyrics?.value ? { lyrics: assets.lyrics.value } : {}),
    ...(!result.coverUrl && assets?.cover?.value ? { coverUrl: assets.cover.value } : {}),
  };
}

async function readAssets(candidate: RoutedCandidate, needs: AssetNeeds, context: LookupContext): Promise<CandidateAssets> {
  const previous = cachedAssets(candidate, context);
  const [lyrics, cover] = await Promise.all([
    needs.lyrics && !previous?.lyrics ? readLyrics(candidate) : undefined,
    needs.cover && !previous?.cover ? readCover(candidate) : undefined,
  ]);
  if (lyrics) {
    context.issues.push(...lyrics.issues);
    context.lyrics.set(candidateKey(candidate), lyrics);
  }
  if (cover) {
    context.issues.push(...cover.issues);
    context.covers.set(coverKey(candidate), cover);
  }
  return cachedAssets(candidate, context);
}

async function resolveCandidates(song: MusicInfo, candidates: RoutedCandidate[], context: LookupContext): Promise<LocalMediaAssets> {
  const selection = selectLocalMediaMatch(song, candidates.map(candidate => candidate.song));
  context.issues.push(...selection.issues);
  if (selection.status !== "matched") return { status: selection.status, issues: [...context.issues] };

  const bySong = new Map(candidates.map(candidate => [candidate.song, candidate]));
  const group = selection.candidates.map(song => bySong.get(song)!);
  const primary = group[0].song;
  let result: LocalMediaAssets = {
    status: "matched",
    candidate: { source: primary.source, id: primary.id, name: primary.name, singer: primary.singer,
      ...(primary.gateway ? { gatewaySource: primary.gateway.source, gatewayTrackId: primary.gateway.trackId } : {}) },
    issues: context.issues,
  };
  // 每次重判重新组装返回值；只复用当前胜出组的同 namespace/track 结果，落选身份的部分资料不会泄漏。
  for (const candidate of group) result = withAssets(result, cachedAssets(candidate, context));
  const attemptedNamespaces = new Set<string>();
  for (const candidate of group) {
    if (hasNeededAssets(result, context.needs)) break;
    const key = namespace(candidate);
    if (attemptedNamespaces.has(key)) continue;
    if (attemptedNamespaces.size === MAX_ASSET_NAMESPACES_PER_ROUND) {
      context.issues.push("assets:namespace-attempt-limit");
      break;
    }
    attemptedNamespaces.add(key);
    const assets = await readAssets(candidate, {
      lyrics: context.needs.lyrics && !result.lyrics,
      cover: context.needs.cover && !result.coverUrl,
    }, context);
    result = withAssets(result, assets);
  }
  return { ...result, issues: [...context.issues] };
}

/**
 * 初始双源搜索后，未匹配或资料不足时最多追加一轮网关搜索，每源最多一次。
 * 两轮均严格重判全体候选；每轮至多四个 namespace 各尝试一位可靠候选，已取结果只在本次调用复用。
 * 服务层至多四次搜索、十六次内容调用，不分页；musicApi 内部直连/网关请求由它管理。
 */
export async function findLocalMediaAssets(
  song: MusicInfo,
  needs: { lyrics: boolean; cover: boolean },
): Promise<LocalMediaAssets> {
  if (!needs.lyrics && !needs.cover) return { status: "not-found", issues: ["request:no-assets-needed"] };
  if (!song || typeof song.name !== "string" || !song.name.trim() ||
      typeof song.singer !== "string" || typeof song.albumName !== "string") {
    return { status: "not-found", issues: ["request:invalid-metadata"] };
  }
  const searches = await Promise.all(SOURCES.map(source => recall(source, song.name.trim())));
  const candidates = searches.flatMap(result => result.candidates);
  const context: LookupContext = { needs, issues: searches.flatMap(result => result.issues), lyrics: new Map(), covers: new Map() };
  const initial = await resolveCandidates(song, candidates, context);
  if (hasNeededAssets(initial, needs)) return initial;

  const searchedGateways = new Set(candidates.filter(candidate => candidate.route === "gateway").map(candidate => candidate.song.source));
  const remainingSources = SOURCES.filter(source => !searchedGateways.has(source));
  if (!remainingSources.length) return initial;
  const gateways = await Promise.all(remainingSources.map(source => recall(source, song.name.trim(), true)));
  context.issues.push(...gateways.flatMap(result => result.issues));
  return resolveCandidates(song, [...candidates, ...gateways.flatMap(result => result.candidates)], context);
}
