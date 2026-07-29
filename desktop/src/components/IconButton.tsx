import type { LucideIcon } from "lucide-react";

export interface IconButtonProps {
  icon: LucideIcon;
  ariaLabel: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}

export function IconButton({
  icon: Icon,
  ariaLabel,
  onClick,
  active,
  size = "md",
  className = "",
  disabled,
}: IconButtonProps) {
  const sizeClass = {
    sm: "af-icon-btn-sm",
    md: "af-icon-btn-md",
    lg: "af-icon-btn-lg",
  }[size];

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={`af-icon-btn ${sizeClass} ${active ? "af-icon-btn-active" : ""} ${className}`}
    >
      <Icon size={size === "sm" ? 16 : size === "lg" ? 24 : 20} strokeWidth={1.5} />
    </button>
  );
}
