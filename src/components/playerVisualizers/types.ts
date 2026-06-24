import type { ComponentType, RefObject, WheelEvent } from 'react';
import type { LyricLine } from '@/services/lyricsService';

export type PlayerVisualizerMode = 'lyrics';

export interface PlayerVisualizerProps {
  lyrics: LyricLine[];
  currentLyricIndex: number;
  showTranslation: boolean;
  lyricsViewportRef: RefObject<HTMLDivElement>;
  handleLyricsWheel: (event: WheelEvent<HTMLDivElement>) => void;
  lyricLineRef: (index: number) => (element: HTMLDivElement | null) => void;
}

export interface PlayerVisualizerDefinition {
  mode: PlayerVisualizerMode;
  label: string;
  Component: ComponentType<PlayerVisualizerProps>;
}
