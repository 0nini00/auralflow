import { describe, expect, it } from "vitest";

import { weapi as weapiJs } from "./weapiJs";

describe("weapi JS 兜底实现", () => {
  it("随机 key 输出格式合法", () => {
    const result = weapiJs({});
    expect(result.params).toBeTruthy();
    expect(result.encSecKey).toMatch(/^[0-9a-f]{256}$/);
  });

  it("params 为 Base64 且密文长度是 16 字节倍数", () => {
    const { params } = weapiJs({ csrf_token: "" });
    expect(params).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const bytesLen = Math.floor((params.length * 3) / 4);
    expect(bytesLen % 16).toBe(0);
  });

  it("同样输入两次 encSecKey 不同（随机 secretKey）", () => {
    const a = weapiJs({ a: 1 });
    const b = weapiJs({ a: 1 });
    expect(a.encSecKey).not.toBe(b.encSecKey);
  });
});
