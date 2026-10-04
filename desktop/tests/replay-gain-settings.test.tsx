import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaybackSettingsSection } from "../src/views/settings/PlaybackSettingsSection";
const mock = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn(), apply: vi.fn() }));
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: mock.load, patchSettings: mock.patch, libraryLoad: vi.fn().mockResolvedValue(null), librarySave: vi.fn() }));
vi.mock("../src/services/playerEngine", () => ({ playerEngine: { getState: () => ({ currentMusic: null }), getReplayGainState: () => ({ enabled: false, status: "disabled", gain: 1, appliedDb: 0, peakLimited: false, hasPeak: false }), setReplayGainEnabled: mock.apply, subscribe: () => () => {} } }));
const model = { defaultQuality: "320k", setDefaultQuality: vi.fn(), pauseOnExternalPlayback: true, patchPlaybackSetting: vi.fn(), handlePauseOnExternalPlaybackChange: vi.fn() };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.clearAllMocks(); mock.load.mockResolvedValue({ replayGainEnabled: false }); mock.patch.mockResolvedValue(undefined); });
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
it("本地ReplayGain默认关闭，保存成功后才应用", async () => {
  await act(async () => { renderer = create(<PlaybackSettingsSection model={model as never} />); });
  const input = renderer!.root.findByProps({ "aria-label": "本地 ReplayGain 音量平衡" });
  expect(input.props.checked).toBe(false);
  await act(async () => { await input.props.onChange({ target: { checked: true } }); });
  expect(mock.patch).toHaveBeenCalledWith({ replayGainEnabled: true });
  expect(mock.apply).toHaveBeenCalledWith(true);
});
it("保存失败明确显示，不提前启用音量补偿", async () => {
  mock.patch.mockRejectedValue(new Error("写盘失败"));
  await act(async () => { renderer = create(<PlaybackSettingsSection model={model as never} />); });
  const input = renderer!.root.findByProps({ "aria-label": "本地 ReplayGain 音量平衡" });
  await act(async () => { await input.props.onChange({ target: { checked: true } }); });
  expect(mock.apply).not.toHaveBeenCalledWith(true);
  expect(JSON.stringify(renderer!.toJSON())).toContain("写盘失败");
});
