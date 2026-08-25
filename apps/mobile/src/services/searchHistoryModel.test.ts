import { describe, expect, it } from "vitest";
import { updateSearchHistory } from "./searchHistoryModel";

describe("updateSearchHistory", () => {
  it("保留不同关键词并把新词置首", () => {
    expect(updateSearchHistory(["周杰伦"], "林俊杰")).toEqual(["林俊杰", "周杰伦"]);
  });

  it("重复关键词只保留一条", () => {
    expect(updateSearchHistory(["周杰伦", "林俊杰"], "周杰伦")).toEqual(["周杰伦", "林俊杰"]);
  });

  it("过滤空白并限制数量", () => {
    expect(updateSearchHistory(["a", "b", "c"], " d ", 2)).toEqual(["d", "a"]);
  });
});
