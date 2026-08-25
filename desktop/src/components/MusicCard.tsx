import { Play } from "lucide-react";
import type { ReactNode } from "react";

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
  const activate = onPlay ?? onClick;
  const actionVerb = onPlay ? "播放" : "打开";
  const hitLabel = subtitle ? `${actionVerb} ${title} - ${subtitle}` : `${actionVerb} ${title}`;

  return (
    <div className={`af-music-card af-music-card-${size}`}>
      <div className={coverClass}>
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="af-cover-placeholder" />
        )}
        {/* 悬停时浮现的播放图标是纯装饰，点击由下面覆盖整卡的按钮接管。
            这里不能用 IconButton：它渲染真 button，放在 aria-hidden 容器里
            依然可聚焦，会造成「焦点落在 aria-hidden 元素上」的可访问性错误。 */}
        {onPlay && (
          <span className="af-music-card-play" aria-hidden="true">
            <span className="af-icon-btn af-icon-btn-md">
              <Play size={20} strokeWidth={1.5} />
            </span>
          </span>
        )}
      </div>
      <div className="af-music-card-info">
        <div className="af-music-card-title-row">
          <div className="af-music-card-title" title={title}>
            {/* stretched button：伪元素铺满整卡，既保留整卡可点的手感，
                又只暴露一个可聚焦、有名称的交互元素给键盘和读屏。 */}
            {activate ? (
              <button
                type="button"
                className="af-music-card-hit"
                onClick={activate}
                aria-label={hitLabel}
              >
                {title}
              </button>
            ) : (
              title
            )}
          </div>
          {actions && <div className="af-music-card-actions">{actions}</div>}
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
