import { describe, expect, it, vi } from "vitest";
import {
  cacheAppBackgroundPath,
  prepareInitialAppBackground,
  readCachedAppBackgroundPath,
  type AppBackgroundStorage,
} from "./appBackground";

function createStorage(initial?: string): AppBackgroundStorage {
  let value = initial;
  return {
    getItem: vi.fn(() => value ?? null),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}

describe("app background startup cache", () => {
  it("distinguishes an uninitialized cache from an explicitly empty background", () => {
    expect(readCachedAppBackgroundPath(createStorage())).toBeUndefined();
    expect(readCachedAppBackgroundPath(createStorage(""))).toBeNull();
    expect(readCachedAppBackgroundPath(createStorage("  C:\\Pictures\\wallpaper.jpg  "))).toBe("C:\\Pictures\\wallpaper.jpg");
  });

  it("stores both configured and explicitly cleared background values", () => {
    const storage = createStorage();
    cacheAppBackgroundPath("  C:\\Pictures\\wallpaper.jpg  ", storage);
    expect(storage.setItem).toHaveBeenLastCalledWith("af-app-background-path", "C:\\Pictures\\wallpaper.jpg");
    cacheAppBackgroundPath(null, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith("af-app-background-path", "");
  });

  it("uses and preloads the cached background without waiting for Rust settings", async () => {
    const storage = createStorage("C:\\Pictures\\cached.jpg");
    const loadPersistedPath = vi.fn(async () => "C:\\Pictures\\persisted.jpg");
    const preload = vi.fn(async () => undefined);

    await expect(prepareInitialAppBackground({ storage, loadPersistedPath, preload })).resolves.toBe("C:\\Pictures\\cached.jpg");
    expect(loadPersistedPath).not.toHaveBeenCalled();
    expect(preload).toHaveBeenCalledWith("C:\\Pictures\\cached.jpg");
  });

  it("hydrates and preloads from Rust settings when the cache has not been initialized", async () => {
    const storage = createStorage();
    const preload = vi.fn(async () => undefined);

    await expect(prepareInitialAppBackground({
      storage,
      loadPersistedPath: async () => " C:\\Pictures\\persisted.jpg ",
      preload,
    })).resolves.toBe("C:\\Pictures\\persisted.jpg");

    expect(storage.setItem).toHaveBeenCalledWith("af-app-background-path", "C:\\Pictures\\persisted.jpg");
    expect(preload).toHaveBeenCalledWith("C:\\Pictures\\persisted.jpg");
  });
});
