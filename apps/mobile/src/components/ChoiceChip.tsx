import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";

import { Chip } from "@/components/ui/Chip";

export interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** 常驻深色场景（视频/图片上）：白色系配色，不走主题 palette */
  onImage?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * 全 app 统一的选择芯片（单选组中的单个选项）。
 * 用于设置页的音质档位、主题模式、歌词字号等离散选择场景。
 * 视觉规范：选中 = 主色描边 + 主色浅底 + 主色文字；未选中 = surface 底 + hairline 边框 + 欮文字。
 * 与 IconButton/ActionButton 构成按键三原语：图标键、文字键、选择键。
 */
export function ChoiceChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  disabled = false,
  onImage = false,
  style,
}: ChoiceChipProps) {
  return (
    <Chip
      label={label}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      style={style}
      onImage={onImage}
    />
  );
}
