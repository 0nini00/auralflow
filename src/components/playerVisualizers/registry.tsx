import { LyricsVisualizer } from './LyricsVisualizer';
import type { PlayerVisualizerDefinition, PlayerVisualizerMode } from './types';

export const defaultPlayerVisualizerMode: PlayerVisualizerMode = 'lyrics';

export const playerVisualizerRegistry: PlayerVisualizerDefinition[] = [
  {
    mode: 'lyrics',
    label: '歌词',
    Component: LyricsVisualizer,
  },
];

export function getPlayerVisualizer(mode: PlayerVisualizerMode): PlayerVisualizerDefinition {
  return playerVisualizerRegistry.find((visualizer) => visualizer.mode === mode) ?? playerVisualizerRegistry[0];
}
