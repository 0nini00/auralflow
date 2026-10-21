import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = 页面唯一主行动；secondary = 次级；ghost = 纯文字；danger = 破坏性操作 */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconSize?: number;
  /** 占满容器宽度 */
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "af-btn-primary",
  secondary: "af-btn-secondary",
  ghost: "af-ui-btn-ghost",
  danger: "af-ui-btn-danger",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "af-ui-btn-sm",
  md: "",
  lg: "af-ui-btn-lg",
};

/**
 * 统一按钮。样式仍由 buttons.css 的 `af-btn-*` 承担，
 * 这里只负责变体/尺寸的类名映射，避免每个页面各写一套。
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconSize,
  block = false,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "af-ui-btn",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block ? "af-ui-btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {Icon ? <Icon size={iconSize ?? (size === "lg" ? 18 : 16)} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
