/**
 * 待恢复的播放位置（跨重启）。
 *
 * 刻意独立成一个**叶子模块**（不 import 任何 store）：播放会话持久化要 import `usePlayerStore`，
 * 而 `playerStore` 又需要这里的 `takeResumeProgress` —— 两者互相 import 时模块初始化顺序
 * 会让 `usePlayerStore` 落在暂时性死区（StrictMode 下更容易暴露）。这里只放纯数据与纯函数。
 */

import type { MusicInfo } from '@lx/core';

/** 播放请求标识，与 playerStore 内部的 `buildPlayRequestKey` 同构（`source:id`）。 */
export function playbackTrackKey(music: Pick<MusicInfo, 'source' | 'id'>): string {
  return `${music.source}:${music.id}`;
}

let pending: { key: string; seconds: number } | null = null;

/** 记下「下次播放这首歌时从第几秒开始」；秒数不合法（≤0 / NaN）等于没有待恢复位置。 */
export function setResumeTarget(music: Pick<MusicInfo, 'source' | 'id'>, seconds: number): void {
  pending = Number.isFinite(seconds) && seconds > 0
    ? { key: playbackTrackKey(music), seconds }
    : null;
}

/**
 * 取走这首歌的待恢复位置；**取一次即消费**，只对同一首歌生效。
 *
 * 恢复的语义是「用户按下播放、继续听上次那首」，而不是「启动就自动播放」：
 * 所以这里只在真正要装载这首歌时被调用一次，之后重播同一首歌应当从头开始。
 */
export function takeResumeProgress(music: Pick<MusicInfo, 'source' | 'id'>): number | null {
  if (!pending || pending.key !== playbackTrackKey(music)) return null;
  const seconds = pending.seconds;
  pending = null;
  return seconds;
}

/** 丢弃待恢复位置（清空播放状态 / 重置用户数据时用）。 */
export function clearResumeTarget(): void {
  pending = null;
}
