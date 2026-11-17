export const WY_PLAYLIST_SUBSCRIBE_PATH = "/playlist/subscribe";

export interface WyPlaylistSubscribeRequest {
  path: string;
  payload: { id: string; t: 1 | 2 };
  pcCookie: true;
}

export function buildWyPlaylistSubscribeRequest(
  playlistId: string | number,
  subscribe: boolean,
): WyPlaylistSubscribeRequest {
  return {
    path: WY_PLAYLIST_SUBSCRIBE_PATH,
    payload: {
      id: String(playlistId),
      t: subscribe ? 1 : 2,
    },
    pcCookie: true,
  };
}
