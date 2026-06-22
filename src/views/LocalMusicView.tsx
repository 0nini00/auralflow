import React, { useState } from 'react';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { LocalMusicService, type LocalSong } from '@/services/localMusicService';
import { MetadataEditModal } from '@/components/MetadataEditModal';
import { formatDuration } from '@/lib/utils';
import { Play, Pause, Music2, Clock, ListMusic, Grid3x3, Plus, FolderOpen, Trash2, Edit2 } from 'lucide-react';

type ViewMode = 'list' | 'grid';

export function LocalMusicView() {
  const { localSongs, addSongs, removeSong, isScanning, setScanning, addScanPath } = useLibraryStore();
  const { current: currentTrack, status, playQueue, togglePlay } = usePlayerStore();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingSong, setEditingSong] = useState<LocalSong | null>(null);

  const isPlaying = status === 'playing';

  const handleSelectDirectory = async () => {
    try {
      const path = await LocalMusicService.selectDirectory();
      if (!path) return;

      setScanning(true);
      const songs = await LocalMusicService.scanDirectory(path);
      addSongs(songs);
      addScanPath(path);
    } catch (error) {
      console.error('Failed to scan directory:', error);
    } finally {
      setScanning(false);
    }
  };

  const handleAddFiles = async () => {
    try {
      const paths = await LocalMusicService.selectFiles();
      if (paths.length === 0) return;

      setScanning(true);
      const songs = await Promise.all(paths.map((path) => LocalMusicService.getAudioInfo(path)));
      addSongs(songs.filter((song): song is LocalSong => song !== null));
    } catch (error) {
      console.error('Failed to add files:', error);
    } finally {
      setScanning(false);
    }
  };

  const toMusicInfo = (track: LocalSong) => ({
    id: track.id,
    name: track.title,
    singer: track.artist,
    albumName: track.album || 'Unknown Album',
    source: "local" as const,
    interval: track.duration,
    img: track.cover,
    url: track.url || track.path,
    isLocal: true,
  });

  const handleTrackClick = (track: LocalSong) => {
    if (currentTrack?.id === track.id && currentTrack.source === 'local') {
      togglePlay();
      return;
    }

    const index = localSongs.findIndex((song) => song.id === track.id);
    playQueue(localSongs.map(toMusicInfo), Math.max(0, index)).catch(console.error);
  };

  const handleRemoveTrack = (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要从列表中移除这首歌吗？')) {
      removeSong(trackId);
    }
  };

  const handleEditTrack = (track: LocalSong, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSong(track);
  };

  return (
    <div className="af-local-music-view af-animate-slide-in">
      {/* Header */}
      <div className="af-local-header">
        <div className="af-local-header-content">
          <div className="af-local-title-section">
            <h1 className="af-heading-1">本地音乐</h1>
            <p className="af-text-body">
              {localSongs.length} 首歌曲 {isScanning && '· 扫描中...'}
            </p>
          </div>

          <div className="af-local-actions">
            <button
              onClick={handleSelectDirectory}
              disabled={isScanning}
              className="af-button-secondary"
              style={{ opacity: isScanning ? 0.5 : 1 }}
            >
              <FolderOpen size={16} />
              <span>扫描文件夹</span>
            </button>

            <button
              onClick={handleAddFiles}
              disabled={isScanning}
              className="af-button-primary"
              style={{ opacity: isScanning ? 0.5 : 1 }}
            >
              <Plus size={16} />
              <span>添加文件</span>
            </button>

            <div className="af-view-mode-toggle">
              <button
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'af-active' : ''}
                aria-label="列表视图"
              >
                <ListMusic size={16} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={viewMode === 'grid' ? 'af-active' : ''}
                aria-label="网格视图"
              >
                <Grid3x3 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="af-local-content">
        {localSongs.length === 0 ? (
          <div className="af-empty-state">
            <div className="af-empty-icon">
              <Music2 size={40} />
            </div>
            <h3 className="af-heading-2">还没有本地音乐</h3>
            <p className="af-text-body">扫描文件夹或添加音乐文件开始享受音乐吧</p>
            <div className="af-empty-actions">
              <button onClick={handleSelectDirectory} className="af-button-secondary">
                <FolderOpen size={18} />
                <span>扫描文件夹</span>
              </button>
              <button
                onClick={handleAddFiles}
                disabled={isScanning}
                className="af-button-primary"
                style={{ opacity: isScanning ? 0.5 : 1 }}
              >
                <Plus size={18} />
                <span>添加文件</span>
              </button>
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div className="af-local-list-view">
            {/* Table Header */}
            <div className="af-local-list-header">
              <div className="af-col-index">#</div>
              <div className="af-col-title">标题</div>
              <div className="af-col-artist">艺术家</div>
              <div className="af-col-album">专辑</div>
              <div className="af-col-duration"><Clock size={12} /></div>
              <div className="af-col-actions"></div>
            </div>

            {/* Table Body */}
            <div className="af-local-list-body">
              {localSongs.map((track, index) => {
                const isCurrent = currentTrack?.id === track.id;

                return (
                  <div
                    key={track.id}
                    className={`af-local-list-row ${isCurrent ? 'af-current' : ''}`}
                    onClick={() => handleTrackClick(track)}
                    title="单击播放"
                  >
                    <div className="af-col-index">
                      {isCurrent && isPlaying ? (
                        <div className="af-music-bars">
                          <span className="af-bar"></span>
                          <span className="af-bar"></span>
                          <span className="af-bar"></span>
                        </div>
                      ) : (
                        <>
                          <span className="af-track-number">{index + 1}</span>
                          <Play size={14} fill="currentColor" className="af-play-icon" />
                        </>
                      )}
                    </div>

                    <div className="af-col-title">
                      <span className={isCurrent ? 'af-text-accent' : ''}>{track.title}</span>
                    </div>

                    <div className="af-col-artist">{track.artist}</div>

                    <div className="af-col-album">{track.album || '-'}</div>

                    <div className="af-col-duration">{formatDuration(track.duration)}</div>

                    <div className="af-col-actions">
                      <button
                        className="af-action-btn"
                        onClick={(e) => handleEditTrack(track, e)}
                        aria-label="编辑元数据"
                        title="编辑元数据"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="af-action-btn af-delete-btn"
                        onClick={(e) => handleRemoveTrack(track.id, e)}
                        aria-label="移除"
                        title="从列表中移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="af-local-grid-view">
            {localSongs.map((track) => {
              const isCurrent = currentTrack?.id === track.id;

              return (
                <div
                  key={track.id}
                  className="af-local-grid-item"
                  onClick={() => handleTrackClick(track)}
                  title="单击播放"
                >
                  <div className="af-grid-cover">
                    {track.cover ? (
                      <img src={track.cover} alt={track.title} />
                    ) : (
                      <div className="af-cover-placeholder">
                        <Music2 size={40} />
                      </div>
                    )}

                    <button
                      className={`af-grid-play-button ${isCurrent && isPlaying ? 'af-visible' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrackClick(track);
                      }}
                      aria-label={isCurrent && isPlaying ? '暂停' : '播放'}
                      title={isCurrent && isPlaying ? '暂停' : '播放'}
                    >
                      {isCurrent && isPlaying ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Play size={16} fill="currentColor" />
                      )}
                    </button>
                    <button
                      className="af-grid-edit-button"
                      onClick={(e) => handleEditTrack(track, e)}
                      aria-label="编辑元数据"
                      title="编辑元数据"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>

                  <div className="af-grid-info">
                    <div className={`af-grid-title ${isCurrent ? 'af-text-accent' : ''}`}>
                      {track.title}
                    </div>
                    <div className="af-grid-artist">{track.artist}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        /* Local Music View Styles */
        .af-local-music-view {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .af-local-header {
          padding: 24px 24px 16px;
          border-bottom: 1px solid var(--af-border-secondary);
        }

        .af-local-header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .af-local-title-section h1 {
          margin-bottom: 4px;
        }

        .af-local-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .af-button-secondary,
        .af-button-primary {
          min-height: 36px;
          padding: 9px 15px;
        }

        .af-button-secondary {
          border: 1px solid var(--af-border-primary);
          background: var(--af-bg-surface);
        }

        .af-button-secondary:hover:not(:disabled) {
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          background: var(--af-bg-surface-hover);
        }

        .af-button-primary {
          border: 1px solid rgba(var(--af-accent-primary-rgb), 0.42);
          background: linear-gradient(180deg, rgba(var(--af-accent-primary-rgb), 0.95), rgba(var(--af-accent-primary-rgb), 0.82));
          color: var(--af-text-on-accent);
          box-shadow: 0 8px 18px rgba(var(--af-accent-primary-rgb), 0.2);
        }

        .af-button-primary:hover:not(:disabled) {
          background: var(--af-accent-gradient-hover);
        }

        .af-view-mode-toggle {
          display: flex;
          gap: 4px;
          background: var(--af-bg-surface);
          border: 1px solid var(--af-border-primary);
          border-radius: var(--af-radius-md);
          padding: 4px;
        }

        .af-view-mode-toggle button {
          width: 32px;
          height: 32px;
          padding: 0;
          border: 1px solid transparent;
          background: transparent;
          color: var(--af-text-secondary);
          border-radius: var(--af-radius-sm);
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .af-view-mode-toggle button:hover {
          color: var(--af-text-primary);
        }

        .af-view-mode-toggle button.af-active {
          background: rgba(var(--af-accent-primary-rgb), 0.12);
          border-color: rgba(var(--af-accent-primary-rgb), 0.32);
          color: var(--af-accent-primary);
        }

        .af-local-content {
          flex: 1;
          overflow-y: auto;
          padding: 0 24px 100px;
        }

        /* Empty State */
        .af-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 64px 24px;
        }

        .af-empty-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--af-accent-primary), var(--af-accent-secondary));
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          color: white;
          opacity: 0.8;
        }

        .af-empty-state h3 {
          margin-bottom: 8px;
        }

        .af-empty-state p {
          margin-bottom: 24px;
          max-width: 400px;
        }

        .af-empty-actions {
          display: flex;
          gap: 12px;
        }

        /* List View */
        .af-local-list-view {
          margin-top: 16px;
        }

        .af-local-list-header {
          display: grid;
          grid-template-columns: 40px 2fr 1.5fr 1.5fr 80px 84px;
          gap: 16px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--af-border-secondary);
          font-size: 11px;
          font-weight: 600;
          color: var(--af-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .af-local-list-body {
          margin-top: 4px;
        }

        .af-local-list-row {
          display: grid;
          grid-template-columns: 40px 2fr 1.5fr 1.5fr 80px 84px;
          gap: 16px;
          padding: 10px 16px;
          border-radius: var(--af-radius-md);
          cursor: pointer;
          transition: background 0.2s;
          align-items: center;
        }

        .af-local-list-row:hover {
          background: var(--af-bg-hover);
        }

        .af-local-list-row.af-current {
          background: rgba(var(--af-accent-primary-rgb), 0.05);
        }

        .af-col-index {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .af-track-number {
          font-size: 13px;
          color: var(--af-text-secondary);
        }

        .af-play-icon {
          display: none;
          color: var(--af-text-primary);
        }

        .af-local-list-row:hover .af-track-number {
          display: none;
        }

        .af-local-list-row:hover .af-play-icon {
          display: block;
        }

        .af-music-bars {
          display: flex;
          gap: 2px;
          align-items: flex-end;
          height: 16px;
        }

        .af-music-bars .af-bar {
          width: 2px;
          background: var(--af-accent-primary);
          animation: music-bar 0.8s ease-in-out infinite;
        }

        .af-music-bars .af-bar:nth-child(1) {
          animation-delay: 0s;
        }

        .af-music-bars .af-bar:nth-child(2) {
          animation-delay: 0.2s;
        }

        .af-music-bars .af-bar:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes music-bar {
          0%, 100% { height: 6px; }
          50% { height: 14px; }
        }

        .af-col-title,
        .af-col-artist,
        .af-col-album {
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .af-col-title {
          font-weight: 500;
          color: var(--af-text-primary);
        }

        .af-col-artist,
        .af-col-album {
          color: var(--af-text-secondary);
        }

        .af-col-duration {
          text-align: center;
          font-size: 12px;
          color: var(--af-text-secondary);
          font-variant-numeric: tabular-nums;
        }

        .af-text-accent {
          color: var(--af-accent-primary) !important;
        }

        .af-col-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }

        /* Grid View */
        .af-local-grid-view {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }

        .af-local-grid-item {
          background: var(--af-bg-elevated);
          border-radius: var(--af-radius-lg);
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .af-local-grid-item:hover {
          background: var(--af-bg-hover);
          transform: translateY(-2px);
        }

        .af-grid-cover {
          position: relative;
          margin-bottom: 12px;
        }

        .af-grid-cover img,
        .af-cover-placeholder {
          width: 100%;
          aspect-ratio: 1;
          object-fit: cover;
          border-radius: var(--af-radius-md);
        }

        .af-cover-placeholder {
          background: linear-gradient(135deg, var(--af-accent-primary), var(--af-accent-secondary));
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          opacity: 0.6;
        }

        .af-grid-play-button {
          position: absolute;
          bottom: 8px;
          right: 8px;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--af-accent-primary);
          color: white;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transform: scale(0.9);
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .af-local-grid-item:hover .af-grid-play-button,
        .af-grid-play-button.af-visible {
          opacity: 1;
          transform: scale(1);
        }

        .af-grid-play-button:hover {
          background: var(--af-accent-hover);
          transform: scale(1.05);
        }

        .af-grid-edit-button {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 30px;
          height: 30px;
          border-radius: var(--af-button-radius);
          background: rgba(0, 0, 0, 0.48);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }
        .af-local-grid-item:hover .af-grid-edit-button {
          opacity: 1;
        }
        .af-grid-edit-button:hover {
          background: rgba(0, 0, 0, 0.68);
        }

        .af-grid-info {
          min-width: 0;
        }

        .af-grid-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--af-text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-bottom: 4px;
        }

        .af-grid-artist {
          font-size: 12px;
          color: var(--af-text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .af-metadata-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .af-metadata-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: var(--af-text-primary);
        }
      `}</style>

      <MetadataEditModal song={editingSong} onClose={() => setEditingSong(null)} />
    </div>
  );
}
