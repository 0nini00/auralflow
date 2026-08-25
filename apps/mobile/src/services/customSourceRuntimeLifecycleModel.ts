export interface PendingRuntimeRequest {
  reject: (error: Error) => void;
}

export function disposeRuntimePendingRequests(
  registry: Map<string, Map<string, PendingRuntimeRequest>>,
  runtimeId: string,
  error: Error,
): boolean {
  const pending = registry.get(runtimeId);
  if (!pending) return false;

  registry.delete(runtimeId);
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  return true;
}
