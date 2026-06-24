import { defaultPlayerVisualizerMode, getPlayerVisualizer } from './registry';
import type { PlayerVisualizerMode, PlayerVisualizerProps } from './types';

interface PlayerVisualizerRendererProps extends PlayerVisualizerProps {
  mode?: PlayerVisualizerMode;
}

export function PlayerVisualizerRenderer({
  mode = defaultPlayerVisualizerMode,
  ...props
}: PlayerVisualizerRendererProps) {
  const Visualizer = getPlayerVisualizer(mode).Component;
  return <Visualizer {...props} />;
}
