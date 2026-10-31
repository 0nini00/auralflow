import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { dispatchPlaybackAction } from "@/services/playback/playbackActions";

/**
 * 监听来自 Rust 侧（托盘菜单 / 全局快捷键 / 媒体键）的播放控制事件。
 *
 * Rust 端在 tray.rs / shortcuts.rs 里用 emit("native-action", "<action>") 派发，
 * 真正的播放器状态归前端管，这里负责把动作转成 store 调用。
 */
type NativeAction = "play-pause" | "prev" | "next";

export function useNativeControls() {
  useEffect(() => {
    const unlistenPromise = listen<NativeAction>("native-action", (event) => {
      // 与歌词窗控制（playerSync）/SMTC 共用同一套分发语义（见 playbackActions）
      dispatchPlaybackAction(event.payload);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
