import { useCallback, useState } from 'react';
import { offlineCache, type OfflineAudioEntry } from '@/services/offlineCache';
import { VirtualList } from './VirtualList';
import { formatBytes } from '@/utils/formatBytes';
import { confirmAction } from '@/components/ui/ConfirmDialog';

export function OfflineCacheLibrary() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<OfflineAudioEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setEntries(await offlineCache.list()); setSelected(new Set()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);
  const visible = entries.filter(entry => `${entry.name} ${entry.singer}`.toLowerCase().includes(query.trim().toLowerCase()));
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="af-settings-card">
    <button type="button" className="af-settings-small-button" aria-expanded={open} onClick={() => {
      setOpen(!open); if (!open) void refresh();
    }}>离线缓存曲库</button>
    {open && <div style={{ display: 'grid', gap: 12, padding: 16 }}>
      <p className="af-settings-hint">仅显示已落盘的音频，可断网播放。缓存会被容量清理淘汰，长期保留请使用下载。</p>
      <input aria-label="筛选离线歌曲" placeholder="搜索歌曲或歌手" value={query} onChange={event => setQuery(event.target.value)} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button disabled={busy} onClick={() => void refresh()}>刷新</button>
        <button disabled={busy || !visible.length} onClick={() => void run(() => offlineCache.play(visible, 0))}>播放筛选结果</button>
        <button disabled={busy || !visible.length} onClick={() => setSelected(new Set(visible.map(entry => entry.key)))}>全选筛选结果</button>
        <button disabled={busy || !selected.size} onClick={() => {
          void (async () => {
            const ok = await confirmAction({
              title: "删除离线缓存",
              message: `删除 ${selected.size} 首缓存？不会删除下载文件。`,
              confirmLabel: "删除",
              danger: true,
            });
            if (!ok) return;
            await run(async () => {
              try { await offlineCache.remove(entries.filter(entry => selected.has(entry.key))); }
              finally { await refresh(); }
            });
          })();
        }}>删除所选缓存（{selected.size}）</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <p role="status">{busy ? '正在处理…' : `${visible.length} 首可离线播放`}</p>
      <div style={{ height: 320 }}>
        <VirtualList items={visible} rowHeight={56} getItemKey={entry => entry.key} renderItem={entry =>
          <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 12 }}>
            <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected.has(entry.key)} onChange={() => setSelected(previous => {
              const next = new Set(previous); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next;
            })} />
            <button disabled={busy} onClick={() => void run(() => offlineCache.play([entry], 0))} style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
              {entry.name} · {entry.singer}
            </button>
            <span>{entry.quality} · {formatBytes(entry.bytes)}</span>
          </div>} />
      </div>
    </div>}
  </div>;
}
