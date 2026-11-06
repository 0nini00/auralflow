import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: vi.fn().mockResolvedValue(null), librarySave: vi.fn().mockResolvedValue(undefined) }));

it('统计页面展示实际会话累计与错误，并明确本机新版本口径', async () => {
  const { useListeningStatsStore, listeningStatsPersistence } = await import('../src/stores/listeningStatsStore');
  const { StatsView } = await import('../src/views/StatsView');
  await listeningStatsPersistence.ready;
  const song = { id: 'one', source: 'wy', name: 'Song', singer: 'Artist', interval: 300 } as MusicInfo;
  useListeningStatsStore.setState({
    events: [
      { sessionId: 'a', song, startedAt: 1, listenedMs: 1000 },
      { sessionId: 'b', song, startedAt: 2, listenedMs: 2000 },
    ],
    error: 'disk full',
  });
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<StatsView />); });
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('3 秒');
  expect(rendered).toContain('本机从此版本');
  expect(rendered).toContain('WebDAV 历史不参与统计');
  expect(rendered).toContain('disk full');
  expect(rendered).not.toContain('10 分钟');
  act(() => view.unmount());
});
