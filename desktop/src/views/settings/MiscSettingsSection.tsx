import { useEffect, useState } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";
import {
  disableAutostart,
  enableAutostart,
  isAutostartEnabled,
} from "@/services/autostartService";
import { SettingRow } from "./SettingRow";

export function MiscSettingsSection() {
  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const [followSystemMediaControl, setFollowSystemMediaControl] = useState(true);
  const [taskbarThumbnails, setTaskbarThumbnails] = useState(true);
  const [closeToTray, setCloseToTray] = useState(true);
  const [startMinimized, setStartMinimized] = useState(false);
  const [miniPlayerEnabled, setMiniPlayerEnabled] = useState(true);
  const [autostart, setAutostart] = useState(false);
  const [status, setStatus] = useState("");
  // 开发模式注册的是 target/debug 下的调试程序，不能把开发构建写进开机启动项。
  const autostartAvailable = !import.meta.env.DEV;

  useEffect(() => {
    loadSettings()
      .then((settings) => {
        setCursorEffect(settings.cursorEffect === "trail" ? "trail" : "off");
        setFollowSystemMediaControl(settings.followSystemMediaControl !== false);
        setTaskbarThumbnails(settings.taskbarThumbnails !== false);
        setCloseToTray(settings.closeToTray !== false);
        setStartMinimized(settings.startMinimized === true);
        setMiniPlayerEnabled(settings.miniPlayerEnabled !== false);
      })
      .catch((error) => {
        setStatus(`读取设置失败：${error instanceof Error ? error.message : String(error)}`);
      });
    if (autostartAvailable) {
      isAutostartEnabled().then(setAutostart).catch(() => undefined);
    }
  }, [autostartAvailable]);

  const saveBoolean = async (key: string, value: boolean, errorText: string): Promise<boolean> => {
    setStatus("");
    try {
      await patchSettings({ [key]: value });
      return true;
    } catch (error) {
      setStatus(`${errorText}：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const handleCursorChange = async (mode: "off" | "trail") => {
    const previous = cursorEffect;
    setCursorEffect(mode);
    setStatus("");
    try {
      await patchSettings({ cursorEffect: mode });
      window.dispatchEvent(new Event("af-cursor-change"));
    } catch (error) {
      setCursorEffect(previous);
      setStatus(`保存鼠标特效失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleFollowSystemMediaControlChange = async (enabled: boolean) => {
    const previous = followSystemMediaControl;
    setFollowSystemMediaControl(enabled);
    if (!(await saveBoolean("followSystemMediaControl", enabled, "保存系统媒体控制设置失败"))) {
      setFollowSystemMediaControl(previous);
      return;
    }
    window.dispatchEvent(new Event("af-smtc-change"));
  };

  const handleTaskbarThumbnailsChange = async (enabled: boolean) => {
    const previous = taskbarThumbnails;
    setTaskbarThumbnails(enabled);
    if (!(await saveBoolean("taskbarThumbnails", enabled, "保存任务栏缩略图设置失败"))) {
      setTaskbarThumbnails(previous);
      return;
    }
    window.dispatchEvent(new Event("af-taskbar-change"));
  };

  const handleCloseToTrayChange = async (enabled: boolean) => {
    const previous = closeToTray;
    setCloseToTray(enabled);
    setStatus("");
    try {
      // 用户在这里主动选过，就不再弹关闭确认框：否则下次关窗会拿弹窗里的选择覆盖这里。
      await patchSettings({ closeToTray: enabled, closePromptSeen: true });
    } catch (error) {
      setCloseToTray(previous);
      setStatus(`保存关闭行为失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** 忘掉「已经回答过关闭提示」，让下次关窗重新弹一次确认框。 */
  const handleAskCloseAgain = async () => {
    setStatus("");
    try {
      await patchSettings({ closePromptSeen: false });
      setStatus("下次关闭窗口时会再问一次");
    } catch (error) {
      setStatus(`保存关闭提示设置失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStartMinimizedChange = async (enabled: boolean) => {
    const previous = startMinimized;
    setStartMinimized(enabled);
    if (!(await saveBoolean("startMinimized", enabled, "保存启动行为失败"))) {
      setStartMinimized(previous);
    }
  };

  const handleMiniPlayerEnabledChange = async (enabled: boolean) => {
    const previous = miniPlayerEnabled;
    setMiniPlayerEnabled(enabled);
    if (!(await saveBoolean("miniPlayerEnabled", enabled, "保存迷你播放器设置失败"))) {
      setMiniPlayerEnabled(previous);
    }
  };

  const handleAutostartChange = async (enabled: boolean) => {
    if (!autostartAvailable) return;
    const previous = autostart;
    setAutostart(enabled);
    setStatus("");
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
    } catch (error) {
      setAutostart(previous);
      setStatus(`设置开机自启失败：${error instanceof Error ? error.message : String(error)}`);
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
            aria-label="鼠标拖尾特效"
            checked={cursorEffect === "trail"}
            onChange={(e) => { void handleCursorChange(e.target.checked ? "trail" : "off"); }}
          />
        </SettingRow>
        <SettingRow
          label="跟随系统媒体控制"
          hint="键盘媒体键、系统媒体浮层与锁屏控制可直接操作播放，并显示当前曲目与封面"
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="跟随系统媒体控制"
            checked={followSystemMediaControl}
            onChange={(e) => { void handleFollowSystemMediaControlChange(e.target.checked); }}
          />
        </SettingRow>
        <SettingRow
          label="任务栏缩略图按钮"
          hint="悬停任务栏图标时显示上一首 / 播放暂停 / 下一首按钮；缩略图内容仍是系统默认的窗口画面"
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="任务栏缩略图按钮"
            checked={taskbarThumbnails}
            onChange={(e) => { void handleTaskbarThumbnailsChange(e.target.checked); }}
          />
        </SettingRow>
      </div>

      <h3 className="af-settings-subsection-title">窗口与启动</h3>
      <div className="af-settings-card">
        <SettingRow label="关闭时最小化到托盘" hint="关闭主窗口后继续在托盘运行；关闭此项则关闭窗口即退出应用">
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="关闭时最小化到托盘"
            checked={closeToTray}
            onChange={(e) => { void handleCloseToTrayChange(e.target.checked); }}
          />
        </SettingRow>
        <SettingRow
          label="关闭窗口时再次询问"
          hint="首次关闭会弹一次确认框（最小化到托盘 / 退出应用）；想重新看到它就点这里"
        >
          <button
            type="button"
            className="af-btn-secondary"
            aria-label="关闭窗口时再次询问"
            onClick={() => void handleAskCloseAgain()}
          >
            下次再问一次
          </button>
        </SettingRow>
        <SettingRow label="启动时最小化" hint="启动时不显示主窗口，只保留托盘图标">
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="启动时最小化"
            checked={startMinimized}
            onChange={(e) => { void handleStartMinimizedChange(e.target.checked); }}
          />
        </SettingRow>
        <SettingRow
          label="托盘时显示迷你播放器"
          hint="隐藏到托盘后在桌面留一条迷你播放器（封面 / 歌名 / 上一首 / 播放暂停 / 下一首），可拖动、可记住位置，双击回到主窗口；托盘右键菜单里也能随时开关"
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="托盘时显示迷你播放器"
            checked={miniPlayerEnabled}
            onChange={(e) => { void handleMiniPlayerEnabledChange(e.target.checked); }}
          />
        </SettingRow>
        <SettingRow
          label="开机自启"
          hint={autostartAvailable
            ? "登录 Windows 后自动启动 AuralFlow（仍受上面的启动时最小化设置影响）"
            : "开发模式下不可用，打包安装后生效"}
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="开机自启"
            checked={autostart}
            disabled={!autostartAvailable}
            onChange={(e) => { void handleAutostartChange(e.target.checked); }}
          />
        </SettingRow>
      </div>

      {status && <p className="af-settings-hint" role="status">{status}</p>}
    </section>
  );
}
