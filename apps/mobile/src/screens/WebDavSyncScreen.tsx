import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useWebdavStore } from "@/stores/webdavStore";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
} from "@/stores/themeStore";
import { radius, touch, typography } from "@/theme/tokens";

interface WebDavSyncScreenProps {
  /** 返回上一页的回调。 */
  onBack: () => void;
}

/**
 * WebDAV 同步设置页面。
 *
 * 提供 WebDAV 服务配置（地址 / 用户名 / 密码）、连接测试，以及歌单与
 * 自定义音源的上传 / 下载操作。配置与同步状态通过 webdavStore 管理，
 * 颜色取自 themeStore，与桌面端 LX Music 同步格式兼容。
 */
export function WebDavSyncScreen({ onBack }: WebDavSyncScreenProps) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const webdavUrl = useWebdavStore((state) => state.url);
  const webdavUsername = useWebdavStore((state) => state.username);
  const webdavPassword = useWebdavStore((state) => state.password);
  const webdavLoaded = useWebdavStore((state) => state.loaded);
  const webdavSyncing = useWebdavStore((state) => state.syncing);
  const webdavMessage = useWebdavStore((state) => state.message);
  const webdavLoadConfig = useWebdavStore((state) => state.loadConfig);
  const webdavSetConfig = useWebdavStore((state) => state.setConfig);
  const webdavTestSync = useWebdavStore((state) => state.testSync);
  const webdavUploadPlaylists = useWebdavStore((state) => state.uploadPlaylists);
  const webdavDownloadPlaylists = useWebdavStore(
    (state) => state.downloadPlaylists,
  );
  const webdavUploadSources = useWebdavStore((state) => state.uploadSources);
  const webdavDownloadSources = useWebdavStore(
    (state) => state.downloadSources,
  );
  const webdavClearMessage = useWebdavStore((state) => state.clearMessage);

  const [formUrl, setFormUrl] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");

  // 首次进入加载已保存的配置
  useEffect(() => {
    webdavLoadConfig();
  }, [webdavLoadConfig]);

  // 配置加载完成后同步到表单输入
  useEffect(() => {
    if (webdavLoaded) {
      setFormUrl(webdavUrl);
      setFormUsername(webdavUsername);
      setFormPassword(webdavPassword);
    }
  }, [webdavLoaded, webdavUrl, webdavUsername, webdavPassword]);

  const persistForm = async () => {
    await webdavSetConfig({
      url: formUrl.trim(),
      username: formUsername.trim(),
      password: formPassword,
    });
  };

  const handleSaveConfig = async () => {
    await persistForm();
    Alert.alert("已保存", "WebDAV 配置已保存");
  };

  const handleTestSync = async () => {
    await persistForm();
    await webdavTestSync();
  };

  const handleUploadPlaylists = async () => {
    await persistForm();
    await webdavUploadPlaylists();
  };

  const handleDownloadPlaylists = () => {
    Alert.alert(
      "确认下载",
      "从 WebDAV 下载将覆盖本地的收藏、歌单和播放历史，是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "下载",
          onPress: async () => {
            await persistForm();
            await webdavDownloadPlaylists();
          },
        },
      ],
    );
  };

  const handleUploadSources = async () => {
    await persistForm();
    await webdavUploadSources();
  };

  const handleDownloadSources = () => {
    Alert.alert(
      "确认下载",
      "从 WebDAV 下载将覆盖本地自定义音源，是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "下载",
          onPress: async () => {
            await persistForm();
            await webdavDownloadSources();
          },
        },
      ],
    );
  };

  const messageIsSuccess =
    webdavMessage.includes("成功") || webdavMessage.includes("正常");

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <StatusBar
        barStyle={palette.statusBar}
        backgroundColor={palette.background}
      />

      {/* 顶部导航栏 */}
      <View
        style={[
          styles.navBar,
          {
            backgroundColor: palette.surface,
            borderBottomColor: palette.border,
          },
        ]}
      >
        <Pressable
          style={styles.navBackButton}
          onPress={() => {
            webdavClearMessage();
            onBack();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <ChevronLeft size={20} color={palette.primary} />
          <Text style={[styles.navBackText, { color: palette.primary }]}>返回</Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: palette.text }]}>
          WebDAV 同步
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* 配置区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            WebDAV 配置
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            填写服务地址与账号信息，与 LX Music 桌面端兼容。
          </Text>

          <Text style={[styles.label, { color: palette.textMuted }]}>
            WebDAV 地址
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formUrl}
            onChangeText={setFormUrl}
            placeholder="https://dav.jianguoyun.com/dav/"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={[styles.label, { color: palette.textMuted }]}>
            用户名
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formUsername}
            onChangeText={setFormUsername}
            placeholder="用户名 / 邮箱"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { color: palette.textMuted }]}>
            密码 / 应用密码
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                color: palette.text,
                borderColor: palette.border,
              },
            ]}
            value={formPassword}
            onChangeText={setFormPassword}
            placeholder="应用密码"
            placeholderTextColor={palette.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <View style={styles.buttonRow}>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
              onPress={handleSaveConfig}
              disabled={webdavSyncing}
            >
              <Text style={[styles.buttonText, { color: palette.text }]}>
                保存配置
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
              onPress={handleTestSync}
              disabled={webdavSyncing}
            >
              {webdavSyncing ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text
                  style={[styles.buttonText, { color: palette.primary }]}
                >
                  测试连接
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* 歌单历史同步区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            歌单历史同步
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            上传将覆盖远端的收藏、歌单与播放历史；下载将覆盖本地数据。
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.button, { backgroundColor: palette.primary }]}
              onPress={handleUploadPlaylists}
              disabled={webdavSyncing}
            >
              {webdavSyncing ? (
                <ActivityIndicator color={palette.primaryText} size="small" />
              ) : (
                <Text
                  style={[
                    styles.buttonText,
                    { color: palette.primaryText },
                  ]}
                >
                  上传歌单历史
                </Text>
              )}
            </Pressable>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
              onPress={handleDownloadPlaylists}
              disabled={webdavSyncing}
            >
              <Text style={[styles.buttonText, { color: palette.text }]}>
                下载歌单历史
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 音源同步区 */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            音源同步
          </Text>
          <Text style={[styles.cardCaption, { color: palette.textMuted }]}>
            上传或下载 LX Music 自定义音源，覆盖远端或本机的 user_apis.json。
          </Text>

          <View style={styles.buttonRow}>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
              onPress={handleUploadSources}
              disabled={webdavSyncing}
            >
              <Text style={[styles.buttonText, { color: palette.text }]}>
                上传音源
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                },
              ]}
              onPress={handleDownloadSources}
              disabled={webdavSyncing}
            >
              <Text style={[styles.buttonText, { color: palette.text }]}>
                下载音源
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 同步状态 / 错误提示 */}
        {webdavMessage ? (
          <View
            style={[
              styles.messageBox,
              {
                backgroundColor: messageIsSuccess
                  ? palette.surfaceMuted
                  : palette.dangerSurface,
              },
            ]}
          >
            <Text
              style={[
                styles.messageText,
                { color: messageIsSuccess ? palette.text : palette.danger },
              ]}
            >
              {webdavMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  navBackButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 4,
    minWidth: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  navBackText: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  navTitle: {
    fontSize: typography.title,
    fontWeight: "700",
  },
  navSpacer: {
    minWidth: 64,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 16,
  },
  cardTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardCaption: {
    fontSize: typography.meta,
    marginBottom: 12,
  },
  label: {
    fontSize: typography.meta,
    fontWeight: "500",
    marginTop: 10,
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.body,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  button: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  buttonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  messageBox: {
    padding: 14,
    borderRadius: radius.sm,
  },
  messageText: {
    fontSize: typography.body,
    lineHeight: 20,
  },
});
