import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  Modal,
  Switch,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { SectionHeader } from "@/components/SectionHeader";
import {
  useCustomSourceStore,
  type CustomSourceItem,
} from "@/stores/customSourceStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { pickCustomSourceScriptFile } from "@/services/customSourceFilePicker";
import { radius, touch, typography } from "@/theme/tokens";

interface CustomSourceScreenProps {
  onBack: () => void;
}

function openCustomSourceUpdateUrl(updateUrl?: string) {
  if (!updateUrl) return;
  void Linking.openURL(updateUrl);
}

export function CustomSourceScreen({ onBack }: CustomSourceScreenProps) {
  const sources = useCustomSourceStore((state) => state.sources);
  const loaded = useCustomSourceStore((state) => state.loaded);
  const loadFromStorage = useCustomSourceStore((state) => state.loadFromStorage);
  const importScript = useCustomSourceStore((state) => state.importScript);
  const importFromFile = useCustomSourceStore((state) => state.importFromFile);
  const removeSource = useCustomSourceStore((state) => state.removeSource);
  const toggleSource = useCustomSourceStore((state) => state.toggleSource);
  const moveSource = useCustomSourceStore((state) => state.moveSource);
  const testSource = useCustomSourceStore((state) => state.testSource);
  const checkSourceUpdate = useCustomSourceStore((state) => state.checkSourceUpdate);
  const checkAllUpdates = useCustomSourceStore((state) => state.checkAllUpdates);
  const toggleUpdateAlert = useCustomSourceStore((state) => state.toggleUpdateAlert);
  const customSourceAutoCheck = useCustomSourceStore((state) => state.customSourceAutoCheck);
  const setCustomSourceAutoCheck = useCustomSourceStore((state) => state.setCustomSourceAutoCheck);

  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [scriptInput, setScriptInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  useEffect(() => {
    if (!loaded) {
      void loadFromStorage();
    }
  }, [loaded, loadFromStorage]);

  const handleImport = async () => {
    const script = scriptInput.trim();
    if (!script) {
      Alert.alert("提示", "请粘贴自定义音源脚本文本");
      return;
    }
    setImporting(true);
    try {
      const item = await importScript(script);
      setImportModalVisible(false);
      setScriptInput("");
      Alert.alert("导入成功", `已导入音源「${item.name}」`);
    } catch (error) {
      Alert.alert(
        "导入失败",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromFile = async () => {
    if (importingFile) return;
    setImportingFile(true);
    try {
      const filePath = await pickCustomSourceScriptFile();
      if (!filePath) return;
      const item = await importFromFile(filePath);
      if (item) {
        Alert.alert("导入成功", `已导入音源「${item.name}」`);
      }
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    } finally {
      setImportingFile(false);
    }
  };

  const handleRemove = (source: CustomSourceItem) => {
    Alert.alert("删除音源", `确定删除「${source.name}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => removeSource(source.id),
      },
    ]);
  };

  const handleCheckAll = () => {
    if (sources.length === 0) return;
    void checkAllUpdates();
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="返回设置"
          >
            <ChevronLeft size={20} strokeWidth={2} color={palette.primary} />
          </Pressable>
          <SectionHeader
            title="自定义音源"
            description={
              sources.length > 0
                ? `已导入 ${sources.length} 个音源`
                : "导入 LX Music 自定义音源脚本"
            }
            style={styles.headerTitleWrap}
          />
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.importButton, { backgroundColor: palette.surface }]}
              onPress={() => void handleImportFromFile()}
              disabled={importingFile}
            >
              {importingFile ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.importButtonText, { color: palette.primary }]}>
                  从文件导入
                </Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.importButton, { backgroundColor: palette.primary }]}
              onPress={() => setImportModalVisible(true)}
            >
              <Text style={[styles.importButtonText, { color: palette.primaryText }]}>
                粘贴导入
              </Text>
            </Pressable>
          </View>
        </View>

      {/* 操作栏 */}
      {sources.length > 0 && (
        <View style={styles.actionBar}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: palette.surface }]}
            onPress={handleCheckAll}
          >
            <Text style={[styles.actionText, { color: palette.text }]}>检测全部更新</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.autoCheckRow, { backgroundColor: palette.surface }]}>
        <View style={styles.autoCheckTextWrap}>
          <Text style={[styles.autoCheckTitle, { color: palette.text }]}>启动自动检测更新</Text>
          <Text style={[styles.autoCheckSubtitle, { color: palette.textMuted }]}>打开应用后自动检测已导入音源的新版本</Text>
        </View>
        <Switch
          value={customSourceAutoCheck}
          onValueChange={(enabled) => void setCustomSourceAutoCheck(enabled)}
          trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
        />
      </View>

      {/* 音源列表 */}
      {sources.length === 0 ? (
        <EmptyState
          title="还没有导入自定义音源"
          description="使用上方按钮粘贴脚本文本，或选择本机 JS 文件导入。"
        />
      ) : (
        <View style={styles.list}>
          {sources.map((source, index) => (
            <SourceCard
              key={source.id}
              source={source}
              palette={palette}
              canMoveUp={index > 0}
              canMoveDown={index < sources.length - 1}
              onToggle={(enabled) => toggleSource(source.id, enabled)}
              onTest={() => testSource(source.id)}
              onCheckUpdate={() => checkSourceUpdate(source.id)}
              onRemove={() => handleRemove(source)}
              onMoveUp={() => moveSource(source.id, "up")}
              onMoveDown={() => moveSource(source.id, "down")}
              onToggleUpdateAlert={(enabled) => toggleUpdateAlert(source.id, enabled)}
              onOpenUpdateUrl={() => openCustomSourceUpdateUrl(source.updateUrl)}
            />
          ))}
        </View>
      )}

      {/* 导入弹窗 */}
      <Modal
        visible={importModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>导入自定义音源</Text>
            <Text style={[styles.modalHint, { color: palette.textMuted }]}>
              粘贴完整的 LX Music 自定义音源脚本（以 /* @name ... */ 开头的 JS 文本）
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  backgroundColor: palette.surfaceMuted,
                  color: palette.text,
                  borderColor: palette.border,
                },
              ]}
              value={scriptInput}
              onChangeText={setScriptInput}
              placeholder="在此粘贴脚本文本..."
              placeholderTextColor={palette.textSubtle}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, { backgroundColor: palette.surfaceMuted }]}
                onPress={() => {
                  setImportModalVisible(false);
                  setScriptInput("");
                }}
              >
                <Text style={[styles.modalButtonText, { color: palette.text }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: palette.primary }]}
                onPress={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator color={palette.primaryText} size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: palette.primaryText }]}>
                    确认导入
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

interface SourceCardProps {
  source: CustomSourceItem;
  palette: ReturnType<typeof getThemePalette>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onCheckUpdate: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleUpdateAlert: (enabled: boolean) => void;
  onOpenUpdateUrl: () => void;
}

function SourceCard({
  source,
  palette,
  canMoveUp,
  canMoveDown,
  onToggle,
  onTest,
  onCheckUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleUpdateAlert,
  onOpenUpdateUrl,
}: SourceCardProps) {
  const isTesting = source.testStatus === "testing";
  const isChecking = source.updateStatus === "checking";
  const hasUpdate = source.updateStatus === "available";

  return (
    <View style={[styles.card, { backgroundColor: palette.surface }]}>
      {/* 头部：名称 + 启用开关 */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
            {source.name}
          </Text>
          <View style={styles.cardMetaRow}>
            {source.version ? (
              <Text style={[styles.cardVersion, { color: palette.primary }]}>
                v{source.version}
              </Text>
            ) : null}
            {source.author ? (
              <Text style={[styles.cardAuthor, { color: palette.textMuted }]} numberOfLines={1}>
                {source.author}
              </Text>
            ) : null}
          </View>
          {source.description ? (
            <Text style={[styles.cardDesc, { color: palette.textSubtle }]} numberOfLines={2}>
              {source.description}
            </Text>
          ) : null}
        </View>
        <Switch
          value={source.enabled}
          onValueChange={onToggle}
          trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
        />
      </View>

      {/* 测试结果 */}
      {source.testMessage ? (
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                source.testStatus === "ok"
                  ? palette.primary
                  : source.testStatus === "failed"
                    ? palette.dangerSurface
                    : palette.surfaceMuted,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color:
                  source.testStatus === "ok" ? palette.primaryText : palette.textMuted,
              },
            ]}
            numberOfLines={2}
          >
            {source.testMessage}
          </Text>
        </View>
      ) : null}

      {/* 更新提示 */}
      {hasUpdate && source.allowShowUpdateAlert ? (
        <View style={[styles.updateAlert, { backgroundColor: palette.dangerSurface }]}>
          <Text style={[styles.updateAlertText, { color: palette.danger }]} numberOfLines={3}>
            {source.updateLog || source.updateMessage || "发现更新"}
          </Text>
          {source.updateUrl ? (
            <View style={styles.updateLinkRow}>
              <Text style={[styles.updateUrl, { color: palette.textSubtle }]} numberOfLines={1}>
                {source.updateUrl}
              </Text>
              <Pressable
                style={[styles.updateLinkButton, { backgroundColor: palette.surface }]}
                onPress={onOpenUpdateUrl}
                accessibilityRole="button"
                accessibilityLabel="打开更新地址"
              >
                <Text style={[styles.updateLinkButtonText, { color: palette.primary }]}>打开更新地址</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {source.updateStatus === "latest" ? (
        <Text style={[styles.latestText, { color: palette.textSubtle }]}>已是最新版本</Text>
      ) : null}

      {/* 操作按钮 */}
      <View style={styles.cardActions}>
        <Pressable
          style={[styles.miniButton, { backgroundColor: palette.surfaceMuted }]}
          onPress={onTest}
          disabled={isTesting}
        >
          {isTesting ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : (
            <Text style={[styles.miniButtonText, { color: palette.text }]}>测试</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.miniButton, { backgroundColor: palette.surfaceMuted }]}
          onPress={onCheckUpdate}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : (
            <Text style={[styles.miniButtonText, { color: palette.text }]}>检测更新</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.miniButton, { backgroundColor: palette.surfaceMuted }]}
          onPress={onMoveUp}
          disabled={!canMoveUp}
        >
          <Text
            style={[
              styles.miniButtonText,
              { color: canMoveUp ? palette.text : palette.textSubtle },
            ]}
          >
            上移
          </Text>
        </Pressable>
        <Pressable
          style={[styles.miniButton, { backgroundColor: palette.surfaceMuted }]}
          onPress={onMoveDown}
          disabled={!canMoveDown}
        >
          <Text
            style={[
              styles.miniButtonText,
              { color: canMoveDown ? palette.text : palette.textSubtle },
            ]}
          >
            下移
          </Text>
        </Pressable>
        <Pressable
          style={[styles.miniButton, { backgroundColor: palette.dangerSurface }]}
          onPress={onRemove}
        >
          <Text style={[styles.miniButtonText, { color: palette.danger }]}>删除</Text>
        </Pressable>
      </View>

      {/* 更新提醒开关 */}
      <View style={styles.alertToggleRow}>
        <Text style={[styles.alertToggleLabel, { color: palette.textMuted }]}>
          显示更新提醒
        </Text>
        <Switch
          value={source.allowShowUpdateAlert}
          onValueChange={onToggleUpdateAlert}
          trackColor={{ false: palette.surfaceStrong, true: palette.primary }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  backButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 180,
  },
  importButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
    minHeight: 40,
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
  },
  importButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  actionBar: {
    flexDirection: "row",
    marginBottom: 12,
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  actionText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  autoCheckRow: {
    minHeight: 68,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  autoCheckTextWrap: {
    flex: 1,
    gap: 3,
  },
  autoCheckTitle: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  autoCheckSubtitle: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  list: {
    gap: 12,
  },
  card: {
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  cardTitleWrap: {
    flex: 1,
    gap: 4,
  },
  cardName: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardVersion: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  cardAuthor: {
    fontSize: typography.caption,
    flexShrink: 1,
  },
  cardDesc: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  statusBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: typography.caption,
    fontWeight: "500",
  },
  updateAlert: {
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  updateAlertText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  updateUrl: {
    flex: 1,
    fontSize: typography.caption,
  },
  updateLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  updateLinkButton: {
    minHeight: 30,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  updateLinkButtonText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  latestText: {
    fontSize: typography.caption,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  miniButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  miniButtonText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  alertToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  alertToggleLabel: {
    fontSize: typography.caption,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: radius.md,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  modalHint: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  textArea: {
    minHeight: 180,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: typography.meta,
    borderWidth: 1,
    fontFamily: "monospace",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  modalButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.sm,
    minWidth: 90,
    alignItems: "center",
  },
  modalButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
