import { useRef, useState, type KeyboardEvent } from 'react';
import { Clock, Edit2, Music2, Pause, Play, Trash2 } from 'lucide-react';
import { getLocalSongCover, type LocalSong } from '@/services/localMusicService';
import { formatDuration } from '@/lib/utils';
import { VirtualList } from './VirtualList';

const ROW_HEIGHT = 60;
interface LocalLibraryTracksProps {
  songs: LocalSong[];
  viewMode: 'list' | 'grid';
  currentTrack: { id: string; source: string } | null;
  isPlaying: boolean;
  onPlay: (track: LocalSong, visibleSongs: LocalSong[]) => void;
  onEdit: (track: LocalSong) => void;
  onRemove: (trackId: string) => void;
}

export function LocalLibraryTracks({ songs, viewMode, currentTrack, isPlaying, onPlay, onEdit, onRemove }: LocalLibraryTracksProps) {
  const [focusIndex, setFocusIndex] = useState<number>();
  const trackButtons = useRef(new Map<number, HTMLButtonElement>());
  const focusTarget = useRef<number>();
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const targets: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: songs.length - 1 };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(songs.length - 1, targets[event.key]));
    focusTarget.current = next;
    setFocusIndex(next);
    trackButtons.current.get(next)?.focus();
  };
  const renderTrack = (track: LocalSong, index: number) => {
    const isCurrent = currentTrack?.source === 'local' && currentTrack.id === track.id;
    const playing = isCurrent && isPlaying;
    const cover = getLocalSongCover(track);
    return (
      <div className={`af-local-track ${isCurrent ? 'af-current' : ''}`} key={track.id}>
        <button type="button" className="af-local-track-play" aria-label={`${playing ? '暂停' : '播放'} ${track.title}`}
          aria-current={isCurrent ? 'true' : undefined} onClick={() => onPlay(track, songs)} onKeyDown={(event) => navigate(event, index)}
          ref={(node) => {
            if (!node) { trackButtons.current.delete(index); return; }
            trackButtons.current.set(index, node);
            if (focusTarget.current === index) { node.focus(); focusTarget.current = undefined; }
          }}>
          <span className="af-local-track-number">{index + 1}</span>
          <span className="af-local-track-cover">
            {cover ? <img src={cover} alt="" loading="lazy" /> : <Music2 size={24} aria-hidden="true" />}
            <span className="af-local-track-play-icon">{playing ? <Pause size={18} /> : <Play size={18} />}</span>
          </span>
          <span className="af-local-track-title" title={track.title}>{track.title}</span>
          <span className="af-local-track-artist" title={track.artist}>{track.artist || '未知艺术家'}</span>
          <span className="af-local-track-album" title={track.album}>{track.album || '未知专辑'}</span>
          <span className="af-local-track-duration">{formatDuration(track.duration)}</span>
        </button>
        <div className="af-local-track-actions">
          <button type="button" aria-label={`编辑 ${track.title}`} title="编辑元数据" onClick={() => onEdit(track)}><Edit2 size={16} /></button>
          <button type="button" aria-label={`移除 ${track.title}`} title="从曲库移除，不删除文件" onClick={() => onRemove(track.id)}><Trash2 size={16} /></button>
        </div>
      </div>
    );
  };
  if (viewMode === 'grid') return <div className="af-local-tracks-grid">{songs.map(renderTrack)}</div>;
  return (
    <div className="af-local-tracks-list">
      <div className="af-local-tracks-heading" aria-hidden="true">
        <span>#</span><span /><span>标题</span><span>艺术家</span><span>专辑</span><span><Clock size={14} /></span><span>操作</span>
      </div>
      <VirtualList items={songs} rowHeight={ROW_HEIGHT} scrollRootSelector=".af-local-content"
        scrollToIndex={focusIndex} scrollToKey={focusIndex} getItemKey={(track) => track.id} renderItem={renderTrack} />
    </div>
  );
}
