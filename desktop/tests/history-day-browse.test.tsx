import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { addDays, dayStartOf, type MusicInfo } from "@lx/core";

vi.mock("@lx/tauri-bridge", () => ({
  libraryLoad: vi.fn().mockResolvedValue(null),
  librarySave: vi.fn().mockResolvedValue(undefined),
}));

const playNext = vi.fn();
const playQueue = vi.fn();
vi.mock("@/stores/playerStore", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) => selector({ playNext, playQueue }),
}));

/** react-test-renderer 的树在含组件引用时会成环，这里只收集文本。 */
function textOf(node: unknown, seen = new WeakSet<object>()): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  if (seen.has(node)) return "";
  seen.add(node);
  const children = (node as { children?: unknown[] }).children;
  return Array.isArray(children) ? children.map((child) => textOf(child, seen)).join("") : "";
}

const song = (id: string, name: string): MusicInfo => ({
  id,
  source: "wy",
  name,
  singer: "Singer",
  albumName: "",
});

it("播放历史默认看今天，前后翻天后只显示当天的歌", async () => {
  const today = dayStartOf(Date.now());
  const yesterday = addDays(today, -1);
  const { useHistoryStore, historyPersistence } = await import("../src/stores/historyStore");
  await historyPersistence.ready;
  useHistoryStore.getState().replaceAll([
    { key: "wy:a", song: song("a", "今天的歌"), playedAt: today + 9 * 60 * 60 * 1000 },
    { key: "wy:b", song: song("b", "昨天的歌"), playedAt: yesterday + 20 * 60 * 60 * 1000 },
    { key: "wy:c", song: song("c", "时间未知的歌"), playedAt: 0 },
  ]);

  const { HistoryView } = await import("../src/views/HistoryView");
  let view!: ReturnType<typeof create>;
  act(() => {
    view = create(<HistoryView />);
  });

  let rendered = textOf(view.toJSON());
  expect(rendered).toContain("今天");
  expect(rendered).toContain("今天的歌");
  expect(rendered).not.toContain("昨天的歌");
  expect(rendered).toContain("时间未知");

  const prev = view.root.findAll(
    (node) => node.props["aria-label"] === "前一天" && typeof node.props.onClick === "function",
  )[0];
  act(() => { prev.props.onClick(); });
  rendered = textOf(view.toJSON());
  expect(rendered).toContain("昨天");
  expect(rendered).toContain("昨天的歌");
  expect(rendered).not.toContain("今天的歌");

  const unknown = view.root.findAll(
    (node) => typeof node.props.className === "string" && node.props.className.includes("af-history-unknown"),
  )[0];
  act(() => { unknown.props.onClick(); });
  rendered = textOf(view.toJSON());
  expect(rendered).toContain("时间未知的歌");

  act(() => view.unmount());
});
