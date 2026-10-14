import { isHttpMediaUrl } from "@/utils/mediaUrl";
import {
  buildBuiltinMusicApiUrl,
  hasOriginalPerformerCandidate,
  selectLocalMediaMatch,
  type LyricLine,
  type MusicInfo,
  type OtherPerformerCandidate,
} from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { LRCLIB_ORIGIN_SOURCE, readLrclibLyrics, type LrclibLyricsResult } from "./lrclibLyricsService";
import { getGatewayLyrics, getLyrics, searchGatewaySongs, searchSongs } from "./musicApi";

/** 歌词来源标注：只用于 UI 提示，不参与缓存键——缓存键仍是歌曲身份 + 文件签名。 */
export interface LocalMediaLyricOrigin {
  tier: "same-recording" | "other-performer";
  /** 仅 tier=other-performer：采用版本的演唱者，UI 必须标注出来。 */
  performer?: string;
  /** 歌词实际来源：`lrclib`，或候选所在的平台（wy/tx）。 */
  source?: string;
}
/** 证据不足（corroboration="none"）的异唱候选：不自动采用，只摆出来供人工挑选。 */
export interface LocalMediaAlternative {
  source: string;
  id: string;
  name: string;
  performer: string;
  durationDeltaSeconds: number;
}

export interface LocalMediaAssets {
  status: "matched" | "not-found" | "ambiguous";
  lyrics?: LyricLine[];
  coverUrl?: string;
  candidate?: { source: string; id: string; name: string; singer: string; gatewaySource?: string; gatewayTrackId?: string };
  issues: string[];
  lyricOrigin?: LocalMediaLyricOrigin;
  alternatives?: LocalMediaAlternative[];
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

/**
 * core 保证判定的结果是传入的同一批对象引用，这里据此用 Map 反查 direct/gateway 路由信息；
 * 反查不到（理论上不会发生）时丢弃该条，绝不合成没有路由的身份。
 */
function routedGroup(candidates: RoutedCandidate[], songs: MusicInfo[]): RoutedCandidate[] {
  const bySong = new Map(candidates.map(candidate => [candidate.song, candidate]));
  return songs.map(song => bySong.get(song)).filter((candidate): candidate is RoutedCandidate => Boolean(candidate));
}

/** 为已判定的候选组取歌词与封面；身份信息与资料只从这一组里来，落选身份的部分资料不会泄漏。 */
async function adoptGroup(group: RoutedCandidate[], context: LookupContext, base: LocalMediaAssets): Promise<LocalMediaAssets> {
  const primary = group[0].song;
  let result: LocalMediaAssets = {
    ...base,
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

/** 每轮都严格重判全体候选：此处只走同一录音档（不传 options），同曲异唱由 finalizeMatch 兜底。 */
async function resolveCandidates(song: MusicInfo, candidates: RoutedCandidate[], context: LookupContext): Promise<LocalMediaAssets> {
  const selection = selectLocalMediaMatch(song, candidates.map(candidate => candidate.song));
  context.issues.push(...selection.issues);
  if (selection.status !== "matched") return { status: selection.status, issues: [...context.issues] };
  const group = routedGroup(candidates, selection.candidates);
  if (!group.length) return { status: "not-found", issues: [...context.issues] };
  return adoptGroup(group, context, { status: "matched", issues: [] });
}

function exposeAlternatives(items: OtherPerformerCandidate[]): LocalMediaAlternative[] {
  return items.map(item => ({
    source: item.song.source, id: item.song.id, name: item.song.name,
    performer: item.performer, durationDeltaSeconds: item.durationDeltaSeconds,
  }));
}

/**
 * 两轮搜索都没能落到「同一录音」时，才允许同曲异唱档介入——必须是所有轮次穷尽后的最后手段。
 *
 * 为什么不能提前：翻唱版本一旦提前参与，就会抢在原唱之前胜出——原唱在平台上仍可得时必须继续用它
 * （回归用例「官方非空但全是翻唱，含 gateway 的网易官方结果也不阻止补查」钉住了这一点）。
 * 自动采用还要求 core 判定出真实证据（corroboration !== "none"）：证据不足时只暴露
 * alternatives 供人工挑选，绝不把「同名 + 歌手不同 + 时长接近」直接当成本曲的歌词。
 */
async function finalizeMatch(
  song: MusicInfo,
  pooled: RoutedCandidate[],
  context: LookupContext,
  result: LocalMediaAssets,
): Promise<LocalMediaAssets> {
  if (result.status === "matched") return result;
  const songs = pooled.map(candidate => candidate.song);
  const selection = selectLocalMediaMatch(song, songs, {
    // 「原唱不可得」是必要条件：召回里只要有一条与本地同演唱者的候选，就不得启用异唱档。
    originalPerformerUnavailable: !hasOriginalPerformerCandidate(song, songs),
  });
  const alternatives = selection.alternatives?.length ? exposeAlternatives(selection.alternatives) : undefined;
  const adoptedSong = selection.status === "matched" && selection.tier === "other-performer"
    ? selection.candidates[0] : undefined;
  const adopted = adoptedSong ? new Map(pooled.map(candidate => [candidate.song, candidate])).get(adoptedSong) : undefined;
  if (!adopted) return alternatives ? { ...result, alternatives } : result;
  context.issues.push(...selection.issues);
  return adoptGroup([adopted], context, {
    status: "matched",
    issues: [],
    lyricOrigin: {
      tier: "other-performer",
      ...(selection.performer ? { performer: selection.performer } : {}),
      source: adopted.song.source,
    },
    ...(alternatives ? { alternatives } : {}),
  });
}

/**
 * 两轮在线搜索：官方直连先行，未匹配或资料不足时每源最多再补一轮网关搜索。
 * 两轮均严格重判全体候选；每轮至多四个 namespace 各尝试一位可靠候选，已取结果只在本次调用复用。
 * 服务层至多四次搜索、十六次内容调用，不分页；musicApi 内部直连/网关请求由它管理。
 */
async function searchOnlineAssets(song: MusicInfo, needs: AssetNeeds): Promise<LocalMediaAssets> {
  const keyword = song.name.trim();
  const searches = await Promise.all(SOURCES.map(source => recall(source, keyword)));
  const candidates = searches.flatMap(result => result.candidates);
  const context: LookupContext = { needs, issues: searches.flatMap(result => result.issues), lyrics: new Map(), covers: new Map() };
  const initial = await resolveCandidates(song, candidates, context);
  if (hasNeededAssets(initial, needs)) return initial;

  const searchedGateways = new Set(candidates.filter(candidate => candidate.route === "gateway").map(candidate => candidate.song.source));
  const remainingSources = SOURCES.filter(source => !searchedGateways.has(source));
  if (!remainingSources.length) return finalizeMatch(song, candidates, context, initial);
  const gateways = await Promise.all(remainingSources.map(source => recall(source, keyword, true)));
  context.issues.push(...gateways.flatMap(result => result.issues));
  const pooled = [...candidates, ...gateways.flatMap(result => result.candidates)];
  return finalizeMatch(song, pooled, context, await resolveCandidates(song, pooled, context));
}

/** LRCLIB 命中结果 -> 直接可用的补全结果（歌词只有它，封面是搜索链的活）。 */
async function withLrclibLyrics(
  song: MusicInfo,
  hit: Extract<LrclibLyricsResult, { kind: "lyrics" }>,
  needs: AssetNeeds,
): Promise<LocalMediaAssets> {
  const lyricOrigin: LocalMediaLyricOrigin = { tier: "same-recording", source: LRCLIB_ORIGIN_SOURCE };
  // 不再走 wy/tx：LRCLIB 按歌名 + 歌手 + 时长直查，比「先搜歌再判身份」更准。
  if (!needs.cover) return { status: "matched", lyrics: hit.lines, lyricOrigin, issues: [] };
  // 封面只有搜索链能提供；歌词已经确定，因此这一轮只为封面搜索。
  const covered = await searchOnlineAssets(song, { lyrics: false, cover: true });
  return {
    // 歌词已经拿到就算 matched：这一档的「缺封面」由 assets 层按 partial 处理，
    // 搜索层的状态字面只有 matched / not-found / ambiguous。
    status: "matched",
    lyrics: hit.lines,
    coverUrl: covered.coverUrl,
    candidate: covered.candidate,
    lyricOrigin,
    issues: covered.issues,
  };
}

/**
 * 本地曲缺失资料的只读补全：先问 LRCLIB，再走 wy/tx 两轮搜索。
 * 任何一步失败都只是「这次没补到」，绝不抛出——歌词与封面都是派生资料，不影响播放。
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
  if (needs.lyrics) {
    // LRCLIB 只是「更准的一条路」：任何失败（超时 / 限流 / 结构不符）都与 404 一样静默降级到搜索链。
    let hit: LrclibLyricsResult = null;
    try { hit = await readLrclibLyrics(song); } catch { hit = null; }
    if (hit?.kind === "lyrics") return withLrclibLyrics(song, hit, needs);
    if (hit?.kind === "instrumental") {
      // 纯音乐是 LRCLIB 给出的明确结论：不再为歌词搜索（对齐桌面端语义）；
      // 封面与歌词无关，仍有封面需求时照旧走搜索链，无封面需求则直接结束。
      if (!needs.cover) return { status: "not-found", issues: ["lrclib:instrumental"] };
      const covered = await searchOnlineAssets(song, { lyrics: false, cover: true });
      return { ...covered, issues: [...covered.issues, "lrclib:instrumental"] };
    }
  }
  return searchOnlineAssets(song, needs);
}
