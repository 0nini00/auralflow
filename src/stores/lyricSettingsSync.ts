import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logAsyncError } from "@/utils/logAsyncError";

export interface LyricSettingsPatch {
  lyricPinned?: boolean;
  lyricLocked?: boolean;
  lyricPauseHide?: boolean;
  lyricFontSize?: number;
  lyricShowNextLine?: boolean;
  lyricSingleLine?: boolean;
  lyricMaxLineNum?: number;
  lyricShowTranslation?: boolean;
  lyricAlign?: string;
  lyricLineGap?: number;
  lyricFontWeight?: number;
  lyricActiveColor?: string;
  lyricNextColor?: string;
  lyricShadowColor?: string;
  lyricTextOpacity?: number;
  lyricBackgroundOpacity?: number;
  lyricTextPositionX?: number;
  lyricTextPositionY?: number;
  lyricHoverHide?: boolean;
  lyricEnableAnimation?: boolean;
}

const CHANNEL_NAME = "auralflow-lyric-settings";

let channelInstance: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channelInstance) {
    channelInstance = new BroadcastChannel(CHANNEL_NAME);
  }
  return channelInstance;
}

export function broadcastLyricSettings(patch: LyricSettingsPatch) {
  getChannel()?.postMessage(patch);
}

export function subscribeLyricSettings(handler: (patch: LyricSettingsPatch) => void) {
  let channel: BroadcastChannel | null = null;
  let unlistenTauri: UnlistenFn | null = null;
  let disposed = false;

  const listener = (event: MessageEvent<LyricSettingsPatch>) => handler(event.data);

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", listener);
  }

  void listen<LyricSettingsPatch>("lyric-settings-changed", (event) => {
    if (!disposed) handler(event.payload);
  }).then((unlisten) => {
    if (disposed) {
      unlisten();
    } else {
      unlistenTauri = unlisten;
    }
  }).catch(logAsyncError("lyric-settings:listen"));

  return () => {
    disposed = true;
    if (channel) {
      channel.removeEventListener("message", listener);
      channel.close();
    }
    unlistenTauri?.();
  };
}
