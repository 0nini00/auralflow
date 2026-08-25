import { describe, expect, it } from "vitest";
import { migrateLegacySecret } from "./secureStorageMigrationModel";

describe("migrateLegacySecret", () => {
  it("安全值不存在时迁移旧明文并在成功后删除旧值", async () => {
    const events: string[] = [];
    const value = await migrateLegacySecret({
      readSecure: async () => null,
      readLegacy: async () => "secret",
      writeSecure: async () => { events.push("write"); },
      removeLegacy: async () => { events.push("remove"); },
    });

    expect(value).toBe("secret");
    expect(events).toEqual(["write", "remove"]);
  });

  it("已有安全值时也清理残留旧明文", async () => {
    const events: string[] = [];
    const value = await migrateLegacySecret({
      readSecure: async () => "secure",
      readLegacy: async () => { events.push("legacy"); return "legacy"; },
      writeSecure: async () => { events.push("write"); },
      removeLegacy: async () => { events.push("remove"); },
    });

    expect(value).toBe("secure");
    expect(events).toEqual(["legacy", "remove"]);
  });

  it("安全写入失败时保留旧明文", async () => {
    let removed = false;
    await expect(migrateLegacySecret({
      readSecure: async () => null,
      readLegacy: async () => "secret",
      writeSecure: async () => { throw new Error("write failed"); },
      removeLegacy: async () => { removed = true; },
    })).rejects.toThrow("write failed");

    expect(removed).toBe(false);
  });
});
