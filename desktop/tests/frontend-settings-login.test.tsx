import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WyCookieLoginModal } from "../src/components/WyCookieLoginModal";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(), getCookie: vi.fn(), setCookie: vi.fn(), createQr: vi.fn(), checkQr: vi.fn(), load: vi.fn(), logout: vi.fn(),
}));
vi.mock("@lx/tauri-bridge", () => ({ patchSettings: mocks.patch }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("@/services/wyAccountService", () => ({
  getWyCookie: mocks.getCookie, setWyCookie: mocks.setCookie,
  createWyQrLoginImage: mocks.createQr, checkWyQrLogin: mocks.checkQr,
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
function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
const qr = (key: string) => ({ key, qrUrl: `https://example.invalid/${key}`, qrImageUrl: `data:image/svg+xml,${key}` });
const authorized = { code: 803, message: "已授权", cookie: "synthetic-cookie" };
let renderer: ReactTestRenderer | undefined;
const close = vi.fn();
const button = (label: string) => renderer!.root.findAllByType("button").find((node) => text(node).includes(label))!;
const visibleText = () => text(renderer!.root);
async function mount() { await act(async () => { renderer = create(<WyCookieLoginModal open onClose={close} />); }); }
async function reopen() {
  await act(async () => renderer!.update(<WyCookieLoginModal open={false} onClose={close} />));
  await act(async () => renderer!.update(<WyCookieLoginModal open onClose={close} />));
}
async function cookieTab() { await act(async () => button("Cookie 登录").props.onClick()); }
async function submitCookie() {
  await cookieTab();
  await act(async () => renderer!.root.findByType("textarea").props.onChange({ target: { value: "synthetic-cookie" } }));
  await act(async () => { button("保存并验证").props.onClick(); });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal("document", { body: {} });
  mocks.patch.mockReset().mockResolvedValue({});
  mocks.getCookie.mockReset().mockResolvedValue("synthetic-previous");
  mocks.setCookie.mockReset().mockImplementation((value: string) => value);
  mocks.createQr.mockReset().mockResolvedValue(qr("new"));
  mocks.checkQr.mockReset().mockResolvedValue({ code: 801, message: "等待扫码" });
  mocks.load.mockReset().mockImplementation(async () => {
    useWyAccountStore.setState({ account: { uid: "test", nickname: "测试账号", avatarUrl: "", vipType: 0, isVip: false } });
  });
  useWyAccountStore.setState({ account: null, playlists: [], isLoading: false, isLoaded: false, error: "" });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("登录弹窗请求代次与提交状态", () => {
  it("QR 803 后持久化失败显示错误、释放 busy，并能刷新重试", async () => {
    mocks.checkQr.mockResolvedValueOnce(authorized);
    mocks.patch.mockRejectedValueOnce(new Error("磁盘只读"));
    await mount();
    expect(visibleText()).toContain("磁盘只读");
    expect(button("刷新二维码").props.disabled).toBe(false);
    expect(button("取消").props.disabled).toBe(false);
    await act(async () => button("刷新二维码").props.onClick());
    expect(mocks.createQr).toHaveBeenCalledTimes(2);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("QR 803 后账号验证失败同样可见且可改用 Cookie 重试", async () => {
    mocks.checkQr.mockResolvedValueOnce(authorized);
    mocks.load.mockImplementationOnce(async () => useWyAccountStore.setState({ account: null, error: "验证失败" }));
    await mount();
    expect(visibleText()).toContain("验证失败");
    await cookieTab();
    await act(async () => renderer!.root.findByType("textarea").props.onChange({ target: { value: "synthetic-cookie" } }));
    expect(button("保存并验证").props.disabled).toBe(false);
  });

  it("回滚失败不能吞掉，错误同时说明原失败及回滚失败", async () => {
    mocks.checkQr.mockResolvedValueOnce(authorized);
    mocks.patch.mockRejectedValueOnce(new Error("保存失败")).mockRejectedValueOnce(new Error("回滚失败"));
    await mount();
    expect(visibleText()).toContain("保存失败");
    expect(visibleText()).toContain("回滚失败");
    expect(button("刷新二维码").props.disabled).toBe(false);
  });

  it("正常授权只提交一次并停止轮询，重新打开不遗留 busy", async () => {
    mocks.checkQr.mockResolvedValueOnce(authorized);
    await mount();
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await reopen();
    expect(button("刷新二维码").props.disabled).toBe(false);
  });

  it("旧二维码生成在关闭重开后到达，不覆盖新二维码或启动旧轮询", async () => {
    const old = deferred<ReturnType<typeof qr>>();
    mocks.createQr.mockReturnValueOnce(old.promise);
    await mount(); await reopen();
    const polls = mocks.checkQr.mock.calls.length;
    await act(async () => old.resolve(qr("old")));
    expect(renderer!.root.findAllByType("img").some((node) => node.props.src === qr("old").qrImageUrl)).toBe(false);
    expect(mocks.checkQr).toHaveBeenCalledTimes(polls);
  });

  it("切到 Cookie 后旧轮询返回 803，不写 Cookie 或触发验证", async () => {
    const poll = deferred<typeof authorized>();
    mocks.checkQr.mockReturnValueOnce(poll.promise);
    await mount(); await cookieTab();
    await act(async () => poll.resolve(authorized));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("切换登录方式后迟到的读取 Cookie 不得继续提交", async () => {
    const previous = deferred<string>(); mocks.getCookie.mockReturnValueOnce(previous.promise);
    await mount(); await submitCookie();
    await act(async () => button("扫码登录").props.onClick());
    await act(async () => previous.resolve("synthetic-previous"));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(button("刷新二维码").props.disabled).toBe(false);
  });

  it("关闭重开后已提交的旧事务仍完成验证，但不关闭新弹窗", async () => {
    const save = deferred<object>(); mocks.patch.mockReturnValueOnce(save.promise);
    mocks.checkQr.mockResolvedValueOnce(authorized);
    await mount(); expect(mocks.patch).toHaveBeenCalledTimes(1);
    await reopen();
    await act(async () => save.resolve({}));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(button("刷新二维码").props.disabled).toBe(false);
  });

  it("关闭后迟到二维码生成不启动轮询", async () => {
    const old = deferred<ReturnType<typeof qr>>(); mocks.createQr.mockReturnValueOnce(old.promise);
    await mount();
    await act(async () => renderer!.update(<WyCookieLoginModal open={false} onClose={close} />));
    await act(async () => old.resolve(qr("old")));
    expect(mocks.checkQr).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("点击遮罩关闭即作废请求，不依赖父组件下一帧更新 open", async () => {
    const old = deferred<ReturnType<typeof qr>>(); mocks.createQr.mockReturnValueOnce(old.promise);
    await mount();
    await act(async () => renderer!.root.findByProps({ className: "af-dialog-overlay" }).props.onClick());
    await act(async () => old.resolve(qr("old")));
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.checkQr).not.toHaveBeenCalled();
  });

  it("旧生成请求失败不清除重开后的 loading 或显示旧错误", async () => {
    const old = deferred<ReturnType<typeof qr>>(); const current = deferred<ReturnType<typeof qr>>();
    mocks.createQr.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await mount(); await reopen();
    await act(async () => old.reject(new Error("旧请求失败")));
    expect(visibleText()).not.toContain("旧请求失败");
    expect(button("刷新二维码").props.disabled).toBe(true);
    await act(async () => current.resolve(qr("current")));
    expect(button("刷新二维码").props.disabled).toBe(false);
  });

  it("仅 onClose 回调引用变化不重新生成二维码", async () => {
    await mount();
    await act(async () => renderer!.update(<WyCookieLoginModal open onClose={() => close()} />));
    expect(mocks.createQr).toHaveBeenCalledTimes(1);
  });

  it("已进入 store 验证的旧请求完成不关闭新弹窗或改写新弹窗错误", async () => {
    const validation = deferred<void>(); mocks.load.mockReturnValueOnce(validation.promise);
    mocks.checkQr.mockResolvedValueOnce(authorized);
    await mount(); expect(mocks.load).toHaveBeenCalledTimes(1);
    await reopen();
    await act(async () => validation.resolve());
    expect(close).not.toHaveBeenCalled();
    expect(visibleText()).not.toContain("账号验证失败");
    expect(button("刷新二维码").props.disabled).toBe(false);
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ wyCookie: "synthetic-cookie" }, { wyCookie: "synthetic-previous" }]);
  });

  it("生成二维码期间退出登录失败，应显示错误并允许重新扫码", async () => {
    useWyAccountStore.setState({ account: { uid: "test", nickname: "测试账号", avatarUrl: "", vipType: 0, isVip: false } });
    const generation = deferred<ReturnType<typeof qr>>(); mocks.createQr.mockReturnValueOnce(generation.promise);
    mocks.logout.mockRejectedValueOnce(new Error("退出失败"));
    await mount();
    await act(async () => button("退出登录").props.onClick());
    expect(visibleText()).toContain("退出失败");
    expect(button("刷新二维码").props.disabled).toBe(false);
    await act(async () => generation.resolve(qr("old")));
    expect(mocks.checkQr).not.toHaveBeenCalled();
  });
  it.each(["遮罩", "关闭", "取消", "Cookie 登录", "刷新二维码"])("Cookie 写入开始后旧的 %s 事件处理器也不能中止事务", async (control) => {
    const poll = deferred<typeof authorized>(); const save = deferred<object>();
    mocks.checkQr.mockReturnValueOnce(poll.promise); mocks.patch.mockReturnValueOnce(save.promise);
    await mount();
    const handler = control === "遮罩" ? renderer!.root.findByProps({ className: "af-dialog-overlay" }).props.onClick
      : control === "关闭" ? renderer!.root.findByProps({ "aria-label": "关闭" }).props.onClick : button(control).props.onClick;
    await act(async () => poll.resolve(authorized));
    try {
      await act(async () => { handler(); });
      expect(close).not.toHaveBeenCalled();
      expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
      expect(mocks.createQr).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => save.resolve({}));
    }
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("真实卸载后已发出的 Cookie 写入仍完成账号验证，磁盘与内存账号一致", async () => {
    const save = deferred<void>();
    let cookie = "synthetic-previous", disk = cookie;
    mocks.getCookie.mockImplementation(async () => cookie);
    mocks.setCookie.mockImplementation((value: string) => cookie = value);
    mocks.patch.mockImplementation(async (patch) => { await save.promise; disk = patch.wyCookie; });
    mocks.checkQr.mockResolvedValueOnce(authorized);
    mocks.load.mockImplementation(async (value: string) => {
      expect(value).toBe(disk);
      useWyAccountStore.setState({ account: { uid: value, nickname: "新账号", avatarUrl: "", vipType: 0, isVip: false } });
    });
    await mount(); expect(cookie).toBe(authorized.cookie);
    act(() => { renderer!.unmount(); renderer = undefined; });
    await act(async () => save.resolve());
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(useWyAccountStore.getState().account?.uid).toBe(disk);
    expect(cookie).toBe(disk);
    expect(close).not.toHaveBeenCalled();
  });

  it("卸载后的验证失败必须恢复旧 Cookie、旧账号和磁盘，不允许代次 return 跳过回滚", async () => {
    const save = deferred<void>();
    const previous = { uid: "previous", nickname: "旧账号", avatarUrl: "", vipType: 0, isVip: false };
    useWyAccountStore.setState({ account: previous });
    let cookie = "synthetic-previous", disk = cookie;
    mocks.getCookie.mockImplementation(async () => cookie);
    mocks.setCookie.mockImplementation((value: string) => cookie = value);
    mocks.patch.mockImplementation(async (patch) => { await save.promise; disk = patch.wyCookie; });
    mocks.load.mockImplementation(async () => {
      useWyAccountStore.setState({ account: null });
      throw new Error("合成验证失败");
    });
    mocks.checkQr.mockResolvedValueOnce(authorized);
    await mount(); act(() => { renderer!.unmount(); renderer = undefined; });
    await act(async () => save.resolve());
    expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ wyCookie: authorized.cookie }, { wyCookie: "synthetic-previous" }]);
    expect(cookie).toBe("synthetic-previous"); expect(disk).toBe(cookie);
    expect(useWyAccountStore.getState().account).toEqual(previous);
    expect(close).not.toHaveBeenCalled();
  });

  it("新实例的登录必须等待旧事务及旧回滚完成，旧事务不能覆盖新账号", async () => {
    const oldSave = deferred<void>(), rollback = deferred<void>();
    let cookie = "synthetic-previous", disk = cookie;
    mocks.getCookie.mockImplementation(async () => cookie);
    mocks.setCookie.mockImplementation((value: string) => cookie = value);
    mocks.patch.mockImplementation(async (patch) => {
      if (patch.wyCookie === "synthetic-old") await oldSave.promise;
      if (patch.wyCookie === "synthetic-previous") await rollback.promise;
      disk = patch.wyCookie;
    });
    mocks.load.mockImplementation(async (value: string) => {
      if (value === "synthetic-old") throw new Error("旧账号验证失败");
      useWyAccountStore.setState({ account: { uid: value, nickname: "新账号", avatarUrl: "", vipType: 0, isVip: false } });
    });
    mocks.checkQr.mockResolvedValueOnce({ ...authorized, cookie: "synthetic-old" }).mockResolvedValueOnce({ ...authorized, cookie: "synthetic-new" });
    await mount(); act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    try {
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      await act(async () => oldSave.resolve());
      expect(mocks.patch.mock.calls.map(([patch]) => patch)).toEqual([{ wyCookie: "synthetic-old" }, { wyCookie: "synthetic-previous" }]);
      expect(mocks.load).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => { oldSave.resolve(); rollback.resolve(); });
    }
    expect(mocks.patch.mock.calls.at(-1)?.[0]).toEqual({ wyCookie: "synthetic-new" });
    expect(cookie).toBe("synthetic-new"); expect(disk).toBe(cookie);
    expect(useWyAccountStore.getState().account?.uid).toBe(cookie);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("跨实例串行范围包含已进入 store 的验证，不仅仅是 Cookie 写盘", async () => {
    const validation = deferred<void>();
    mocks.checkQr.mockResolvedValueOnce({ ...authorized, cookie: "synthetic-old" }).mockResolvedValueOnce({ ...authorized, cookie: "synthetic-new" });
    mocks.load.mockImplementation(async (value: string) => {
      if (value === "synthetic-old") await validation.promise;
      useWyAccountStore.setState({ account: { uid: value, nickname: value, avatarUrl: "", vipType: 0, isVip: false } });
    });
    await mount(); act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    try {
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(mocks.load).toHaveBeenCalledTimes(1);
    } finally { await act(async () => validation.resolve()); }
    expect(mocks.load.mock.calls.map(([value]) => value)).toEqual(["synthetic-old", "synthetic-new"]);
    expect(useWyAccountStore.getState().account?.uid).toBe("synthetic-new");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["关闭", "切换"])("尚在等待旧事务的新登录允许%s，并在轮到执行时取消", async (action) => {
    const validation = deferred<void>();
    mocks.checkQr.mockResolvedValueOnce(authorized).mockResolvedValueOnce({ ...authorized, cookie: "synthetic-cancelled" });
    mocks.load.mockImplementation(async () => {
      await validation.promise;
      useWyAccountStore.setState({ account: { uid: "old", nickname: "已验证", avatarUrl: "", vipType: 0, isVip: false } });
    });
    await mount(); act(() => { renderer!.unmount(); renderer = undefined; }); await mount();
    await act(async () => {
      if (action === "关闭") renderer!.root.findByProps({ className: "af-dialog-overlay" }).props.onClick();
      else button("Cookie 登录").props.onClick();
    });
    await act(async () => validation.resolve());
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.getCookie).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(action === "关闭" ? 1 : 0);
  });
});
