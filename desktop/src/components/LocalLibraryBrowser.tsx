import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Disc3, FolderOpen, Grid3x3, ListMusic, Search, Users, X } from 'lucide-react';
import type { LocalSong } from '@/services/localMusicService';
import { getLocalSongCover } from '@/services/localMusicService';
import { filterLocalSongs, groupLocalSongs, type LocalLibraryCategory, type LocalLibraryGroup } from '@/services/localLibraryGrouping';
import { LocalLibraryTracks } from './LocalLibraryTracks';
import '@/styles/local-library-browser.css';

const categories = [
  { value: 'all', label: '全部' }, { value: 'artist', label: '艺术家' },
  { value: 'album', label: '专辑' }, { value: 'folder', label: '文件夹' },
] as const;

interface LocalLibraryBrowserProps {
  localSongs: readonly LocalSong[];
  currentTrack: { id: string; source: string } | null;
  isPlaying: boolean;
  onPlay: (track: LocalSong, visibleSongs: LocalSong[]) => void;
  onEdit: (track: LocalSong) => void;
  onRemove: (trackId: string) => void;
}

function groupDescription(group: LocalLibraryGroup, category: LocalLibraryCategory) {
  if (category === 'folder') return group.subtitle || group.title;
  return group.subtitle ? `${group.title} · ${group.subtitle}` : group.title;
}

export function LocalLibraryBrowser({ localSongs, ...trackActions }: LocalLibraryBrowserProps) {
  const [category, setCategory] = useState<LocalLibraryCategory>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{ id: string; parentQuery: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const categoryLabel = categories.find((item) => item.value === category)!.label;
  const groups = useMemo(() => category === 'all' ? [] : groupLocalSongs(localSongs, category), [localSongs, category]);
  const selectedGroup = selection ? groups.find((group) => group.id === selection.id) : undefined;
  // 失效分类仍为空分类，不能意外退回全库播放，也不保存旧歌曲快照。
  const scopedSongs = selection ? selectedGroup?.songs ?? [] : localSongs;
  const visibleSongs = useMemo(() => filterLocalSongs(scopedSongs, query), [scopedSongs, query]);
  const visibleGroups = useMemo(() => category === 'all' || selection ? [] : groupLocalSongs(visibleSongs, category), [visibleSongs, category, selection]);
  const showGroups = category !== 'all' && !selection;

  useEffect(() => {
    if (selection) headingRef.current?.focus();
  }, [selection]);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [category, selection, query, viewMode]);

  const selectCategory = (next: LocalLibraryCategory) => {
    setCategory(next);
    setSelection(null);
    setQuery('');
  };
  const goBack = () => {
    setQuery(selection!.parentQuery);
    setSelection(null);
    categoryRef.current?.focus();
  };
  const title = selection ? selectedGroup ? groupDescription(selectedGroup, category) : '此分类暂无歌曲' : categoryLabel;
  const count = `${showGroups ? `${visibleGroups.length} 个${categoryLabel} · ` : ''}${visibleSongs.length} 首歌曲`;
  const emptyTitle = localSongs.length === 0 ? '还没有本地音乐'
    : selection && scopedSongs.length === 0 ? '此分类暂无歌曲'
    : showGroups ? '没有匹配的分类' : '没有匹配的歌曲';
  const GroupIcon = category === 'artist' ? Users : category === 'folder' ? FolderOpen : Disc3;

  return (
    <section className="af-local-browser" aria-label="本地曲库浏览">
      <div className="af-local-browser-toolbar">
        <nav className="af-local-categories" aria-label="曲库分类">
          {categories.map(({ value, label }) => (
            <button key={value} type="button" aria-label={label} aria-pressed={category === value}
              ref={category === value ? categoryRef : undefined} onClick={() => selectCategory(value)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="af-local-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="搜索本地音乐" placeholder={selection ? '搜索此分类中的歌曲' : '搜索歌曲、艺术家、专辑或路径'}
            value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={16} /></button>}
        </div>
        <div className="af-local-layout-toggle" aria-label="显示方式">
          <button type="button" aria-label="列表视图" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}><ListMusic size={18} /></button>
          <button type="button" aria-label="网格视图" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}><Grid3x3 size={18} /></button>
        </div>
      </div>
      <div className="af-local-breadcrumb">
        {selection && <button type="button" className="af-button-secondary" aria-label={`返回${categoryLabel}`} onClick={goBack}><ArrowLeft size={16} />返回{categoryLabel}</button>}
        <h2 ref={headingRef} tabIndex={-1} title={title}>{title}</h2>
        <span role="status" aria-live="polite">{count}</span>
      </div>
      <div ref={contentRef} className="af-local-content">
        {visibleSongs.length === 0 ? (
          <div className="af-local-empty" role="status">
            <ListMusic size={40} aria-hidden="true" />
            <h3>{emptyTitle}</h3>
            <p>{localSongs.length === 0 ? '扫描文件夹或添加音乐文件以建立本地曲库' : '尝试调整搜索条件或返回其他分类'}</p>
          </div>
        ) : showGroups ? (
          <div className={`af-local-groups af-local-groups-${viewMode}`}>
            {visibleGroups.map((group) => {
              const cover = group.songs.map(getLocalSongCover).find(Boolean);
              const description = groupDescription(group, category);
              return (
                <button key={group.id} type="button" className="af-local-group" aria-label={`打开${categoryLabel} ${description}`}
                  onClick={() => { setSelection({ id: group.id, parentQuery: query }); setQuery(''); }}>
                  <span className="af-local-group-cover">
                    {cover ? <img src={cover} alt="" loading="lazy" /> : <GroupIcon size={28} aria-hidden="true" />}
                  </span>
                  <span className="af-local-group-info">
                    <strong title={group.title}>{group.title}</strong>
                    {group.subtitle && <span title={group.subtitle}>{group.subtitle}</span>}
                    <span>{group.songs.length} 首歌曲</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <LocalLibraryTracks key={`${category}:${selection?.id ?? ''}:${query}:${viewMode}`} songs={visibleSongs} viewMode={viewMode} {...trackActions} />
        )}
      </div>
    </section>
  );
}
