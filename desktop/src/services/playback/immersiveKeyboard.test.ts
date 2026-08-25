import { describe, expect, it } from 'vitest';
import { resolveImmersiveKeyboardAction } from './immersiveKeyboard';

describe('resolveImmersiveKeyboardAction', () => {
  it('maps playback and close keys', () => {
    expect(resolveImmersiveKeyboardAction({ key: ' ' })).toBe('toggle-play');
    expect(resolveImmersiveKeyboardAction({ key: 'Escape' })).toBe('close');
    expect(resolveImmersiveKeyboardAction({ key: 'm' })).toBe('toggle-mute');
    expect(resolveImmersiveKeyboardAction({ key: 'M' })).toBe('toggle-mute');
  });

  it('maps arrows to seek, volume and shifted track navigation', () => {
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowLeft' })).toBe('seek-backward');
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowRight' })).toBe('seek-forward');
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowLeft', shiftKey: true })).toBe('previous');
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowRight', shiftKey: true })).toBe('next');
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowUp' })).toBe('volume-up');
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowDown' })).toBe('volume-down');
  });

  it('ignores modified and unrelated shortcuts', () => {
    expect(resolveImmersiveKeyboardAction({ key: ' ', ctrlKey: true })).toBeNull();
    expect(resolveImmersiveKeyboardAction({ key: 'ArrowRight', altKey: true })).toBeNull();
    expect(resolveImmersiveKeyboardAction({ key: 'x' })).toBeNull();
  });
});
