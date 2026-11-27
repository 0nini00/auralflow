import { useEffect, useId, useRef, useState } from "react";
import { CloudSyncRefusalError } from "@lx/core";
import { useCustomSourceStore } from "@/stores/customSourceStore";
import { updateSettings, useLoadedSettings, type SettingsPatch } from "@/stores/settingsStore";
import { confirmAction } from "@/components/ui/ConfirmDialog";

interface WebdavConfig {
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavAutoSyncPlaylists: boolean;
}
type WebdavField = keyof WebdavConfig;

/**
 * 表单提交的顺序屏障，不保存任何设置值（值在 settingsStore）。
 * 它管的是表单自己的事：轮到某次提交时才取「当时还没保存的编辑」一起写，
 * 并且轮到时页面已经离开的提交直接作废——这两点都要在「真正发出写入的那一刻」判断。
 */
let webdavWriteQueue: Promise<boolean> = Promise.resolve(true);

export function SyncSettingsSection() {
  const formId = useId();
  const featureEnabled = useCustomSourceStore((state) => state.featureEnabled);
  const featureReady = useCustomSourceStore((state) => state.featureReady);
  const sourcesSyncEnabled = featureReady && featureEnabled;
  const savedUrl = useLoadedSettings((s) => s.webdavUrl ?? "");
  const savedUser = useLoadedSettings((s) => s.webdavUsername ?? "");
  const savedPass = useLoadedSettings((s) => s.webdavPassword ?? "");
  const savedAutoSync = useLoadedSettings((s) => s.webdavAutoSyncPlaylists);
  // 还没保存的编辑；保存成功后清掉，输入框回到设置里的值。
  const [drafts, setDrafts] = useState<Partial<WebdavConfig>>({});
  const [configError, setConfigError] = useState("");
  const [dirtyCount, setDirtyCount] = useState(0);
  const [savingCount, setSavingCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const lifecycleRef = useRef({ active: false });
  // 每次编辑都有独立标记，旧保存完成不能清除同字段的新编辑（包括 A → B → A）。
  const dirtyFieldsRef = useRef(new Map<WebdavField, { value: string | boolean }>());
  const webdavUrl = drafts.webdavUrl ?? savedUrl;
  const webdavUser = drafts.webdavUsername ?? savedUser;
  const webdavPass = drafts.webdavPassword ?? savedPass;
  const autoSyncPlaylists = drafts.webdavAutoSyncPlaylists ?? savedAutoSync;

  useEffect(() => {
    const lifecycle = { active: true };
    lifecycleRef.current = lifecycle;
    return () => { lifecycle.active = false; };
  }, []);

  const editConfig = <K extends WebdavField>(field: K, value: WebdavConfig[K]) => {
    setDrafts((current) => ({ ...current, [field]: value }));
    const persistedValue = typeof value === "string" && field !== "webdavPassword" ? value.trim() : value;
    dirtyFieldsRef.current.set(field, { value: persistedValue });
    setDirtyCount(dirtyFieldsRef.current.size);
    setSaved(false);
  };

  /** 已保存的编辑不再是草稿：从 dirty 与 drafts 里一起拿掉（期间又被改过的字段保留）。 */
  const settleSavedEdits = (snapshot: Map<WebdavField, { value: string | boolean }>) => {
    const settled = [...snapshot].filter(([field, edit]) => dirtyFieldsRef.current.get(field) === edit).map(([field]) => field);
    for (const field of settled) dirtyFieldsRef.current.delete(field);
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !settled.includes(field as WebdavField))));
    setDirtyCount(dirtyFieldsRef.current.size);
    setSaved(dirtyFieldsRef.current.size === 0);
  };

  const saveWebdavConfig = async (): Promise<boolean> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle.active) return false;
    setSavingCount((count) => count + 1);
    let submitted = false;
    const write = async () => {
      // 排队时仍在页面，不代表真正轮到写入时仍在同一个生命周期。
      if (!lifecycle.active) return false;
      const snapshot = new Map(dirtyFieldsRef.current);
      if (snapshot.size === 0) return true;
      setConfigError("");
      submitted = true;
      await updateSettings(Object.fromEntries([...snapshot].map(([field, edit]) => [field, edit.value])) as SettingsPatch);
      if (lifecycle.active) settleSavedEdits(snapshot);
      return true;
    };
    try {
      // 写入失败由对应调用方报告，之后仍允许重试。
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
    setSyncError(false);
    setSyncStatus(label + "…");
    try {
      if (!(await saveWebdavConfig())) {
        if (lifecycle.active) {
          setSyncError(true);
          setSyncStatus("配置未保存，未执行同步；请处理上方错误后重试");
        }
        return;
      }
      if (!lifecycle.active) return;
      const result = await action();
      if (lifecycle.active && typeof result === "string") {
        setSyncStatus(result);
      }
    } catch (e) {
      if (lifecycle.active) {
        setSyncError(true);
        setSyncStatus(e instanceof Error ? e.message : String(e));
      }
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

  const handleDownloadSources = async () => {
    const ok = await confirmAction({
      title: "下载音源",
      message: "从 WebDAV 下载音源将覆盖本地自定义音源。",
      confirmLabel: "下载并覆盖",
      danger: true,
    });
    if (!ok) return;
    void runSync("下载音源", async () => {
      const { downloadSourcesSync } = await import("@/services/webdavSyncService");
      try {
        await downloadSourcesSync();
        return "已从 WebDAV 下载音源";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof CloudSyncRefusalError) {
          if (await confirmAction({
            title: "云端数据较旧",
            message: `${msg}

是否强制用云端覆盖本地？`,
            confirmLabel: "强制覆盖",
            danger: true,
          })) {
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

  const handleDownloadPlaylists = async () => {
    const ok = await confirmAction({
      title: "下载歌单与历史",
      message: "将从 WebDAV 合并下载（并集去重，保留本地独有内容）。",
      confirmLabel: "下载",
    });
    if (!ok) return;
    void runSync("下载歌单历史", async () => {
      const { downloadPlaylistsSync } = await import("@/services/webdavSyncService");
      try {
        await downloadPlaylistsSync();
        return "已从 WebDAV 下载歌单和历史";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof CloudSyncRefusalError) {
          if (await confirmAction({
            title: "云端数据较旧",
            message: `${msg}

是否强制用云端覆盖本地？`,
            confirmLabel: "强制覆盖",
            danger: true,
          })) {
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
      <p className="af-settings-hint">用于备份/恢复自定义音源、收藏、本地歌单和播放历史。下载前会检查云端是否比本地旧，并自动备份当前本地数据。自定义音源脚本会以明文上传到 WebDAV。</p>

      <p className="af-settings-hint" role="status" aria-live="polite">
        {savingCount > 0 ? "保存中..." : dirtyCount > 0 ? "有未保存的修改" : saved ? "配置已保存" : ""}
      </p>
      {configError && (
        <div role="alert" className="af-settings-error">
          <p>{configError}</p>
          <button type="button" className="af-settings-small-button" disabled={savingCount > 0} onClick={handleInputBlur}>重试保存</button>
        </div>
      )}

      <div className="af-settings-group">
        <label className="af-settings-label" htmlFor={`${formId}-url`}>WebDAV 地址</label>
        <input
          id={`${formId}-url`}
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
        <label className="af-settings-label" htmlFor={`${formId}-username`}>用户名</label>
        <input
          id={`${formId}-username`}
          className="af-settings-input"
          value={webdavUser}
          onChange={(e) => editConfig("webdavUsername", e.target.value)}
          onBlur={handleInputBlur}
          disabled={syncBusy}
          autoComplete="off"
        />
      </div>

      <div className="af-settings-group">
        <label className="af-settings-label" htmlFor={`${formId}-password`}>密码</label>
        <input
          id={`${formId}-password`}
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
        <div className="af-settings-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span className="af-settings-hint" style={{ margin: 0 }}>
            开启后每次启动应用自动与云端合并下载并上传收敛（需填完上方配置）
          </span>
          <input
            type="checkbox"
            className="af-switch"
            role="switch"
            aria-label="启动时自动同步歌单历史"
            checked={autoSyncPlaylists}
            disabled={savingCount > 0 || syncBusy}
            onChange={(e) => { void handleToggleAutoSync(e.target.checked); }}
          />
        </div>
      </div>

      <div className="af-settings-action-group">
        <span className="af-settings-label">连接</span>
        <div className="af-settings-input-group">
          <button type="button" className="af-settings-small-button" onClick={handleTest} disabled={syncBusy}>测试连接</button>
        </div>
      </div>

      <div className="af-settings-action-group">
        <span className="af-settings-label">音源</span>
        <p className="af-settings-hint">自定义音源脚本会以明文上传到 WebDAV，请确认云端存储可信。</p>
        <div className="af-settings-input-group">
          <button type="button" className="af-settings-small-button" onClick={handleUploadSources} disabled={syncBusy || !sourcesSyncEnabled}>上传音源</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadSources} disabled={syncBusy || !sourcesSyncEnabled}>下载音源</button>
        </div>
        {!sourcesSyncEnabled && (
          <p className="af-settings-hint">
            {!featureReady
              ? "正在恢复 LX 自定义音源状态，音源上传和下载暂不可用；歌单和历史同步不受影响。"
              : "LX 自定义音源已停用，音源上传和下载已暂停；本地及云端音源数据保留，歌单和历史同步不受影响。已发送的远端请求无法撤回。"}
          </p>
        )}
      </div>

      <div className="af-settings-action-group">
        <span className="af-settings-label">歌单与历史</span>
        <div className="af-settings-input-group">
          <button type="button" className="af-settings-small-button" onClick={handleUploadPlaylists} disabled={syncBusy}>上传歌单历史</button>
          <button type="button" className="af-settings-small-button" onClick={handleDownloadPlaylists} disabled={syncBusy}>下载歌单历史</button>
        </div>
      </div>

      {syncStatus && (
        <p
          className={`af-settings-hint${syncError ? " is-error" : ""}`}
          role={syncError ? "alert" : "status"}
        >
          {syncBusy ? "同步中：" : ""}{syncStatus}
        </p>
      )}
    </section>
  );
}
