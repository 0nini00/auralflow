import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Touchable } from "@/components/Touchable";
import {
  isCloudUploadTaskTerminal,
  useCloudUploadStore,
  type CloudUploadTask,
  type CloudUploadTaskPhase,
} from "@/stores/cloudUploadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

function phaseLabel(task: CloudUploadTask): string {
  switch (task.phase) {
    case "queued":
      return "等待上传";
    case "hashing":
      return "计算校验值";
    case "checking":
      return "准备上传";
    case "uploading": {
      const percent = task.total > 0 ? Math.min(100, Math.round((task.loaded / task.total) * 100)) : 0;
      return `上传中 ${percent}%`;
    }
    case "completing":
      return "写入云盘";
    case "cancelling":
      return "正在取消";
    case "done":
      return "已完成";
    case "failed":
      return task.error || "上传失败";
    case "cancelled":
      return "已取消";
  }
}

/** 云盘页顶部的上传进度卡；无任务时不占空间。 */
export function CloudUploadPanel() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );
  const tasks = useCloudUploadStore((state) => state.tasks);
  const running = useCloudUploadStore((state) => state.running);
  const cancel = useCloudUploadStore((state) => state.cancel);
  const clear = useCloudUploadStore((state) => state.clear);

  if (tasks.length === 0) return null;

  const doneCount = tasks.filter((task) => task.phase === "done").length;
  const failedTasks = tasks.filter((task) => task.phase === "failed");
  const cancelledCount = tasks.filter((task) => task.phase === "cancelled").length;
  const activeTask = tasks.find((task) => !isCloudUploadTaskTerminal(task.phase));
  const activeIndex = activeTask ? tasks.indexOf(activeTask) : -1;
  const firstFailedTask = failedTasks[0];
  const percent = activeTask && activeTask.total > 0
    ? Math.min(100, Math.round((activeTask.loaded / activeTask.total) * 100))
    : doneCount === tasks.length
      ? 100
      : 0;
  const title = running
    ? `正在上传 ${activeIndex >= 0 ? activeIndex + 1 : doneCount}/${tasks.length}`
    : failedTasks.length > 0
      ? `上传结束：${doneCount} 首成功，${failedTasks.length} 首失败`
      : cancelledCount > 0
        ? doneCount > 0
          ? `已上传 ${doneCount} 首，${cancelledCount} 首取消`
          : `已取消 ${cancelledCount} 首`
        : `已上传 ${doneCount} 首`;

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
        <Touchable
          onPress={running ? cancel : clear}
          accessibilityRole="button"
          accessibilityLabel={running ? "取消云盘上传" : "关闭上传结果"}
          hitSlop={12}
        >
          <Text style={[styles.action, { color: palette.primaryInk }]}>
            {running ? "取消" : "关闭"}
          </Text>
        </Touchable>
      </View>
      <Text style={[styles.fileName, { color: palette.textMuted }]} numberOfLines={1}>
        {activeTask ? activeTask.fileName : tasks[tasks.length - 1]?.fileName}
      </Text>
      <Text style={[styles.phase, { color: firstFailedTask && !running ? palette.danger : palette.textMuted }]} numberOfLines={1}>
        {activeTask
          ? phaseLabel(activeTask)
          : firstFailedTask
            ? phaseLabel(firstFailedTask)
            : cancelledCount > 0
              ? "已取消"
              : "上传完成"}
      </Text>
      <View style={[styles.track, { backgroundColor: palette.surfaceMuted }]}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: palette.primaryInk }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.s,
    marginBottom: spacing.m,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  action: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  fileName: {
    fontSize: typography.caption,
  },
  phase: {
    fontSize: typography.micro,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
});
