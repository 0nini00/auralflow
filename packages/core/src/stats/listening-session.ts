import type { MusicInfo } from '../sources';
import type { ListeningStats, ListeningStatsArtist, ListeningStatsDay, ListeningStatsTrack } from './aggregate';

/** 独立于最近播放；同曲重播使用新 sessionId，暂停恢复沿用原会话。 */
export interface ListeningEvent {
  sessionId: string;
  song: MusicInfo;
  startedAt: number;
  listenedMs: number;
}

export interface ListeningSample {
  /** 单调时钟毫秒，不使用播放位置或可被校时的墙钟替代。 */
  at: number;
  position: number;
  playing: boolean;
  rate: number;
}

export interface ListeningSession {
  event: ListeningEvent;
  sample: ListeningSample;
}

export const LISTENING_CHECKPOINT_MS = 10_000;
const PROGRESS_JITTER_SECONDS = 0.35;

export function createListeningSession(sessionId: string, song: MusicInfo, startedAt: number, sample: ListeningSample): ListeningSession {
  return {
    // 落盘边界是严格解析（parseListeningEvents 要求这些字段都是字符串）：
    // 创建时就收敛类型，别把 undefined 留到下次启动才炸。
    event: { sessionId, startedAt, listenedMs: 0, song: {
      id: String(song.id ?? ''), source: song.source,
      name: String(song.name ?? ''), singer: String(song.singer ?? ''),
      albumName: String(song.albumName ?? ''),
    } },
    sample,
  };
}

export function sampleListeningSession(state: ListeningSession, sample: ListeningSample): ListeningSession {
  const previous = state.sample;
  const elapsed = sample.at - previous.at;
  const progress = sample.position - previous.position;
  const rate = previous.rate;
  const continuous = previous.playing && Number.isFinite(elapsed) && elapsed > 0
    && Number.isFinite(progress) && progress > 0 && Number.isFinite(rate) && rate > 0
    && progress <= elapsed / 1000 * rate + PROGRESS_JITTER_SECONDS;
  // 真实经过时间限定上界；进度停滞或缓冲只计实际解码推进对应的时间。
  const heard = continuous ? Math.min(elapsed, progress / rate * 1000) : 0;
  return { event: { ...state.event, listenedMs: state.event.listenedMs + heard }, sample };
}

/** 显式跳转只改测量起点；跳过的媒体位置不能被算作收听时间。 */
export function seekListeningSession(state: ListeningSession, sample: ListeningSample): ListeningSession {
  return { event: state.event, sample };
}

export function upsertListeningEvent(events: readonly ListeningEvent[], event: ListeningEvent): ListeningEvent[] {
  const existing = events.findIndex((entry) => entry.sessionId === event.sessionId);
  if (existing < 0) return [...events, event];
  if (events[existing].listenedMs >= event.listenedMs) return events as ListeningEvent[];
  return events.map((entry, index) => index === existing ? event : entry);
}

/** 落盘边界严格失败，不把损坏数据解释为空库，也不把旧历史迁移为真实收听。 */
export function parseListeningEvents(value: unknown): ListeningEvent[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('收听统计数据不是事件数组');
  const events = new Map<string, ListeningEvent>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.sessionId !== 'string' || !item.sessionId
      || !Number.isFinite(item.startedAt) || item.startedAt <= 0
      || !Number.isFinite(item.listenedMs) || item.listenedMs < 0
      || !item.song || typeof item.song !== 'object'
      || typeof item.song.id !== 'string' || !item.song.id
      || typeof item.song.source !== 'string' || !item.song.source
      || typeof item.song.name !== 'string' || typeof item.song.singer !== 'string') {
      throw new Error('收听统计包含无效事件');
    }
    const previous = events.get(item.sessionId);
    if (!previous || previous.listenedMs < item.listenedMs) events.set(item.sessionId, item as ListeningEvent);
  }
  return [...events.values()];
}

export function aggregateListeningEvents(events: readonly ListeningEvent[]): ListeningStats {
  const tracks = new Map<string, ListeningStatsTrack>();
  const artists = new Map<string, ListeningStatsArtist>();
  const days = new Map<number, ListeningStatsDay>();
  let totalMs = 0;
  let totalPlays = 0;
  for (const event of events) {
    if (event.listenedMs <= 0) continue;
    const { song, listenedMs } = event;
    totalMs += listenedMs;
    totalPlays += 1;
    const key = `${song.source}:${song.id}`;
    const track = tracks.get(key) ?? { key, song, plays: 0, totalMs: 0 };
    tracks.set(key, { ...track, plays: track.plays + 1, totalMs: track.totalMs + listenedMs });
    const name = song.singer.trim();
    if (name) {
      const artist = artists.get(name) ?? { name, plays: 0, totalMs: 0 };
      artists.set(name, { ...artist, plays: artist.plays + 1, totalMs: artist.totalMs + listenedMs });
    }
    const date = new Date(event.startedAt);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const day = days.get(dayStart) ?? {
      dayStart, day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      plays: 0, totalMs: 0,
    };
    days.set(dayStart, { ...day, plays: day.plays + 1, totalMs: day.totalMs + listenedMs });
  }
  const rank = (a: { totalMs: number; plays: number }, b: { totalMs: number; plays: number }) => b.totalMs - a.totalMs || b.plays - a.plays;
  return { totalMs, totalPlays, playsWithoutDuration: 0,
    topTracks: [...tracks.values()].sort((a, b) => rank(a, b) || (a.key < b.key ? -1 : 1)),
    topArtists: [...artists.values()].sort((a, b) => rank(a, b) || (a.name < b.name ? -1 : 1)),
    byDay: [...days.values()].sort((a, b) => a.dayStart - b.dayStart),
  };
}
