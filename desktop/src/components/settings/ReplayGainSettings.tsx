import { useEffect, useRef, useState } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";
import { playerEngine } from "@/services/playerEngine";
import { readLocalReplayGain } from "@/services/localMusicService";
import { useLibraryStore } from "@/stores/libraryStore";
import type { ReplayGainState } from "@/services/replayGain";

function describe(state: ReplayGainState): string {
  if (state.status === "disabled") return "当前未启用音量平衡。";
  if (state.status === "not-local") return "只处理本地歌曲，在线歌曲保持原音量。";
  if (state.status === "missing") return "当前歌曲没有有效 ReplayGain 标签，保持原音量。";
  if (state.status === "invalid") return `当前标签不可用，保持原音量。${state.reason ?? ""}`;
  return `当前补偿 ${state.appliedDb.toFixed(2)} dB${state.peakLimited ? "（已按峰值限制，避免削波）" : state.hasPeak ? "（含峰值信息）" : "（缺少峰值标签，无法保证防削波）"}`;
}

export function ReplayGainSettings() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState(() => playerEngine.getReplayGainState());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void loadSettings().then((settings) => {
      if (disposed) return;
      playerEngine.setReplayGainEnabled(settings.replayGainEnabled === true);
      setEnabled(settings.replayGainEnabled === true);
      setReady(true);
    }).catch((error) => { if (!disposed) setError(`读取播放设置失败：${String(error)}`); });
    const unsubscribe = playerEngine.subscribe(() => {
      const next = playerEngine.getReplayGainState();
      setState((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    });
    return () => { disposed = true; mounted.current = false; unsubscribe(); };
  }, []);

  const change = async (value: boolean) => {
    setPending(true); setError("");
    try {
      await patchSettings({ replayGainEnabled: value });
      playerEngine.setReplayGainEnabled(value);
      if (mounted.current) setEnabled(value);
      const current = playerEngine.getState().currentMusic;
      if (value && current?.source === "local" && current.localPath) {
        const updated = await readLocalReplayGain(current);
        useLibraryStore.getState().updateSong(updated.id, { replayGain: updated.replayGain, replayGainError: updated.replayGainError });
        playerEngine.updateCurrentMusic(updated);
      }
    } catch (error) {
      if (mounted.current) setError(`ReplayGain 设置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (mounted.current) setPending(false); }
  };

  return <div className="af-settings-card">
    <label className="af-settings-checkbox-label">
      <input type="checkbox" aria-label="本地 ReplayGain 音量平衡" checked={enabled} disabled={!ready || pending}
        onChange={(event) => change(event.target.checked)} />
      本地 ReplayGain 音量平衡
    </label>
    <p className="af-settings-hint">读取文件已有的曲目增益标签，不自动分析响度，也不修改文件。用户音量和静音独立保留。</p>
    <p className="af-settings-hint" role="status">{pending ? "正在保存并读取标签..." : describe(state)}</p>
    {error && <p className="af-settings-error" role="alert">{error}</p>}
  </div>;
}
