import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { debugLog } from "@lx/tauri-bridge";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 出错时展示的上下文名（如「主窗口」「歌词窗」），便于用户描述问题。 */
  scope?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 根级错误边界。
 *
 * v0.10.1 的发布说明里已经出现过「队列面板反复开合白屏」的兜底修复，
 * 但桌面端此前只有 installGlobalErrorHandlers 记日志 —— 能留痕，
 * 却拦不住 React 树抛错后整屏变白（渲染函数抛异常时 React 会卸载整棵
 * 被边界包裹的树，没有边界就是整页）。
 *
 * 与移动端 `apps/mobile/src/components/ErrorBoundary.tsx` 对齐的语义：
 *  - 只捕获渲染 / 生命周期 / 构造函数里的同步错误；
 *  - 事件处理器与异步回调里的错误仍由各自的 try/catch 负责，不在这里兜；
 *  - 降级 UI 必须给出「看到什么、怎么办」，而不是只有一句「出错了」。
 *
 * 重试采用「重置 error 后重新渲染子树」：如果是数据导致的确定性崩溃，
 * 会立刻再次落到这里（可反复点，不会更糟）；如果是瞬时状态问题则能恢复。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 必须带 componentStack：React 的报错信息本身不指出是哪棵子树抛的，
    // 只有这里能拿到，白屏排查基本全靠它。
    debugLog(
      `[render] ${this.props.scope ?? "app"} 渲染异常: ${error.message} | stack=${(info.componentStack ?? "").trim().slice(0, 1200)}`,
    );
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 32,
          background: "var(--af-bg-base, #121212)",
          color: "var(--af-text-primary, #f5f5f5)",
          textAlign: "center",
        }}
      >
        <AlertTriangle size={32} style={{ color: "var(--af-error, #e74c3c)" }} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>界面渲染出错</div>
        <div
          style={{
            maxWidth: 560,
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--af-text-secondary, #b3b3b3)",
          }}
        >
          这次异常发生在本窗口的界面渲染中，音频播放不受影响。
          可以先点「重试」；若反复出现，请重载窗口，把日志里的
          <code> [render] </code>
          一行连同操作步骤一起记录下来。
        </div>
        <pre
          style={{
            maxWidth: "min(720px, 100%)",
            maxHeight: 160,
            overflow: "auto",
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--af-border-primary, rgba(255,255,255,0.12))",
            background: "var(--af-bg-surface, #1b1b1b)",
            color: "var(--af-text-secondary, #b3b3b3)",
            fontSize: 12,
            textAlign: "left",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.message || String(error)}
        </pre>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="primary" onClick={this.handleReset}>
            重试
          </Button>
          <Button variant="secondary" onClick={this.handleReload}>
            重载窗口
          </Button>
        </div>
      </div>
    );
  }
}
