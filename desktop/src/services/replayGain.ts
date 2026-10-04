import type { MusicInfo } from "@lx/core";

export interface ReplayGainState {
  enabled: boolean;
  status: "disabled" | "not-local" | "missing" | "invalid" | "applied";
  gain: number;
  appliedDb: number;
  peakLimited: boolean;
  hasPeak: boolean;
  reason?: string;
}

export function calculateReplayGain(enabled: boolean, music: MusicInfo | null): ReplayGainState {
  const base = { enabled, gain: 1, appliedDb: 0, peakLimited: false, hasPeak: false };
  if (!enabled) return { ...base, status: "disabled" };
  if (!music?.isLocal || music.source !== "local") return { ...base, status: "not-local" };
  if (music.replayGainError) return { ...base, status: "invalid", reason: music.replayGainError };
  const tag = music.replayGain;
  if (!tag) return { ...base, status: "missing" };
  const requested = 10 ** (tag.gainDb / 20);
  if (!Number.isFinite(tag.gainDb) || !Number.isFinite(requested) || requested <= 0
    || (tag.peak !== undefined && (!Number.isFinite(tag.peak) || tag.peak <= 0))) {
    return { ...base, status: "invalid" };
  }
  const gain = tag.peak === undefined ? requested : Math.min(requested, 1 / tag.peak);
  return { ...base, status: "applied", gain, appliedDb: 20 * Math.log10(gain),
    peakLimited: gain < requested, hasPeak: tag.peak !== undefined };
}

/** 只接入本地 asset 媒体元素。在线流继续使用未连接 Web Audio 的原元素。 */
export class LocalReplayGainOutput {
  readonly audio = new Audio();
  private readonly context: AudioContext;
  private readonly gainNode: GainNode;
  private readonly source: MediaElementAudioSourceNode;

  constructor() {
    if (typeof AudioContext === "undefined") throw new Error("当前环境不支持本地 ReplayGain 音频输出");
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    this.source = this.context.createMediaElementSource(this.audio);
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.context.destination);
  }

  async ready(): Promise<void> {
    if (this.context.state === "suspended") await this.context.resume();
    if (this.context.state !== "running") throw new Error("本地音频输出尚未就绪，请点击播放重试");
  }

  setGain(value: number): void {
    this.gainNode.gain.setValueAtTime(value, this.context.currentTime);
  }
}
