import type { MusicInfo } from '@lx/core';
import type { LyricLine } from '@/services/lyricsService';

export interface PlayerVisualizerProps {
  currentTrack: MusicInfo | null;
  coverUrl: string;
  lyrics: LyricLine[];
  currentLyricIndex: number;
  currentTime: number;
  duration: number;
  progressPercent: number;
  isPlaying: boolean;
  showTranslation: boolean;
  controlsHidden: boolean;
}
