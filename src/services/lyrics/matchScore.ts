export interface LyricMatchTarget {
  name?: string;
  singer?: string;
  albumName?: string;
  interval?: string | number;
}

export interface LyricSearchCandidate {
  id: string | number;
  name?: string;
  singer?: string;
  artists?: Array<{ name?: string }>;
  ar?: Array<{ name?: string }>;
  album?: { name?: string };
  al?: { name?: string };
  duration?: number;
  dt?: number;
  interval?: string | number;
}

const VERSION_MARKER_PATTERN = /(instrumental|inst|off\s*vocal|karaoke|remix|mix|version|ver\.?|cover|live|edit|arrange|伴奏|カラオケ|インスト|リミックス|remaster|remastered)/iu;
const FEAT_BRACKET_PATTERN = /[\(\[（【]\s*(feat|featuring|ft)\.?\s+[^\]\)）】]+[\]\)）】]/giu;
const BRACKET_PATTERN = /[\(\[（【]([^\]\)）】]+)[\]\)）】]/gu;

function normalizeText(value?: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(FEAT_BRACKET_PATTERN, '')
    .replace(/\b(feat|featuring|ft)\.?\s+.+$/iu, '')
    .replace(BRACKET_PATTERN, (match, content: string) => (
      VERSION_MARKER_PATTERN.test(content) ? match : ''
    ))
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function splitArtists(value?: string): string[] {
  return (value ?? '')
    .split(/[,，、/&]| and |\s+x\s+/i)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function similarity(left?: string, right?: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const item of aSet) {
    if (bSet.has(item)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union > 0 ? intersection / union : 0;
}

function parseDurationMs(value?: string | number): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value > 1000 ? value : value * 1000;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(':').map((part) => Number.parseFloat(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  return Math.round(parts[0] * 1000);
}

function getCandidateArtists(candidate: LyricSearchCandidate): string {
  const artists = candidate.artists ?? candidate.ar;
  if (artists?.length) return artists.map((artist) => artist.name).filter(Boolean).join(', ');
  return candidate.singer ?? '';
}

function getCandidateAlbum(candidate: LyricSearchCandidate): string {
  return candidate.album?.name ?? candidate.al?.name ?? '';
}

function getCandidateDurationMs(candidate: LyricSearchCandidate): number {
  return parseDurationMs(candidate.duration ?? candidate.dt ?? candidate.interval);
}

function artistSimilarity(targetArtist?: string, candidateArtist?: string): number {
  const targetParts = splitArtists(targetArtist);
  const candidateParts = splitArtists(candidateArtist);
  if (targetParts.length === 0 || candidateParts.length === 0) return 0;

  let matches = 0;
  for (const target of targetParts) {
    if (candidateParts.some((candidate) => similarity(target, candidate) >= 0.72)) matches += 1;
  }
  const tokenScore = matches / Math.max(targetParts.length, candidateParts.length);
  const mainArtistScore = similarity(targetParts[0], candidateParts[0]) >= 0.72 ? 0.25 : 0;
  return Math.min(1, tokenScore + mainArtistScore);
}

function durationMultiplier(targetMs: number, candidateMs: number): number {
  if (targetMs <= 0 || candidateMs <= 0) return 0.9;
  const diff = Math.abs(targetMs - candidateMs);
  if (diff <= 1000) return 1;
  if (diff <= 3000) return 0.95;
  if (diff <= 5000) return 0.75;
  if (diff <= 10000) return 0.35;
  return 0.1;
}

export function calculateLyricMatchScore(target: LyricMatchTarget, candidate: LyricSearchCandidate): number {
  const titleScore = similarity(target.name, candidate.name) * 56;
  const artistScore = artistSimilarity(target.singer, getCandidateArtists(candidate)) * 28;
  const albumScore = target.albumName ? similarity(target.albumName, getCandidateAlbum(candidate)) * 10 : 6;
  const multiplier = durationMultiplier(parseDurationMs(target.interval), getCandidateDurationMs(candidate));
  return Math.round((titleScore + artistScore + albumScore) * multiplier);
}

export function selectBestLyricMatch<T extends LyricSearchCandidate>(
  target: LyricMatchTarget,
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: calculateLyricMatchScore(target, candidate),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0]?.candidate ?? null;
}
