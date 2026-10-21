import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { openLogDir } from "@lx/tauri-bridge";
import logoImg from "@/assets/logo.png";
import { logger } from "@/services/logger";
import { checkForUpdate, readAppVersion } from "@/services/updateService";
import { useUpdateStore } from "@/stores/updateStore";
import { SettingRow } from "./SettingRow";

const REPO_URL = "https://github.com/0nini00/auralflow";
const RELEASES_URL = `${REPO_URL}/releases`;

export function AboutSettingsSection() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let disposed = false;
    readAppVersion()
      .then((next) => {
        if (!disposed) setVersion(next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const handleCheckUpdate = async () => {
    setStatus("检查中…");
    try {
      const result = await checkForUpdate();
      if (result.kind === "available") {
        setStatus(`发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}）`);
        useUpdateStore.getState().setAvailable(result);
      } else if (result.kind === "latest") {
        setStatus(`已是最新版本（当前 ${result.currentVersion || "未知"}）`);
      } else {
        setStatus(`检查更新失败：${result.reason}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenLogDir = async () => {
    try {
      await openLogDir();
    } catch (error) {
      logger.warn("[设置] 打开日志目录失败", error);
      setStatus("打开日志目录失败，请检查日志设置。");
    }
  };

  const handleOpenExternal = (url: string) => {
    setStatus("");
    void open(url).catch((error) => {
      setStatus(`打开链接失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return (
    <section className="af-settings-section" id="about">
      <h2 className="af-settings-section-title">关于</h2>

      <div className="af-settings-about">
        <div className="af-settings-about-logo">
          <img src={logoImg} alt="AuralFlow" />
        </div>
        <h3 className="af-settings-about-title">AuralFlow</h3>
        <p className="af-settings-about-version">{version ? `版本 ${version}` : "版本 未知"}</p>
        <p className="af-settings-about-description">
          现代化的跨平台音乐播放器，基于 Tauri + React 构建。
        </p>
      </div>

      <div className="af-settings-card" style={{ marginTop: 16 }}>
        <SettingRow label="软件更新" hint={status || "检查 AuralFlow 新版本"}>
          <button type="button" className="af-settings-small-button" onClick={() => { void handleCheckUpdate(); }}>
            检查更新
          </button>
        </SettingRow>
        <SettingRow label="运行日志" hint="落盘到本地 logs 目录（单文件 2 MiB、保留 3 份），排查问题时可取用">
          <button type="button" className="af-settings-small-button" onClick={() => { void handleOpenLogDir(); }}>
            打开日志目录
          </button>
        </SettingRow>
        <SettingRow label="项目主页" hint="GitHub 仓库与问题反馈">
          <button
            type="button"
            className="af-settings-small-button"
            onClick={() => handleOpenExternal(REPO_URL)}
          >
            打开 GitHub
          </button>
        </SettingRow>
        <SettingRow label="发布说明" hint="查看各版本的更新内容与下载">
          <button
            type="button"
            className="af-settings-small-button"
            onClick={() => handleOpenExternal(RELEASES_URL)}
          >
            查看 Releases
          </button>
        </SettingRow>
      </div>
    </section>
  );
}
