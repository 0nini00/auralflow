import {
  durationDeltaSeconds,
  hasOriginalPerformerCandidate,
  parseLyricSource,
  selectLocalMediaMatch,
  type LocalMatchTier,
  type LyricLine,
  type MusicInfo,
  type OtherPerformerCandidate,
} from "@lx/core";
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
  candidate?: { source: string; id: string; name: string; singer: string; gatewaySource?: string; gatewayTrackId?: string };
  issues: string[];
  lyricOrigin?: LocalMediaLyricOrigin;
  alternatives?: LocalMediaAlternative[];
}

/** 「选择歌词」面板的候选来源展示名。 */
export const LOCAL_LYRICS_CANDIDATE_LABELS = {
  local: "本地文件", lrclib: "LRCLIB", wy: "网易云", tx: "QQ音乐",
} as const;

export type LocalLyricsCandidateKind = keyof typeof LOCAL_LYRICS_CANDIDATE_LABELS;

/**
 * 一条可选的歌词候选。
 *
 * `lines` 是已经取到的歌词（本地 / LRCLIB / 面板预览过的平台候选），点选后不必再取一次；
 * `identity` 只在没预先取到时用于点击后取词。
 */
export interface LocalLyricsCandidate {
  /** 稳定键：同一份候选在面板重新加载后仍是同一项。 */
  key: string;
  kind: LocalLyricsCandidateKind;
  sourceLabel: string;
  name: string;
  singer: string;
  albumName: string;
  /** 与本地时长的差值（秒）；没有可比时长时缺省。 */
  durationDeltaSeconds?: number;
  /** 首行预览；平台候选未必预先取到，缺省时由 UI 提示。 */
  preview?: string;
  /** core 的档位判定，只用于排序与标注（同一录音档 / 同曲异唱档），不用于隐藏候选。 */
  tier?: LocalMatchTier;
  lines?: LyricLine[];
  identity?: { song: MusicInfo; route: "direct" | "gateway" };
}

type OnlineSource = "wy" | "tx";
interface AssetResult<T> { value?: T; issues: string[] }
interface RoutedCandidate { song: MusicInfo; route: "direct" | "gateway" }
interface LookupContext {
  issues: string[];
  lyrics: Map<string, AssetResult<LyricLine[]>>;
}

const SOURCES: readonly OnlineSource[] = ["wy", "tx"];
const MAX_ASSET_NAMESPACES_PER_ROUND = 4;
/**
 * 面板一次打开最多为多少条平台候选预取歌词首行。
 *
 * 候选本身不做隐藏（用户要能自己判断），但首行预览需要真的取一次词；面板是用户主动触发的一次性
 * 操作，取前 N 条足够看清「是不是这一首」，再多就是替用户浪费平台配额。
 */
const MAX_CANDIDATE_PREVIEWS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRemoteId(value: unknown): value is string {
  // 歌曲/歌词 ID 是不透明标识，不接受本地路径、URI 或控制字符。
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

function cachedLyrics(candidate: RoutedCandidate, context: LookupContext): AssetResult<LyricLine[]> | undefined {
  return context.lyrics.get(candidateKey(candidate));
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

function hasLyrics(result: LocalMediaAssets): boolean {
  return result.status === "matched" && Boolean(result.lyrics);
}

function withLyrics(result: LocalMediaAssets, assets?: AssetResult<LyricLine[]>): LocalMediaAssets {
  return {
    ...result,
    ...(!result.lyrics && assets?.value ? { lyrics: assets.value } : {}),
  };
}

async function readAssets(candidate: RoutedCandidate, context: LookupContext): Promise<AssetResult<LyricLine[]>> {
  const previous = cachedLyrics(candidate, context);
  if (previous) return previous;
  const lyrics = await readLyrics(candidate);
  context.issues.push(...lyrics.issues);
  context.lyrics.set(candidateKey(candidate), lyrics);
  return lyrics;
}

/**
 * core 保证判定的结果是传入的同一批对象引用，这里据此用 Map 反查 direct/gateway 路由信息；
 * 反查不到（理论上不会发生）时丢弃该条，绝不合成没有路由的身份。
 */
function routedGroup(candidates: RoutedCandidate[], songs: MusicInfo[]): RoutedCandidate[] {
  const bySong = new Map(candidates.map(candidate => [candidate.song, candidate]));
  return songs.map(song => bySong.get(song)).filter((candidate): candidate is RoutedCandidate => Boolean(candidate));
}

/** 为已判定的候选组取歌词；身份信息与资料只从这一组里来，落选身份的部分资料不会泄漏。 */
async function adoptGroup(group: RoutedCandidate[], context: LookupContext, base: LocalMediaAssets): Promise<LocalMediaAssets> {
  const primary = group[0].song;
  let result: LocalMediaAssets = {
    ...base,
    candidate: { source: primary.source, id: primary.id, name: primary.name, singer: primary.singer,
      ...(primary.gateway ? { gatewaySource: primary.gateway.source, gatewayTrackId: primary.gateway.trackId } : {}) },
    issues: context.issues,
  };
  // 每次重判重新组装返回值；只复用当前胜出组的同 namespace/track 结果，落选身份的部分资料不会泄漏。
  for (const candidate of group) result = withLyrics(result, cachedLyrics(candidate, context));
  const attemptedNamespaces = new Set<string>();
  for (const candidate of group) {
    if (hasLyrics(result)) break;
    const key = namespace(candidate);
    if (attemptedNamespaces.has(key)) continue;
    if (attemptedNamespaces.size === MAX_ASSET_NAMESPACES_PER_ROUND) {
      context.issues.push("assets:namespace-attempt-limit");
      break;
    }
    attemptedNamespaces.add(key);
    result = withLyrics(result, await readAssets(candidate, context));
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
async function searchOnlineAssets(song: MusicInfo): Promise<LocalMediaAssets> {
  const keyword = song.name.trim();
  const searches = await Promise.all(SOURCES.map(source => recall(source, keyword)));
  const candidates = searches.flatMap(result => result.candidates);
  const context: LookupContext = { issues: searches.flatMap(result => result.issues), lyrics: new Map() };
  const initial = await resolveCandidates(song, candidates, context);
  if (hasLyrics(initial)) return initial;

  const searchedGateways = new Set(candidates.filter(candidate => candidate.route === "gateway").map(candidate => candidate.song.source));
  const remainingSources = SOURCES.filter(source => !searchedGateways.has(source));
  if (!remainingSources.length) return finalizeMatch(song, candidates, context, initial);
  const gateways = await Promise.all(remainingSources.map(source => recall(source, keyword, true)));
  context.issues.push(...gateways.flatMap(result => result.issues));
  const pooled = [...candidates, ...gateways.flatMap(result => result.candidates)];
  return finalizeMatch(song, pooled, context, await resolveCandidates(song, pooled, context));
}

/**
 * 本地曲缺失歌词的只读补全：先问 LRCLIB，再走 wy/tx 两轮搜索。
 * 任何一步失败都只是「这次没补到」，绝不抛出——歌词是派生资料，不影响播放。
 *
 * 只补歌词：本地曲封面只来自音频文件自己的内嵌标签与同目录旁挂图，服务层不再为封面联网。
 */
export async function findLocalMediaAssets(song: MusicInfo): Promise<LocalMediaAssets> {
  if (!song || typeof song.name !== "string" || !song.name.trim() ||
      typeof song.singer !== "string" || typeof song.albumName !== "string") {
    return { status: "not-found", issues: ["request:invalid-metadata"] };
  }
  // LRCLIB 只是「更准的一条路」：任何失败（超时 / 限流 / 结构不符）都与 404 一样静默降级到搜索链。
  let hit: LrclibLyricsResult = null;
  try { hit = await readLrclibLyrics(song); } catch { hit = null; }
  if (hit?.kind === "lyrics") {
    // 不再走 wy/tx：LRCLIB 按歌名 + 歌手 + 时长直查，比「先搜歌再判身份」更准。
    return { status: "matched", lyrics: hit.lines, lyricOrigin: { tier: "same-recording", source: LRCLIB_ORIGIN_SOURCE }, issues: [] };
  }
  // 纯音乐是 LRCLIB 给出的明确结论：不再为歌词搜索（对齐桌面端语义）。
  if (hit?.kind === "instrumental") return { status: "not-found", issues: ["lrclib:instrumental"] };
  return searchOnlineAssets(song);
}

/** 首行预览：跳过纯空白行，取第一行有内容的文本。 */
function previewOf(lines: LyricLine[]): string | undefined {
  return lines.find(line => line.text.trim())?.text.trim() || undefined;
}

/**
 * 逐条重判档位。
 *
 * 用 core 的判定结果**排序并标注**「同一录音档 / 同曲异唱档」，但不据此隐藏任何候选：
 * 平台召回的质量不由本层担保，用户要能自己看到并选择（例如原唱下架时的翻唱版本）。
 */
function annotateTier(song: MusicInfo, candidate: MusicInfo): LocalMatchTier | undefined {
  const verdict = selectLocalMediaMatch(song, [candidate], { originalPerformerUnavailable: true });
  // 证据不足时 core 只把候选列进 alternatives（不自动采用）；对用户来说它仍然是「同曲异唱档」。
  return verdict.tier ?? (verdict.alternatives?.length ? "other-performer" : undefined);
}

function durationGap(song: MusicInfo, candidate: MusicInfo): number | undefined {
  const delta = durationDeltaSeconds(song, candidate);
  return delta === null ? undefined : Math.abs(delta);
}

/** 同一份真实身份可能在直连与网关两轮里各召回一次：按 namespace + 真实 ID 去重。 */
function dedupeCandidates(candidates: RoutedCandidate[]): RoutedCandidate[] {
  const unique = new Map<string, RoutedCandidate>();
  for (const candidate of candidates) unique.set(candidateKey(candidate), candidate);
  return [...unique.values()];
}

/**
 * 「选择歌词」面板的候选列表：本地已有（内嵌 / 旁挂 .lrc / 按曲文本）、LRCLIB、平台搜索（wy/tx）。
 *
 * 与自动补全的区别：这里**不挑一个胜者**，而是把平台召回整体摆出来，只做排序与档位标注，让用户
 * 自己判断哪一份是对的；搜索失败只回流 issues，候选列表仍然可用（离线至少还有本地那一档）。
 */
export async function findLocalLyricsCandidates(
  song: MusicInfo,
  input: { localText?: string } = {},
): Promise<{ candidates: LocalLyricsCandidate[]; issues: string[] }> {
  const candidates: LocalLyricsCandidate[] = [];
  // 面板每次重新加载都是一次独立请求：已取到的词只在本次调用里复用，不跨轮次留缓存。
  const context: LookupContext = { issues: [], lyrics: new Map() };
  const issues: string[] = context.issues;
  if (!song || typeof song.name !== "string" || !song.name.trim()) {
    return { candidates, issues: ["request:invalid-metadata"] };
  }

  // 本地已有必须排在最前：离线也能选它（含「不要匹配」这条退路）。
  const localText = input.localText?.trim() || song.localLyrics?.trim() || "";
  if (localText) {
    const lines = parseLyricSource({ type: "auto", content: localText });
    if (lines.length) {
      candidates.push({
        key: "local", kind: "local", sourceLabel: LOCAL_LYRICS_CANDIDATE_LABELS.local,
        name: song.name, singer: song.singer, albumName: song.albumName,
        preview: previewOf(lines), lines,
      });
    }
  }

  let hit: LrclibLyricsResult = null;
  try { hit = await readLrclibLyrics(song); } catch { hit = null; }
  if (hit?.kind === "lyrics") {
    candidates.push({
      key: "lrclib", kind: "lrclib", sourceLabel: LOCAL_LYRICS_CANDIDATE_LABELS.lrclib,
      name: song.name, singer: song.singer, albumName: song.albumName,
      preview: previewOf(hit.lines), lines: hit.lines,
    });
  } else if (hit?.kind === "instrumental") {
    issues.push("lrclib:instrumental");
  }

  const keyword = song.name.trim();
  // 两轮召回：候选列表宁可多一轮，也不因为「官方直连只返回翻唱」就把原唱藏起来。
  const rounds = await Promise.all([
    ...SOURCES.map(source => recall(source, keyword)),
    ...SOURCES.map(source => recall(source, keyword, true)),
  ]);
  issues.push(...rounds.flatMap(round => round.issues));
  const pooled = dedupeCandidates(rounds.flatMap(round => round.candidates));
  const ranked = pooled
    .map(candidate => ({ candidate, tier: annotateTier(song, candidate.song) }))
    .sort((a, b) => {
      const tierRank = (tier?: LocalMatchTier) => (tier === "same-recording" ? 0 : tier === "other-performer" ? 1 : 2);
      return tierRank(a.tier) - tierRank(b.tier) ||
        (durationGap(song, a.candidate.song) ?? Number.POSITIVE_INFINITY) -
          (durationGap(song, b.candidate.song) ?? Number.POSITIVE_INFINITY) ||
        Number(a.candidate.song.source !== "wy") - Number(b.candidate.song.source !== "wy") ||
        a.candidate.song.id.localeCompare(b.candidate.song.id);
    });

  const withPreviews: LocalLyricsCandidate[] = [];
  for (const [index, item] of ranked.entries()) {
    // recall 只接受 wy/tx，因此这里只有这两种平台来源。
    const kind: LocalLyricsCandidateKind = item.candidate.song.source === "tx" ? "tx" : "wy";
    const gap = durationGap(song, item.candidate.song);
    const online: LocalLyricsCandidate = {
      key: candidateKey(item.candidate), kind,
      sourceLabel: LOCAL_LYRICS_CANDIDATE_LABELS[kind],
      name: item.candidate.song.name, singer: item.candidate.song.singer, albumName: item.candidate.song.albumName,
      ...(gap !== undefined ? { durationDeltaSeconds: gap } : {}),
      ...(item.tier ? { tier: item.tier } : {}),
      identity: { song: onlineIdentity(item.candidate.song), route: item.candidate.route },
    };
    // 预览预算只给最靠前的几条：取不到就留空，点选时再取（见 readLyricsCandidateLines）。
    const preview = index < MAX_CANDIDATE_PREVIEWS
      ? await readAssets(item.candidate, context)
      : undefined;
    if (preview?.value) withPreviews.push({ ...online, lines: preview.value, preview: previewOf(preview.value) });
    else withPreviews.push(online);
  }
  return { candidates: [...candidates, ...withPreviews], issues };
}

/** 点选候选时才取歌词：面板预览没覆盖到的候选（超出预览上限或预览取词失败）走这里。 */
export async function readLyricsCandidateLines(candidate: LocalLyricsCandidate): Promise<LyricLine[]> {
  if (candidate.lines?.length) return candidate.lines;
  if (!candidate.identity) return [];
  const result = await readLyrics({ song: candidate.identity.song, route: candidate.identity.route });
  return result.value ?? [];
}
