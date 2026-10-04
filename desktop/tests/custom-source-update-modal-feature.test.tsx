import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomSourceUpdateModal, openCustomSourceUpdateModal } from "../src/components/CustomSourceUpdateModal";
import { useCustomSourceStore } from "../src/stores/customSourceStore";

vi.mock("@/stores/customSourceStore", async () => {
  const { create } = await import("zustand");
  return { useCustomSourceStore: create(() => ({ sources: [], featureEnabled: false, featureReady: true })) };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

const source = {
  id: "available", name: "音源更新", script: "saved-script", description: "", enabled: true,
  allowShowUpdateAlert: true, testStatus: "idle" as const, updateStatus: "available" as const,
  updateLog: "更新详情", createdAt: 1, updatedAt: 1,
};
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  useCustomSourceStore.setState({ sources: [source], featureEnabled: false, featureReady: true });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function mount() { act(() => { renderer = create(<CustomSourceUpdateModal />); }); }

describe("LX 更新弹窗总开关隔离", () => {
  it.each([
    { featureEnabled: false, featureReady: true },
    { featureEnabled: true, featureReady: false },
  ])("关闭或未恢复不显示已有可用更新: %j", (state) => {
    useCustomSourceStore.setState(state);
    mount();
    expect(renderer!.toJSON()).toBeNull();
  });

  it("开启并恢复后仍显示允许提醒的更新", () => {
    useCustomSourceStore.setState({ featureEnabled: true });
    mount();
    expect(renderer!.root.findAllByType("button")).toHaveLength(1);
  });

  it("关闭总开关立即隐藏弹窗并清除手动请求，再开启不复活旧请求", () => {
    useCustomSourceStore.setState({ featureEnabled: true, sources: [{ ...source, allowShowUpdateAlert: false }] });
    mount();
    act(() => openCustomSourceUpdateModal(source.id));
    expect(renderer!.toJSON()).not.toBeNull();
    act(() => useCustomSourceStore.setState({ featureEnabled: false }));
    expect(renderer!.toJSON()).toBeNull();
    act(() => useCustomSourceStore.setState({ featureEnabled: true }));
    expect(renderer!.toJSON()).toBeNull();
  });

  it("关闭期间收到旧事件不会展示，也不会排队到再次开启", () => {
    useCustomSourceStore.setState({ sources: [{ ...source, allowShowUpdateAlert: false }] });
    mount();
    act(() => openCustomSourceUpdateModal(source.id));
    expect(renderer!.toJSON()).toBeNull();
    act(() => useCustomSourceStore.setState({ featureEnabled: true }));
    expect(renderer!.toJSON()).toBeNull();
    act(() => openCustomSourceUpdateModal(source.id));
    expect(renderer!.toJSON()).not.toBeNull();
  });

  it("事件处理读取最新开关状态，不采用上一帧开启的闭包", () => {
    useCustomSourceStore.setState({ featureEnabled: true, sources: [{ ...source, allowShowUpdateAlert: false }] });
    mount();
    act(() => {
      useCustomSourceStore.setState({ featureEnabled: false });
      openCustomSourceUpdateModal(source.id);
    });
    expect(renderer!.toJSON()).toBeNull();
    act(() => useCustomSourceStore.setState({ featureEnabled: true }));
    expect(renderer!.toJSON()).toBeNull();
  });
});
