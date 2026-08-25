import { useEffect, useState } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";
import { SettingRow } from "./SettingRow";
import { setPlaybackFailedAutoNext } from "../../stores/playerStore";

export function MiscSettingsSection() {
  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const [autoNextOnFailed, setAutoNextOnFailed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setCursorEffect(s.cursorEffect === "trail" ? "trail" : "off");
        setAutoNextOnFailed(s.playbackFailedAutoNext === true);
      })
      .catch((error) => {
        setUpdateStatus(`读取设置失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);

  const handleCursorChange = async (mode: "off" | "trail") => {
    const previousMode = cursorEffect;
    setCursorEffect(mode);
    setUpdateStatus("");
    try {
      await patchSettings({ cursorEffect: mode });
      window.dispatchEvent(new Event("af-cursor-change"));
    } catch (error) {
      setCursorEffect(previousMode);
      setUpdateStatus(`保存鼠标特效失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleAutoNextChange = async (enabled: boolean) => {
    const previous = autoNextOnFailed;
    setAutoNextOnFailed(enabled);
    setPlaybackFailedAutoNext(enabled);
    setUpdateStatus("");
    try {
      await patchSettings({ playbackFailedAutoNext: enabled });
    } catch (error) {
      setAutoNextOnFailed(previous);
      setPlaybackFailedAutoNext(previous);
      setUpdateStatus(`保存播放失败设置失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("检查中...");
    try {
      const { checkForUpdates } = await import("@/services/updateService");
      const info = await checkForUpdates();
      setUpdateStatus(info ? `发现新版本 ${info.latestVersion}（当前 ${info.currentVersion}）` : "已是最新版本");
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="af-settings-section" id="misc">
      <h2 className="af-settings-section-title">其他</h2>
      <div className="af-settings-card">
        <SettingRow label="鼠标拖尾特效" hint="跟随鼠标的衰减圆点，纯装饰">
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            checked={cursorEffect === "trail"}
            onChange={(e) => handleCursorChange(e.target.checked ? "trail" : "off")}
          />
        </SettingRow>
        <SettingRow label="播放失败自动下一首" hint="开启后，播放中出错会自动跳下一首；私人 FM 始终连播">
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            checked={autoNextOnFailed}
            onChange={(e) => void handleAutoNextChange(e.target.checked)}
          />
        </SettingRow>
        <SettingRow label="软件更新" hint={updateStatus || "检查 AuralFlow 新版本"}>
          <button type="button" className="af-settings-small-button" onClick={handleCheckUpdate}>检查更新</button>
        </SettingRow>
      </div>
    </section>
  );
}
