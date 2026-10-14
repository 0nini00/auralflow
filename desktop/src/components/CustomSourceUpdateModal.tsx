import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";

const OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT = "af-open-custom-source-update-modal";
const DISMISSED_KEYS_STORAGE = "af-custom-source-update-dismissed";

function loadDismissedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEYS_STORAGE);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissedKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEYS_STORAGE, JSON.stringify([...keys]));
  } catch {
    // ignore storage failures (quota / disabled storage)
  }
}

interface OpenCustomSourceUpdateModalDetail {
  sourceId: string;
  /** 设置页「查看更新」等用户主动动作：不受会话一次限制 */
  manual?: boolean;
}

/**
 * 本次会话内已自动弹过更新弹窗的音源 id。
 * 脚本在每次播放/取链时都可能上报 updateAlert,且每次上报都会刷新 updateCheckedAt
 * (dismissKey 随之变化,localStorage 里的「已关闭」记录永远追不上),
 * 不加会话去重的话弹窗会频繁重开。产品语义:不退出软件,每个音源只自动弹一次;
 * 设置页手动查看不受限。
 */
const sessionAutoShownSourceIds = new Set<string>();

/** 仅供测试重置会话状态 */
export function __resetCustomSourceUpdateSessionForTests(): void {
  sessionAutoShownSourceIds.clear();
}

export function openCustomSourceUpdateModal(sourceId: string, options?: { manual?: boolean }) {
  window.dispatchEvent(new CustomEvent<OpenCustomSourceUpdateModalDetail>(
    OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT,
    { detail: { sourceId, manual: options?.manual } },
  ));
}

function buildDismissKey(source: CustomSourceItem): string {
  return [
    source.id,
    source.updateCheckedAt ?? source.updatedAt,
    source.updateUrl ?? "",
    source.updateLog ?? source.updateMessage ?? "",
  ].join(":");
}

function getUpdateLog(source: CustomSourceItem): string {
  return source.updateLog || source.updateMessage || "自定义音源提示有新版本";
}

export function CustomSourceUpdateModal() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const sources = useCustomSourceStore((state) => state.sources);
  const featureEnabled = useCustomSourceStore((state) => state.featureEnabled);
  const featureReady = useCustomSourceStore((state) => state.featureReady);
  const [requestedSourceId, setRequestedSourceId] = useState<string | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => loadDismissedKeys());

  useEffect(() => {
    if (!featureEnabled || !featureReady) setRequestedSourceId(null);
  }, [featureEnabled, featureReady]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const state = useCustomSourceStore.getState();
      if (!state.featureEnabled || !state.featureReady) return;
      const detail = (event as CustomEvent<OpenCustomSourceUpdateModalDetail>).detail;
      const sourceId = detail?.sourceId;
      if (!sourceId) return;
      // 运行时上报的自动弹窗:每个音源本次会话只弹一次,
      // 用户关闭后脚本反复上报也不再打扰;设置页手动查看(manual)不受限
      if (!detail.manual && sessionAutoShownSourceIds.has(sourceId)) return;
      setRequestedSourceId(sourceId);
    };

    window.addEventListener(OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT, handleOpen);
  }, []);

  const source = useMemo(
    () => {
      if (!featureEnabled || !featureReady) return undefined;
      const requestedSource = requestedSourceId
        ? sources.find((item) => item.id === requestedSourceId && item.updateStatus === "available")
        : undefined;
      if (requestedSource) return requestedSource;

      return sources.find((item) => {
        if (item.updateStatus === "available" && item.allowShowUpdateAlert !== false) {
          // 本会话已自动弹过的音源不再进入自动扫描(脚本每次上报都会刷新
          // updateCheckedAt,单靠 dismissedKeys 挡不住反复重弹)
          if (sessionAutoShownSourceIds.has(item.id)) return false;
          return !dismissedKeys.has(buildDismissKey(item));
        }
        return false;
      });
    },
    [dismissedKeys, requestedSourceId, sources, featureEnabled, featureReady],
  );

  // 弹窗实际展示的音源记入会话集合:本次会话内不再自动弹出
  useEffect(() => {
    if (source) sessionAutoShownSourceIds.add(source.id);
  }, [source]);

  const handleClose = () => {
    if (!source) return;
    const dismissKey = buildDismissKey(source);
    setRequestedSourceId(null);
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(dismissKey);
      persistDismissedKeys(next);
      return next;
    });
  };

  useDialogFocus({ open: !!source, containerRef: dialogRef, onClose: handleClose });

  if (!source) return null;
  const updateLog = getUpdateLog(source);

  const handleOpenUpdateUrl = () => {
    if (!source.updateUrl) {
      handleClose();
      return;
    }
    void open(source.updateUrl).catch(() => undefined);
    handleClose();
  };

  return (
    <div className="af-dialog-overlay af-custom-source-update-overlay" onClick={handleClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-custom-source-update-title"
        className="af-dialog af-custom-source-update-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="af-custom-source-update-bar" />

        <div className="af-dialog-body af-custom-source-update-body">
          <p id="af-custom-source-update-title" className="af-custom-source-update-heading">
            自定义源【{source.name}】发现新版本：
          </p>
          <div className="af-custom-source-update-log">{updateLog}</div>
        </div>

        <div className="af-dialog-actions af-custom-source-update-actions">
          <button className="af-btn-secondary" onClick={handleClose}>
            关闭
          </button>
          {source.updateUrl && (
            <button className="af-btn-secondary" onClick={handleOpenUpdateUrl}>
              <ExternalLink size={16} />
              <span>打开更新地址</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
