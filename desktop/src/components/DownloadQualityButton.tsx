import { useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Headphones } from "lucide-react";
import type { MusicInfo } from "@lx/core";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";

interface DownloadQualityButtonProps {
  song: MusicInfo;
  className?: string;
  iconSize?: number;
  title?: string;
}

const MENU_WIDTH = 180;
const MENU_HEIGHT_ESTIMATE = 230;

const QUALITY_OPTIONS: { value: DownloadQuality; label: string }[] = [
  { value: "128k", label: "标准 128K" },
  { value: "192k", label: "较高 192K" },
  { value: "320k", label: "高品质 320K" },
  { value: "flac", label: "无损 FLAC" },
  { value: "flac24bit", label: "Hi-Res" },
];

function getMenuPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
  const belowTop = rect.bottom + 6;
  const top = belowTop + MENU_HEIGHT_ESTIMATE > window.innerHeight
    ? Math.max(8, rect.top - MENU_HEIGHT_ESTIMATE - 6)
    : belowTop;

  return { top, left };
}

export function DownloadQualityButton({
  song,
  className = "af-action-btn",
  iconSize = 16,
  title = "下载",
}: DownloadQualityButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [error, setError] = useState("");
  const addDownload = useDownloadStore((s) => s.addDownload);

  const close = () => {
    setOpen(false);
    setError("");
  };

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuPos(getMenuPosition(event.currentTarget));
    setError("");
    setOpen((value) => !value);
  };

  const handleDownload = async (event: MouseEvent<HTMLButtonElement>, quality: DownloadQuality) => {
    event.stopPropagation();
    setPendingQuality(quality);
    setError("");
    try {
      await addDownload(song, quality);
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingQuality(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleToggle}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download size={iconSize} />
      </button>

      {open && menuPos && createPortal(
        <>
          <div className="af-add-menu-backdrop" onClick={close} aria-hidden="true" />
          <div
            className="af-dropdown-menu af-add-menu"
            role="menu"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH, zIndex: 9999 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="af-add-menu-label">
              <Headphones size={13} />
              <span>选择下载音质</span>
            </div>
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={(event) => handleDownload(event, option.value)}
                disabled={pendingQuality != null}
              >
                <Download size={14} />
                <span>{pendingQuality === option.value ? "下载中..." : option.label}</span>
              </button>
            ))}
            {error && <div className="af-add-menu-status af-add-menu-error">{error}</div>}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
