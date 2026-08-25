import { ScrollingLyricsVisualizer } from './ScrollingLyricsVisualizer';
import type { PlayerVisualizerProps } from './types';

export function PlayerVisualizerRenderer(props: PlayerVisualizerProps) {
  return <ScrollingLyricsVisualizer {...props} />;
}
