// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

function renderBoundary(props: { variant?: "inline" | "fullscreen" }) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  act(() => {
    root.render(
      <ErrorBoundary scope="test" variant={props.variant}>
        <Boom />
      </ErrorBoundary>,
    );
  });
  const alert = container.querySelector('[role="alert"]') as HTMLElement;
  return { container, root, alert, errorSpy };
}

it("路由/面板级边界只占内容区，不再盖住侧栏与播放条", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { root, alert, errorSpy } = renderBoundary({});
  expect(alert).toBeTruthy();
  expect(alert.style.position).not.toBe("fixed");
  expect(alert.style.zIndex).not.toBe("10000");
  act(() => root.unmount());
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});

it("窗口级边界仍覆盖整个窗口", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { root, alert, errorSpy } = renderBoundary({ variant: "fullscreen" });
  expect(alert.style.position).toBe("fixed");
  expect(alert.style.zIndex).toBe("10000");
  act(() => root.unmount());
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});
