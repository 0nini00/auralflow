import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    clear: () => data.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storage,
}));

import {
  MOBILE_PACT_ACCEPTED_KEY,
  acceptMobilePact,
  hasAcceptedMobilePact,
} from "@/services/mobilePactService";

describe("mobile pact service", () => {
  beforeEach(() => {
    storage.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
  });

  it("treats missing pact state as not accepted", async () => {
    await expect(hasAcceptedMobilePact()).resolves.toBe(false);

    expect(storage.getItem).toHaveBeenCalledWith(MOBILE_PACT_ACCEPTED_KEY);
  });

  it("loads a persisted accepted pact state", async () => {
    storage.data.set(MOBILE_PACT_ACCEPTED_KEY, "true");

    await expect(hasAcceptedMobilePact()).resolves.toBe(true);
  });

  it("persists pact acceptance", async () => {
    await acceptMobilePact();

    expect(storage.setItem).toHaveBeenCalledWith(MOBILE_PACT_ACCEPTED_KEY, "true");
    await expect(hasAcceptedMobilePact()).resolves.toBe(true);
  });
});
