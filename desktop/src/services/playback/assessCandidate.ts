import { assessPlaybackCandidate, buildSongKey, CANDIDATE_PROBE_TIMEOUT_MS } from '@lx/core';
import { throwIfAborted, waitWithSignal } from './cancellation';
import { buildStreamHeaders } from './streamHeaders';
import { probeStreamUrl } from './streamProbe';
import type { PlaybackRequest, PlaybackResolvedUrl } from './types';

/** 同一候选只探活一次；明确拒绝与试听在进入竞速前退出。 */
export async function assessResolvedCandidate(
  resolved: PlaybackResolvedUrl,
  request: Pick<PlaybackRequest, 'signal' | 'deadlineAt' | 'excludedUrls' | 'excludedCandidateIds' | 'purpose'>,
): Promise<PlaybackResolvedUrl> {
  throwIfAborted(request.signal);
  const candidateId = resolved.candidateId ?? `${resolved.backend}:${buildSongKey(resolved.music)}:${resolved.quality}`;
  if (request.excludedCandidateIds?.has(candidateId)) throw new Error('该播放来源已被本次播放器拒绝');
  if (request.excludedUrls?.has(resolved.url)) throw new Error('播放地址已被本次播放拒绝');
  if (resolved.assessment?.status === 'rejected') throw new Error(`候选地址不可用(${resolved.assessment.reason})`);
  if (resolved.assessment) return { ...resolved, candidateId };
  const budget = Math.min(CANDIDATE_PROBE_TIMEOUT_MS, (request.deadlineAt ?? Infinity) - Date.now());
  if (budget <= 0) throw new Error('候选验证预算耗尽');
  const probe = await waitWithSignal(probeStreamUrl(
    resolved.url,
    resolved.backend === 'hiddenSource' ? undefined : buildStreamHeaders(resolved.music.source),
    budget,
    request.signal,
  ), request.signal);
  const assessment = assessPlaybackCandidate({
    probe,
    quality: resolved.quality,
    expectedDurationSeconds: resolved.music.wyCloud ? undefined : resolved.music.interval,
    mode: request.purpose,
  });
  if (assessment.status === 'rejected') throw new Error(`候选地址不可用(${assessment.reason})`);
  return { ...resolved, candidateId, assessment };
}

export function isVerifiedCandidate(candidate: PlaybackResolvedUrl): boolean {
  return candidate.assessment?.status === 'verified';
}
