import { PosterLyricsVisualizer } from './PosterLyricsVisualizer';
import type { PlayerVisualizerProps } from './types';

export function PlayerVisualizerRenderer(props: PlayerVisualizerProps) {
  return <PosterLyricsVisualizer {...props} />;
}
