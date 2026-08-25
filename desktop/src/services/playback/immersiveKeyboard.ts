export type ImmersiveKeyboardAction =
  | 'close'
  | 'toggle-play'
  | 'seek-backward'
  | 'seek-forward'
  | 'previous'
  | 'next'
  | 'volume-up'
  | 'volume-down'
  | 'toggle-mute';

export interface ImmersiveKeyboardInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export function resolveImmersiveKeyboardAction(
  input: ImmersiveKeyboardInput,
): ImmersiveKeyboardAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;

  switch (input.key) {
    case 'Escape':
      return 'close';
    case ' ':
      return 'toggle-play';
    case 'ArrowLeft':
      return input.shiftKey ? 'previous' : 'seek-backward';
    case 'ArrowRight':
      return input.shiftKey ? 'next' : 'seek-forward';
    case 'ArrowUp':
      return 'volume-up';
    case 'ArrowDown':
      return 'volume-down';
    case 'm':
    case 'M':
      return 'toggle-mute';
    default:
      return null;
  }
}
