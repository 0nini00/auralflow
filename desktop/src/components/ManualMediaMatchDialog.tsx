import { useEffect, useRef, useState } from 'react';
import type { MusicInfo } from '@lx/core';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import {
  getManualLyrics, searchManualMedia, type ManualLyricPreview, type ManualMediaSource,
} from '@/services/manualMediaMatchService';
import { formatManualDuration, ManualMediaRequestToken, manualMediaError, type ManualLyricExtras } from '@/services/manualMediaMatchModel';

interface Props {
  initialQuery: string;
  onLyrics: (lyrics: string, extras?: ManualLyricExtras) => void;
  onClose: () => void;
}

/**
 * 平台候选的手动匹配窗口：只匹配**歌词**。
 *
 * 封面没有候选可挑——本地曲封面只能来自音频文件自己（内嵌标签 / 同目录旁挂图），
 * 所以这里不再请求、预览或应用任何封面。
 */
export function ManualMediaMatchDialog({ initialQuery, onLyrics, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState<ManualMediaSource>('wy');
  const [candidates, setCandidates] = useState<MusicInfo[]>([]);
  const [selected, setSelected] = useState<MusicInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lyrics, setLyrics] = useState<ManualLyricPreview | null>(null);
  const [lyricError, setLyricError] = useState('');
  const [status, setStatus] = useState('');
  const searchToken = useRef(new ManualMediaRequestToken());
  const previewToken = useRef(new ManualMediaRequestToken());
  const dialogRef = useRef<HTMLElement>(null);

  function invalidate() {
    searchToken.current.invalidate(); previewToken.current.invalidate();
  }
  useEffect(() => () => invalidate(), []);

  function resetResults() {
    invalidate();
    setCandidates([]); setSelected(null); setLyrics(null);
    setSearchError(''); setLyricError(''); setStatus('');
    setSearching(false); setSearched(false);
  }

  async function search() {
    resetResults();
    const isCurrent = searchToken.current.next();
    setSearching(true);
    try {
      const result = await searchManualMedia(source, query);
      if (!isCurrent()) return;
      setCandidates(result); setSearched(true);
    } catch (error) {
      if (isCurrent()) setSearchError(manualMediaError(error));
    } finally {
      if (isCurrent()) setSearching(false);
    }
  }

  function select(candidate: MusicInfo) {
    const isCurrent = previewToken.current.next();
    setSelected(candidate); setLyrics(null);
    setLyricError(''); setStatus('');
    void getManualLyrics(candidate).then(
      (result) => { if (isCurrent()) setLyrics(result); },
      (error) => { if (isCurrent()) setLyricError(manualMediaError(error)); },
    );
  }

  function close() { invalidate(); onClose(); }
  useDialogFocus({ open: true, containerRef: dialogRef, onClose: close });

  return (
    <div className="af-dialog-overlay" onClick={close}>
      <section ref={dialogRef} className="af-dialog af-metadata-dialog" role="dialog" aria-modal="true" aria-label="手动匹配歌词" onClick={(event) => event.stopPropagation()}>
        <div className="af-metadata-header"><h2>手动匹配歌词</h2></div>
        <div className="af-dialog-body" style={{ overflowY: 'auto', maxHeight: '70vh' }}>
          <p className="af-settings-hint">搜索不会自动选曲。先预览候选，再决定是否采用它的歌词；不会替换音源和播放地址。</p>
          <div className="af-form-group">
            <label htmlFor="manual-media-source">平台</label>
            <select id="manual-media-source" aria-label="匹配平台" value={source} onChange={(event) => { resetResults(); setSource(event.target.value as ManualMediaSource); }}>
              <option value="wy">网易云音乐</option><option value="tx">QQ 音乐</option>
            </select>
            <label htmlFor="manual-media-query">歌名 / 歌手 / 专辑</label>
            <input id="manual-media-query" aria-label="搜索关键词" value={query} onChange={(event) => { resetResults(); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229 && !searching && query.trim()) void search(); }} data-dialog-initial-focus />
            <button type="button" className="af-settings-small-button" disabled={searching || !query.trim()} onClick={search}>{searching ? '搜索中...' : '搜索'}</button>
          </div>
          {searchError && <p role="alert" className="af-settings-error">搜索失败：{searchError}</p>}
          {searched && candidates.length === 0 && <p role="status">未找到候选，请调整关键词或切换平台。</p>}
          <ul style={{ padding: 0, listStyle: 'none', maxHeight: 220, overflowY: 'auto' }}>
            {candidates.map((candidate) => (
              <li key={`${candidate.source}:${candidate.id}`}>
                <button type="button" className="af-settings-small-button" style={{ width: '100%', textAlign: 'left', marginBottom: 6 }} aria-label={`预览 ${candidate.name}`} aria-pressed={selected?.id === candidate.id && selected.source === candidate.source} onClick={() => select(candidate)}>
                  {candidate.name} · {candidate.singer || '歌手未知'} · {candidate.albumName || '专辑未知'} · {formatManualDuration(candidate.interval)}
                </button>
              </li>
            ))}
          </ul>
          {selected && <section aria-label="候选预览">
            <h3>{selected.name} · {selected.singer}</h3>
            <p>{selected.albumName} · {formatManualDuration(selected.interval)}</p>
            <h4>歌词预览</h4>
            {lyricError ? <p role="alert" className="af-settings-error">{lyricError}</p> : lyrics ? (
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>{lyrics.lines.map((line) => [line.text, line.tr, line.roma].filter(Boolean).join('\n')).join('\n\n')}</pre>
            ) : <p role="status">歌词加载中...</p>}
            <button type="button" className="af-settings-small-button" disabled={!lyrics} onClick={() => { if (lyrics) { if (lyrics.translation !== undefined || lyrics.romanization !== undefined) onLyrics(lyrics.raw, { translation: lyrics.translation, romanization: lyrics.romanization }); else onLyrics(lyrics.raw); setStatus('歌词已加入编辑草稿，保存后才会应用。'); } }}>使用此歌词</button>
          </section>}
          {status && <p role="status">{status}</p>}
        </div>
        <div className="af-dialog-actions"><button type="button" className="af-btn-secondary" onClick={close}>返回编辑器</button></div>
      </section>
    </div>
  );
}
