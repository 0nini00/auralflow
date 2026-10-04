// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WyCookieLoginModal } from "../src/components/WyCookieLoginModal";

const mocks = vi.hoisted(() => ({ patch: vi.fn(), createQr: vi.fn(), checkQr: vi.fn(), load: vi.fn(), logout: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ patchSettings: mocks.patch }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@/services/wyAccountService", () => ({
  createWyQrLoginImage: mocks.createQr, checkWyQrLogin: mocks.checkQr,
  getWyCookie: async () => "synthetic-previous", setWyCookie: (value: string) => value,
}));
vi.mock("@/stores/wyAccountStore", async () => {
  const { create } = await import("zustand");
  return { useWyAccountStore: create(() => ({
    account: null, playlists: [], isLoading: false, isLoaded: false, error: "", load: mocks.load, logout: mocks.logout,
  })) };
});
import { useWyAccountStore } from "../src/stores/wyAccountStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const qr = { key: "synthetic", qrUrl: "https://example.invalid/qr", qrImageUrl: "data:image/svg+xml,synthetic" };
const close = vi.fn();
let root: Root;
let trigger: HTMLButtonElement;
function Harness() {
  const [open, setOpen] = useState(true);
  return <WyCookieLoginModal open={open} onClose={() => { close(); setOpen(false); }} />;
}
function button(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.includes(label))!;
}
function key(value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => { document.activeElement!.dispatchEvent(event); });
  return event;
}
async function mount() { await act(async () => root.render(<Harness />)); }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<button id="trigger">打开登录</button><div id="root"></div>';
  trigger = document.getElementById("trigger") as HTMLButtonElement; trigger.focus();
  root = createRoot(document.getElementById("root")!);
  mocks.patch.mockReset().mockResolvedValue({});
  mocks.createQr.mockReset().mockResolvedValue(qr);
  mocks.checkQr.mockReset().mockResolvedValue({ code: 801, message: "等待扫码" });
  mocks.logout.mockReset().mockResolvedValue(undefined);
  useWyAccountStore.setState({ account: null, playlists: [], isLoaded: false, isLoading: false, error: "" });
});
afterEach(() => { act(() => root.unmount()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("登录弹窗公共焦点 hook 集成", () => {
  it("命名 dialog 接收初始焦点，Tab 双向循环，Escape 关闭一次并恢复入口", async () => {
    await mount();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("登录网易云账号");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const first = dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!;
    const last = button("重新扫码");
    act(() => last.focus()); key("Tab"); expect(document.activeElement).toBe(first);
    key("Tab", true); expect(document.activeElement).toBe(last);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape 使用已有关闭逻辑作废仍在生成的二维码", async () => {
    const generation = deferred<typeof qr>(); mocks.createQr.mockReturnValueOnce(generation.promise);
    await mount(); key("Escape");
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => generation.resolve(qr));
    expect(mocks.checkQr).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(mocks.checkQr).not.toHaveBeenCalled();
  });

  it("QR 持久化 busy 时 Escape 不关闭，失败释放 busy 后可正常关闭", async () => {
    const save = deferred<object>(); mocks.patch.mockReturnValueOnce(save.promise);
    mocks.checkQr.mockResolvedValueOnce({ code: 803, message: "已授权", cookie: "synthetic-cookie" });
    await mount();
    expect(button("取消").disabled).toBe(true);
    key("Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => save.reject(new Error("合成保存失败")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("合成保存失败");
    expect(button("取消").disabled).toBe(false);
    key("Escape"); expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("退出登录 busy 时 Escape 不关闭，失败后恢复关闭能力", async () => {
    const logout = deferred<void>(); mocks.logout.mockReturnValueOnce(logout.promise);
    useWyAccountStore.setState({ account: { uid: "test", nickname: "测试账号", avatarUrl: "", vipType: 0, isVip: false } });
    await mount();
    await act(async () => button("退出登录").click());
    key("Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => logout.reject(new Error("合成退出失败")));
    key("Escape"); expect(close).toHaveBeenCalledTimes(1);
  });
  it("提交期真实关闭按钮、遮罩、Tab 与 Escape 都不能关闭；回滚后恢复原操作", async () => {
    const save = deferred<object>(); mocks.patch.mockReturnValueOnce(save.promise);
    mocks.checkQr.mockResolvedValueOnce({ code: 803, message: "已授权", cookie: "synthetic-cookie" });
    await mount();
    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!;
    expect(closeButton.disabled).toBe(true);
    expect(button("Cookie 登录").disabled).toBe(true);
    await act(async () => {
      closeButton.click(); button("Cookie 登录").click();
      document.querySelector<HTMLElement>(".af-dialog-overlay")!.click();
    });
    key("Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => save.reject(new Error("合成写盘失败")));
    expect(closeButton.disabled).toBe(false);
    expect(button("Cookie 登录").disabled).toBe(false);
    await act(async () => button("Cookie 登录").click());
    expect(document.querySelector("textarea")).not.toBeNull();
    await act(async () => button("取消").click());
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });
});
