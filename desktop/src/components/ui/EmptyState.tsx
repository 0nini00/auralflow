import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** 主行动（通常是「重试」「扫描文件夹」这类下一步） */
  action?: ReactNode;
  /** error 时图标换成告警色 */
  tone?: "neutral" | "error";
  className?: string;
}

/**
 * 空态/错误态的唯一形态：图标 + 一句话 + 说明 + 可选主行动。
 *
 * 硬规则：页面没有内容时必须给下一步，不允许出现纯空白页面
 * （历史上搜索页就是一片空白）。
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral",
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`af-empty-state ${tone === "error" ? "af-empty-state-error" : ""} ${className}`.trim()} role={tone === "error" ? "alert" : "status"}>
      {Icon ? <Icon size={30} strokeWidth={1.6} aria-hidden="true" /> : null}
      <p>{title}</p>
      {description ? <span>{description}</span> : null}
      {action ? <div className="af-empty-state-action">{action}</div> : null}
    </div>
  );
}
