import type { MusicInfo } from "@lx/core";
import { SoundTouch, SimpleFilter, type SampleSource } from "soundtouchjs";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PlayerEngineState {
  currentMusic: MusicInfo | null;
  status: PlayerStatus;
  currentUrl: string | null;
  duration: number;
  currentTime: number;
  volume: number;
  playbackRate: number;
  error: string | null;
}

type Unsubscribe = () => void;
type StateListener = (state: PlayerEngineState) => void;
type EndedListener = () => void;
type GraphReadyListener = () => void;

class PlayerEngine {
  private audio = new Audio();
  private preloadAudio: HTMLAudioElement | null = null;
  private preloadedUrl: string | null = null;
  // ── WebAudio 音效图 ──
  private ctx: AudioContext | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private mediaSourceCreated = false;
  private eqNodes: BiquadFilterNode[] = [];
  private panner: StereoPannerNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private graphReady = false;
  // ── 变调（实验性，ScriptProcessorNode + soundtouchjs）──
  private pitchNode: ScriptProcessorNode | null = null;
  private pitchSoundTouch: SoundTouch | null = null;
  private pitchFilter: SimpleFilter | null = null;
  private pitchRing: RingSource | null = null;
  private pitchActive = false;
  private state: PlayerEngineState = {
    currentMusic: null,
    status: "idle",
    currentUrl: null,
    duration: 0,
    currentTime: 0,
    volume: 0.8,
    playbackRate: 1.0,
    error: null,
  };
  private stateListeners = new Set<StateListener>();
  private endedListeners = new Set<EndedListener>();
  private graphReadyListeners = new Set<GraphReadyListener>();
  private progressRaf: number | null = null;

  constructor() {
    this.audio.volume = this.state.volume;
    this.audio.playbackRate = this.state.playbackRate;

    this.audio.addEventListener("loadedmetadata", () => {
      this.patchState({ duration: this.audio.duration || 0 });
    });

    this.audio.addEventListener("timeupdate", () => {
      this.patchState({ currentTime: this.audio.currentTime || 0 });
    });

    this.audio.addEventListener("play", () => {
      this.startProgressLoop();
      this.patchState({ status: "playing", currentTime: this.audio.currentTime || 0 });
    });

    this.audio.addEventListener("pause", () => {
      this.stopProgressLoop();
      if (this.state.status !== "loading") {
        this.patchState({ status: "paused", currentTime: this.audio.currentTime || 0 });
      }
    });

    this.audio.addEventListener("ended", () => {
      this.stopProgressLoop();
      this.patchState({ status: "idle", currentTime: 0 });
      this.endedListeners.forEach((l) => l());
    });

    this.audio.addEventListener("error", () => {
      const error = this.audio.error
        ? `播放失败（code: ${this.audio.error.code}）`
        : "播放失败";
      this.patchState({ status: "error", error });
    });
  }

  getState(): PlayerEngineState {
    return { ...this.state };
  }

  subscribe(listener: StateListener): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEnded(listener: EndedListener): Unsubscribe {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  /** 音效图首次构建完成后触发；音效 store 用它把持久化设置重新 apply 到引擎。 */
  onGraphReady(listener: GraphReadyListener): Unsubscribe {
    this.graphReadyListeners.add(listener);
    if (this.graphReady) listener();
    return () => this.graphReadyListeners.delete(listener);
  }

  /** 按需启用音效图。默认播放保持原生 audio 直出，避免本地 asset URL 被 WebAudio 静音。 */
  ensureEffectsGraph(): void {
    this.ensureGraph();
  }

  async load(music: MusicInfo, url: string): Promise<void> {
    this.patchState({
      currentMusic: music,
      currentUrl: url,
      status: "loading",
      duration: 0,
      currentTime: 0,
      error: null,
    });
    this.audio.src = url;
    this.audio.load();
  }

  async play(music: MusicInfo, url: string): Promise<void> {
    await this.load(music, url);
    void this.resumeContext();
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    void this.resumeContext();
    this.audio.play().catch((e) => {
      this.patchState({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  /** 暂停并把进度归零，但保留 currentMusic / currentUrl，便于 UI 继续显示"刚刚那首"。 */
  pauseAtEnd(): void {
    this.stopProgressLoop();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.patchState({
      status: "paused",
      currentTime: 0,
    });
  }

  stop(): void {
    this.stopProgressLoop();
    this.audio.pause();
    this.audio.src = "";
    this.audio.load();
    this.patchState({
      status: "idle",
      currentMusic: null,
      currentUrl: null,
      duration: 0,
      currentTime: 0,
      error: null,
    });
  }

  seek(seconds: number): void {
    const duration = this.state.duration;
    if (!isFinite(duration)) return;
    const clamped = Math.max(0, Math.min(seconds, duration));
    this.audio.currentTime = clamped;
    this.patchState({ currentTime: clamped });
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 1));
    this.audio.volume = clamped;
    this.patchState({ volume: clamped });
  }

  setPlaybackRate(rate: number): void {
    const clamped = Math.max(0.25, Math.min(rate, 3.0));
    this.audio.playbackRate = clamped;
    this.patchState({ playbackRate: clamped });
  }

  /** 预加载下一首 URL，让浏览器提前缓存，切换时更快起播。 */
  preload(url: string): void {
    if (!url || url === this.preloadedUrl) return;
    if (!this.preloadAudio) {
      this.preloadAudio = new Audio();
      this.preloadAudio.preload = "auto";
      this.preloadAudio.muted = true;
    }
    this.preloadedUrl = url;
    this.preloadAudio.src = url;
    this.preloadAudio.load();
  }

  // ── 音效：WebAudio 图 ───────────────────────────────

  /** 懒构建音频图。必须在用户手势（play）后调用。可恢复：mediaSource 只创建一次，中途失败后重试不重复创建。 */
  private ensureGraph(): void {
    if (this.graphReady) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.ctx) this.ctx = new Ctx();
      if (!this.mediaSourceCreated) {
        this.mediaSource = this.ctx.createMediaElementSource(this.audio);
        this.mediaSourceCreated = true;
      } else if (this.mediaSource) {
        // 重试：先断开上一次失败残留的半连接，避免重建后重复出声
        try { this.mediaSource.disconnect(); } catch { /* ignore */ }
      }

      // 5 段 EQ：60 / 230 / 910 / 3600 / 14000 Hz
      const freqs = [60, 230, 910, 3600, 14000];
      this.eqNodes = freqs.map((f) => {
        const node = this.ctx!.createBiquadFilter();
        node.type = "peaking";
        node.frequency.value = f;
        node.Q.value = 1.0;
        node.gain.value = 0;
        return node;
      });
      for (let i = 0; i < this.eqNodes.length - 1; i++) {
        this.eqNodes[i].connect(this.eqNodes[i + 1]);
      }

      this.panner = this.ctx.createStereoPanner();
      this.panner.pan.value = 0;

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.buildImpulseResponse(2.2, 2.5);
      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 1;
      this.wetGain = this.ctx.createGain();
      this.wetGain.gain.value = 0;

      const lastEq = this.eqNodes[this.eqNodes.length - 1];
      lastEq.connect(this.panner);
      this.panner.connect(this.dryGain);
      this.dryGain.connect(this.ctx.destination);
      this.panner.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(this.ctx.destination);

      this.mediaSource!.connect(this.eqNodes[0]);
      this.graphReady = true;
      this.graphReadyListeners.forEach((l) => l());
    } catch (err) {
      console.warn("[playerEngine] 音效图构建失败，回退直连", err);
      this.graphReady = false;
    }
  }

  /** 生成简单的衰减噪声脉冲响应，用于混响卷积。 */
  private buildImpulseResponse(durationSec: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * durationSec));
    const buf = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buf;
  }

  /** 音效图就绪后恢复 AudioContext（autoplay 策略）。 */
  async resumeContext(): Promise<void> {
    if (this.ctx && this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  setEqGains(gains: number[]): void {
    if (!this.graphReady) return;
    for (let i = 0; i < this.eqNodes.length && i < gains.length; i++) {
      this.eqNodes[i].gain.value = gains[i];
    }
  }

  setPan(pan: number): void {
    if (!this.graphReady || !this.panner) return;
    this.panner.pan.value = Math.max(-1, Math.min(1, pan));
  }

  setReverbMix(mix: number): void {
    if (!this.graphReady || !this.wetGain || !this.dryGain) return;
    const clamped = Math.max(0, Math.min(1, mix));
    this.wetGain.gain.value = clamped;
    this.dryGain.gain.value = 1 - clamped * 0.5;
  }

  // ── 变调（实验性）──────────────────────────────────

  /**
   * 独立变调（保持 tempo）。semitones=0 旁路，不影响正常播放。
   * 注意：基于已废弃的 ScriptProcessorNode + soundtouchjs，可能有延迟/杂音。
   */
  setPitch(semitones: number): void {
    const clamped = Math.max(-12, Math.min(12, Math.round(semitones)));
    if (clamped === 0) {
      this.disablePitch();
      return;
    }
    if (!this.graphReady) this.ensureGraph();
    if (!this.graphReady || !this.ctx || !this.mediaSource || this.eqNodes.length === 0) return;

    this.enablePitch(clamped);
  }

  private enablePitch(semitones: number): void {
    const ctx = this.ctx!;
    if (!this.pitchNode) {
      this.pitchRing = new RingSource();
      this.pitchSoundTouch = new SoundTouch();
      this.pitchFilter = new SimpleFilter(this.pitchRing, this.pitchSoundTouch);
      this.pitchNode = ctx.createScriptProcessor(4096, 2, 2);
      this.pitchNode.onaudioprocess = (e) => {
        if (!this.pitchRing || !this.pitchFilter) return;
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.getChannelData(1);
        const n = e.inputBuffer.length;
        this.pitchRing.feed(inL, inR, n);
        const out = new Float32Array(n * 2);
        this.pitchFilter.extract(out, n);
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < n; i++) {
          outL[i] = out[i * 2];
          outR[i] = out[i * 2 + 1];
        }
      };
    }

    this.pitchSoundTouch!.clear();
    this.pitchSoundTouch!.pitchSemitones = semitones;
    this.pitchRing!.clear();

    if (!this.pitchActive) {
      // 把 pitchNode 插入 mediaSource 与 EQ 之间
      try { this.mediaSource!.disconnect(); } catch { /* ignore */ }
      this.mediaSource!.connect(this.pitchNode);
      this.pitchNode.connect(this.eqNodes[0]);
      this.pitchActive = true;
    }
  }

  private disablePitch(): void {
    if (!this.pitchActive) return;
    try { this.mediaSource!.disconnect(); } catch { /* ignore */ }
    try { this.pitchNode?.disconnect(); } catch { /* ignore */ }
    this.mediaSource!.connect(this.eqNodes[0]);
    this.pitchActive = false;
  }

  private startProgressLoop(): void {
    if (this.progressRaf != null) return;

    const tick = () => {
      this.patchState({ currentTime: this.audio.currentTime || 0 });
      if (!this.audio.paused && !this.audio.ended) {
        this.progressRaf = requestAnimationFrame(tick);
      } else {
        this.progressRaf = null;
      }
    };

    this.progressRaf = requestAnimationFrame(tick);
  }

  private stopProgressLoop(): void {
    if (this.progressRaf == null) return;
    cancelAnimationFrame(this.progressRaf);
    this.progressRaf = null;
  }

  private patchState(patch: Partial<PlayerEngineState>): void {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l(this.getState()));
  }
}

export const playerEngine = new PlayerEngine();

/** 环形缓冲源：供 SimpleFilter 流式读取 onaudioprocess 喂入的样本。 */
class RingSource implements SampleSource {
  private cap = 32768;
  private buf = new Float32Array(this.cap * 2);
  private wr = 0;
  private rd = 0;
  private frames = 0;
  position = 0;

  feed(left: Float32Array, right: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.frames >= this.cap) return;
      this.buf[this.wr * 2] = left[i];
      this.buf[this.wr * 2 + 1] = right[i];
      this.wr = (this.wr + 1) % this.cap;
      this.frames++;
    }
  }

  extract(target: Float32Array, numFrames: number): number {
    const n = Math.min(numFrames, this.frames);
    for (let i = 0; i < n; i++) {
      target[i * 2] = this.buf[this.rd * 2];
      target[i * 2 + 1] = this.buf[this.rd * 2 + 1];
      this.rd = (this.rd + 1) % this.cap;
      this.frames--;
    }
    return n;
  }

  clear(): void {
    this.wr = 0;
    this.rd = 0;
    this.frames = 0;
  }
}
