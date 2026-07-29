import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 根级错误边界。捕获子树渲染期抛出的异常，展示可读的降级 UI 并提供重试，
 * 避免任一屏幕的渲染错误直接冒泡到根导致整屏白屏。
 *
 * 注意：错误边界只捕获渲染、生命周期与构造函数中的同步错误，
 * 不捕获事件处理器和异步回调中的错误（那些仍由各自的 try/catch 负责）。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>应用遇到了一点问题</Text>
        <Text style={styles.subtitle}>页面渲染时出现异常，可尝试重试。若反复出现，请重启应用。</Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={styles.detailContent}>
          <Text style={styles.detailText}>{error.message || String(error)}</Text>
        </ScrollView>
        <Pressable
          style={styles.retryButton}
          onPress={this.handleReset}
          accessibilityRole="button"
          accessibilityLabel="重试"
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "#10241f",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#8fa79f",
    marginBottom: 20,
    lineHeight: 20,
  },
  detailBox: {
    maxHeight: 160,
    borderRadius: 10,
    backgroundColor: "#0d1d19",
    borderWidth: 1,
    borderColor: "#1a3a31",
    marginBottom: 20,
  },
  detailContent: {
    padding: 12,
  },
  detailText: {
    fontSize: 12,
    color: "#c6d6d0",
    fontFamily: "monospace",
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#45e58d",
  },
  retryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#10241f",
  },
});
