import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const debugLog = vi.fn(async () => undefined);
vi.mock("@lx/tauri-bridge", () => ({ debugLog }));

const { ErrorBoundary } = await import("../src/components/ErrorBoundary");

/** 在渲染期抛错的子组件。 */
function Bomb(): JSX.Element {
  throw new Error("渲染期故意抛错");
}

/** 收集渲染树里所有文本节点，便于断言降级 UI 的内容。 */
function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  debugLog.mockClear();
  // React 会把捕获到的错误再打一遍 console.error，静音避免测试输出刷屏
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("桌面端 ErrorBoundary", () => {
  it("子树正常时原样渲染，不插入降级 UI", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary scope="test">
          <div>内容</div>
        </ErrorBoundary>,
      );
    });
    expect(textOf(renderer)).toContain("内容");
    expect(textOf(renderer)).not.toContain("界面渲染出错");
  });

  it("渲染期抛错时给出降级 UI，而不是让整棵树塌掉", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary scope="test">
          <Bomb />
        </ErrorBoundary>,
      );
    });
    const tree = textOf(renderer);
    expect(tree).toContain("界面渲染出错");
    // 错误原文必须可见：白屏排查全靠它
    expect(tree).toContain("渲染期故意抛错");
    // 必须给出可执行的下一步，而不是只有一句「出错了」
    expect(tree).toContain("重试");
    expect(tree).toContain("重载窗口");
    expect(renderer.root.findByProps({ role: "alert" })).toBeTruthy();
  });

  it("componentDidCatch 把 componentStack 记进日志（白屏排查的唯一线索）", () => {
    act(() => {
      create(
        <ErrorBoundary scope="route:/playlist/1">
          <Bomb />
        </ErrorBoundary>,
      );
    });
    expect(debugLog).toHaveBeenCalled();
    const line = String(debugLog.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("route:/playlist/1");
    expect(line).toContain("渲染期故意抛错");
    // React 的报错本身不指出是哪棵子树抛的，只有 componentStack 能给出
    expect(line).toContain("stack=");
    // 截断是为了避免单条日志过长，但不能截成空
    expect(line.length).toBeGreaterThan(40);
  });

  it("重试会清掉错误状态；确定性崩溃不会被错误地「重试成功」", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary scope="test">
          <Bomb />
        </ErrorBoundary>,
      );
    });
    const retry = renderer.root.findByProps({ children: "重试" });
    act(() => {
      retry.props.onClick();
    });
    // 子组件仍然抛错 → 立刻再次落到边界，界面保持一致而不是白屏
    expect(textOf(renderer)).toContain("界面渲染出错");
  });

  it("边界外的兄弟节点不受影响（错误不外溢）", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <div>
          <span>播放条仍然可用</span>
          <ErrorBoundary scope="test">
            <Bomb />
          </ErrorBoundary>
        </div>,
      );
    });
    const tree = textOf(renderer);
    expect(tree).toContain("播放条仍然可用");
    expect(tree).toContain("界面渲染出错");
  });
});
