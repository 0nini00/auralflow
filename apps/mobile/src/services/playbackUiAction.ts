export type PlaybackUiResult =
  | { ok: true }
  | { ok: false; message: string };

export async function runPlaybackUiAction(
  action: () => Promise<void>,
): Promise<PlaybackUiResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
