import { describe, expect, it } from "vitest";
import { CloudDataStaleError, CloudSyncRefusalError } from "./webdav-sync-error";

/**
 * 这两条 instanceof 判据是 WebDAV 同步安全性的支点，不是形式检查：
 * - 桌面 / 移动设置页靠 `instanceof CloudSyncRefusalError` 决定是否提示「强制下载」；
 * - 两端 autoSyncPlaylistsOnce 靠 `instanceof CloudDataStaleError` 决定是否吞掉拒绝并改为上传。
 *
 * 若基类构造里的 setPrototypeOf 写成写死类名（而非 new.target），子类实例的 instanceof
 * 会全部失效：最保守的「无法判定云端更新时间」拒绝将被误吞并触发覆盖式上传，删掉只存在
 * 于云端的实体——这正是本模块存在的理由。
 */
describe("webdav sync refusal errors", () => {
  it("「云端较旧」同时是「可用强制下载覆盖」的拒绝", () => {
    const error = new CloudDataStaleError("云端数据较旧");
    expect(error).toBeInstanceOf(CloudDataStaleError);
    expect(error).toBeInstanceOf(CloudSyncRefusalError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CloudDataStaleError");
    expect(error.message).toBe("云端数据较旧");
  });

  it("通用拒绝不是「云端较旧」，因此自动同步不得吞掉它", () => {
    const error = new CloudSyncRefusalError("无法确定更新状态");
    expect(error).toBeInstanceOf(CloudSyncRefusalError);
    expect(error).not.toBeInstanceOf(CloudDataStaleError);
    expect(error.name).toBe("CloudSyncRefusalError");
  });

  it("子类构造不会把实例原型改回基类", () => {
    expect(Object.getPrototypeOf(new CloudDataStaleError("x"))).toBe(
      CloudDataStaleError.prototype,
    );
  });
});
