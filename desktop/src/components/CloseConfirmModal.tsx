import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ackCloseRequest, resolveCloseRequest } from "@lx/tauri-bridge";
import { useDialogFocus } from "@/hooks/useDialogFocus";

type CloseAction = "tray" | "quit";

/**
 * 关闭主窗口时的确认框（首次关闭 / 用户在设置里要求再问一次时出现）。
 *
 * Rust 侧在「还没回答过」时会 prevent 掉真正的 close 再 emit("app-close-requested")，
 * 所以窗口还在、前端有机会把选择问清楚：最小化到托盘 还是 退出应用。
 * 勾了「记住我的选择」才写盘（closeToTray + closePromptSeen），之后关窗直接执行、
 * 不再打扰；没勾则本次生效、下次仍问。
 *
 * 「取消」只关掉弹窗：close 已被拦下，窗口保持原样继续用。
 */
export function CloseConfirmModal() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unlistenPromise = listen("app-close-requested", () => {
      // 先告诉 Rust「框已经出来了」，取消它的无人应答兜底：用户想多久都行。
      void ackCloseRequest().catch(() => undefined);
      setError("");
      setVisible(true);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
  useDialogFocus({
    open: visible,
    containerRef: dialogRef,
    closeOnEscape: true,
    onClose: () => setVisible(false),
  });

  if (!visible) return null;

  const answer = async (action: CloseAction) => {
    setBusy(true);
    setError("");
    try {
      await resolveCloseRequest(action, remember);
      // 「退出应用」走 Rust 侧 700ms 后的 exit，这里先把弹窗收掉避免闪一下。
      setVisible(false);
    } catch (err) {
      setError(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="af-dialog-overlay af-close-confirm-overlay">
      <div
        ref={dialogRef}
        className="af-dialog af-close-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-close-confirm-title"
      >
        <h2 id="af-close-confirm-title">关闭 AuralFlow？</h2>
        <div className="af-dialog-body">
          <p>关闭主窗口后应用会继续在系统托盘运行，音乐不会中断；也可以在托盘图标上右键退出。</p>
          <label className="af-close-confirm-remember">
            <input
              type="checkbox"
              className="af-switch"
              role="switch"
              aria-label="记住我的选择"
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>记住我的选择（之后可在 设置 → 其他 → 窗口与启动 修改）</span>
          </label>
          {error && (
            <p className="af-settings-hint" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="af-dialog-actions">
          <button type="button" className="af-btn-secondary" disabled={busy} onClick={() => setVisible(false)}>
            取消
          </button>
          <button type="button" className="af-btn-secondary" disabled={busy} onClick={() => void answer("quit")}>
            退出应用
          </button>
          <button
            type="button"
            className="af-btn-primary"
            data-dialog-initial-focus
            disabled={busy}
            onClick={() => void answer("tray")}
          >
            最小化到托盘
          </button>
        </div>
      </div>
    </div>
  );
}
