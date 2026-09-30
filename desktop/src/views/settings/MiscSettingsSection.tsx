import { useEffect, useState } from "react";
import { loadSettings, openLogDir, patchSettings } from "@lx/tauri-bridge";
import { SettingRow } from "./SettingRow";
import { setPlaybackFailedAutoNext } from "../../stores/playerStore";
import { logger } from "@/services/logger";
import { checkForUpdate } from "@/services/updateService";
import { useUpdateStore } from "../../stores/updateStore";

export function MiscSettingsSection() {
  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const [autoNextOnFailed, setAutoNextOnFailed] = useState(false);
  const [followSystemMediaControl, setFollowSystemMediaControl] = useState(true);
  const [taskbarThumbnails, setTaskbarThumbnails] = useState(true);
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setCursorEffect(s.cursorEffect === "trail" ? "trail" : "off");
        setAutoNextOnFailed(s.playbackFailedAutoNext === true);
        setFollowSystemMediaControl(s.followSystemMediaControl !== false);
        setTaskbarThumbnails(s.taskbarThumbnails !== false);
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

  const handleFollowSystemMediaControlChange = async (enabled: boolean) => {
    const previous = followSystemMediaControl;
    setFollowSystemMediaControl(enabled);
    setUpdateStatus("");
    try {
      await patchSettings({ followSystemMediaControl: enabled });
      // 通知 smtcService 重新读设置并启用 / 释放系统媒体控制会话
      window.dispatchEvent(new Event("af-smtc-change"));
    } catch (error) {
      setFollowSystemMediaControl(previous);
      setUpdateStatus(
        `保存系统媒体控制设置失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleTaskbarThumbnailsChange = async (enabled: boolean) => {
    const previous = taskbarThumbnails;
    setTaskbarThumbnails(enabled);
    setUpdateStatus("");
    try {
      await patchSettings({ taskbarThumbnails: enabled });
      // 通知 taskbarService 重新读设置并启用 / 卸载任务栏缩略图钩子
      window.dispatchEvent(new Event("af-taskbar-change"));
    } catch (error) {
      setTaskbarThumbnails(previous);
      setUpdateStatus(
        `保存任务栏缩略图设置失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("检查中…");
    try {
      const result = await checkForUpdate();
      if (result.kind === "available") {
        setUpdateStatus(`发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}）`);
        // 手动检查发现新版本就直接把弹窗打开，省得用户再去别处找入口
        useUpdateStore.getState().setAvailable(result);
      } else if (result.kind === "latest") {
        setUpdateStatus(`已是最新版本（当前 ${result.currentVersion || "未知"}）`);
      } else {
        setUpdateStatus(`检查更新失败：${result.reason}`);
      }
    } catch (error) {
      // checkForUpdate 契约上不抛错；留着兜底是为了将来改动不会把设置页整块打崩
      setUpdateStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenLogDir = async () => {
    try {
      await openLogDir();
    } catch (error) {
      // 打开目录失败只记日志：日志是诊断设施，不该为它弹错误框打断用户
      logger.warn("[设置] 打开日志目录失败", error);
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
        <SettingRow
          label="跟随系统媒体控制"
          hint="键盘媒体键、系统媒体浮层与锁屏控制可直接操作播放，并显示当前曲目与封面"
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            checked={followSystemMediaControl}
            onChange={(e) => void handleFollowSystemMediaControlChange(e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          label="任务栏缩略图按钮与封面预览"
          hint="悬停任务栏图标时显示上一首 / 播放暂停 / 下一首按钮，并把窗口快照预览换成当前曲目封面"
        >
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            checked={taskbarThumbnails}
            onChange={(e) => void handleTaskbarThumbnailsChange(e.target.checked)}
          />
        </SettingRow>
        <SettingRow label="软件更新" hint={updateStatus || "检查 AuralFlow 新版本"}>
          <button type="button" className="af-settings-small-button" onClick={handleCheckUpdate}>检查更新</button>
        </SettingRow>
        <SettingRow
          label="运行日志"
          hint="落盘到本地 logs 目录（单文件 2 MiB、保留 3 份），排查问题时可取用"
        >
          <button
            type="button"
            className="af-settings-small-button"
            onClick={() => void handleOpenLogDir()}
          >
            打开日志目录
          </button>
        </SettingRow>
      </div>
    </section>
  );
}
