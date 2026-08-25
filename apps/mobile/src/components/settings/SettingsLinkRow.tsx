import React from "react";
import { StyleSheet } from "react-native";

import { ChevronRight } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { ListItemButton } from "@/components/ui/ListItemButton";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing } from "@/theme/tokens";

interface SettingsLinkRowProps {
  title: string;
  subtitle: string;
  onPress: () => void;
  /** 行尾内容：不传时默认渲染主色箭头；传 null 则完全不渲染尾部（纯文字行） */
  trailing?: React.ReactNode;
  /** 禁用态（如检查更新进行中） */
  disabled?: boolean;
  /** 副标题用主色渲染（如更新状态文案） */
  subtitleAccent?: boolean;
}

export function SettingsLinkRow({ title, subtitle, onPress, trailing, disabled = false, subtitleAccent = false }: SettingsLinkRowProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const trailingContent =
    trailing !== undefined ? trailing : <ChevronRight size={18} color={palette.primary} />;

  return (
    <SettingsCard style={styles.rowCard}>
      <ListItemButton
        title={title}
        subtitle={subtitle}
        subtitleColor={subtitleAccent ? palette.primary : undefined}
        trailing={trailingContent}
        disabled={disabled}
        accessibilityLabel={title}
        onPress={onPress}
        style={styles.row}
      />
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    paddingVertical: spacing.xs,
  },
  row: {
    marginHorizontal: -spacing.xs,
  },
});
