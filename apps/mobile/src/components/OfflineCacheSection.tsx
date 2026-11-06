import React, { useCallback, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { deleteCachedAudio, formatCacheSize, listCachedAudio } from '@/services/cacheService';
import { playOfflineCache } from '@/services/offlineCache';
import type { CachedAudioEntry } from '@/services/audioCacheListModel';
import { getResolvedTheme, getThemePalette, useThemeStore } from '@/stores/themeStore';

export function OfflineCacheSection({ disabled, onCacheChanged }: { disabled: boolean; onCacheChanged: () => void }) {
  const mode = useThemeStore(state => state.mode);
  const system = useThemeStore(state => state.systemTheme);
  const accent = useThemeStore(state => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, system), accent);
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<CachedAudioEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(30);
  const refresh = useCallback(async () => {
    const items = await listCachedAudio(); setEntries(items); setSelected(new Set()); setLimit(30);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const visible = entries.filter(entry => `${entry.name} ${entry.singer} ${entry.key}`.toLowerCase().includes(query.trim().toLowerCase()));
  const buttonStyle = { padding: 12, borderRadius: 10, backgroundColor: palette.surfaceStrong };
  const removeSelected = () => Alert.alert('删除离线缓存', `删除 ${selected.size} 首缓存？不会删除已下载文件。`, [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: () => { void run(async () => {
      try { for (const entry of entries.filter(item => selected.has(item.key))) await deleteCachedAudio(entry); }
      finally { await refresh(); onCacheChanged(); }
    }); } },
  ]);
  return <View style={{ gap: 10 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="离线缓存曲库" accessibilityState={{ expanded }} disabled={disabled || busy}
      style={buttonStyle} onPress={() => { setExpanded(!expanded); if (!expanded) void run(refresh); }}>
      <Text style={{ color: palette.text, fontWeight: '600' }}>离线缓存曲库</Text>
      <Text style={{ color: palette.textMuted }}>已落盘歌曲可断网播放，缓存可能被容量清理淘汰</Text>
    </Pressable>
    {expanded && <>
      <TextInput accessibilityLabel="搜索离线歌曲" placeholder="搜索歌曲或歌手" placeholderTextColor={palette.textMuted}
        value={query} onChangeText={value => { setQuery(value); setLimit(30); }} style={{ ...buttonStyle, color: palette.text }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable accessibilityRole="button" disabled={busy} style={buttonStyle} onPress={() => void run(refresh)}><Text style={{ color: palette.text }}>刷新</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !visible.length} style={buttonStyle} onPress={() => void run(() => playOfflineCache(visible))}><Text style={{ color: palette.text }}>播放筛选结果</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={buttonStyle} onPress={() => setSelected(new Set(visible.map(entry => entry.key)))}><Text style={{ color: palette.text }}>全选</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !selected.size} style={buttonStyle} onPress={removeSelected}><Text style={{ color: palette.danger }}>删除所选（{selected.size}）</Text></Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: palette.danger }}>{error}</Text> : null}
      <Text style={{ color: palette.textMuted }}>{busy ? '正在处理…' : `${visible.length} 首可离线播放`}</Text>
      {visible.slice(0, limit).map(entry => <View key={entry.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(entry.key) }} accessibilityLabel={`选择 ${entry.name || entry.key}`}
          style={buttonStyle} onPress={() => setSelected(previous => { const next = new Set(previous); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next; })}>
          <Text style={{ color: palette.primaryInk }}>{selected.has(entry.key) ? '已选' : '选择'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={{ flex: 1, paddingVertical: 12 }} onPress={() => void run(() => playOfflineCache([entry]))}>
          <Text numberOfLines={1} style={{ color: palette.text }}>{entry.name || entry.key}</Text>
          <Text numberOfLines={1} style={{ color: palette.textMuted }}>{entry.singer || '元数据未记录'} · {entry.quality} · {formatCacheSize(entry.size)}</Text>
        </Pressable>
      </View>)}
      {visible.length > limit && <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => setLimit(value => value + 30)}><Text style={{ color: palette.primaryInk }}>显示更多缓存</Text></Pressable>}
    </>}
  </View>;
}
