export interface SearchPageSource { id: string; category: string }
export interface SearchPage<R> { result: R; hasMore: boolean }
export interface SearchPageState<S extends SearchPageSource, R> {
  source: S;
  page: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: R;
  hasMore: boolean;
  error: string | null;
}

/** 每个来源独立提交分页；失败页保留旧结果，并且重试不重发成功来源。 */
export function createPagedSearch<S extends SearchPageSource, R>(options: {
  sources: readonly S[];
  request: (source: S, page: number) => Promise<SearchPage<R>>;
  empty: () => R;
  merge: (current: R, incoming: R) => R;
  initialStates?: readonly SearchPageState<S, R>[];
  onChange?: (snapshot: SearchPageState<S, R>[]) => void;
}) {
  if (new Set(options.sources.map(source => source.id)).size !== options.sources.length) {
    throw new Error('搜索来源 ID 重复');
  }
  let states: SearchPageState<S, R>[] = options.sources.map(source => {
    const restored = options.initialStates?.find(state => state.source.id === source.id && state.source.category === source.category);
    if (!restored) return { source, page: 0, status: 'idle', result: options.empty(), hasMore: true, error: null };
    if (!Number.isInteger(restored.page) || restored.page < 0) throw new Error('缓存搜索页码无效');
    return { ...restored, source,
      status: restored.status === 'loading' ? (restored.page > 0 ? 'ready' : 'idle') : restored.status,
    };
  });
  let disposed = false;
  let started: Promise<void> | undefined;
  const publish = (index: number, patch: Partial<SearchPageState<S, R>>) => {
    if (disposed) return;
    states = states.map((state, i) => i === index ? { ...state, ...patch } : state);
    options.onChange?.(states.slice());
  };
  const run = async (index: number) => {
    const state = states[index];
    if (disposed || state.status === 'loading') return;
    const page = state.page + 1;
    publish(index, { status: 'loading', error: null });
    try {
      const next = await options.request(state.source, page);
      if (disposed) return;
      publish(index, { page, status: 'ready', result: options.merge(state.result, next.result), hasMore: next.hasMore });
    } catch (error) {
      publish(index, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };
  const selected = (category: string | undefined, predicate: (state: SearchPageState<S, R>) => boolean) =>
    Promise.all(states.map((state, index) =>
      (!category || state.source.category === category) && predicate(state) ? run(index) : Promise.resolve(),
    )).then(() => undefined);
  return {
    start(): Promise<void> {
      started ??= selected(undefined, state => state.status === 'idle');
      return started;
    },
    loadMore(category: string): Promise<void> {
      return selected(category, state => state.status === 'ready' && state.hasMore);
    },
    retry(category?: string): Promise<void> {
      return selected(category, state => state.status === 'error');
    },
    getSnapshot: () => states.slice(),
    dispose() { disposed = true; },
  };
}
