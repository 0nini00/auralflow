import { useEffect, useState } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";

export function SyncSettingsSection() {
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setWebdavUrl(s.webdavUrl ?? "");
      setWebdavUser(s.webdavUsername ?? "");
      setWebdavPass(s.webdavPassword ?? "");
    }).catch((error) => {
      setSyncStatus(`读取同步配置失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }, []);

  const saveWebdavConfig = async () => {
    await patchSettings({
      webdavUrl: webdavUrl.trim(),
      webdavUsername: webdavUser.trim(),
      webdavPassword: webdavPass,
    });
  };

  const runSync = async (label: string, action: () => Promise<void | string>) => {
    if (syncBusy) {
      setSyncStatus("同步进行中，请稍候…");
      return;
    }
    setSyncBusy(true);
    setSyncStatus(label + "…");
    try {
      const result = await action();
      if (typeof result === "string") {
        setSyncStatus(result);
      }
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  const handleTest = () => {
    void runSync("测试连接", async () => {
      await saveWebdavConfig();
      const { testSync } = await import("@/services/webdavSyncService");
      return testSync();
    });
  };

  const handleUploadSources = () => {
    void runSync("上传音源", async () => {
      await saveWebdavConfig();
      const { uploadSourcesSync } = await import("@/services/webdavSyncService");
      await uploadSourcesSync();
      setSyncStatus("已上传音源到 WebDAV");
    });
  };

  const handleDownloadSources = () => {
    if (!confirm("从 WebDAV 下载音源将覆盖本地自定义音源，确定继续？")) return;
    void runSync("下载音源", async () => {
      await saveWebdavConfig();
      const { downloadSourcesSync } = await import("@/services/webdavSyncService");
      try {
        await downloadSourcesSync();
        setSyncStatus("已从 WebDAV 下载音源");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("云端数据较旧") || msg.includes("强制下载")) {
          if (confirm(msg + "\n\n是否强制用云端覆盖本地？")) {
            await downloadSourcesSync({ force: true });
            setSyncStatus("已强制从 WebDAV 下载音源");
            return;
          }
        }
        throw e;
      }
    });
  };

  const handleUploadPlaylists = () => {
    void runSync("上传歌单历史", async () => {
      await saveWebdavConfig();
      const { uploadPlaylistsSync } = await import("@/services/webdavSyncService");
      await uploadPlaylistsSync();
      setSyncStatus("已上传歌单和历史到 WebDAV");
    });
  };

  const handleDownloadPlaylists = () => {
    if (!confirm("从 WebDAV 下载歌单和历史将与本地合并（并集去重，保留本地独有内容），确定继续？")) return;
    void runSync("下载歌单历史", async () => {
      await saveWebdavConfig();
      const { downloadPlaylistsSync } = await import("@/services/webdavSyncService");
      try {
        await downloadPlaylistsSync();
        setSyncStatus("已从 WebDAV 下载歌单和历史");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("云端数据较旧") || msg.includes("强制下载")) {
          if (confirm(msg + "\n\n是否强制用云端覆盖本地？")) {
            await downloadPlaylistsSync({ force: true });
            setSyncStatus("已强制从 WebDAV 下载歌单和历史");
            return;
          }
        }
        throw e;
      }
    });
  };

  return (
    <section className="af-settings-section">
      <h2 className="af-settings-section-title">WebDAV 同步</h2>
      <p className="af-settings-hint">用于备份/恢复自定义音源、收藏、本地歌单和播放历史。下载前会检查云端是否比本地旧，并自动备份当前本地数据。</p>

      <div className="af-settings-group">
        <label className="af-settings-label">WebDAV 地址</label>
        <input
          className="af-settings-input"
          value={webdavUrl}
          onChange={(e) => setWebdavUrl(e.target.value)}
          placeholder="https://dav.example.com/auralflow"
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">用户名</label>
        <input
          className="af-settings-input"
          value={webdavUser}
          onChange={(e) => setWebdavUser(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">密码</label>
        <input
          className="af-settings-input"
          type="password"
          value={webdavPass}
          onChange={(e) => setWebdavPass(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <div className="af-input-group" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="af-settings-small-button" onClick={handleTest} disabled={syncBusy}>测试连接</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadSources} disabled={syncBusy}>上传音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadSources} disabled={syncBusy}>下载音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadPlaylists} disabled={syncBusy}>上传歌单历史</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadPlaylists} disabled={syncBusy}>下载歌单历史</button>
        </div>
        {syncStatus && <p className="af-settings-hint">{syncBusy ? "同步中：" : ""}{syncStatus}</p>}
      </div>
    </section>
  );
}
