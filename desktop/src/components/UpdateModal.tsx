import { useEffect, useState } from "react";
import { ArrowRight, Download, Loader2, Sparkles, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useUpdateStore } from "@/stores/updateStore";
import { flushLibraryPersistence } from "@/stores/libraryPersistence";
import { installPendingUpdate, type UpdateProgress } from "@/services/updateService";

/**
 * 软件更新弹窗。
 *
 * 与旧版的区别：旧版只把用户送进浏览器手动下载；现在点「立即更新」会直接下载、
 * 验签、静默安装，并在装完后由安装器把应用重新拉起（NSIS passive + `/R /ARGS`，
 * 见 tauri-plugin-updater 与 tauri-bundler 的 installer.nsi）。
 *
 * Windows 上安装步骤是**终态**：Rust 侧一调起安装器就 `exit(0)`，这个组件的
 * Promise 不会正常返回。所以「安装中」态必须自己画出来，不能等返回值。
 */
type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installing" }
  | { kind: "failed"; reason: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function UpdateModal() {
  const info = useUpdateStore((s) => s.available);
  const setAvailable = useUpdateStore((s) => s.setAvailable);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const latestVersion = info?.latestVersion;

  const busy = phase.kind === "downloading" || phase.kind === "installing";

  // 换了待装版本（或重新打开弹窗）就重置阶段，免得把上一次的进度/错误带过来
  useEffect(() => {
    setPhase({ kind: "idle" });
  }, [latestVersion]);

  useEffect(() => {
    if (!info || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAvailable(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [info, busy, setAvailable]);

  if (!info) return null;

  const close = () => {
    if (!busy) setAvailable(null);
  };

  const handleInstall = async () => {
    setPhase({ kind: "downloading", downloaded: 0, total: null });
    try {
      // Rust 侧一调起安装器就 exit(0)，不走 JS 的 pagehide/visibilitychange，
      // 所以先把可能还在 debounce 里的写盘落盘，否则会丢最后一批收藏/歌单/历史。
      await flushLibraryPersistence();
      await installPendingUpdate((progress: UpdateProgress) => {
        setPhase(
          progress.readyToInstall
            ? { kind: "installing" }
            : { kind: "downloading", downloaded: progress.downloaded, total: progress.total },
        );
      });
      // 正常情况下在 Windows 上走不到这里（进程已被安装器接管并在装完后重新拉起）
      setPhase({ kind: "installing" });
    } catch (error) {
      setPhase({
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const percent =
    phase.kind === "downloading" && phase.total && phase.total > 0
      ? Math.min(100, Math.round((phase.downloaded / phase.total) * 100))
      : null;

  const buttonLabel =
    phase.kind === "downloading"
      ? percent == null
        ? "下载中…"
        : `下载中 ${percent}%`
      : phase.kind === "installing"
        ? "安装中…"
        : phase.kind === "failed"
          ? "重试"
          : "立即更新";

  const dateText = formatDate(info.date);

  return (
    <div className="af-dialog-overlay af-update-overlay" onClick={close}>
      <div
        className="af-dialog af-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-update-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="af-update-hero">
          <span className="af-update-hero-badge" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <div className="af-update-hero-text">
            <h2 id="af-update-title">发现新版本</h2>
            <p>{dateText ? `${dateText}发布` : "可立即下载并安装"}</p>
          </div>
          <button
            type="button"
            className="af-menu-trigger"
            onClick={close}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="af-update-versions">
          <span className="af-update-chip">当前 {info.currentVersion}</span>
          <ArrowRight size={16} className="af-update-arrow" aria-hidden="true" />
          <span className="af-update-chip af-update-chip-new">最新 {info.latestVersion}</span>
        </div>

        <div className="af-update-notes">
          <div className="af-update-notes-label">更新内容</div>
          <div className="af-update-notes-body">
            {info.notes || "本次发布未附更新说明。"}
          </div>
        </div>

        {phase.kind === "downloading" && (
          <div className="af-update-progress" role="status" aria-live="polite">
            <div className="af-update-progress-row">
              <span>正在下载安装包…</span>
              <span className="af-update-progress-num">
                {phase.total
                  ? `${formatBytes(phase.downloaded)} / ${formatBytes(phase.total)}`
                  : formatBytes(phase.downloaded)}
              </span>
            </div>
            <div className="af-update-progress-track">
              <div
                className={
                  percent == null
                    ? "af-update-progress-fill af-update-progress-fill-indeterminate"
                    : "af-update-progress-fill"
                }
                style={percent == null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {phase.kind === "installing" && (
          <div className="af-update-notice" role="status" aria-live="polite">
            <Loader2 size={16} className="af-spin" aria-hidden="true" />
            <span>正在安装。应用会自动退出，并在安装完成后自动重新打开。</span>
          </div>
        )}

        {phase.kind === "failed" && (
          <div className="af-update-error" role="alert">
            <strong>自动更新失败</strong>
            <p>{phase.reason}</p>
            <button
              type="button"
              className="af-update-link"
              onClick={() => void open(info.releaseUrl).catch(() => undefined)}
            >
              打开发布页手动下载
            </button>
          </div>
        )}

        <footer className="af-dialog-actions">
          <button type="button" className="af-btn-secondary" onClick={close} disabled={busy}>
            {phase.kind === "failed" ? "关闭" : "稍后再说"}
          </button>
          <button
            type="button"
            className="af-btn-primary"
            onClick={() => void handleInstall()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={16} className="af-spin" aria-hidden="true" />
            ) : (
              <Download size={16} />
            )}
            <span>{buttonLabel}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
