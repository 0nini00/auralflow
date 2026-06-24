import { Download, FolderOpen, Play, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useDownloadStore, type DownloadTask } from '@/stores/downloadStore';
import { usePlayerStore } from '@/stores/playerStore';
import { logAsyncError } from '@/utils/logAsyncError';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function statusText(task: DownloadTask): string {
  if (task.status === 'resolving') return '解析地址中';
  if (task.status === 'downloading') return task.speed > 0 ? `下载中 · ${formatBytes(task.speed)}/s` : '下载中';
  if (task.status === 'completed') return '已完成';
  return task.error || '下载失败';
}

export function DownloadsView() {
  const {
    tasks,
    downloadDir,
    chooseDownloadDir,
    initDownloadListeners,
    retryTask,
    removeTask,
    clearCompleted,
    toLocalMusic,
  } = useDownloadStore();
  const play = usePlayerStore((s) => s.play);

  useEffect(() => {
    initDownloadListeners().catch(logAsyncError('downloads:init-listeners'));
  }, [initDownloadListeners]);

  const handlePlay = (task: DownloadTask) => {
    const localMusic = toLocalMusic(task);
    if (localMusic) play(localMusic).catch(logAsyncError('downloads:play-local-file'));
  };

  return (
    <div className="af-downloads-view">
      <div className="af-downloads-header">
        <div>
          <p className="af-section-kicker">Download Center</p>
          <h1>下载中心</h1>
          <p>管理当前设备上的音乐下载任务。</p>
        </div>
        <div className="af-downloads-actions">
          <button className="af-btn-secondary" onClick={() => { chooseDownloadDir().catch(logAsyncError('downloads:choose-dir')); }}>
            <FolderOpen size={18} />
            <span>{downloadDir ? '更改目录' : '选择目录'}</span>
          </button>
          <button className="af-btn-secondary" onClick={() => clearCompleted()} disabled={!tasks.some((t) => t.status === 'completed')}>
            清理已完成
          </button>
        </div>
      </div>

      {downloadDir && <div className="af-download-dir">保存到：{downloadDir}</div>}

      {tasks.length === 0 ? (
        <div className="af-empty-state af-download-empty">
          <Download size={40} />
          <p>还没有下载任务</p>
          <span>在歌曲行末的下载按钮里选择音质。</span>
        </div>
      ) : (
        <div className="af-download-list">
          {tasks.map((task) => (
            <div key={task.id} className={`af-download-item af-download-${task.status}`}>
              <div className="af-download-cover">
                {task.music.img || task.music.picUrl ? (
                  <img src={task.music.img || task.music.picUrl} alt={task.music.name} />
                ) : (
                  <Download size={22} />
                )}
              </div>

              <div className="af-download-main">
                <div className="af-download-title-row">
                  <div>
                    <h3>{task.music.name}</h3>
                    <p>{task.music.singer || '未知歌手'} · {task.quality || task.music.quality || '默认音质'}</p>
                  </div>
                  <span className={`af-download-status af-status-${task.status}`}>{statusText(task)}</span>
                </div>

                <div className="af-download-progress">
                  <div className="af-download-progress-bar" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
                </div>

                <div className="af-download-meta">
                  <span>{task.fileName}</span>
                  <span>{formatBytes(task.downloaded)} / {formatBytes(task.total)}</span>
                </div>
              </div>

              <div className="af-download-actions">
                {task.status === 'completed' && (
                  <button className="af-action-btn" onClick={() => handlePlay(task)} title="播放本地文件">
                    <Play size={15} fill="currentColor" />
                  </button>
                )}
                {task.status === 'failed' && (
                  <button className="af-action-btn" onClick={() => retryTask(task.id)} title="重试">
                    <RefreshCw size={15} />
                  </button>
                )}
                {task.status === 'failed' && <XCircle className="af-download-error-icon" size={16} />}
                <button className="af-action-btn" onClick={() => removeTask(task.id)} title="移除任务">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .af-downloads-view {
          padding: 32px;
          max-width: 1180px;
          margin: 0 auto;
        }

        .af-downloads-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 18px;
        }

        .af-downloads-header h1 {
          margin: 4px 0 8px;
          font-size: 34px;
          color: var(--af-text-primary);
        }

        .af-downloads-header p {
          margin: 0;
          color: var(--af-text-secondary);
        }

        .af-downloads-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .af-download-dir {
          margin-bottom: 18px;
          padding: 12px 14px;
          border: 1px solid var(--af-border-primary);
          border-radius: var(--af-radius-lg);
          color: var(--af-text-secondary);
          background: var(--af-bg-secondary);
          font-size: 13px;
        }

        .af-download-empty {
          min-height: 360px;
        }

        .af-download-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .af-download-item {
          display: grid;
          grid-template-columns: 56px 1fr auto;
          align-items: center;
          gap: 16px;
          padding: 14px;
          border: 1px solid var(--af-border-primary);
          border-radius: var(--af-radius-xl);
          background: var(--af-bg-surface);
        }

        .af-download-cover {
          width: 56px;
          height: 56px;
          border-radius: var(--af-radius-md);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--af-bg-secondary);
          color: var(--af-text-tertiary);
        }

        .af-download-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .af-download-main {
          min-width: 0;
        }

        .af-download-title-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 10px;
        }

        .af-download-title-row h3 {
          margin: 0 0 4px;
          font-size: 16px;
          color: var(--af-text-primary);
        }

        .af-download-title-row p,
        .af-download-meta {
          margin: 0;
          color: var(--af-text-secondary);
          font-size: 13px;
        }

        .af-download-status {
          white-space: nowrap;
          font-size: 13px;
          color: var(--af-text-secondary);
        }

        .af-status-completed {
          color: var(--af-accent-primary);
        }

        .af-status-failed {
          color: var(--af-error);
        }

        .af-download-progress {
          height: 6px;
          border-radius: 999px;
          background: var(--af-bg-secondary);
          overflow: hidden;
        }

        .af-download-progress-bar {
          height: 100%;
          border-radius: inherit;
          background: var(--af-accent-primary);
          transition: width 0.2s ease;
        }

        .af-download-meta {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-top: 8px;
        }

        .af-download-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .af-download-error-icon {
          color: var(--af-error);
        }
      `}</style>
    </div>
  );
}
