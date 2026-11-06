import { describe, expect, it } from 'vitest';
import { createPagedSearch } from './paged-search';

const source = (id: string, category = 'song') => ({ id, category });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];

describe('分页搜索所有权', () => {
  it('恢复缓存页码并只补未完成的第一页，继续加载下一页', async () => {
    const calls: string[] = [];
    const sources = [source('cached'), source('pending')];
    const session = createPagedSearch({ sources, empty: () => [] as string[], merge,
      initialStates: [
        { source: sources[0], page: 2, status: 'ready' as const, result: ['a','b'], hasMore: true, error: null },
        { source: sources[1], page: 0, status: 'loading' as const, result: [], hasMore: true, error: null },
      ],
      request: async (item, page) => { calls.push(`${item.id}:${page}`); return { result: [String(page)], hasMore: false }; },
    });
    await session.start();
    expect(calls).toEqual(['pending:1']);
    await session.loadMore('song');
    expect(calls).toEqual(['pending:1','cached:3']);
    expect(session.getSnapshot()[0].result).toEqual(['a','b','3']);
  });
  it('快来源独立发布，不等待慢分类', async () => {
    const slow = deferred<{ result: string[]; hasMore: boolean }>();
    const session = createPagedSearch({ sources: [source('fast'), source('slow', 'album')],
      empty: () => [] as string[], merge,
      request: async item => item.id === 'fast' ? { result: ['a'], hasMore: true } : slow.promise,
    });
    const pending = session.start();
    await Promise.resolve(); await Promise.resolve();
    expect(session.getSnapshot()[0]).toMatchObject({ status: 'ready', result: ['a'], page: 1 });
    expect(session.getSnapshot()[1].status).toBe('loading');
    slow.resolve({ result: ['album'], hasMore: false });
    await pending;
  });
  it('失败页可重试，成功源不重发，旧数据不丢失', async () => {
    const calls: string[] = [];
    let fail = true;
    const session = createPagedSearch({ sources: [source('one'), source('two')], empty: () => [] as string[], merge,
      request: async (item, page) => {
        calls.push(`${item.id}:${page}`);
        if (item.id === 'one' && page === 2 && fail) throw new Error('offline');
        return { result: [`${item.id}-${page}`], hasMore: page < 2 };
      },
    });
    await session.start(); await session.loadMore('song');
    expect(session.getSnapshot()[0]).toMatchObject({ page: 1, status: 'error', result: ['one-1'] });
    fail = false; await session.retry('song');
    expect(calls).toEqual(['one:1', 'two:1', 'one:2', 'two:2', 'one:2']);
    expect(session.getSnapshot()[0].result).toEqual(['one-1', 'one-2']);
    await session.loadMore('song');
    expect(calls).toHaveLength(5);
  });
  it('重复加载合并为一次，销毁后不发布迟到结果', async () => {
    const pending = deferred<{ result: string[]; hasMore: boolean }>();
    let calls = 0, changes = 0;
    const session = createPagedSearch({ sources: [source('one')], empty: () => [] as string[], merge,
      request: async () => { calls++; return pending.promise; }, onChange: () => { changes++; },
    });
    const first = session.start(); const second = session.start();
    await session.loadMore('song');
    session.dispose(); const before = changes;
    pending.resolve({ result: ['late'], hasMore: true });
    await Promise.all([first, second]);
    expect(calls).toBe(1); expect(changes).toBe(before);
    expect(session.getSnapshot()[0].result).toEqual([]);
  });
});
