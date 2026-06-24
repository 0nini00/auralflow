export function logAsyncError(scope: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(`[${scope}]`, error);
  };
}

export function warnAsyncError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error);
}
