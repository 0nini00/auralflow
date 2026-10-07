import type { CommentVoice } from "@/services/musicApi";
import type { MediaAudioSession } from "@/services/mediaAudioSession";

export interface CommentVoiceItem { id: string; voice: CommentVoice }
export interface CommentVoiceState {
  item: CommentVoiceItem | null;
  token: number;
  phase: "idle" | "preparing" | "loading" | "playing" | "stopping" | "error";
  error: string | null;
}
interface Dependencies {
  createSession: (onInterrupted: () => void) => MediaAudioSession;
  stopMedia: () => Promise<void>;
  onChange: (state: CommentVoiceState) => void;
  onError: (error: unknown) => void;
}
const LOAD_TIMEOUT_MS = 20_000;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 单个评论面板只有一个媒体实例；序列化释放过程，避免切语音时短暂恢复歌曲。 */
export function createCommentVoiceController(deps: Dependencies) {
  let state: CommentVoiceState = { item: null, token: 0, phase: "idle", error: null };
  let revision = 0;
  let requestedId: string | null = null;
  let session: MediaAudioSession | null = null;
  let closingSession: MediaAudioSession | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: CommentVoiceState) => { state = next; deps.onChange(next); };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const advance = () => { clearTimer(); return ++revision; };
  const idle = (token: number) => publish({ item: null, token, phase: "idle", error: null });

  function enqueue(token: number, item: CommentVoiceItem | null, action: () => Promise<boolean>): Promise<boolean> {
    const result = pending.then(action).catch((error: unknown) => {
      deps.onError(error);
      if (token === revision) {
        requestedId = null;
        publish({ item, token, phase: "error", error: messageOf(error) });
      }
      // 调用方得到明确失败，队列本身仍可接受用户重试。
      return false;
    });
    pending = result;
    return result;
  }
  async function release(resume: boolean) {
    const closing = session;
    session = null;
    if (!closing) return;
    closingSession = closing;
    try { await closing.close(resume); }
    finally { if (closingSession === closing) closingSession = null; }
  }
  async function pauseMedia() {
    if (state.phase === "loading" || state.phase === "playing") publish({ ...state, phase: "stopping" });
    await deps.stopMedia();
  }
  async function finish(resume: boolean) {
    try {
      await pauseMedia();
    } catch (error) {
      try { await release(false); }
      catch (closingError) { throw new Error(`${messageOf(error)}；结束音频会话失败：${messageOf(closingError)}`); }
      throw error;
    }
    await release(resume);
  }
  function stop(resume = true): Promise<boolean> {
    // 中断不能排在旧 close(true) 后面；仍在挂起的恢复必须立刻失效。
    if (!resume) {
      const cancelling = session ?? closingSession;
      if (cancelling) void cancelling.close(false).catch(deps.onError);
    }
    const token = advance();
    requestedId = null;
    return enqueue(token, state.item, async () => {
      await finish(resume);
      if (token === revision) idle(token);
      return true;
    });
  }
  function failed(token: number, error: unknown): Promise<boolean> {
    if (token !== revision) return Promise.resolve(false);
    const item = state.item;
    const next = advance();
    requestedId = null;
    return enqueue(next, item, async () => {
      try { await finish(true); }
      catch (closingError) { throw new Error(`${messageOf(error)}；结束音频会话失败：${messageOf(closingError)}`); }
      throw error;
    });
  }
  function armTimer(token: number) {
    clearTimer();
    timer = setTimeout(() => { void failed(token, new Error("语音加载超时，请点击重试")); }, LOAD_TIMEOUT_MS);
  }
  function toggle(item: CommentVoiceItem): Promise<boolean> {
    if (requestedId === item.id && state.phase !== "error") return stop();
    const token = advance();
    requestedId = item.id;
    return enqueue(token, item, async () => {
      if (token !== revision) return false;
      let mediaStopped = false;
      try {
        await pauseMedia();
        mediaStopped = true;
        if (token !== revision) return false;
        publish({ item, token, phase: "preparing", error: null });
        session ??= deps.createSession(() => { void stop(false); });
        const ready = await session.start();
        if (token !== revision) return false;
        if (!ready) {
          await release(false);
          requestedId = null;
          idle(token);
          return false;
        }
        publish({ item, token, phase: "loading", error: null });
        armTimer(token);
        return true;
      } catch (error) {
        try { await release(mediaStopped); }
        catch (closingError) { throw new Error(`${messageOf(error)}；结束音频会话失败：${messageOf(closingError)}`); }
        throw error;
      }
    });
  }
  function buffering(token: number, isBuffering: boolean) {
    if (token !== revision || !state.item) return;
    publish({ ...state, phase: isBuffering ? "loading" : "playing" });
    if (isBuffering) armTimer(token); else clearTimer();
  }
  return {
    getState: () => state,
    toggle, stop, failed, buffering,
    loaded: (token: number) => buffering(token, false),
    ended: (token: number) => token === revision ? stop() : Promise.resolve(false),
    interrupted: (token: number) => token === revision ||
      (token === state.token && ["loading", "playing", "stopping"].includes(state.phase))
      ? stop(false) : Promise.resolve(false),
  };
}
