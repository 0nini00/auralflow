import type { MusicInfo } from "@lx/core";

const PREFETCH_THRESHOLD = 2;

export interface PersonalFmQueueState {
  fmQueue: MusicInfo[];
  fmIndex: number;
  fmLoading: boolean;
  fmPrefetching: boolean;
  fmError: string;
}

type PersonalFmStatePatch =
  | Partial<PersonalFmQueueState>
  | ((state: PersonalFmQueueState) => Partial<PersonalFmQueueState>);

interface PersonalFmQueueControllerDeps {
  getState: () => PersonalFmQueueState;
  setState: (patch: PersonalFmStatePatch) => void;
  fetchTracks: () => Promise<MusicInfo[]>;
  trashTrack: (trackId: string) => Promise<void>;
  warn?: (message: string, error: unknown) => void;
}

export interface PersonalFmQueueController {
  load: (force?: boolean) => Promise<void>;
  next: () => Promise<MusicInfo | null>;
  dislike: (track: MusicInfo) => Promise<void>;
  reset: () => void;
}

function trackKey(track: MusicInfo): string {
  return `${track.source}:${track.id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendUniqueTracks(queue: MusicInfo[], incoming: MusicInfo[]): MusicInfo[] {
  const seen = new Set(queue.map(trackKey));
  const additions = incoming.filter((track) => {
    const key = trackKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return additions.length > 0 ? [...queue, ...additions] : queue;
}

function removeTrackFromState(
  state: PersonalFmQueueState,
  track: MusicInfo,
): Partial<PersonalFmQueueState> {
  const index = state.fmQueue.findIndex((item) => trackKey(item) === trackKey(track));
  if (index < 0) return {};

  const fmQueue = state.fmQueue.filter((_, itemIndex) => itemIndex !== index);
  const movedPastTrack = index < state.fmIndex;
  const nextIndex = movedPastTrack ? Math.max(0, state.fmIndex - 1) : state.fmIndex;

  return {
    fmQueue,
    fmIndex: Math.min(nextIndex, fmQueue.length),
  };
}

export function createPersonalFmQueueController(
  deps: PersonalFmQueueControllerDeps,
): PersonalFmQueueController {
  let generation = 0;
  let nextLockId = 0;
  let prefetchLockId = 0;
  let activeNextLockId = 0;
  let activePrefetchLockId = 0;
  let nextPromise: Promise<MusicInfo | null> | null = null;
  let prefetchPromise: Promise<void> | null = null;

  const warn = (message: string, error: unknown) => {
    deps.warn?.(message, error);
  };

  const prefetch = (startedGeneration: number): void => {
    if (prefetchPromise) return;

    deps.setState({ fmPrefetching: true });
    const lockId = ++prefetchLockId;
    activePrefetchLockId = lockId;
    prefetchPromise = (async () => {
      try {
        const tracks = await deps.fetchTracks();
        if (generation !== startedGeneration) return;

        deps.setState((state) => ({
          fmQueue: appendUniqueTracks(state.fmQueue, tracks),
        }));
      } catch (error) {
        warn("[fm] prefetch failed", error);
      } finally {
        if (generation === startedGeneration) {
          deps.setState({ fmPrefetching: false });
        }
        if (activePrefetchLockId === lockId) {
          prefetchPromise = null;
          activePrefetchLockId = 0;
        }
      }
    })();
  };

  const load = async (force = false): Promise<void> => {
    const state = deps.getState();
    if (state.fmLoading) return;
    if (!force && state.fmQueue.length > 0) return;

    const startedGeneration = ++generation;
    nextPromise = null;
    prefetchPromise = null;
    activeNextLockId = 0;
    activePrefetchLockId = 0;
    deps.setState({ fmLoading: true, fmError: "", fmPrefetching: false });
    try {
      const tracks = await deps.fetchTracks();
      if (generation !== startedGeneration) return;

      deps.setState({
        fmQueue: tracks,
        fmIndex: 0,
        fmLoading: false,
      });
    } catch (error) {
      if (generation !== startedGeneration) return;

      deps.setState({
        fmError: errorMessage(error),
        fmLoading: false,
      });
    }
  };

  const next = async (): Promise<MusicInfo | null> => {
    if (nextPromise) return nextPromise;

    const lockId = ++nextLockId;
    activeNextLockId = lockId;
    nextPromise = (async () => {
      const state = deps.getState();
      const startedGeneration = generation;

      if (state.fmIndex < state.fmQueue.length) {
        const track = state.fmQueue[state.fmIndex];
        const nextIndex = state.fmIndex + 1;
        deps.setState({ fmIndex: nextIndex, fmError: "" });

        if (state.fmQueue.length - nextIndex <= PREFETCH_THRESHOLD) {
          prefetch(startedGeneration);
        }

        return track;
      }

      deps.setState({ fmLoading: true, fmError: "" });
      try {
        const tracks = await deps.fetchTracks();
        if (generation !== startedGeneration) return null;

        const first = tracks[0] ?? null;
        deps.setState({
          fmQueue: tracks,
          fmIndex: first ? 1 : 0,
          fmLoading: false,
        });
        return first;
      } catch (error) {
        if (generation !== startedGeneration) return null;

        deps.setState({
          fmError: errorMessage(error),
          fmLoading: false,
        });
        return null;
      }
    })();

    void nextPromise.finally(() => {
      if (activeNextLockId === lockId) {
        nextPromise = null;
        activeNextLockId = 0;
      }
    }).catch(() => undefined);

    return nextPromise;
  };

  const dislike = async (track: MusicInfo): Promise<void> => {
    if (track.source === "wy") {
      try {
        await deps.trashTrack(String(track.id));
      } catch (error) {
        warn("[fm] trash failed", error);
      }
    }

    deps.setState((state) => removeTrackFromState(state, track));
  };

  const reset = (): void => {
    generation += 1;
    nextPromise = null;
    prefetchPromise = null;
    activeNextLockId = 0;
    activePrefetchLockId = 0;
    deps.setState({
      fmQueue: [],
      fmIndex: 0,
      fmLoading: false,
      fmPrefetching: false,
      fmError: "",
    });
  };

  return { load, next, dislike, reset };
}
