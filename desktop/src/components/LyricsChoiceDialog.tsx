import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleSlash, RotateCcw, X } from 'lucide-react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useLibraryStore } from '@/stores/libraryStore';
import { localSongToMusicInfo, type LocalSong } from '@/services/localMusicService';
import {
  fetchLyricsCandidateLines,
  formatLyricsAsLrc,
  listLocalLyricCandidates,
  type LocalLyricCandidate,
} from '@/services/lyricsService';
import {
  applyLocalLyricsChoice,
  computeLocalLyricsFingerprint,
} from '@/services/localLyricsChoiceService';
import {
  formatLocalLyricsChoiceLabel,
  resolveLocalLyricsChoice,
  type LocalLyricsChoiceRequest,
} from '@/services/localLyricsChoiceModel';

interface Props {
  song: LocalSong | null;
  onClose: () => void;
}

const TIER_LABELS: Record<string, string> = {
  'same-recording': '同一录音档',
  'other-performer': '同曲异唱档',
};

/** 「12.5s 差值」这种量级用一位小数足够；差值小于 0.5s 直接说一致。 */
function formatDurationGap(gap?: number): string | undefined {
  if (gap === undefined) return undefined;
  return gap < 0.5 ? '时长一致' : `时长差 ${gap.toFixed(1)}s`;
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** 面板上的动作：指纹由面板在用户真正做出选择时现算一次，调用方不必关心。 */
type ChoiceAction =
  | { type: 'auto' }
  | { type: 'local-only' }
  | { type: 'picked'; sourceLabel: string; text: string };

/**
 * 「选择歌词」面板。
 *
 * 候选**全部**摆出来，只用 core 的档位判定排序与标注（同一录音档 / 同曲异唱档）：平台召回的质量
 * 不由本层担保，同名不同曲最终得由用户自己认，因此本层不隐藏任何候选。搜索失败只显示错误与
 * 「重试」，绝不改变当前 mode——否则一次断网就会把用户的选择悄悄改掉；「不要匹配」与本地已有
 * 歌词在离线时同样可用。
 *
 * 与移动端 `LyricsChoiceSheet` 同一套语义：三态判定、指纹绑定、补丁形状都在
 * `localLyricsChoiceModel` 里，本组件只负责取候选、算指纹与呈现。
 */
export function LyricsChoiceDialog({ song, onClose }: Props) {
  // 换歌直接换会话，不让上一首的候选或异步响应继承到下一首。
  return song ? <LyricsChoiceEditor key={`${song.id}:${song.path}`} song={song} onClose={onClose} /> : null;
}

function LyricsChoiceEditor({ song, onClose }: { song: LocalSong; onClose: () => void }) {
  // 面板打开期间记录可能被别处改写（例如重新扫描刷新了 size），一律以库里最新那条为准：
  // 指纹与候选都基于它，避免对着过期快照做选择。
  const localSongs = useLibraryStore((state) => state.localSongs);
  const record = useMemo(() => localSongs.find((item) => item.id === song.id) ?? song, [localSongs, song]);
  const [candidates, setCandidates] = useState<LocalLyricCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestToken = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    const isCurrent = () => requestToken.current === token;
    setLoading(true);
    setError('');
    void listLocalLyricCandidates(localSongToMusicInfo(record)).then(
      (result) => {
        if (!isCurrent()) return;
        setCandidates(result.candidates);
        setError(result.error ?? '');
      },
      (failure) => {
        if (!isCurrent()) return;
        setCandidates([]);
        setError(describeFailure(failure));
      },
    ).finally(() => {
      if (isCurrent()) setLoading(false);
    });
    // 只在「换一首歌」与「重试」时重新取候选：记录自身的字段变化（例如刚写入的选择）不该再打一次网络。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, record.id, record.path]);

  const currentLabel = formatLocalLyricsChoiceLabel(resolveLocalLyricsChoice(record));
  const close = () => { if (!busy) onClose(); };
  useDialogFocus({ open: true, containerRef: dialogRef, onClose: close, closeOnEscape: !busy });

  /** 指纹只在用户做出选择时算一次（整文件 md5），随后随记录一起持久化。 */
  async function buildRequest(action: ChoiceAction): Promise<LocalLyricsChoiceRequest> {
    if (action.type === 'auto') return { type: 'auto' };
    return { ...action, fingerprint: await computeLocalLyricsFingerprint(record) };
  }

  async function save(action: ChoiceAction) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      applyLocalLyricsChoice(record, await buildRequest(action));
      onClose();
    } catch (failure) {
      setError(`保存歌词选择失败：${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickCandidate(candidate: LocalLyricCandidate) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const text = formatLyricsAsLrc(await fetchLyricsCandidateLines(candidate));
      if (!text.trim()) {
        // 取不到词就什么都不改：宁可让用户换一条，也不写一份空文本假装「已选中」。
        setError(`${candidate.sourceLabel} 这一条没能取到歌词，请换一条或稍后重试。`);
        return;
      }
      applyLocalLyricsChoice(record, await buildRequest({ type: 'picked', sourceLabel: candidate.sourceLabel, text }));
      onClose();
    } catch (failure) {
      setError(`取歌词失败：${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="af-dialog-overlay" onClick={close}>
      <div ref={dialogRef} className="af-dialog af-metadata-dialog" role="dialog" aria-modal="true"
        aria-label="选择歌词" aria-busy={busy || loading} onClick={(event) => event.stopPropagation()}>
        <div className="af-metadata-header">
          <h2>选择歌词</h2>
          <button type="button" className="af-menu-trigger" onClick={close} disabled={busy} aria-label="关闭选择歌词面板"><X size={18} /></button>
        </div>
        <div className="af-dialog-body" style={{ overflowY: 'auto', maxHeight: '70vh' }}>
          <p className="af-settings-hint">
            {record.title || song.title} · 当前：{currentLabel}
          </p>
          <p className="af-settings-hint">
            候选全部列出，只按判定结果排序与标注（同一录音档 / 同曲异唱档由你自己认）；
            选择只对作出选择时的这份文件内容有效。
          </p>

          {loading ? <p role="status">正在查找可用的歌词…</p> : null}

          {!loading && error ? (
            <section aria-label="候选搜索失败">
              <p className="af-settings-error" role="alert">{error}</p>
              <p className="af-settings-hint">当前选择没有被改动；仍可「不要匹配」，或重试后再挑。</p>
              <button type="button" className="af-settings-small-button" aria-label="重试"
                onClick={() => setReloadToken((value) => value + 1)}>
                <RotateCcw size={16} /> 重试
              </button>
            </section>
          ) : null}

          {!loading && !error && candidates.length === 0 ? (
            <p role="status">没有可用的候选：本地没有歌词，LRCLIB 与网易云也没有返回结果。</p>
          ) : null}

          {candidates.length ? (
            <ul style={{ padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {candidates.map((candidate, index) => {
                const gap = formatDurationGap(candidate.durationDeltaSeconds);
                const tier = candidate.tier ? TIER_LABELS[candidate.tier] : undefined;
                return (
                  <li key={candidate.key}>
                    <button type="button" className="af-settings-small-button" disabled={busy}
                      data-dialog-initial-focus={index === 0 ? true : undefined}
                      aria-label={`使用${candidate.sourceLabel}的歌词：${candidate.name}`}
                      style={{ width: '100%', textAlign: 'left', display: 'grid', gap: 2 }}
                      onClick={() => { void pickCandidate(candidate); }}>
                      <span>{candidate.sourceLabel}{tier ? ` · ${tier}` : ''}{gap ? ` · ${gap}` : ''}</span>
                      <span>{candidate.name} · {candidate.singer || '歌手未知'} · {candidate.albumName || '专辑未知'}</span>
                      <span>{candidate.preview ? `首行：${candidate.preview}` : '未预览到歌词（点选后获取）'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <div className="af-dialog-actions">
          <button type="button" className="af-btn-secondary" disabled={busy} aria-label="不要匹配，只用本地歌词"
            onClick={() => { void save({ type: 'local-only' }); }}><CircleSlash size={16} /> 不要匹配（只用本地歌词）</button>
          <button type="button" className="af-btn-primary" disabled={busy} aria-label="恢复自动匹配"
            onClick={() => { void save({ type: 'auto' }); }}><Check size={16} /> 恢复自动匹配</button>
        </div>
      </div>
    </div>
  );
}
