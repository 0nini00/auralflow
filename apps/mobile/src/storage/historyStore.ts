import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicInfo } from "@lx/core";

const HISTORY_KEY = "auralflow.mobile.playHistory";
const MAX_HISTORY_ITEMS = 200;

function dedupeSongs(songs: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];
  for (const song of songs) {
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

export async function loadHistorySongs(): Promise<MusicInfo[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as MusicInfo[];
  return Array.isArray(parsed) ? dedupeSongs(parsed).slice(0, MAX_HISTORY_ITEMS) : [];
}

export async function addHistorySong(song: MusicInfo): Promise<MusicInfo[]> {
  const current = await loadHistorySongs();
  const next = dedupeSongs([song, ...current]).slice(0, MAX_HISTORY_ITEMS);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
