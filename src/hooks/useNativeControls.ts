import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "@/stores/playerStore";

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
      const action = event.payload;
      const store = usePlayerStore.getState();
      switch (action) {
        case "play-pause": {
          const { status, current, play, resume, pause } = store;
          if (!current) return;
          if (status === "playing") pause();
          else if (status === "paused") resume();
          else void play(current).catch(() => {});
          break;
        }
        case "next":
          void store.next().catch(() => {});
          break;
        case "prev":
          void store.prev().catch(() => {});
          break;
        default:
          console.warn("[native-action] unknown action", action);
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
