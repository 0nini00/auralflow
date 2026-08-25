import React from "react";
import { ActivityIndicator, Text, type StyleProp, type ViewStyle } from "react-native";

import { Button } from "@/components/ui/Button";

export interface ActionButtonProps {
  label: string;
  count?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  grow?: boolean;
  shrink?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** 旧详情页动作按钮的兼容接口，视觉和状态由共享 Button 提供。 */
export function ActionButton({
  label,
  count,
  variant = "secondary",
  disabled = false,
  loading = false,
  onPress,
  accessibilityLabel,
  grow = false,
  shrink = false,
  small = false,
  style,
}: ActionButtonProps) {
  const mappedVariant = variant === "danger" ? "danger" : variant;
  return (
    <Button
      label={label}
      variant={mappedVariant}
      size={small ? "small" : "medium"}
      disabled={disabled}
      loading={loading}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={[grow && styles.grow, shrink && styles.shrink, style]}
      trailing={count ? <Text style={styles.count}>{count}</Text> : undefined}
    />
  );
}

const styles = {
  grow: { flexGrow: 1 } satisfies ViewStyle,
  shrink: { flexGrow: 1, flexShrink: 1, flexBasis: 0 } satisfies ViewStyle,
  count: { opacity: 0.72 } satisfies ViewStyle,
};
