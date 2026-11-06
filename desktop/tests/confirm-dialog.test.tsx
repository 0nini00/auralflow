// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { confirmAction } from "../src/components/ui/ConfirmDialog";

async function open(options: Parameters<typeof confirmAction>[0]) {
  let promise!: Promise<boolean>;
  await act(async () => {
    promise = confirmAction(options);
  });
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog).toBeTruthy();
  const button = (label: string) =>
    Array.from(dialog.querySelectorAll("button")).find((node) => node.textContent === label) as HTMLButtonElement;
  return { promise, dialog, button };
}

it("确认返回 true，取消返回 false", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const first = await open({ title: "删除歌单", message: "确定要删除吗？", confirmLabel: "删除", danger: true });
  expect(first.dialog.textContent).toContain("删除歌单");
  expect(first.button("删除").className).toContain("af-confirm-danger");
  await act(async () => { first.button("删除").click(); });
  expect(await first.promise).toBe(true);
  await act(async () => { await Promise.resolve(); });

  const second = await open({ title: "清空缓存", message: "不可恢复" });
  await act(async () => { second.button("取消").click(); });
  expect(await second.promise).toBe(false);

  vi.unstubAllGlobals();
});

it("Esc 等同取消", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { promise, dialog } = await open({ title: "退出", message: "确定退出？" });
  await act(async () => {
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(await promise).toBe(false);
  vi.unstubAllGlobals();
});
