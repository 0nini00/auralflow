import { useCallback, useEffect, useRef, useState } from "react";
import { loadSettings, patchSettings } from "@lx/tauri-bridge";
import { CloudSyncRefusalError } from "@lx/core";
import { useCustomSourceStore } from "@/stores/customSourceStore";

interface WebdavConfig {
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavAutoSyncPlaylists: boolean;
}
type WebdavField = keyof WebdavConfig;

// 仅保存操作的顺序屏障，不保留设置副本；新实例的读取也等待已发写入收敛。
let webdavWriteQueue: Promise<boolean> = Promise.resolve(true);

export function SyncSettingsSection() {
  const featureEnabled = useCustomSourceStore((state) => state.featureEnabled);
  const featureReady = useCustomSourceStore((state) => state.featureReady);
  const sourcesSyncEnabled = featureReady && featureEnabled;
  const [config, setConfig] = useState<WebdavConfig>({
    webdavUrl: "", webdavUsername: "", webdavPassword: "", webdavAutoSyncPlaylists: false,
  });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [configError, setConfigError] = useState("");
  const [dirtyCount, setDirtyCount] = useState(0);
  const [savingCount, setSavingCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const lifecycleRef = useRef({ active: false });
  // 每次编辑都有独立标记，旧保存完成不能清除同字段的新编辑（包括 A → B → A）。
  const dirtyFieldsRef = useRef(new Map<WebdavField, { value: string | boolean }>());
  const loadRequestRef = useRef<Promise<Awaited<ReturnType<typeof loadSettings>> | null> | null>(null);
  const { webdavUrl, webdavUsername: webdavUser, webdavPassword: webdavPass, webdavAutoSyncPlaylists: autoSyncPlaylists } = config;

  const loadConfig = useCallback(() => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle.active) return;
    setLoadState("loading");
    setConfigError("");
    // null 表示读取开始前已离开页面，不以空配置代替失败或取消。
    const read = () => lifecycle.active ? loadSettings() : null;
    const request = webdavWriteQueue.then(read, read);
    loadRequestRef.current = request;
    void request.then((settings) => {
      if (!lifecycle.active || settings === null || loadRequestRef.current !== request) return;
      const loaded: WebdavConfig = {
        webdavUrl: settings.webdavUrl ?? "",
        webdavUsername: settings.webdavUsername ?? "",
        webdavPassword: settings.webdavPassword ?? "",
        webdavAutoSyncPlaylists: Boolean(settings.webdavAutoSyncPlaylists),
      };
      // 只恢复未编辑字段，加载期间允许输入，但保存必须等待读取成功。
      const dirty = new Set(dirtyFieldsRef.current.keys());
      setConfig((current) => ({
        webdavUrl: dirty.has("webdavUrl") ? current.webdavUrl : loaded.webdavUrl,
        webdavUsername: dirty.has("webdavUsername") ? current.webdavUsername : loaded.webdavUsername,
        webdavPassword: dirty.has("webdavPassword") ? current.webdavPassword : loaded.webdavPassword,
        webdavAutoSyncPlaylists: dirty.has("webdavAutoSyncPlaylists") ? current.webdavAutoSyncPlaylists : loaded.webdavAutoSyncPlaylists,
      }));
      setLoadState("ready");
    }, (error) => {
      if (!lifecycle.active || loadRequestRef.current !== request) return;
      setLoadState("failed");
      setConfigError("读取同步配置失败：" + (error instanceof Error ? error.message : String(error)));
    });
  }, []);

  useEffect(() => {
    const lifecycle = { active: true };
    lifecycleRef.current = lifecycle;
    loadConfig();
    return () => { lifecycle.active = false; };
  }, [loadConfig]);

  const editConfig = <K extends WebdavField>(field: K, value: WebdavConfig[K]) => {
    setConfig((current) => ({ ...current, [field]: value }));
    const persistedValue = typeof value === "string" && field !== "webdavPassword" ? value.trim() : value;
    dirtyFieldsRef.current.set(field, { value: persistedValue });
    setDirtyCount(dirtyFieldsRef.current.size);
    setSaved(false);
  };

  const saveWebdavConfig = (): Promise<boolean> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle.active) return Promise.resolve(false);
    setSavingCount((count) => count + 1);
    const request = loadRequestRef.current;
    const persist = async () => {
      let submitted = false;
      try {
        if (!request) throw new Error("同步配置尚未开始读取");
        const loaded = await request;
        if (!lifecycle.active || loaded === null) return false;
        const write = async () => {
          // 排队时仍在页面，不代表真正轮到写入时仍在同一个生命周期。
          if (!lifecycle.active) return false;
          const snapshot = new Map(dirtyFieldsRef.current);
          if (snapshot.size === 0) return true;
          setConfigError("");
          submitted = true;
          await patchSettings(Object.fromEntries([...snapshot].map(([field, edit]) => [field, edit.value])));
          if (lifecycle.active) {
            for (const [field, edit] of snapshot) {
              if (dirtyFieldsRef.current.get(field) === edit) dirtyFieldsRef.current.delete(field);
            }
            setDirtyCount(dirtyFieldsRef.current.size);
            setSaved(dirtyFieldsRef.current.size === 0);
          }
          return true;
        };
        // 只将已完成初始化的保存排队；卸载后的慢读取不能阻塞新页面。
        // 写入失败由对应调用方报告，之后仍允许读取磁盘及重试。
        const queued = webdavWriteQueue.then(write, write);
        webdavWriteQueue = queued;
        return await queued;
      } catch (error) {
        if (lifecycle.active) {
          setConfigError("保存同步配置失败：" + (error instanceof Error ? error.message : String(error)));
        } else if (submitted) {
          console.error("离开同步设置后已提交的配置保存失败", error);
        }
        return false;
      } finally {
        if (lifecycle.active) setSavingCount((count) => count - 1);
      }
    };
    return persist();
  };

  const handleToggleAutoSync = async (enabled: boolean) => {
    const lifecycle = lifecycleRef.current;
    if (enabled && (!webdavUrl.trim() || !webdavUser.trim() || !webdavPass)) {
      setSyncStatus("请先填写 WebDAV 地址、用户名和密码");
      return;
    }
    editConfig("webdavAutoSyncPlaylists", enabled);
    if (await saveWebdavConfig() && lifecycle.active) {
      setSyncStatus(enabled ? "已开启启动时自动同步（配置已保存，下次启动生效）" : "已关闭启动时自动同步");
    }
  };

  const handleInputBlur = () => { void saveWebdavConfig(); };

  const runSync = async (label: string, action: () => Promise<void | string>) => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle.active) return;
    if (syncBusy) {
      setSyncStatus("同步进行中，请稍候…");
      return;
    }
    setSyncBusy(true);
    setSyncStatus(label + "…");
    try {
      if (!(await saveWebdavConfig())) {
        if (lifecycle.active) setSyncStatus("配置未保存，未执行同步；请处理上方错误后重试");
        return;
      }
      if (!lifecycle.active) return;
      const result = await action();
      if (lifecycle.active && typeof result === "string") {
        setSyncStatus(result);
      }
    } catch (e) {
      if (lifecycle.active) setSyncStatus(e instanceof Error ? e.message : String(e));
    } finally {
      if (lifecycle.active) setSyncBusy(false);
    }
  };

  const handleTest = () => {
    void runSync("测试连接", async () => {
      const { testSync } = await import("@/services/webdavSyncService");
      return testSync();
    });
  };

  const handleUploadSources = () => {
    void runSync("上传音源", async () => {
      const { uploadSourcesSync } = await import("@/services/webdavSyncService");
      await uploadSourcesSync();
      return "已上传音源到 WebDAV";
    });
  };

  const handleDownloadSources = () => {
    if (!confirm("从 WebDAV 下载音源将覆盖本地自定义音源，确定继续？")) return;
    void runSync("下载音源", async () => {
      const { downloadSourcesSync } = await import("@/services/webdavSyncService");
      try {
        await downloadSourcesSync();
        return "已从 WebDAV 下载音源";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof CloudSyncRefusalError) {
          if (confirm(msg + "\n\n是否强制用云端覆盖本地？")) {
            await downloadSourcesSync({ force: true });
            return "已强制从 WebDAV 下载音源";
          }
        }
        throw e;
      }
    });
  };

  const handleUploadPlaylists = () => {
    void runSync("上传歌单历史", async () => {
      const { uploadPlaylistsSync } = await import("@/services/webdavSyncService");
      await uploadPlaylistsSync();
      return "已上传歌单和历史到 WebDAV";
    });
  };

  const handleDownloadPlaylists = () => {
    if (!confirm("从 WebDAV 下载歌单和历史将与本地合并（并集去重，保留本地独有内容），确定继续？")) return;
    void runSync("下载歌单历史", async () => {
      const { downloadPlaylistsSync } = await import("@/services/webdavSyncService");
      try {
        await downloadPlaylistsSync();
        return "已从 WebDAV 下载歌单和历史";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof CloudSyncRefusalError) {
          if (confirm(msg + "\n\n是否强制用云端覆盖本地？")) {
            await downloadPlaylistsSync({ force: true });
            return "已强制从 WebDAV 下载歌单和历史";
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

      <p className="af-settings-hint" role="status" aria-live="polite">
        {loadState === "loading" ? "正在读取配置，可先编辑；读取完成后才会保存。" : ""}
        {savingCount > 0 ? "保存中..." : dirtyCount > 0 ? "有未保存的修改" : saved ? "配置已保存" : ""}
      </p>
      {configError && (
        <div role="alert" className="af-settings-error">
          <p>{configError}</p>
          {loadState === "failed" ? (
            <button type="button" className="af-settings-small-button" onClick={loadConfig}>重新读取</button>
          ) : (
            <button type="button" className="af-settings-small-button" disabled={savingCount > 0} onClick={handleInputBlur}>重试保存</button>
          )}
        </div>
      )}

      <div className="af-settings-group">
        <label className="af-settings-label">WebDAV 地址</label>
        <input
          className="af-settings-input"
          value={webdavUrl}
          onChange={(e) => editConfig("webdavUrl", e.target.value)}
          onBlur={handleInputBlur}
          disabled={syncBusy}
          placeholder="https://dav.example.com/auralflow"
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">用户名</label>
        <input
          className="af-settings-input"
          value={webdavUser}
          onChange={(e) => editConfig("webdavUsername", e.target.value)}
          onBlur={handleInputBlur}
          disabled={syncBusy}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">密码</label>
        <input
          className="af-settings-input"
          type="password"
          value={webdavPass}
          onChange={(e) => editConfig("webdavPassword", e.target.value)}
          onBlur={handleInputBlur}
          disabled={syncBusy}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label">启动时自动同步歌单历史</label>
        <div className="af-settings-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={autoSyncPlaylists}
            disabled={loadState !== "ready" || savingCount > 0 || syncBusy}
            onChange={(e) => { void handleToggleAutoSync(e.target.checked); }}
          />
          <span className="af-settings-hint" style={{ margin: 0 }}>
            开启后每次启动应用自动与云端合并下载并上传收敛（需填完上方配置）
          </span>
        </div>
      </div>

      <div className="af-settings-group">
        <div className="af-input-group" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="af-settings-small-button" onClick={handleTest} disabled={syncBusy}>测试连接</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadSources} disabled={syncBusy || !sourcesSyncEnabled}>上传音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadSources} disabled={syncBusy || !sourcesSyncEnabled}>下载音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleUploadPlaylists} disabled={syncBusy}>上传歌单历史</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadPlaylists} disabled={syncBusy}>下载歌单历史</button>
        </div>
        {!sourcesSyncEnabled && (
          <p className="af-settings-hint">
            {!featureReady
              ? "正在恢复 LX 自定义音源状态，音源上传和下载暂不可用；歌单和历史同步不受影响。"
              : "LX 自定义音源已停用，音源上传和下载已暂停；本地及云端音源数据保留，歌单和历史同步不受影响。已发送的远端请求无法撤回。"}
          </p>
        )}
        {syncStatus && <p className="af-settings-hint">{syncBusy ? "同步中：" : ""}{syncStatus}</p>}
      </div>
    </section>
  );
}
