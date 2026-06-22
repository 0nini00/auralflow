import { playerEngine } from "./playerEngine";
import { scrobble } from "./wyAccountService";

interface ScrobbleState {
  songId: string | null;
  duration: number;
  accumulated: number;
  lastTime: number;
  reported: boolean;
}

const THRESHOLD_SEC = 120;
const report = (s: ScrobbleState) => {
  if (!s.songId || s.reported) return;
  s.reported = true;
  void scrobble(s.songId, "", s.accumulated).catch((err) => {
    console.warn("[scrobble] 上报失败", err);
  });
};

export function setupScrobble(): void {
  let s: ScrobbleState = { songId: null, duration: 0, accumulated: 0, lastTime: 0, reported: false };

  playerEngine.subscribe((state) => {
    const music = state.currentMusic;
    const key = music && music.source === "wy" && music.id ? String(music.id) : null;

    if (key !== s.songId) {
      if (s.songId && !s.reported && s.accumulated >= 30) {
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
