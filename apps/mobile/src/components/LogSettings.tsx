import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { FileText } from "lucide-react-native";

import { SectionHeader } from "@/components/SectionHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/Button";
import { formatCacheSize } from "@/services/cacheService";
import { clearLogs, getLogDirectoryPath, getLogStorageInfo, type LogStorageInfo } from "@/services/logger";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

const LOG_DIRECTORY = getLogDirectoryPath();

/**
 * 「运行日志」设置块（存储与数据页）。
 *
 * 移动端没有「打开目录」的系统能力，所以这里只展示目录路径 + 体积，并提供「清理日志」。
 * 强调按钮沿用 `ui/Button` 的 primary 约定：表面色底 + 强调色文字 + 细边框，不做实心填充。
 */
export function LogSettings() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [info, setInfo] = useState<LogStorageInfo | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInfo(await getLogStorageInfo());
    } catch {
      // 目录读不到（IO/权限异常）时退化为「未知」态，设置页不能因此报错
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClear = () => {
    if (clearing) return;
    setClearing(true);
    void (async () => {
      try {
        const deleted = await clearLogs();
        await refresh();
        Alert.alert("已清理日志", deleted > 0 ? `已删除 ${deleted} 个日志文件` : "日志目录本来就是空的");
      } catch (error) {
        Alert.alert("清理失败", error instanceof Error ? error.message : String(error));
      } finally {
        setClearing(false);
      }
    })();
  };

  const sizeText = info === null
    ? "日志目录读取失败，可稍后重试"
    : `${info.fileCount} 个文件 · ${formatCacheSize(info.totalBytes)}`;

  return (
    <View style={styles.section}>
      <SectionHeader
        title="运行日志"
        description="同步、下载等失败原因会记在这里，报问题时把日志内容贴到 issue 里"
      />
      <SettingsCard style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowTitleWrap}>
            <FileText size={18} color={palette.primary} />
            <Text style={[styles.rowTitle, { color: palette.text }]}>日志目录</Text>
          </View>
          <Text
            accessibilityLabel={`日志目录 ${LOG_DIRECTORY}`}
            selectable
            style={[styles.path, { color: palette.textMuted }]}
          >
            {LOG_DIRECTORY}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            当前文件形如 app-YYYY-MM-DD.log；单个文件上限 1 MiB（超限截断），启动时清理 7 天前的日志。
          </Text>
        </View>
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="polite" style={[styles.size, { color: palette.text }]}>
            {sizeText}
          </Text>
          <Button
            label="清理日志"
            disabled={clearing}
            loading={clearing}
            accessibilityLabel="清理日志，删除全部日志文件"
            onPress={handleClear}
            style={styles.clearButton}
          />
        </View>
      </SettingsCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  card: {
    gap: spacing.s,
  },
  row: {
    gap: spacing.xxs,
  },
  rowTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  rowTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  path: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  meta: {
    fontSize: typography.caption,
    lineHeight: 17,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
  },
  size: {
    flexShrink: 1,
    fontSize: typography.meta,
    fontWeight: "600",
  },
  clearButton: {
    alignSelf: "flex-end",
  },
});
