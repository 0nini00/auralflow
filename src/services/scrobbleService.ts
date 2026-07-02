import { playerEngine } from "./playerEngine";
import { scrobble } from "./wyAccountService";
import { loadSettings } from "@lx/tauri-bridge";

interface ScrobbleState {
  songId: string | null;
  duration: number;
  accumulated: number;
  lastTime: number;
  reported: boolean;
}

interface ScrobbleRetryEntry {
  songId: string;
  sourceId: string;
  playedTime: number;
  createdAt: number;
  attempts: number;
  lastTriedAt?: number;
  lastError?: string;
}

const THRESHOLD_SEC = 120;
const MIN_REPORT_ON_TRACK_CHANGE_SEC = 30;
const MAX_RETRY_QUEUE_SIZE = 100;
const RETRY_FLUSH_INTERVAL_MS = 60_000;
const SCROBBLE_RETRY_QUEUE_KEY = "auralflow:netease-scrobble-retry:v1";

let retryFlushInFlight: Promise<void> | null = null;

function readRetryQueue(): ScrobbleRetryEntry[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SCROBBLE_RETRY_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ScrobbleRetryEntry =>
        typeof item?.songId === "string" &&
        typeof item?.sourceId === "string" &&
        typeof item?.playedTime === "number" &&
        typeof item?.createdAt === "number" &&
        typeof item?.attempts === "number",
      )
      .slice(-MAX_RETRY_QUEUE_SIZE);
  } catch (error) {
    console.warn("[scrobble] 读取重试队列失败", error);
    return [];
  }
}

function saveRetryQueue(queue: ScrobbleRetryEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCROBBLE_RETRY_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_RETRY_QUEUE_SIZE)));
}

function enqueueScrobbleRetry(songId: string, sourceId: string, playedTime: number, error: unknown): void {
  const queue = readRetryQueue();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const existingIndex = queue.findIndex((entry) => entry.songId === songId && entry.sourceId === sourceId);
  const nextEntry: ScrobbleRetryEntry = {
    songId,
    sourceId,
    playedTime,
    createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : Date.now(),
    attempts: existingIndex >= 0 ? queue[existingIndex].attempts : 0,
    lastError: errorMessage,
  };
  const nextQueue = existingIndex >= 0
    ? [...queue.slice(0, existingIndex), nextEntry, ...queue.slice(existingIndex + 1)]
    : [...queue, nextEntry];
  saveRetryQueue(nextQueue);
  console.warn("[scrobble] 上报失败，已加入重试队列", error);
}

async function isScrobbleSyncEnabled(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.neteaseScrobbleSync !== false;
}

async function submitScrobble(songId: string, sourceId: string, playedTime: number): Promise<void> {
  if (!(await isScrobbleSyncEnabled())) return;
  await scrobble(songId, sourceId, playedTime);
}

async function flushScrobbleRetryQueue(): Promise<void> {
  if (retryFlushInFlight) return retryFlushInFlight;

  retryFlushInFlight = (async () => {
    if (!(await isScrobbleSyncEnabled())) return;
    const queue = readRetryQueue();
    if (queue.length === 0) return;

    const remaining: ScrobbleRetryEntry[] = [];
    for (const entry of queue) {
      try {
        await scrobble(entry.songId, entry.sourceId, entry.playedTime);
      } catch (error) {
        remaining.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastTriedAt: Date.now(),
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    saveRetryQueue(remaining);
  })().finally(() => {
    retryFlushInFlight = null;
  });

  return retryFlushInFlight;
}

const report = (s: ScrobbleState) => {
  if (!s.songId || s.reported) return;
  s.reported = true;
  void flushScrobbleRetryQueue()
    .then(() => submitScrobble(s.songId!, "", s.accumulated))
    .catch((err) => enqueueScrobbleRetry(s.songId!, "", s.accumulated, err));
};

export function setupScrobble(): void {
  let s: ScrobbleState = { songId: null, duration: 0, accumulated: 0, lastTime: 0, reported: false };
  void flushScrobbleRetryQueue();
  window.setInterval(() => {
    void flushScrobbleRetryQueue().catch((error) => {
      console.warn("[scrobble] 重试队列刷新失败", error);
    });
  }, RETRY_FLUSH_INTERVAL_MS);

  playerEngine.subscribe((state) => {
    const music = state.currentMusic;
    const key = music && music.source === "wy" && music.id ? String(music.id) : null;

    if (key !== s.songId) {
      if (s.songId && !s.reported && s.accumulated >= MIN_REPORT_ON_TRACK_CHANGE_SEC) {
        report(s);
      }
      s = { songId: key, duration: state.duration, accumulated: 0, lastTime: 0, reported: false };
      return;
    }

    if (state.duration && state.duration !== s.duration) {
      s.duration = state.duration;
    }

    if (state.status === "playing") {
      const delta = state.currentTime - s.lastTime;
      if (delta > 0 && delta < 2) {
        s.accumulated += delta;
      }
      s.lastTime = state.currentTime;

      if (!s.reported) {
        if (s.accumulated >= THRESHOLD_SEC || (s.duration > 0 && s.accumulated >= s.duration * 0.5)) {
          report(s);
        }
      }
    } else {
      s.lastTime = state.currentTime;
    }
  });
}
