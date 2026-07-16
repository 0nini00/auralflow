import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

export interface MusicCardProps {
  title: string;
  subtitle?: string;
  coverUrl?: string | null;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  onPlay?: () => void;
  actions?: ReactNode;
}

export function MusicCard({
  title,
  subtitle,
  coverUrl,
  size = "md",
  onClick,
  onPlay,
  actions,
}: MusicCardProps) {
  const coverClass = `af-music-card-cover af-music-card-cover-${size}`;

  return (
    <div
      className={`af-music-card af-music-card-${size}`}
      onClick={onPlay ?? onClick}
      title={onPlay || onClick ? "单击播放" : undefined}
    >
      <div
        className={coverClass}
        role={onPlay || onClick ? "button" : undefined}
        tabIndex={onPlay || onClick ? 0 : undefined}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="af-cover-placeholder" />
        )}
        {onPlay && (
          <div className="af-music-card-play" onClick={(e) => { e.stopPropagation(); onPlay(); }}>
            <IconButton icon={Play} ariaLabel="播放" size="md" />
          </div>
        )}
      </div>
      <div className="af-music-card-info">
        <div className="af-music-card-title-row">
          <div className="af-music-card-title" title={title}>
            {title}
          </div>
          {actions && (
            <div className="af-music-card-actions" onClick={(event) => event.stopPropagation()}>
              {actions}
            </div>
          )}
        </div>
        {subtitle && (
          <div className="af-music-card-subtitle" title={subtitle}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
