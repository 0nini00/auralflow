import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Headphones } from "lucide-react";
import type { MusicInfo } from "@lx/core";
import { cloudQualityLabel } from "@lx/core";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";

interface DownloadQualityButtonProps {
  song: MusicInfo;
  className?: string;
  iconSize?: number;
  title?: string;
}

export interface DownloadQualityMenuProps {
  song: MusicInfo;
  /** 触发按钮：菜单按它的位置定位，Esc 关闭后焦点交还给它 */
  anchor: HTMLElement;
  onClose: () => void;
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

/**
 * 受控的音质选择菜单（portal + 按触发按钮定位 + Esc 关闭）。
 * 长列表整表共用一个实例即可，不必每行各建一份状态与 store 订阅。
 */
export function DownloadQualityMenu({ song, anchor, onClose }: DownloadQualityMenuProps) {
  const menuId = useId();
  const [position] = useState(() => getMenuPosition(anchor));
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const songKey = `${song.source}:${song.id}`;
  const addDownload = useDownloadStore((s) => s.addDownload);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setPendingQuality(null);
    setError("");
  }, [songKey]);

  useEffect(() => {
    // 归属由实际 anchor 声明，同时覆盖按钮封装与列表共享的受控菜单入口。
    const previousControls = anchor.getAttribute("aria-controls");
    anchor.setAttribute("aria-controls", previousControls ? `${previousControls} ${menuId}` : menuId);
    // 先声明归属，再聚焦 portal，父弹窗才能将菜单纳入同一 Tab 序列。
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onCloseRef.current();
      anchor.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousControls === null) anchor.removeAttribute("aria-controls");
      else anchor.setAttribute("aria-controls", previousControls);
    };
  }, [anchor, menuId]);

  const close = () => {
    setError("");
    onClose();
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

  return createPortal(
    <>
      <div className="af-add-menu-backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={menuRef}
        id={menuId}
        className="af-dropdown-menu af-add-menu"
        role="menu"
        style={{ position: "fixed", top: position.top, left: position.left, width: MENU_WIDTH, zIndex: 9999 }}
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
  );
}

export function DownloadQualityButton({
  song,
  className = "af-action-btn",
  iconSize = 16,
  title = "下载",
}: DownloadQualityButtonProps) {
  // 云盘曲不做转码：请求哪个档位都是同一份上传文件，音质菜单只会误导用户，
  // 直接下载原文件（并保留其内嵌标签/歌词）即可。
  if (song.wyCloud === true) {
    return (
      <CloudDownloadButton
        song={song}
        className={className}
        iconSize={iconSize}
        title={`下载云盘原文件${cloudQualityLabel(song.cloudMeta?.bitrate) ? `（${cloudQualityLabel(song.cloudMeta?.bitrate)}）` : ""}`}
      />
    );
  }
  return <QualityDownloadButton song={song} className={className} iconSize={iconSize} title={title} />;
}

interface CloudDownloadButtonProps {
  song: MusicInfo;
  className: string;
  iconSize: number;
  title: string;
}

/** 云盘曲的下载入口：单击直接下载原文件，失败时在按钮下方给出原因。 */
function CloudDownloadButton({ song, className, iconSize, title }: CloudDownloadButtonProps) {
  const addDownload = useDownloadStore((s) => s.addDownload);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (pending) return;
    const trigger = event.currentTarget;
    setPending(true);
    setError("");
    try {
      await addDownload(song);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAnchor(trigger);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={handleClick}
        title={title}
        aria-label={title}
        aria-busy={pending}
        disabled={pending}
      >
        <Download size={iconSize} />
      </button>
      {error && anchor && (
        <CloudDownloadError message={error} anchor={anchor} onClose={() => setError("")} />
      )}
    </>
  );
}

function CloudDownloadError({
  message,
  anchor,
  onClose,
}: {
  message: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const width = 260;
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const top = rect.bottom + 8 + 80 > window.innerHeight ? Math.max(8, rect.top - 88) : rect.bottom + 8;

  return createPortal(
    <>
      <div className="af-add-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="af-dropdown-menu af-add-menu"
        role="alert"
        style={{ position: "fixed", top, left, width, zIndex: 9999 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="af-add-menu-status af-add-menu-error">{message}</div>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </>,
    document.body,
  );
}

function QualityDownloadButton({
  song,
  className,
  iconSize,
  title,
}: DownloadQualityButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // currentTarget 在事件派发结束后会被置空，先取出再进 updater
    const trigger = event.currentTarget;
    setAnchor((current) => (current ? null : trigger));
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
        aria-expanded={anchor != null}
      >
        <Download size={iconSize} />
      </button>

      {anchor && (
        <DownloadQualityMenu
          key={`${song.source}:${song.id}`}
          song={song}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}