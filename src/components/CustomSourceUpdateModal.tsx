import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useCustomSourceStore, type CustomSourceItem } from "@/stores/customSourceStore";
import { logAsyncError } from "@/utils/logAsyncError";

const OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT = "af-open-custom-source-update-modal";

interface OpenCustomSourceUpdateModalDetail {
  sourceId: string;
}

export function openCustomSourceUpdateModal(sourceId: string) {
  window.dispatchEvent(new CustomEvent<OpenCustomSourceUpdateModalDetail>(
    OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT,
    { detail: { sourceId } },
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
  const sources = useCustomSourceStore((state) => state.sources);
  const [requestedSourceId, setRequestedSourceId] = useState<string | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const sourceId = (event as CustomEvent<OpenCustomSourceUpdateModalDetail>).detail?.sourceId;
      if (sourceId) setRequestedSourceId(sourceId);
    };

    window.addEventListener(OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_CUSTOM_SOURCE_UPDATE_MODAL_EVENT, handleOpen);
  }, []);

  const source = useMemo(
    () => {
      const requestedSource = requestedSourceId
        ? sources.find((item) => item.id === requestedSourceId && item.updateStatus === "available")
        : undefined;
      if (requestedSource) return requestedSource;

      return sources.find((item) => {
        if (item.updateStatus === "available" && item.allowShowUpdateAlert !== false) {
          return !dismissedKeys.has(buildDismissKey(item));
        }
        return false;
      });
    },
    [dismissedKeys, requestedSourceId, sources],
  );

  if (!source) return null;

  const dismissKey = buildDismissKey(source);
  const updateLog = getUpdateLog(source);

  const handleClose = () => {
    setRequestedSourceId(null);
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(dismissKey);
      return next;
    });
  };

  const handleOpenUpdateUrl = () => {
    if (!source.updateUrl) {
      handleClose();
      return;
    }
    void open(source.updateUrl).catch(logAsyncError("custom-source:update-open-url"));
    handleClose();
  };

  return (
    <div className="af-dialog-overlay" onClick={handleClose}>
      <div
        className="af-dialog af-custom-source-update-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="af-custom-source-update-bar" />

        <div className="af-dialog-body af-custom-source-update-body">
          <p className="af-custom-source-update-heading">
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
