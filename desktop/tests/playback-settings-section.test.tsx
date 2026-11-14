import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaybackSettingsSection } from "../src/views/settings/PlaybackSettingsSection";
const mock = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: mock.load, patchSettings: mock.patch, libraryLoad: vi.fn().mockResolvedValue(null), librarySave: vi.fn() }));
vi.mock("../src/services/playerEngine", () => ({ playerEngine: {} }));
// 音质下拉的菜单走 portal；node 环境没有 DOM，改为就地渲染
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
const model = {
  defaultQuality: "320k",
  handleDefaultQualityChange: vi.fn(),
  pauseOnExternalPlayback: true,
  handlePauseOnExternalPlaybackChange: vi.fn(),
  playbackFailedAutoNext: false,
  handlePlaybackFailedAutoNextChange: vi.fn(),
  playbackSettingsStatus: "",
};
let renderer: ReactTestRenderer | undefined;
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}
const button = (label: string) => renderer!.root.findAllByType("button").find((node) => text(node) === label)!;
beforeEach(() => {
  vi.clearAllMocks();
  mock.load.mockResolvedValue({ replayGainEnabled: true });
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it("播放设置移除本地音量平衡，保留普通音质和外部媒体行为", async () => {
  await act(async () => { renderer = create(<PlaybackSettingsSection model={model as never} />); });
  expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/ReplayGain|音量平衡|音量补偿/);
  expect(mock.load).not.toHaveBeenCalled();
  expect(mock.patch).not.toHaveBeenCalled();
  const qualityTrigger = renderer!.root.findByProps({ "aria-label": "音质偏好：高品质 320K" });
  // 触发器按事件里的 currentTarget 定位；test-renderer 没有布局，给个固定矩形即可
  act(() => qualityTrigger.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 120, bottom: 156, left: 24, width: 180 }) } }));
  act(() => button("无损 FLAC").props.onClick());
  expect(model.handleDefaultQualityChange).toHaveBeenCalledWith("flac");
  await act(async () => { await button("继续播放").props.onClick(); });
  expect(model.handlePauseOnExternalPlaybackChange).toHaveBeenCalledWith(false);
});
