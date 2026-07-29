export interface ExternalPauseContext {
  pauseOnExternalPlayback: boolean;
  wasPlayingBeforePause: boolean;
  internalPausePending: boolean;
  hasCurrentUrl: boolean;
  mediaEnded?: boolean;
}

export function normalizePauseOnExternalPlayback(value: unknown): boolean {
  return value !== false;
}

export function shouldResumeAfterExternalPause(context: ExternalPauseContext): boolean {
  return (
    !context.pauseOnExternalPlayback &&
    context.wasPlayingBeforePause &&
    !context.internalPausePending &&
    context.hasCurrentUrl &&
    !context.mediaEnded
  );
}
