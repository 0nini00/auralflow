import { useEffect, useRef, useState } from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";

/**
 * 轻提示（toast）—— 非阻塞的操作反馈。
 *
 * 为什么需要它：桌面端此前「加入歌单 / 加入喜欢」成功后直接关闭菜单，
 * 用户没有任何确认；移动端则用 Alert 弹窗，连「导入成功」都要点一下「好」。
 * 两种都不对：一次轻操作不应该打断播放，也不应该完全没有回声。
 *
 * 用法（命令式，不需要包 provider）：
 *   showToast("已加入「深夜歌单」");
 *   showToast("已从歌单移除", { actionLabel: "撤销", onAction: undo });
 *
 * 与对话框的分工：只有「需要用户做决定」或「必须中断」的场景才用 dialog，
 * 成功/已复制/已加入一律走这里。
 */

export type ToastKind = "success" | "info" | "error";

export interface ToastOptions {
  kind?: ToastKind;
  /** 毫秒；错误默认停留更久 */
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem extends Required<Pick<ToastOptions, "kind">> {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function showToast(message: string, options: ToastOptions = {}): number {
  const id = nextId++;
  const item: ToastItem = {
    id,
    message,
    kind: options.kind ?? "success",
    actionLabel: options.actionLabel,
    onAction: options.onAction,
  };
  // 最多同时 3 条：再多就变成噪音，把最旧的一条挤掉
  items = [...items.slice(-2), item];
  emit();

  // 带「撤销」的提示要留出反应时间：2.6s 连读完都紧张。
  const duration = options.duration ?? (item.actionLabel ? 6000 : item.kind === "error" ? 4000 : 2600);
  window.setTimeout(() => dismiss(id), duration);
  return id;
}

const KIND_ICON = {
  success: Check,
  info: Info,
  error: TriangleAlert,
} as const;

export function ToastHost() {
  const [visible, setVisible] = useState<ToastItem[]>(items);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener: Listener = (next) => {
      if (mounted.current) setVisible(next);
    };
    listeners.add(listener);
    listener(items);
    return () => {
      mounted.current = false;
      listeners.delete(listener);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div className="af-toast-host" role="region" aria-label="操作提示">
      {visible.map((item) => {
        const Icon = KIND_ICON[item.kind];
        return (
          <div key={item.id} className={`af-toast af-toast-${item.kind}`} role="status" aria-live="polite">
            <Icon size={16} aria-hidden="true" className="af-toast-icon" />
            <span className="af-toast-text">{item.message}</span>
            {item.actionLabel ? (
              <button
                type="button"
                className="af-toast-action"
                onClick={() => {
                  item.onAction?.();
                  dismiss(item.id);
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
            <button type="button" className="af-toast-close" aria-label="关闭提示" onClick={() => dismiss(item.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
