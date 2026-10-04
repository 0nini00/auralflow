import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { getAudioInfo } from '@lx/tauri-bridge';
import { getLocalSongCover, type LocalSong } from '@/services/localMusicService';
import { useLibraryStore } from '@/stores/libraryStore';
import { ManualMediaMatchDialog } from './ManualMediaMatchDialog';
import { ManualMediaRequestToken, manualMediaError, type LocalCoverSelection, type ManualLyricExtras } from '@/services/manualMediaMatchModel';
import { ManualMediaSaveError, pickManualCover, saveManualMediaEdits } from '@/services/manualMediaMatchService';

interface Props { song: LocalSong | null; onClose: () => void }

/** 切歌直接换编辑会话，不让前一首的草稿或异步响应继承到下一首。 */
export function MetadataEditModal({ song, onClose }: Props) {
  return song ? <MetadataEditor key={`${song.id}:${song.path}`} song={song} onClose={onClose} /> : null;
}

function MetadataEditor({ song, onClose }: { song: LocalSong; onClose: () => void }) {
  const updateSong = useLibraryStore((state) => state.updateSong);
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [album, setAlbum] = useState(song.album);
  const [lyrics, setLyrics] = useState(song.lyricsOverride ?? song.embeddedLyrics ?? '');
  const lyricsEdited = useRef(false);
  const [lyricExtras, setLyricExtras] = useState<ManualLyricExtras>({ translation: song.lyricsTranslationOverride, romanization: song.lyricsRomanizationOverride });
  const [cover, setCover] = useState<LocalCoverSelection>();
  const [writeToFile, setWriteToFile] = useState(false);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const readToken = useRef(new ManualMediaRequestToken());
  const pickToken = useRef(new ManualMediaRequestToken());
  const saveToken = useRef(new ManualMediaRequestToken());

  function invalidate() {
    readToken.current.invalidate(); pickToken.current.invalidate(); saveToken.current.invalidate();
  }

  useEffect(() => {
    const isCurrent = readToken.current.next();
    void getAudioInfo(song.path).then(
      (info) => {
        if (isCurrent() && !lyricsEdited.current && song.lyricsOverride === undefined) setLyrics(info.lyrics ?? '');
      },
      (failure) => { if (isCurrent()) setReadError(`读取文件歌词失败：${manualMediaError(failure)}。未编辑歌词不会被保存或清除。`); },
    );
    return () => invalidate();
    // 同一首歌的库更新不重置用户草稿；换曲由外层 key 创建新会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.path]);

  function changeLyrics(value: string) { lyricsEdited.current = true; setLyrics(value); if (!value.trim()) setLyricExtras({ translation: "", romanization: "" }); }
  function close() { if (!busy.current) { invalidate(); onClose(); } }

  async function pickCover() {
    const isCurrent = pickToken.current.next();
    setPicking(true); setError('');
    try {
      const selected = await pickManualCover();
      if (isCurrent() && selected) setCover(selected);
    } catch (failure) {
      if (isCurrent()) setError(`选择封面失败：${manualMediaError(failure)}`);
    } finally {
      if (isCurrent()) setPicking(false);
    }
  }

  async function save() {
    if (busy.current || picking) return;
    busy.current = true;
    const isCurrent = saveToken.current.next();
    setSaving(true); setError('');
    try {
      const patch = await saveManualMediaEdits(song, {
        title, artist, album,
        lyrics: lyricsEdited.current ? lyrics : undefined,
        translation: lyricsEdited.current ? lyricExtras.translation : undefined,
        romanization: lyricsEdited.current ? lyricExtras.romanization : undefined,
        cover,
      }, writeToFile, isCurrent);
      if (!isCurrent()) return;
      updateSong(song.id, patch);
      invalidate(); onClose();
    } catch (failure) {
      if (!isCurrent()) return;
      if (failure instanceof ManualMediaSaveError && Object.keys(failure.appliedPatch).length) {
        updateSong(song.id, failure.appliedPatch);
      }
      setError(manualMediaError(failure));
    } finally {
      busy.current = false;
      if (isCurrent()) setSaving(false);
    }
  }

  useDialogFocus({ open: true, containerRef: dialogRef, onClose: close, closeOnEscape: !saving });

  const coverUrl = cover?.assetUrl ?? getLocalSongCover(song);
  return (
    <>
    <div className="af-dialog-overlay" style={matching ? { display: 'none' } : undefined} onClick={close}>
      <div ref={dialogRef} className="af-dialog af-metadata-dialog" aria-busy={saving} role="dialog" aria-modal="true" aria-label="编辑元数据" onClick={(event) => event.stopPropagation()}>
        <div className="af-metadata-header">
          <h2>编辑元数据</h2>
          <button type="button" className="af-menu-trigger" onClick={close} disabled={saving} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="af-dialog-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="af-metadata-cover-row">
              <div className="af-metadata-cover">
                {coverUrl ? <img src={coverUrl} alt="歌曲封面" /> : <div className="af-cover-placeholder">暂无封面</div>}
              </div>
              <div className="af-metadata-cover-actions">
                <button type="button" className="af-settings-small-button" disabled={picking} onClick={pickCover}>{picking ? '读取封面中...' : '更换封面'}</button>
                {cover && <button type="button" className="af-settings-small-button" onClick={() => { pickToken.current.invalidate(); setPicking(false); setCover(undefined); }}>撤销封面选择</button>}
                <button type="button" className="af-settings-small-button" disabled={picking} onClick={() => setMatching(true)}>搜索匹配歌词 / 封面</button>
              </div>
            </div>
            <div className="af-form-group"><label htmlFor="metadata-title">标题</label><input id="metadata-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} data-dialog-initial-focus /></div>
            <div className="af-form-group"><label htmlFor="metadata-artist">艺术家</label><input id="metadata-artist" type="text" value={artist} onChange={(event) => setArtist(event.target.value)} /></div>
            <div className="af-form-group"><label htmlFor="metadata-album">专辑</label><input id="metadata-album" type="text" value={album} onChange={(event) => setAlbum(event.target.value)} /></div>
            <div className="af-form-group">
              <label htmlFor="metadata-lyrics">歌词</label>
              <textarea id="metadata-lyrics" className="af-settings-textarea" value={lyrics} onChange={(event) => changeLyrics(event.target.value)} placeholder="LRC 或纯文本歌词；主动编辑为空才会清除" rows={6} />
            </div>
            <p className="af-settings-hint">默认只应用到本机曲库，不修改原音频。选定封面会复制到独立的本机资料目录，不受清理自动缓存影响。</p>
            <label><input type="checkbox" checked={writeToFile} onChange={(event) => setWriteToFile(event.target.checked)} /> 同时写回音频文件（不可撤回）</label>
            <p className="af-settings-hint">匹配的翻译与罗马音仅保存在本机，写回文件只写原文。勾选后将直接修改已编辑的标题/艺术家/专辑、封面、歌词标签；写入可能部分成功，不能撤回，请先备份文件。未编辑字段保持不变。</p>
          </fieldset>
          {readError && <p role="alert" className="af-settings-error">{readError}</p>}
          {error && <p role="alert" className="af-settings-error">{error}</p>}
        </div>
        <div className="af-dialog-actions">
          <button type="button" className="af-btn-secondary" onClick={close} disabled={saving}>取消</button>
          <button type="button" className="af-btn-primary" onClick={save} disabled={saving || picking || !title.trim()}>{saving ? '保存中...' : writeToFile ? '保存并写入文件' : '保存到本机曲库'}</button>
        </div>
      </div>
    </div>
      {matching && <ManualMediaMatchDialog initialQuery={`${title} ${artist}`.trim()}
    onLyrics={(raw, extras) => { changeLyrics(raw); setLyricExtras({ translation: extras?.translation ?? "", romanization: extras?.romanization ?? "" }); }}
    onCover={(selected) => { pickToken.current.invalidate(); setPicking(false); setCover(selected); }}
    onClose={() => setMatching(false)} />}

    </>
  );
}
