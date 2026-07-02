import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useWyAccountStore } from '@/stores/wyAccountStore';
import { useBiliAccountStore } from '@/stores/biliAccountStore';
import { getBiliCookie } from '@/services/biliAccountService';
import { exportPlaylists, importPlaylists } from '@/services/playlistTransferService';
import { getImageReferrerPolicy, normalizeImageUrl } from '@/utils/imageReferrerPolicy';
import {
  Plus,
  Music,
  MoreVertical,
  Trash2,
  Edit2,
  Copy,
  Heart,
  History,
  Download,
  Layers,
  Upload,
  SlidersHorizontal,
  EyeOff,
  X,
} from 'lucide-react';

export function PlaylistsView() {
  const navigate = useNavigate();
  const { playlists, createPlaylist, deletePlaylist, duplicatePlaylist, renamePlaylist, updatePlaylistDescription } = usePlaylistStore();
  const favorites = useFavoritesStore((s) => s.favorites);
  const history = useHistoryStore((s) => s.history);
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wyLoading = useWyAccountStore((s) => s.isLoading);
  const wyLoaded = useWyAccountStore((s) => s.isLoaded);
  const wyError = useWyAccountStore((s) => s.error);
  const biliAccount = useBiliAccountStore((s) => s.account);
  const biliPlaylists = useBiliAccountStore((s) => s.playlists);
  const hiddenBiliCollectionIds = useBiliAccountStore((s) => s.hiddenCollectionIds);
  const newBiliCollectionIds = useBiliAccountStore((s) => s.newCollectionIds);
  const autoShowNewBiliCollections = useBiliAccountStore((s) => s.autoShowNewCollections);
  const getVisibleBiliCollections = useBiliAccountStore((s) => s.getVisibleCollections);
  const setBiliCollectionVisible = useBiliAccountStore((s) => s.setCollectionVisible);
  const setAutoShowNewBiliCollections = useBiliAccountStore((s) => s.setAutoShowNewCollections);
  const clearNewBiliCollectionState = useBiliAccountStore((s) => s.clearNewCollectionState);
  const biliLoading = useBiliAccountStore((s) => s.isLoading);
  const biliLoaded = useBiliAccountStore((s) => s.isLoaded);
  const biliError = useBiliAccountStore((s) => s.error);
  const biliLoad = useBiliAccountStore((s) => s.load);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState('');
  const [showBiliManager, setShowBiliManager] = useState(false);

  const myWyPlaylists = wyPlaylists.filter((p) => !p.subscribed);
  const collectedWyPlaylists = wyPlaylists.filter((p) => p.subscribed);
  const visibleBiliPlaylists = getVisibleBiliCollections();
  const hiddenBiliIdSet = new Set(hiddenBiliCollectionIds);
  const newBiliIdSet = new Set(newBiliCollectionIds);
  const totalPlaylistCount = 2 + wyPlaylists.length + visibleBiliPlaylists.length + playlists.length;
  const newBiliCollectionCount = biliPlaylists.filter((playlist) => newBiliIdSet.has(playlist.id)).length;
  const firstFavoriteCover = favorites[0]?.img || favorites[0]?.picUrl || "";
  const firstHistoryCover = history[0]?.img || history[0]?.picUrl || "";

  useEffect(() => {
    if (biliLoaded || biliLoading) return;
    getBiliCookie().then((cookie) => {
      if (cookie) void biliLoad(cookie);
    });
  }, [biliLoad, biliLoaded, biliLoading]);

  useEffect(() => {
    if (!showCreateDialog && !showBiliManager) return;
    document.documentElement.classList.add('af-page-scroll-locked');
    return () => {
      document.documentElement.classList.remove('af-page-scroll-locked');
    };
  }, [showCreateDialog, showBiliManager]);

  const handleCreate = () => {
    const name = newPlaylistName.trim();
    if (!name) return;

    if (editingPlaylist) {
      renamePlaylist(editingPlaylist, name);
      updatePlaylistDescription(editingPlaylist, newPlaylistDesc.trim() || '');
      setEditingPlaylist(null);
    } else {
      const playlist = createPlaylist(name, newPlaylistDesc.trim() || undefined);
      navigate(`/playlist/${playlist.id}`);
    }
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateDialog(false);
  };

  const handleStartEdit = (id: string) => {
    const pl = playlists.find(p => p.id === id);
    if (pl) {
      setNewPlaylistName(pl.name);
      setNewPlaylistDesc(pl.description || '');
      setEditingPlaylist(id);
      setShowCreateDialog(true);
      setActiveMenu(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个歌单吗？')) {
      deletePlaylist(id);
      setActiveMenu(null);
    }
  };

  const handleDuplicate = (id: string) => {
    const duplicated = duplicatePlaylist(id);
    setActiveMenu(null);
    navigate(`/playlist/${duplicated.id}`);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const openCreateDialog = () => {
    setEditingPlaylist(null);
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateDialog(true);
  };

  const handleExportAll = async () => {
    if (playlists.length === 0) {
      setTransferStatus('没有可导出的本地歌单');
      return;
    }
    setTransferStatus('导出中...');
    try {
      const saved = await exportPlaylists(playlists);
      setTransferStatus(saved ? `已导出 ${playlists.length} 个歌单` : '已取消导出');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async () => {
    setTransferStatus('导入中...');
    try {
      const count = await importPlaylists();
      setTransferStatus(count > 0 ? `已导入 ${count} 个歌单` : '已取消导入');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportOne = async (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    setActiveMenu(null);
    if (!pl) return;
    try {
      const saved = await exportPlaylists([pl]);
      setTransferStatus(saved ? `已导出「${pl.name}」` : '已取消导出');
    } catch (e) {
      setTransferStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const closeBiliManager = () => {
    clearNewBiliCollectionState();
    setShowBiliManager(false);
  };

  const handleHideBiliCollection = (id: string) => {
    setBiliCollectionVisible(id, false);
    setActiveMenu(null);
  };

  return (
    <div className="af-playlists-view">
      <div className="af-playlists-header">
        <div>
          <span className="af-page-kicker">Library</span>
          <h1>我的歌单</h1>
          <p>{totalPlaylistCount} 个歌单入口 · 管理收藏、网易云歌单和本地歌单</p>
        </div>
        <div className="af-playlists-header-actions">
          <button
            className="af-create-playlist-btn af-btn-secondary"
            onClick={handleImport}
            title="从 JSON 文件导入歌单"
          >
            <Upload size={18} />
            <span>导入</span>
          </button>
          <button
            className="af-create-playlist-btn af-btn-secondary"
            onClick={handleExportAll}
            disabled={playlists.length === 0}
            title="导出全部本地歌单为 JSON"
          >
            <Download size={18} />
            <span>导出</span>
          </button>
          <button
            className="af-create-playlist-btn"
            onClick={openCreateDialog}
          >
            <Plus size={18} />
            <span>创建歌单</span>
          </button>
        </div>
        {transferStatus && <p className="af-transfer-status">{transferStatus}</p>}
      </div>

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>快捷入口</h2>
            <p>这里只保留已经接通的播放入口</p>
          </div>
        </div>

        <div className="af-quick-grid">
          <button
            type="button"
            className="af-quick-card"
            onClick={() => navigate('/library')}
          >
            <span className="af-quick-cover">
              {firstFavoriteCover ? (
                <img src={firstFavoriteCover} alt="" />
              ) : (
                <Heart size={24} fill="currentColor" />
              )}
            </span>
            <span className="af-quick-content">
              <strong>我喜欢的音乐</strong>
              <small>{favorites.length} 首歌曲</small>
            </span>
          </button>
          <button
            type="button"
            className="af-quick-card"
            onClick={() => navigate('/history')}
          >
            <span className="af-quick-cover">
              {firstHistoryCover ? (
                <img src={firstHistoryCover} alt="" />
              ) : (
                <History size={24} />
              )}
            </span>
            <span className="af-quick-content">
              <strong>播放历史</strong>
              <small>{history.length} 首歌曲</small>
            </span>
          </button>
        </div>
      </section>

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>B站收藏合集</h2>
            <p>{biliAccount ? `${biliAccount.nickname} 订阅的合集和收藏夹` : '在设置里保存 B站 Cookie 后同步'}</p>
          </div>
          <div className="af-section-heading-actions">
            {newBiliCollectionCount > 0 && (
              <button
                type="button"
                className="af-bili-new-pill"
                onClick={() => setShowBiliManager(true)}
              >
                新发现 {newBiliCollectionCount}
              </button>
            )}
            {biliPlaylists.length > 0 && (
              <button
                type="button"
                className="af-section-action af-bili-manage-button"
                onClick={() => setShowBiliManager(true)}
              >
                <SlidersHorizontal size={16} />
                <span>管理</span>
              </button>
            )}
            <span className="af-section-count">
              {biliPlaylists.length > 0 ? `${visibleBiliPlaylists.length}/${biliPlaylists.length}` : 0}
            </span>
          </div>
        </div>

        {biliLoading && (
          <div className="af-inline-state">正在加载 B站收藏合集...</div>
        )}

        {!biliLoading && biliError && (
          <div className="af-inline-state af-inline-error">{biliError}</div>
        )}

        {!biliLoading && !biliError && biliLoaded && biliPlaylists.length === 0 && (
          <div className="af-inline-state">还没有同步到 B站收藏合集</div>
        )}

        {!biliLoading && !biliError && biliPlaylists.length > 0 && visibleBiliPlaylists.length === 0 && (
          <div className="af-inline-state af-bili-hidden-empty">
            <span>已隐藏全部 B站合集，可以在管理里重新显示。</span>
            <button type="button" className="af-section-action" onClick={() => setShowBiliManager(true)}>
              <SlidersHorizontal size={16} />
              <span>管理合集</span>
            </button>
          </div>
        )}

        {!biliLoading && visibleBiliPlaylists.length > 0 && (
          <div className="af-playlists-grid af-cloud-grid">
            {visibleBiliPlaylists.map((playlist) => (
              <div
                key={playlist.id}
                className="af-playlist-card af-cloud-playlist-card"
              >
                <div
                  className="af-playlist-cover-wrap"
                  onClick={() => navigate(`/playlist/${playlist.id}?source=bili`, { state: { playlist } })}
                >
                  <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                  <div className="af-playlist-overlay">
                    <span className="af-play-all-btn" aria-hidden="true">
                      <Music size={22} />
                    </span>
                  </div>
                </div>
                <div className="af-playlist-info af-local-playlist-info">
                  <h3
                    className="af-playlist-name"
                    onClick={() => navigate(`/playlist/${playlist.id}?source=bili`, { state: { playlist } })}
                  >
                    {playlist.name}
                  </h3>
                  <p className="af-playlist-meta">
                    {playlist.trackCount ?? 0} 个视频 · {playlist.author || '哔哩哔哩'}
                  </p>
                  <div className="af-playlist-menu">
                    <button
                      className="af-menu-trigger"
                      onClick={() => setActiveMenu(activeMenu === `bili:${playlist.id}` ? null : `bili:${playlist.id}`)}
                      aria-label="B站合集菜单"
                    >
                      <MoreVertical size={18} />
                    </button>

                    {activeMenu === `bili:${playlist.id}` && (
                      <div className="af-dropdown-menu">
                        <button onClick={() => handleHideBiliCollection(playlist.id)}>
                          <EyeOff size={16} />
                          <span>隐藏此合集</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>网易云歌单</h2>
            <p>{wyAccount ? `${wyAccount.nickname} 的云端歌单` : '登录后同步你的网易云歌单'}</p>
          </div>
          <span className="af-section-count">{wyPlaylists.length}</span>
        </div>

        {wyLoading && (
          <div className="af-inline-state">正在加载网易云歌单...</div>
        )}

        {!wyLoading && wyError && (
          <div className="af-inline-state af-inline-error">{wyError}</div>
        )}

        {!wyLoading && !wyError && wyLoaded && wyPlaylists.length === 0 && (
          <div className="af-inline-state">还没有同步到网易云歌单</div>
        )}

        {!wyLoading && wyPlaylists.length > 0 && (
          <>
            {myWyPlaylists.length > 0 && (
              <div className="af-playlists-grid af-cloud-grid">
                {myWyPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    className="af-playlist-card af-cloud-playlist-card"
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                    <div className="af-playlist-info">
                      <h3 className="af-playlist-name">{playlist.name}</h3>
                      <p className="af-playlist-meta">
                        {playlist.trackCount ?? 0} 首 · {playlist.author || '网易云音乐'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {collectedWyPlaylists.length > 0 && (
              <>
                <div className="af-subsection-title">收藏的歌单</div>
                <div className="af-playlists-grid af-cloud-grid">
                  {collectedWyPlaylists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      className="af-playlist-card af-cloud-playlist-card"
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                    >
                      <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                      <div className="af-playlist-info">
                        <h3 className="af-playlist-name">{playlist.name}</h3>
                        <p className="af-playlist-meta">
                          {playlist.trackCount ?? 0} 首 · {playlist.author || '网易云音乐'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="af-playlist-section">
        <div className="af-section-heading">
          <div>
            <h2>本地歌单</h2>
            <p>你在 AuralFlow 中创建和整理的歌单</p>
          </div>
          <span className="af-section-count">{playlists.length}</span>
        </div>

        {playlists.length > 0 ? (
          <div className="af-playlists-grid">
            {playlists.map((playlist) => (
              <div
                key={playlist.id}
                className="af-playlist-card"
              >
                <div
                  className="af-playlist-cover-wrap"
                  onClick={() => navigate(`/playlist/${playlist.id}`)}
                >
                  <PlaylistCover src={playlist.cover} name={playlist.name} />
                  <div className="af-playlist-overlay">
                    <span className="af-play-all-btn" aria-hidden="true">
                      <Music size={22} />
                    </span>
                  </div>
                </div>

                <div className="af-playlist-info af-local-playlist-info">
                  <h3
                    className="af-playlist-name"
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    {playlist.name}
                  </h3>
                  <p className="af-playlist-meta">
                    {playlist.songs.length} 首 · {formatDate(playlist.updatedAt)}
                  </p>

                  <div className="af-playlist-menu">
                    <button
                      className="af-menu-trigger"
                      onClick={() => setActiveMenu(activeMenu === playlist.id ? null : playlist.id)}
                      aria-label="歌单菜单"
                    >
                      <MoreVertical size={18} />
                    </button>

                    {activeMenu === playlist.id && (
                      <div className="af-dropdown-menu">
                        <button onClick={() => handleStartEdit(playlist.id)}>
                          <Edit2 size={16} />
                          <span>编辑信息</span>
                        </button>
                        <button onClick={() => handleDuplicate(playlist.id)}>
                          <Copy size={16} />
                          <span>复制歌单</span>
                        </button>
                        <button onClick={() => handleExportOne(playlist.id)}>
                          <Download size={16} />
                          <span>导出歌单</span>
                        </button>
                        <button
                          className="af-menu-danger"
                          onClick={() => handleDelete(playlist.id)}
                        >
                          <Trash2 size={16} />
                          <span>删除歌单</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="af-inline-state af-local-empty">
            <Music size={32} strokeWidth={1.5} />
            <span>还没有本地歌单，可以创建一个用于临时整理歌曲。</span>
          </div>
        )}
      </section>

      {(showCreateDialog) && (
        <div className="af-dialog-overlay" onClick={() => { setShowCreateDialog(false); setEditingPlaylist(null); }}>
          <div className="af-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{editingPlaylist ? '编辑歌单' : '创建歌单'}</h2>
            <div className="af-dialog-body">
              <div className="af-form-group">
                <label htmlFor="playlist-name">歌单名称</label>
                <input
                  id="playlist-name"
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="输入歌单名称"
                  autoFocus
                  maxLength={50}
                />
              </div>
              <div className="af-form-group">
                <label htmlFor="playlist-desc">描述（可选）</label>
                <textarea
                  id="playlist-desc"
                  value={newPlaylistDesc}
                  onChange={(e) => setNewPlaylistDesc(e.target.value)}
                  placeholder="简单介绍一下这个歌单"
                  rows={3}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="af-dialog-actions">
              <button
                className="af-btn-secondary"
                onClick={() => { setShowCreateDialog(false); setEditingPlaylist(null); }}
              >
                取消
              </button>
              <button
                className="af-btn-primary"
                onClick={handleCreate}
                disabled={!newPlaylistName.trim()}
              >
                {editingPlaylist ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBiliManager && (
        <div className="af-dialog-overlay af-bili-manager-overlay" onClick={closeBiliManager}>
          <div className="af-dialog af-bili-manager-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="af-bili-manager-header">
              <div>
                <h2>B站合集管理</h2>
                <p>选择哪些收藏合集显示在歌单页。</p>
              </div>
              <button
                type="button"
                className="af-menu-trigger"
                onClick={closeBiliManager}
                aria-label="关闭 B站合集管理"
              >
                <X size={18} />
              </button>
            </div>

            <label className="af-bili-auto-row">
              <input
                type="checkbox"
                checked={autoShowNewBiliCollections}
                onChange={(event) => setAutoShowNewBiliCollections(event.target.checked)}
              />
              <span className="af-bili-visibility-switch" aria-hidden="true" />
              <span>
                <strong>新合集自动显示</strong>
                <small>关闭后，新收藏的合集会先进入管理列表，确认后再显示。</small>
              </span>
            </label>

            <div className="af-bili-collection-list">
              {biliPlaylists.map((playlist) => {
                const visible = !hiddenBiliIdSet.has(playlist.id);
                const isNew = newBiliIdSet.has(playlist.id);
                return (
                  <div key={playlist.id} className="af-bili-collection-row">
                    <PlaylistCover src={playlist.picUrl} name={playlist.name} cloud />
                    <div className="af-bili-collection-info">
                      <div className="af-bili-collection-title-row">
                        <h3>{playlist.name}</h3>
                        {isNew && <span className="af-bili-new-badge">新发现</span>}
                      </div>
                      <p>{playlist.trackCount ?? 0} 个视频 · {playlist.author || '哔哩哔哩'}</p>
                    </div>
                    <label className="af-bili-row-toggle">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={(event) => setBiliCollectionVisible(playlist.id, event.target.checked)}
                        aria-label={`${visible ? '隐藏' : '显示'} ${playlist.name}`}
                      />
                      <span className="af-bili-visibility-switch" aria-hidden="true" />
                      <span>{visible ? '显示' : '隐藏'}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaylistCover({ src, name, cloud = false }: { src?: string; name: string; cloud?: boolean }) {
  const imageSrc = normalizeImageUrl(src);
  return (
    <div className="af-playlist-cover">
      {imageSrc ? (
        <img src={imageSrc} alt={name} referrerPolicy={getImageReferrerPolicy(imageSrc)} />
      ) : (
        <div className="af-playlist-cover-placeholder">
          {cloud ? <Layers size={38} /> : <Music size={42} />}
        </div>
      )}
    </div>
  );
}
