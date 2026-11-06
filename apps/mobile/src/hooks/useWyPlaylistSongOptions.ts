import { useCallback, useEffect, useMemo, useState } from "react";
import type { MusicInfo } from "@lx/core";
import { buildOwnedWyPlaylistSongOptions } from "@/services/localPlaylistSelectionModel";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";

interface WyPlaylistSongOptionsInput {
  visible: boolean;
  song?: Pick<MusicInfo, "source" | "id">;
  songCount: number;
}

interface PlaylistRequestState {
  userId: string;
  attempt: number;
  phase: "loading" | "ready" | "error";
  error: string | null;
}

export function useWyPlaylistSongOptions({ visible, song, songCount }: WyPlaylistSongOptionsInput) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const userId = useAccountStore((state) => state.user?.userId);
  const playlists = usePlaylistStore((state) => state.playlists);
  const fetchPlaylists = usePlaylistStore((state) => state.fetchPlaylists);
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<PlaylistRequestState | null>(null);
  const canAddWySong = visible && songCount === 1 && song?.source === "wy";
  const loginRequired = canAddWySong && (!isLoggedIn || !userId);
  const enabled = canAddWySong && !loginRequired;

  useEffect(() => {
    if (!enabled || !userId) {
      setRequest(null);
      return;
    }

    let cancelled = false;
    setRequest({ userId, attempt, phase: "loading", error: null });
    void fetchPlaylists(userId).then((result) => {
      if (cancelled) return;
      setRequest({
        userId,
        attempt,
        phase: result.ok ? "ready" : "error",
        error: result.ok ? null : result.error,
      });
    });
    return () => { cancelled = true; };
  }, [enabled, userId, attempt, fetchPlaylists]);

  // 账户变化及重试发生后的首帧，旧请求状态不能授予候选列表展示权限。
  const currentRequest = enabled && request && request.userId === userId && request.attempt === attempt
    ? request
    : null;
  const ready = currentRequest?.phase === "ready";
  const options = useMemo(
    () => ready && song ? buildOwnedWyPlaylistSongOptions(playlists, song, userId) : [],
    [ready, playlists, song, userId],
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    options,
    loading: enabled && (!currentRequest || currentRequest.phase === "loading"),
    error: currentRequest?.error ?? null,
    loginRequired,
    retry,
  };
}
