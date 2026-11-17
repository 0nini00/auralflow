import { useEffect } from "react";
import { TAURI_EVENTS, listenTauriEvent } from "@lx/tauri-bridge";
import { dispatchPlaybackAction } from "@/services/playback/playbackActions";

/**
 * 监听来自 Rust 侧托盘菜单的播放控制事件。
 *
 * Rust 端目前只有 tray.rs 发 native-action（媒体键走 SMTC，见 smtcService），
 * 真正的播放器状态归前端管，这里负责把动作转成 store 调用。
 */

export function useNativeControls() {
  useEffect(() => {
    const unlistenPromise = listenTauriEvent(TAURI_EVENTS.nativeAction, (action) => {
      // 与歌词窗控制（playerSync）/SMTC 共用同一套分发语义（见 playbackActions）
      dispatchPlaybackAction(action);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
