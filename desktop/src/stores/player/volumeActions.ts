/**
 * 音量与静音：写引擎、写 store，并把逻辑音量防抖落到设置里。
 */
import { logger } from "@/services/logger";
import { playerEngine } from "@/services/playerEngine";
import { updateSettings } from "@/stores/settingsStore";
import type { PlayerGet, PlayerSet, PlayerStore } from "./types";

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleVolumePersist(volume: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null;
    updateSettings({ volume: Math.round(volume * 100) }).catch((error) => {
      logger.warn("保存音量失败，下次启动会回到上次保存的音量", error);
    });
  }, 400);
}

export function createVolumeActions(set: PlayerSet, get: PlayerGet): Pick<PlayerStore, "setVolume" | "toggleMute"> {
  return {
    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(volume, 1));
      playerEngine.setVolume(clamped);
      // 滑到 0 视为静音；非 0 则解除静音并写入逻辑音量
      set({ volume: clamped, isMuted: clamped === 0 });
      scheduleVolumePersist(clamped);
    },

    toggleMute: () => {
      const { isMuted, volume } = get();

      if (isMuted) {
        // store.volume 在静音期间保持为静音前的逻辑音量
        const restored = volume > 0 ? volume : 0.8;
        playerEngine.setVolume(restored);
        set({ isMuted: false, volume: restored });
        scheduleVolumePersist(restored);
      } else {
        // 只把 engine 静音；不把 store.volume 改成 0，也不 persist 0
        // 否则 unmute 只能回到默认 0.8，且下次启动音量被写成 0
        // 引擎会同步推送音量；先标记静音，订阅者才会保留逻辑音量。
        set({ isMuted: true });
        playerEngine.setVolume(0);
      }
    },
  };
}
