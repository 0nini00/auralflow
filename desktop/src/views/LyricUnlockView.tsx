import { setLyricWindowLocked } from "@lx/tauri-bridge";
import { logger } from "@/services/logger";
import { Unlock } from "lucide-react";

export function LyricUnlockView() {
  // 解锁成功后由 Rust 通知各窗口（lyric-settings-changed），这里不替它转发状态。
  const handleUnlock = () => {
    setLyricWindowLocked(false, undefined, "lyric-unlock").catch((error) => {
      logger.warn("[桌面歌词] 解锁失败", error);
    });
  };

  return (
    <div className="af-lyric-unlock-shell">
      <button
        type="button"
        className="af-lyric-unlock-button"
        onClick={handleUnlock}
        title="解锁桌面歌词"
        aria-label="解锁桌面歌词"
      >
        <Unlock size={18} />
      </button>

      <style>{`
        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: transparent !important;
        }
        .af-lyric-unlock-shell {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          user-select: none;
        }
        .af-lyric-unlock-button {
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 8px;
          color: #fff;
          background: rgba(16, 185, 129, 0.78);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
          backdrop-filter: blur(12px) saturate(120%);
          -webkit-backdrop-filter: blur(12px) saturate(120%);
          cursor: pointer;
          opacity: 0;
          transform: translateY(-2px);
          transition: background 0.16s, transform 0.16s, opacity 0.16s;
        }
        .af-lyric-unlock-shell:hover .af-lyric-unlock-button {
          opacity: 1;
          transform: translateY(0);
        }
        .af-lyric-unlock-button:hover {
          background: rgba(16, 185, 129, 0.95);
          transform: translateY(-1px);
        }
        .af-lyric-unlock-button:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
