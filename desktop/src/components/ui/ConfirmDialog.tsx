import { useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮用错误色 */
  danger?: boolean;
}

interface ConfirmDialogProps {
  options: ConfirmOptions;
  onResolve: (value: boolean) => void;
}

function ConfirmDialog({ options, onResolve }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialogFocus({
    open: true,
    containerRef: dialogRef,
    onClose: () => onResolve(false),
  });

  return (
    <div
      className="af-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <div
        ref={dialogRef}
        className="af-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{options.title}</h2>
        {options.message ? (
          <div className="af-dialog-body">
            <p style={{ whiteSpace: "pre-line" }}>{options.message}</p>
          </div>
        ) : null}
        <div className="af-dialog-actions">
          <button
            type="button"
            className="af-btn-secondary"
            data-dialog-initial-focus
            onClick={() => onResolve(false)}
          >
            {options.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className={`af-btn-primary${options.danger ? " af-confirm-danger" : ""}`}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 命令式确认框：替代原生 `window.confirm`。
 *
 * - 样式跟随主题，不阻塞渲染线程（原生 confirm 会冻结进度条与封面氛围动画）；
 * - 复用 `useDialogFocus`：Esc 关闭、Tab 焦点陷阱、关闭后焦点回到触发点；
 * - 危险操作默认把初始焦点放在「取消」上，避免回车误删。
 */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  const normalized: ConfirmOptions = typeof options === "string"
    ? { title: "请确认", message: options }
    : options;

  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
      queueMicrotask(() => {
        root.unmount();
        container.remove();
      });
    };

    root.render(<ConfirmDialog options={normalized} onResolve={finish} />);
  });
}
