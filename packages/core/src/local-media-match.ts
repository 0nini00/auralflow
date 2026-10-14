import type { MusicInfo } from "./sources/types";

/**
 * 本地文件 → 在线候选的择优判定（歌词与封面共用）。
 *
 * 两档结论：
 * - `same-recording`：同一录音（歌名 / 版本 / 演唱者 / 时长都对得上）→ 调用方可静默采信。
 * - `other-performer`：同曲异唱。原唱在平台上不可得（下架、无版权）但别人唱过同一首歌时，
 *   用它补歌词/封面。只在调用方明确声明「原唱不可得」时产出，且必须带证据、UI 必须标注来源。
 *
 * 为什么收在这里：同一首歌两端必须给出相同答案，而此前两端各有一套且互相矛盾——
 * 移动端是硬否决（歌名不全等就丢弃，导致原唱下架时永远匹配不到），桌面端是加权打分
 * （歌名对得上就给 56 分，阈值 28 分，于是「同名不同曲」也能过，还会因为歌词「看起来更好」
 * 而在混合评分里胜出）。收敛到 core 后由单测钉住，两端只负责取候选与呈现。
 */

/** 时长差 ≤2s 视为「同一录音」（沿用移动端既有口径）。 */
const CLOSE_DURATION_SECONDS = 2;
/** 时长差 >5s 视为硬冲突：不可能是同一首歌。 */
const CONFLICT_DURATION_SECONDS = 5;
/**
 * 同曲异唱的时长窗。翻唱几乎同速，所以「同一首歌的两个录音」才会落进这么窄的区间；
 * 「同名不同歌」的时长是随机分布，这一条就能挡掉绝大多数误配。
 */
export const OTHER_PERFORMER_MAX_DURATION_DELTA_SECONDS = 3;
/** 时长差 ≤1s 视为同一份录音素材（换名重传 / 直接翻录），单独构成强证据。 */
export const OTHER_PERFORMER_STRONG_DURATION_DELTA_SECONDS = 1;

const ARTIST_SCORE = 6;
const DURATION_SCORE = 3;
const ALBUM_SCORE = 2;
/** 冠军必须领先第二名录音组这么多分，否则判歧义。 */
const MIN_SCORE_LEAD = 3;

const UNKNOWN_METADATA = new Set([
  "", "未知", "未知歌手", "未知艺术家", "未知艺人", "未知专辑", "未知歌手名",
  "unknown", "unknownartist", "unknownsinger", "unknownalbum", "artist", "album",
  "群星", "various", "variousartists", "va", "na", "null", "undefined", "none",
]);

const VERSION_MARKERS = [
  /\blive\b|现场|現場|演唱会|演唱會/i,
  /\binstrumental\b|\bkaraoke\b|伴奏/i,
  /\bcover\b|翻唱/i,
  /\bre[\s-]?record(?:ed|ing)?\b|重录|重錄/i,
  /\bremaster(?:ed)?\b|重制|重製/i,
  /\bremix\b|混音/i,
  /\bacoustic\b|不插电|不插電/i,
  /\bdemo\b|小样|小樣/i,
];

// 只折叠字形、大小写和排版；括号里的版本文字不会被剥离。
function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

function metadataKey(value: string): string {
  const key = normalizeText(value);
  return UNKNOWN_METADATA.has(key) ? "" : key;
}

function artistIdentity(value: string): { key: string; complete: boolean } {
  if (!metadataKey(value)) return { key: "", complete: false };
  const artists = value.normalize("NFKC").split(/[/、,，;&]+/).map(metadataKey);
  // 部分缺失不能抹掉已知歌手，也不能作为完整名单加分。
  return {
    key: [...new Set(artists.filter(Boolean))].sort().join("|"),
    complete: artists.every(Boolean),
  };
}

function versionKey(song: MusicInfo): string {
  const text = `${song.name}\n${song.albumName}`.normalize("NFKC");
  return VERSION_MARKERS.map(marker => Number(marker.test(text))).join("");
}

function splitArtistTokens(value: string): string[] {
  return value.normalize("NFKC").split(/[/、,，;&]+/).map(metadataKey).filter(Boolean);
}

/**
 * 只看歌名的版本位串，供同曲异唱档使用。翻唱版本的专辑名几乎必然带「翻唱 / 伴奏」这类字眼，
 * 用「歌名 + 专辑」的位串去比会把所有翻唱候选一刀切掉；但歌名里的版本标记必须一致——
 * 本地是录音室版，就不能拿 live/伴奏 版本的歌词顶上。
 */
function titleVersionKey(song: MusicInfo): string {
  const text = song.name.normalize("NFKC");
  return VERSION_MARKERS.map(marker => Number(marker.test(text))).join("");
}

type DurationAgreement = "missing" | "close" | "near" | "conflict";

function durationSeconds(song: MusicInfo): number | null {
  const value = song.interval;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function durationAgreement(a: MusicInfo, b: MusicInfo): DurationAgreement {
  const left = durationSeconds(a);
  const right = durationSeconds(b);
  if (left === null || right === null) return "missing";
  const difference = Math.abs(left - right);
  if (difference <= CLOSE_DURATION_SECONDS) return "close";
  return difference > CONFLICT_DURATION_SECONDS ? "conflict" : "near";
}

/** 时长差的绝对值（秒）；任一侧缺时长返回 null。 */
export function durationDeltaSeconds(a: MusicInfo, b: MusicInfo): number | null {
  const left = durationSeconds(a);
  const right = durationSeconds(b);
  if (left === null || right === null) return null;
  return Math.abs(left - right);
}

interface Evidence {
  song: MusicInfo;
  score: number;
  reliable: boolean;
}

function assess(local: MusicInfo, candidate: MusicInfo): Evidence | null {
  if (normalizeText(local.name) !== normalizeText(candidate.name)) return null;
  if (versionKey(local) !== versionKey(candidate)) return null;
  const localArtist = artistIdentity(local.singer);
  const candidateArtist = artistIdentity(candidate.singer);
  if (localArtist.key && candidateArtist.key && localArtist.key !== candidateArtist.key) return null;
  const duration = durationAgreement(local, candidate);
  if (duration === "conflict") return null;
  const sameArtist = localArtist.complete && candidateArtist.complete && localArtist.key === candidateArtist.key;
  const album = metadataKey(local.albumName);
  const sameAlbum = Boolean(album && album === metadataKey(candidate.albumName));
  const closeDuration = duration === "close";
  return {
    song: candidate,
    score: Number(sameArtist) * ARTIST_SCORE + Number(closeDuration) * DURATION_SCORE + Number(sameAlbum) * ALBUM_SCORE,
    // 歌手不可用时，单独的标题、专辑或近似时长都不足以确认身份。
    reliable: sameArtist || (sameAlbum && closeDuration),
  };
}

function sameRecording(a: Evidence, b: Evidence): boolean {
  if (!a.reliable || !b.reliable) return false;
  const left = a.song;
  const right = b.song;
  if (normalizeText(left.name) !== normalizeText(right.name) || versionKey(left) !== versionKey(right)) return false;
  const leftArtist = artistIdentity(left.singer);
  const rightArtist = artistIdentity(right.singer);
  if (!leftArtist.complete || !rightArtist.complete || leftArtist.key !== rightArtist.key) return false;
  const duration = durationAgreement(left, right);
  if (duration === "conflict" || duration === "near") return false;
  const sameId = left.source === right.source && left.id === right.id &&
    left.gateway?.source === right.gateway?.source && left.gateway?.trackId === right.gateway?.trackId;
  const album = metadataKey(left.albumName);
  return sameId || Boolean(album && album === metadataKey(right.albumName));
}

function compareEvidence(a: Evidence, b: Evidence): number {
  // 只在同一录音内用来源、ID 稳定排序；它们不参与置信度或领先差距。
  return b.score - a.score || Number(a.song.source !== "wy") - Number(b.song.source !== "wy") ||
    a.song.id.localeCompare(b.song.id);
}

export type LocalMatchStatus = "matched" | "not-found" | "ambiguous";
export type LocalMatchTier = "same-recording" | "other-performer";
/**
 * 同曲异唱的证据强度：
 * - `duration`：与本地时长差 ≤1s（同一份录音素材被换了演唱者名，或直接翻录）。
 * - `cross-source`：另一个平台的候选与它歌名、版本、时长（≤2s）互相印证。
 * - `none`：只有「歌名 + 版本 + 演唱者不同 + 时长 ≤3s」，只能作为候选项交给人挑，不自动采信。
 */
export type OtherPerformerCorroboration = "duration" | "cross-source" | "none";

export interface OtherPerformerCandidate {
  /** 与传入的候选是同一对象引用，便于调用方用 Map 反查路由信息。 */
  song: MusicInfo;
  /** 演唱者，用于 UI 标注「歌词来自 X 的演唱版本」。 */
  performer: string;
  durationDeltaSeconds: number;
  corroboration: OtherPerformerCorroboration;
}

export interface LocalMatchResult {
  status: LocalMatchStatus;
  /** 同一录音组（组内来源可互换）；tier=other-performer 时只含被采用的那一条。 */
  candidates: MusicInfo[];
  issues: string[];
  tier?: LocalMatchTier;
  /** tier=other-performer：异唱版本的演唱者（UI 必须标注）。 */
  performer?: string;
  /** tier=other-performer：本地与候选的时长差（秒）。 */
  durationDeltaSeconds?: number;
  /** tier=other-performer：该候选的证据强度。 */
  corroboration?: OtherPerformerCorroboration;
  /** 可人工挑选的异唱候选（含被采用那条），按证据强度排序；仅在有候选时出现。 */
  alternatives?: OtherPerformerCandidate[];
}

export interface LocalMatchOptions {
  /**
   * 调用方是否已确认「原唱在平台上不可得」（本地歌手的录音一条都搜不到）。
   * 默认 false：保守起见不给同曲异唱档，避免用别人的演唱版本顶替原唱。
   *
   * 注意这是必要条件而非充分条件——本模块还会自己检查召回里确实没有同一演唱者的候选，
   * 因为那直接推翻「原唱不可得」这个前提。
   */
  originalPerformerUnavailable?: boolean;
}

/** 召回里是否存在「与本地有共同演唱者」的候选；用于判断原唱是否可得。 */
export function hasOriginalPerformerCandidate(local: MusicInfo, candidates: MusicInfo[]): boolean {
  const target = splitArtistTokens(local.singer);
  if (!target.length) return false;
  // 按演唱者 token 求交集，而不是比整串：本地标签常带别名（「吴亦凡/Kris」），
  // 平台上的原唱可能只署名其中一个，整串比对会把原唱误判成「不可得」而放行异唱档。
  return candidates.some((candidate) => {
    const tokens = splitArtistTokens(candidate.singer);
    return tokens.some(token => target.includes(token));
  });
}

/** 另一个平台上的候选是否与它构成同曲互证（歌名、版本一致且时长 ≤2s）。 */
function crossSourceCorroborated(candidate: MusicInfo, all: MusicInfo[]): boolean {
  const name = normalizeText(candidate.name);
  const version = versionKey(candidate);
  return all.some((other) =>
    other !== candidate &&
    other.source !== candidate.source &&
    normalizeText(other.name) === name &&
    versionKey(other) === version &&
    durationAgreement(candidate, other) === "close",
  );
}

function otherPerformerEvidence(local: MusicInfo, candidate: MusicInfo, all: MusicInfo[]): OtherPerformerCandidate | null {
  const localArtist = artistIdentity(local.singer);
  const candidateArtist = artistIdentity(candidate.singer);
  // 两侧都必须知道「谁在唱」：否则既无法证明这是异唱，也无法在 UI 上标注来源。
  if (!localArtist.key || !candidateArtist.key) return null;
  // 同一演唱者属于 same-recording 档，不该从这里进来。
  if (localArtist.key === candidateArtist.key) return null;
  if (normalizeText(local.name) !== normalizeText(candidate.name)) return null;
  if (titleVersionKey(local) !== titleVersionKey(candidate)) return null;
  const delta = durationDeltaSeconds(local, candidate);
  // 缺时长一律出局：时长是这一档唯一可靠的硬证据，缺了就无从区分「同曲」与「同名」。
  if (delta === null || delta > OTHER_PERFORMER_MAX_DURATION_DELTA_SECONDS) return null;
  const corroboration: OtherPerformerCorroboration =
    delta <= OTHER_PERFORMER_STRONG_DURATION_DELTA_SECONDS ? "duration"
      : crossSourceCorroborated(candidate, all) ? "cross-source"
        : "none";
  return {
    song: candidate,
    performer: (candidate.singer ?? "").trim(),
    durationDeltaSeconds: delta,
    corroboration,
  };
}

// 先比证据强度，再比时长接近度（更像原唱的是哪个由时长说话），最后才用 wy 优先与 id 保证稳定。
// 注意时长排在来源之前：这两条候选是两个不同的人唱的，谁更接近与平台无关。
function compareOtherPerformer(a: OtherPerformerCandidate, b: OtherPerformerCandidate): number {
  const strength = { duration: 0, "cross-source": 1, none: 2 } as const;
  return strength[a.corroboration] - strength[b.corroboration] ||
    a.durationDeltaSeconds - b.durationDeltaSeconds ||
    Number(a.song.source !== "wy") - Number(b.song.source !== "wy") ||
    a.song.id.localeCompare(b.song.id);
}

/**
 * 列出可用的同曲异唱候选，按证据强度（时长 → 跨源 → 无）、时长接近度、来源稳定性排序。
 *
 * 导出是因为两端 UI 都要把候选摆给用户挑：第二档明确不静默，用户得能换一个。
 */
export function listOtherPerformerCandidates(local: MusicInfo, candidates: MusicInfo[]): OtherPerformerCandidate[] {
  return candidates
    .map(candidate => otherPerformerEvidence(local, candidate, candidates))
    .filter((item): item is OtherPerformerCandidate => item !== null)
    .sort(compareOtherPerformer);
}

/**
 * 纯判定：同一录音优先；原唱不可得时给出同曲异唱候选。
 *
 * 冲突为硬否决；弱证据、竞争身份、领先不足都不返回可用候选。
 */
export function selectLocalMediaMatch(
  local: MusicInfo,
  candidates: MusicInfo[],
  options: LocalMatchOptions = {},
): LocalMatchResult {
  const ranked = candidates.map(candidate => assess(local, candidate))
    .filter((item): item is Evidence => item !== null).sort(compareEvidence);

  // 同曲异唱档：要求调用方确认原唱不可得，且本批召回里确实没有同一演唱者的候选。
  const allowOtherPerformer = options.originalPerformerUnavailable === true &&
    !hasOriginalPerformerCandidate(local, candidates);
  const alternatives = allowOtherPerformer ? listOtherPerformerCandidates(local, candidates) : [];

  if (!ranked.length) {
    const adopted = alternatives.find(item => item.corroboration !== "none");
    if (adopted) return adoptOtherPerformer(adopted, alternatives);
    return {
      status: "not-found",
      candidates: [],
      issues: ["match:no-compatible-candidate"],
      ...(alternatives.length ? { alternatives } : {}),
    };
  }

  const groups: Evidence[][] = [];
  for (const item of ranked) {
    // 要求组内两两一致，防止缺时长候选把两个不同版本传递合并。
    const group = groups.find(members => members.every(member => sameRecording(member, item)));
    if (group) group.push(item);
    else groups.push([item]);
  }
  const best = groups[0][0];
  const runnerUp = groups[1]?.[0];
  const lead = runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY;
  const sameRecordingWins = best.reliable && lead >= MIN_SCORE_LEAD;
  if (sameRecordingWins) {
    return {
      status: "matched",
      tier: "same-recording",
      candidates: groups[0].map(item => item.song),
      issues: [],
    };
  }

  // 同一录音不够说服力时，只有把异唱档的证据摆上来才可能救回这次匹配。
  const adopted = alternatives.find(item => item.corroboration !== "none");
  if (adopted) return adoptOtherPerformer(adopted, alternatives);

  return best.reliable
    ? { status: "ambiguous", candidates: [], issues: ["match:insufficient-lead"] }
    : { status: "ambiguous", candidates: [], issues: ["match:insufficient-evidence"] };
}

function adoptOtherPerformer(
  adopted: OtherPerformerCandidate,
  alternatives: OtherPerformerCandidate[],
): LocalMatchResult {
  return {
    status: "matched",
    tier: "other-performer",
    candidates: [adopted.song],
    issues: ["match:other-performer-adopted"],
    performer: adopted.performer,
    durationDeltaSeconds: adopted.durationDeltaSeconds,
    corroboration: adopted.corroboration,
    alternatives,
  };
}
