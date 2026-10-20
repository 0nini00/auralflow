import { useState } from 'react';
import { FolderOpen, Plus, RefreshCw } from 'lucide-react';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { LocalMusicService, localSongToMusicInfo, type LocalSong } from '@/services/localMusicService';
import { MetadataEditModal } from '@/components/MetadataEditModal';
import { LocalLibraryBrowser } from '@/components/LocalLibraryBrowser';

export function LocalMusicView() {
  const { localSongs, addSongs, removeSong, isScanning, setScanning, addScanPath, scanPaths, refreshLibrary } = useLibraryStore();
  // 不订阅播放进度，避免高频推送导致整库重渲染。
  const currentTrack = usePlayerStore((state) => state.current);
  const queue = usePlayerStore((state) => state.queue);
  const status = usePlayerStore((state) => state.status);
  const playQueue = usePlayerStore((state) => state.playQueue);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const [editingSong, setEditingSong] = useState<LocalSong | null>(null);
  const [error, setError] = useState('');

  const handleSelectDirectory = async () => {
    setError('');
    try {
      const path = await LocalMusicService.selectDirectory();
      if (!path) return;
      setScanning(true);
      const songs = await LocalMusicService.scanDirectory(path);
      addSongs(songs);
      addScanPath(path);
    } catch (cause) {
      setError(`扫描文件夹失败：${String(cause)}`);
    } finally {
      setScanning(false);
    }
  };

  const handleAddFiles = async () => {
    setError('');
    try {
      const paths = await LocalMusicService.selectFiles();
      if (paths.length === 0) return;
      setScanning(true);
      const results = await Promise.all(paths.map((path) => LocalMusicService.getAudioInfo(path)));
      const songs = results.filter((song): song is LocalSong => song !== null);
      addSongs(songs);
      if (songs.length < paths.length) setError(`${paths.length - songs.length} 个文件读取失败，其余文件已添加。`);
    } catch (cause) {
      setError(`添加音乐失败：${String(cause)}`);
    } finally {
      setScanning(false);
    }
  };

  const handleRefresh = async () => {
    setError('');
    try {
      const { failedPaths } = await refreshLibrary();
      if (failedPaths.length) setError(`以下文件夹刷新失败，已保留原有歌曲：\n${failedPaths.join('\n')}`);
    } catch (cause) {
      setError(`刷新曲库失败：${String(cause)}`);
    }
  };

  const handleTrackClick = async (track: LocalSong, visibleSongs: LocalSong[]) => {
    setError('');
    const index = visibleSongs.findIndex((song) => song.id === track.id);
    if (index < 0) throw new Error('播放歌曲不在当前筛选结果中');
    const queueMatches = queue.length === visibleSongs.length && queue.every((item, position) =>
      item.source === 'local' && item.id === visibleSongs[position].id);
    if (currentTrack?.id === track.id && currentTrack.source === 'local' && queueMatches) {
      togglePlay();
      return;
    }
    try {
      await playQueue(visibleSongs.map(localSongToMusicInfo), index);
    } catch (cause) {
      setError(`播放失败：${String(cause)}`);
    }
  };

  const handleRemoveTrack = (trackId: string) => {
    if (confirm('确定要从曲库中移除这首歌吗？不会删除本地文件。')) removeSong(trackId);
  };

  return (
    <div className="af-local-music-view af-animate-slide-in">
      <header className="af-local-header">
        <div>
          <h1 className="af-heading-1">本地音乐</h1>
          <p className="af-text-body">{localSongs.length} 首歌曲 {isScanning && '· 扫描中...'}</p>
        </div>
        <div className="af-local-actions">
          <button type="button" aria-label="扫描文件夹" onClick={handleSelectDirectory} disabled={isScanning} className="af-button-secondary"><FolderOpen size={16} />扫描文件夹</button>
          {scanPaths.length > 0 && <button type="button" aria-label="刷新" onClick={handleRefresh} disabled={isScanning} className="af-button-secondary" title={`重新扫描 ${scanPaths.length} 个已记录文件夹`}><RefreshCw size={16} className={isScanning ? 'af-spin' : ''} />刷新</button>}
          <button type="button" aria-label="添加文件" onClick={handleAddFiles} disabled={isScanning} className="af-button-primary"><Plus size={16} />添加文件</button>
        </div>
      </header>
      {error && <p className="af-local-error" role="alert">{error}</p>}
      <LocalLibraryBrowser localSongs={localSongs} currentTrack={currentTrack} isPlaying={status === 'playing'}
        onPlay={handleTrackClick} onEdit={setEditingSong} onRemove={handleRemoveTrack} />
      <MetadataEditModal song={editingSong} onClose={() => setEditingSong(null)} />
    </div>
  );
}
