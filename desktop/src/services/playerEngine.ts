import type { MusicInfo } from "@lx/core";
import { isPreviewDuration } from "@lx/core";
import {
  normalizePauseOnExternalPlayback,
  shouldResumeAfterExternalPause,
} from "@/services/mediaInterruptionPolicy";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

const INTERNAL_PAUSE_GUARD_MS = 500;
const FADE_OUT_MS = 90;
const FADE_IN_MS = 140;

export interface PlayerEngineState {
  currentMusic: MusicInfo | null;
  status: PlayerStatus;
  currentUrl: string | null;
  duration: number;
  currentTime: number;
  /** currentTime 的采样时刻（Date.now()）：跨 WebView 同一时间基准，UI 插值用它做锚点 */
  currentTimeSampledAt: number;
  volume: number;
  playbackRate: number;
  error: string | null;
}

type Unsubscribe = () => void;
type StateListener = (state: PlayerEngineState) => void;
type EndedListener = () => void;
type PreviewListener = (duration: number) => void;

class PlayerEngine {
  private readonly audio = new Audio();
  private loadVersion = 0;
  private preloadAudio: HTMLAudioElement | null = null;
  private preloadedUrl: string | null = null;
  private state: PlayerEngineState = {
    currentMusic: null,
    status: "idle",
    currentUrl: null,
    duration: 0,
    currentTime: 0,
    currentTimeSampledAt: Date.now(),
    volume: 0.8,
    playbackRate: 1.0,
    error: null,
  };
  private stateListeners = new Set<StateListener>();
  private endedListeners = new Set<EndedListener>();
  private previewListeners = new Set<PreviewListener>();
  private progressRaf: number | null = null;
  /** rAF 被窗口遮挡 / 全屏 / 合成器繁忙而节流时，用低频 interval 兜底推送真实 currentTime，避免 store 进度与歌词冻结。 */
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private fadeRaf: number | null = null;
  private fadeResolve: (() => void) | null = null;
  private fadeToken = 0;
  private pauseOnExternalPlayback = true;
  private internalPauseGuardUntil = 0;

  constructor() {
    this.bindAudioEvents(this.audio);
  }

  private bindAudioEvents(audio: HTMLAudioElement): void {
    const on = (event: string, listener: () => void) => {
      audio.addEventListener(event, listener);
    };
    audio.volume = this.state.volume;
    audio.playbackRate = this.state.playbackRate;

    on("loadedmetadata", () => {
      const duration = this.audio.duration || 0;
      this.patchState({ duration });
      // 试听兜底：解析期拿不到长度头的流式响应靠播放器实际时长判定（见 @lx/core stream-integrity）
      const music = this.state.currentMusic;
      if (
        music &&
        isPreviewDuration({ actualDurationSeconds: duration, expectedDurationSeconds: music.interval })
      ) {
        this.previewListeners.forEach((listener) => listener(duration));
      }
    });

    on("timeupdate", () => {
      this.patchState({ currentTime: this.audio.currentTime || 0 });
    });

    on("play", () => {
      this.startProgressLoop();
      this.patchState({ status: "playing", currentTime: this.audio.currentTime || 0 });
    });

    on("pause", () => {
      const wasPlayingBeforePause = this.state.status === "playing";
      this.stopProgressLoop();
      if (shouldResumeAfterExternalPause({
        pauseOnExternalPlayback: this.pauseOnExternalPlayback,
        wasPlayingBeforePause,
        internalPausePending: this.isInternalPausePending(),
        hasCurrentUrl: Boolean(this.state.currentUrl),
        mediaEnded: this.audio.ended,
      })) {
        this.audio.play().catch((error) => {
          this.patchState({
            status: "paused",
            currentTime: this.audio.currentTime || 0,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (this.state.status !== "loading") {
        this.patchState({ status: "paused", currentTime: this.audio.currentTime || 0 });
      }
    });

    on("ended", () => {
      this.stopProgressLoop();
      this.patchState({ status: "idle", currentTime: 0 });
      this.endedListeners.forEach((l) => l());
    });

    on("error", () => {
      const error = this.audio.error
        ? `播放失败（code: ${this.audio.error.code}）`
        : "播放失败";
      // 必须显式停循环：src 加载失败发生在 play() 之后时 audio.paused 仍为 false，
      // tick 里的 !paused 守卫拦不住，rAF 会以 60fps 空转并每帧 patchState，
      // 上层每帧写一条日志 + 一次 Tauri IPC，直到用户手动切歌。
      this.stopProgressLoop();
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

  /** 播放器解析出试听片段时通知（duration 为实际流时长）。 */
  onPreviewDetected(listener: PreviewListener): Unsubscribe {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  setPauseOnExternalPlayback(value: unknown): void {
    this.pauseOnExternalPlayback = normalizePauseOnExternalPlayback(value);
  }

  /** 曲库资料变化只更新元信息，不能重新启动歌曲或重置进度。 */
  updateCurrentMusic(music: MusicInfo): void {
    const current = this.state.currentMusic;
    if (!current || current.id !== music.id || current.source !== music.source) return;
    this.patchState({ currentMusic: music });
  }

  async load(music: MusicInfo, url: string, assertPlaybackAllowed?: () => void, startAtSeconds?: number): Promise<void> {
    const version = ++this.loadVersion;
    const assertCurrent = () => { if (version !== this.loadVersion) throw new Error("播放加载已被更新的操作取消"); };
    assertPlaybackAllowed?.();
    await this.fadeOut();
    // 淡出会让出执行权；切歌、暂停或停止后不能再提交旧加载。
    assertCurrent();
    assertPlaybackAllowed?.();
    this.audio.volume = this.state.volume;
    this.patchState({
      currentMusic: music,
      currentUrl: url,
      status: "loading",
      duration: 0,
      currentTime: 0,
      error: null,
    });

    this.markInternalPause();
    this.audio.src = url;
    this.audio.load();
    // 恢复上次播放位置：此刻还没有 metadata，赋 currentTime 会被浏览器记成「默认起播位置」，
    // 元数据到位后自动落到该处；顺手把状态推给 UI，进度条不必等 metadata 才正确。
    if (typeof startAtSeconds === "number" && startAtSeconds > 0) {
      this.audio.currentTime = startAtSeconds;
      this.patchState({ currentTime: startAtSeconds });
    }
    // load() 会重置播放速率，必须在装载后恢复用户设置。
    this.audio.playbackRate = this.state.playbackRate;
  }

  async play(music: MusicInfo, url: string, assertPlaybackAllowed?: () => void, startAtSeconds?: number): Promise<void> {
    const version = this.loadVersion + 1;
    try {
      await this.load(music, url, assertPlaybackAllowed, startAtSeconds);
      if (version !== this.loadVersion) throw new Error("播放加载已被更新的操作取消");
      assertPlaybackAllowed?.();
      await this.audio.play();
    } catch (error) {
      if (version === this.loadVersion) {
        this.cancelFade();
        this.audio.volume = this.state.volume;
      }
      throw error;
    }
    if (version === this.loadVersion) void this.fadeIn();
  }

  pause(): void {
    this.loadVersion += 1;
    this.cancelFade();
    this.audio.volume = this.state.volume;
    this.markInternalPause();
    this.audio.pause();
  }

  resume(): void {
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
    this.cancelFade();
    this.markInternalPause();
    this.audio.pause();
    this.audio.volume = this.state.volume;
    this.audio.currentTime = 0;
    this.patchState({
      status: "paused",
      currentTime: 0,
    });
  }

  stop(): void {
    this.loadVersion += 1;
    this.stopProgressLoop();
    this.cancelFade();
    this.markInternalPause();
    this.audio.pause();
    this.audio.volume = this.state.volume;
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
    if (!Number.isFinite(duration)) return;
    const clamped = Math.max(0, Math.min(seconds, duration));
    this.audio.currentTime = clamped;
    this.patchState({ currentTime: clamped });
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 1));
    this.cancelFade();
    this.audio.volume = clamped;
    this.patchState({ volume: clamped });
  }

  /** 切歌前做短淡出，避免爆音和瞬时音量跳变。 */
  private async fadeOut(): Promise<void> {
    if (this.audio.paused || this.state.status !== "playing") return;
    await this.fadeAudioVolume(0, FADE_OUT_MS);
  }

  /** 新歌起播后淡入。 */
  private fadeIn(): void {
    this.audio.volume = 0;
    void this.fadeAudioVolume(this.state.volume, FADE_IN_MS);
  }

  private fadeAudioVolume(targetVolume: number, durationMs: number): Promise<void> {
    this.cancelFade();
    const fromVolume = this.audio.volume;
    const toVolume = Math.max(0, Math.min(targetVolume, 1));
    const token = this.fadeToken;
    const startedAt = performance.now();

    if (durationMs <= 0 || fromVolume === toVolume) {
      this.audio.volume = toVolume;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.fadeResolve = resolve;
      const tick = (now: number) => {
        if (token !== this.fadeToken) {
          resolve();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / durationMs);
        const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
        this.audio.volume = fromVolume + (toVolume - fromVolume) * eased;

        if (progress < 1) {
          this.fadeRaf = requestAnimationFrame(tick);
          return;
        }

        this.fadeRaf = null;
        this.fadeResolve = null;
        resolve();
      };

      this.fadeRaf = requestAnimationFrame(tick);
    });
  }

  private cancelFade(): void {
    this.fadeToken += 1;
    if (this.fadeRaf != null) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
    if (this.fadeResolve) {
      const resolve = this.fadeResolve;
      this.fadeResolve = null;
      resolve();
    }
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

  private startProgressLoop(): void {
    if (this.progressRaf != null) return;

    const tick = () => {
      this.patchState({ currentTime: this.audio.currentTime || 0 });
      if (!this.audio.paused && !this.audio.ended) {
        this.progressRaf = requestAnimationFrame(tick);
      } else {
        this.progressRaf = null;
        this.stopProgressFallbackInterval();
      }
    };

    this.progressRaf = requestAnimationFrame(tick);
    this.startProgressFallbackInterval();
  }

  /**
   * 兜底进度推送：rAF 正常时几乎不触发（阈值 0.15s），仅在 rAF 被节流
   * （窗口遮挡 / 原生全屏 / 沉浸页重合成）导致 currentTime 落后时校正 store。
   */
  private startProgressFallbackInterval(): void {
    if (this.progressInterval != null) return;
    this.progressInterval = setInterval(() => {
      if (this.audio.paused || this.audio.ended) return;
      const current = this.audio.currentTime || 0;
      if (Math.abs(current - this.state.currentTime) > 0.15) {
        this.patchState({ currentTime: current });
      }
    }, 500);
  }

  private stopProgressFallbackInterval(): void {
    if (this.progressInterval == null) return;
    clearInterval(this.progressInterval);
    this.progressInterval = null;
  }

  private stopProgressLoop(): void {
    if (this.progressRaf != null) {
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = null;
    }
    this.stopProgressFallbackInterval();
  }

  private markInternalPause(): void {
    this.internalPauseGuardUntil = Date.now() + INTERNAL_PAUSE_GUARD_MS;
  }

  private isInternalPausePending(): boolean {
    return Date.now() <= this.internalPauseGuardUntil;
  }

  private patchState(patch: Partial<PlayerEngineState>): void {
    // 采样时刻与 currentTime 同帧写入，供 UI 层按真实采样时间外推
    if (patch.currentTime !== undefined) {
      patch = { ...patch, currentTimeSampledAt: Date.now() };
    }
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l(this.getState()));
  }
}

export const playerEngine = new PlayerEngine();
