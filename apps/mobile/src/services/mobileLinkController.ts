interface MobileLinkDependencies<T> {
  resolve: (uri: string) => Promise<T | null>;
  dispatch: (intent: T, isCurrent: () => boolean) => void | Promise<void>;
  onError: (error: unknown) => void;
}

export function createMobileLinkController<T>({ resolve, dispatch, onError }: MobileLinkDependencies<T>) {
  let ready = false;
  let disposed = false;
  let pending: string | null = null;
  let revision = 0;
  let runningRevision: number | null = null;

  async function flush(): Promise<void> {
    if (!ready || disposed || !pending || runningRevision === revision) return;
    const currentRevision = revision;
    const isCurrent = () => !disposed && ready && currentRevision === revision;
    runningRevision = currentRevision;
    try {
      const intent = await resolve(pending);
      if (!isCurrent()) return;
      pending = null;
      if (intent) await dispatch(intent, isCurrent);
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      pending = null;
      onError(error);
    } finally {
      if (runningRevision === currentRevision) runningRevision = null;
    }
  }

  return {
    receive(uri: string | null): Promise<void> {
      if (!uri || disposed) return Promise.resolve();
      pending = uri;
      revision += 1;
      return flush();
    },
    setReady(value: boolean): Promise<void> {
      ready = value;
      return flush();
    },
    dispose(): void {
      disposed = true;
      pending = null;
      revision += 1;
    },
  };
}
