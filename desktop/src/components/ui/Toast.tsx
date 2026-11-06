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
  /** 暂停后剩余时间（毫秒） */
  remaining: number;
  startedAt?: number;
  timer?: number;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  const item = items.find((entry) => entry.id === id);
  if (item?.timer) window.clearTimeout(item.timer);
  items = items.filter((entry) => entry.id !== id);
  emit();
}

function schedule(item: ToastItem, duration: number) {
  item.remaining = duration;
  item.startedAt = Date.now();
  item.timer = window.setTimeout(() => dismiss(item.id), duration);
}

/** 悬停/聚焦时暂停计时，离开后按剩余时间继续 —— WCAG 2.2.1。 */
function pauseToast(id: number) {
  const item = items.find((entry) => entry.id === id);
  if (!item?.timer) return;
  window.clearTimeout(item.timer);
  item.timer = undefined;
  item.remaining = Math.max(0, item.remaining - (Date.now() - (item.startedAt ?? Date.now())));
}

function resumeToast(id: number) {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.timer || item.remaining <= 0) return;
  item.startedAt = Date.now();
  item.timer = window.setTimeout(() => dismiss(item.id), item.remaining);
}

export function showToast(message: string, options: ToastOptions = {}): number {
  const id = nextId++;
  const item: ToastItem = {
    id,
    message,
    kind: options.kind ?? "success",
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    remaining: 0,
  };
  // 最多同时 3 条：再多就变成噪音，把最旧的一条挤掉（连同计时器一起清掉）
  for (const dropped of items.slice(0, Math.max(0, items.length - 2))) {
    if (dropped.timer) window.clearTimeout(dropped.timer);
  }
  items = [...items.slice(-2), item];
  emit();

  // 带「撤销」的提示要留出反应时间：2.6s 连读完都紧张。
  const duration = options.duration ?? (item.actionLabel ? 6000 : item.kind === "error" ? 4000 : 2600);
  schedule(item, duration);
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
          <div
            key={item.id}
            className={`af-toast af-toast-${item.kind}`}
            role="status"
            aria-live="polite"
            onMouseEnter={() => pauseToast(item.id)}
            onMouseLeave={() => resumeToast(item.id)}
            onFocus={() => pauseToast(item.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeToast(item.id);
            }}
          >
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
