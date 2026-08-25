import React from "react";
import { type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

import { IconButton as SharedIconButton } from "@/components/ui/IconButton";
import { type IconButtonControlSize } from "@/theme/tokens";

export type IconButtonTone = "default" | "strong" | "primary" | "danger" | "onImage";
export type IconButtonVariant = "plain" | "surface" | "filled" | "accent";

export interface IconButtonProps {
  render: (props: { size: number; color: string }) => React.ReactNode;
  accessibilityLabel: string;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: IconButtonTone;
  variant?: IconButtonVariant;
  selected?: boolean;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
}

const SIZE_MAP: Record<NonNullable<IconButtonProps["size"]>, IconButtonControlSize> = {
  sm: "compact",
  md: "standard",
  lg: "large",
  xl: "large",
};

const TONE_MAP: Record<IconButtonTone, "default" | "muted" | "inverse" | "danger" | "translucent"> = {
  default: "muted",
  strong: "default",
  primary: "inverse",
  danger: "danger",
  onImage: "translucent",
};

/** 旧 IconButton 接口兼容层；所有几何和按压状态由 ui/IconButton 统一提供。 */
export function IconButton({ size = "md", tone = "default", ...props }: IconButtonProps) {
  return <SharedIconButton {...props} size={SIZE_MAP[size]} tone={TONE_MAP[tone]} />;
}
