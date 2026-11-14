// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "../src/components/ui/Select";

const OPTIONS = [
  { value: "cover", label: "封面背景" },
  { value: "liquid", label: "液态渐变" },
  { value: "aurora", label: "极光光幕" },
];

let root: Root;
const onChange = vi.fn();

const trigger = () => document.querySelector<HTMLButtonElement>("button.af-settings-select")!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
const open = () => act(() => trigger().click());

function mount(value = "liquid") {
  act(() => root.render(
    <Select label="沉浸式播放背景" triggerClassName="af-settings-select" options={OPTIONS} value={value} onChange={onChange} />,
  ));
}

/** 按键发给当前焦点元素，和真实键盘一样从焦点处冒泡 */
function press(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => { document.activeElement!.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  onChange.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("自绘下拉选择 Select", () => {
  it("触发器显示当前选项；展开后列出全部选项，焦点落在当前项", () => {
    mount();
    expect(trigger().textContent).toBe("液态渐变");
    expect(trigger().getAttribute("aria-label")).toBe("沉浸式播放背景：液态渐变");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();

    open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu()!.getAttribute("aria-label")).toBe("沉浸式播放背景");
    expect(items().map((item) => item.textContent)).toEqual(["封面背景", "液态渐变", "极光光幕"]);
    expect(items().map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(items()[1]);
  });

  it("方向键 / Home / End 在选项间移动焦点，到头不越界，并拦下页面滚动", () => {
    mount();
    open();

    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items()[2]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items()[2]);

    press("Home");
    expect(document.activeElement).toBe(items()[0]);
    press("ArrowUp");
    expect(document.activeElement).toBe(items()[0]);

    press("End");
    expect(document.activeElement).toBe(items()[2]);
    expect(menu()).not.toBeNull();
  });

  it("选中其它项回调新值并收起；选回当前项只收起，不重复回调", () => {
    mount();
    open();
    act(() => items()[2].click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("aurora");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => items()[1].click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("Esc / Tab / 点空白 / 页面滚动都收起并把焦点还给触发器，菜单内部滚动不收起", () => {
    mount();

    open();
    press("Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    // Tab 不拦默认行为：焦点先回触发器，再由浏览器走到相邻控件
    open();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => document.querySelector<HTMLElement>(".af-add-menu-backdrop")!.click());
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => { menu()!.dispatchEvent(new Event("scroll")); });
    expect(menu()).not.toBeNull();
    // 页面级滚动的 target 是 document，它没有 closest
    act(() => { document.dispatchEvent(new Event("scroll")); });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("值不在选项里时原样显示，不伪装成第一项；展开后焦点落在第一项", () => {
    mount("legacy-mode");
    expect(trigger().textContent).toBe("legacy-mode");

    open();
    expect(items().every((item) => item.getAttribute("aria-checked") === "false")).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
  });
});
