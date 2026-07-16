export interface NavigationHistory<T> {
  entries: T[];
  index: number;
}

export interface NavigationMove<T> {
  history: NavigationHistory<T>;
  value: T | null;
}

export type NavigationTarget<
  MainName extends string = string,
  RootName extends string = string,
> =
  | { kind: "main"; name: MainName; params?: unknown }
  | { kind: "root"; name: RootName; params?: unknown };

export type NavigationEquality<T> = (left: T, right: T) => boolean;

export interface NavigationStateTransition<T> {
  history: NavigationHistory<T>;
  pendingReplay: T | null;
}

export function createMainNavigationTarget<Name extends string>(
  name: Name,
  params?: unknown,
): NavigationTarget<Name, never> {
  return { kind: "main", name, params };
}

export function createRootNavigationTarget<Name extends string>(
  name: Name,
  params?: unknown,
): NavigationTarget<never, Name> {
  return { kind: "root", name, params };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null) return false;
  if (typeof right !== "object" || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((value, index) =>
      valuesEqual(value, right[index]),
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) =>
    key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]),
  );
}

export function navigationTargetsEqual(
  left: NavigationTarget,
  right: NavigationTarget,
): boolean {
  if (left.kind !== right.kind || left.name !== right.name) return false;
  return valuesEqual(left.params, right.params);
}

function hasEmptyParams(params: unknown): boolean {
  if (params === undefined) return true;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return false;
  return Object.values(params).every((value) => value === undefined);
}

export function navigationObservationsEqual(
  stored: NavigationTarget,
  active: NavigationTarget,
): boolean {
  if (navigationTargetsEqual(stored, active)) return true;
  return stored.kind === "main"
    && active.kind === "main"
    && stored.name === active.name
    && hasEmptyParams(active.params);
}

export function navigationReplayTargetsEqual(
  pending: NavigationTarget,
  active: NavigationTarget,
): boolean {
  return navigationObservationsEqual(pending, active);
}

export function createNavigationHistory<T>(initial: T): NavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function recordNavigation<T>(
  history: NavigationHistory<T>,
  value: T,
  isEqual: NavigationEquality<T> = Object.is,
): NavigationHistory<T> {
  if (isEqual(history.entries[history.index], value)) return history;

  return {
    entries: [...history.entries.slice(0, history.index + 1), value],
    index: history.index + 1,
  };
}

export function applyNavigationState<T>(
  history: NavigationHistory<T>,
  active: T,
  pendingReplay: T | null,
  observationsEqual: NavigationEquality<T> = Object.is,
  replayTargetsEqual: NavigationEquality<T> = observationsEqual,
): NavigationStateTransition<T> {
  if (pendingReplay !== null) {
    return {
      history,
      pendingReplay: replayTargetsEqual(pendingReplay, active) ? null : pendingReplay,
    };
  }

  return {
    history: recordNavigation(history, active, observationsEqual),
    pendingReplay: null,
  };
}

export function moveBackward<T>(history: NavigationHistory<T>): NavigationMove<T> {
  if (history.index === 0) return { history, value: null };

  const index = history.index - 1;
  return {
    history: { ...history, index },
    value: history.entries[index],
  };
}

export function moveForward<T>(history: NavigationHistory<T>): NavigationMove<T> {
  if (history.index >= history.entries.length - 1) return { history, value: null };

  const index = history.index + 1;
  return {
    history: { ...history, index },
    value: history.entries[index],
  };
}
