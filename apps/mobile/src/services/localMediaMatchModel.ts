import type { MusicInfo } from "@lx/core";

export interface LocalMediaMatch {
  status: "matched" | "not-found" | "ambiguous";
  candidates: MusicInfo[];
  issues: string[];
}

interface Evidence {
  song: MusicInfo;
  score: number;
  reliable: boolean;
}

type DurationAgreement = "missing" | "close" | "near" | "conflict";

const CLOSE_DURATION_SECONDS = 2;
const CONFLICT_DURATION_SECONDS = 5;
const ARTIST_SCORE = 6;
const DURATION_SCORE = 3;
const ALBUM_SCORE = 2;
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

function durationAgreement(a: MusicInfo, b: MusicInfo): DurationAgreement {
  const left = a.interval;
  const right = b.interval;
  if (typeof left !== "number" || !Number.isFinite(left) || left <= 0 ||
      typeof right !== "number" || !Number.isFinite(right) || right <= 0) return "missing";
  const difference = Math.abs(left - right);
  if (difference <= CLOSE_DURATION_SECONDS) return "close";
  return difference > CONFLICT_DURATION_SECONDS ? "conflict" : "near";
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

/** 纯判定：冲突为硬否决；弱证据、竞争身份、领先不足都不返回可用候选。 */
export function selectLocalMediaMatch(song: MusicInfo, candidates: MusicInfo[]): LocalMediaMatch {
  const ranked = candidates.map(candidate => assess(song, candidate))
    .filter((item): item is Evidence => item !== null).sort(compareEvidence);
  if (!ranked.length) return { status: "not-found", candidates: [], issues: ["match:no-compatible-candidate"] };

  const groups: Evidence[][] = [];
  for (const item of ranked) {
    // 要求组内两两一致，防止缺时长候选把两个不同版本传递合并。
    const group = groups.find(members => members.every(member => sameRecording(member, item)));
    if (group) group.push(item);
    else groups.push([item]);
  }
  const best = groups[0][0];
  const runnerUp = groups[1]?.[0];
  if (!best.reliable) return { status: "ambiguous", candidates: [], issues: ["match:insufficient-evidence"] };
  if (runnerUp && best.score - runnerUp.score < MIN_SCORE_LEAD) {
    return { status: "ambiguous", candidates: [], issues: ["match:insufficient-lead"] };
  }
  return { status: "matched", candidates: groups[0].map(item => item.song), issues: [] };
}
