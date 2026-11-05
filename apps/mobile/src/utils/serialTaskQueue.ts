/** 排队整个读改写事务；失败仍交给原调用者，后续事务可以继续执行。 */
export function createSerialTaskQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
