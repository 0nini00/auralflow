import { describe, expect, it } from "vitest";

import { assertPublicOutboundUrl, isBlockedOutboundHost } from "./outbound-host";

/**
 * 这套用例锚定一个不变量：本模块判定的 host 必须与真实发出请求的 host 相同。
 * 移动端由 OkHttp 发请求，其 URL 语义与 WHATWG 一致，所以拿 Node 的 `URL`
 * 当参照物（见 `guard 判定与真实请求目标一致`）。
 */

describe("isBlockedOutboundHost", () => {
  it("拦截回环、私有、链路本地与保留段", () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254", // 云元数据
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1",
      "203.0.113.1", // 文档示例
    ]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("拦截 localhost 与 .local", () => {
    for (const host of ["localhost", "LOCALHOST", "foo.localhost", "nas.local"]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("还原 inet_aton 写法后拦截", () => {
    // 全部指向 127.0.0.1，漏掉任何一种都等于放行回环
    for (const host of [
      "2130706433",
      "0177.0.0.1",
      "0x7f.0.0.1",
      "0x7f000001",
      "127.1",
      "127.0.1",
    ]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("inet_aton 混写进制写法同样拦截", () => {
    for (const host of ["127.0.0x1", "0x7f.1", "0x7f.0x1", "0x7f.1.1", "0xffffffff.0"]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("形似 IPv4 但解析失败时拒绝，不 fail-open", () => {
    for (const host of [
      "999.999.999.999",
      "1.2.3.4.5",
      "127.0.0.0x1",
      "4294967296", // 超 32 位
      "0xffffffffff",
    ]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("不误伤落在十六进制字符集里的真实域名", () => {
    // 回归：`looksLikeIpv4` 曾用 /^[0-9a-fA-FxX.]+$/，把这些域名当成解析失败的 IPv4
    for (const host of ["b2b.cc", "a1.de", "x5.be", "abc123.cc", "4a.ba", "0x.cc"]) {
      expect(isBlockedOutboundHost(host), host).toBe(false);
    }
  });

  it("拦截 IPv6 回环与映射地址，解析失败按拒绝", () => {
    for (const host of ["::1", "::", "fe80::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::7f00:1"]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
    expect(isBlockedOutboundHost("1:2:3")).toBe(true);
    expect(isBlockedOutboundHost("::ffff:999.1.1.1")).toBe(true);
  });

  it("放行公网地址", () => {
    for (const host of ["example.com", "cdn.example.com", "1.1.1.1", "8.8.8.8", "2001:4860::8888"]) {
      expect(isBlockedOutboundHost(host), host).toBe(false);
    }
  });

  it("空 host 按拒绝", () => {
    expect(isBlockedOutboundHost("")).toBe(true);
    expect(isBlockedOutboundHost("   ")).toBe(true);
  });

  it("百分号编码的 host 先解码再判定", () => {
    // 回归：手写解析器不解码时，这些串既不匹配 IPv4 也不等于 localhost，直接放行
    expect(isBlockedOutboundHost("%31%32%37%2e%30%2e%30%2e%31")).toBe(true); // 127.0.0.1
    expect(isBlockedOutboundHost("%6c%6f%63%61%6c%68%6f%73%74")).toBe(true); // localhost
    expect(isBlockedOutboundHost("%65xample.com")).toBe(false); // example.com
  });

  it("解码出分隔符或畸形百分号序列按拒绝", () => {
    for (const host of ["%2f@evil.com", "127.0.0.1%00", "%", "%zz", "%e0%a4"]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("IDNA 句点变体折成 ASCII 点后判定", () => {
    // U+3002 / U+FF0E / U+FF61 都会被客户端折成 `.`
    for (const host of ["127。0。0。1", "127．0．0．1", "127｡0｡0｡1", "foo。localhost"]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("剥掉尾点后判定（等价 FQDN 写法）", () => {
    for (const host of ["localhost.", "nas.local.", "127.0.0.1.", "localhost...", "..."]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
    expect(isBlockedOutboundHost("example.com.")).toBe(false);
  });
});

describe("assertPublicOutboundUrl", () => {
  const guardAllows = (url: string): boolean => {
    try {
      assertPublicOutboundUrl(url, "测试");
      return true;
    } catch {
      return false;
    }
  };

  it("guard 判定与真实请求目标一致", () => {
    // 每个 URL 里 host 与 userinfo 都有歧义空间；参照 WHATWG 解析出的 host,
    // 只要它被封锁，guard 就必须拒绝，否则就是绕过。
    for (const url of [
      "http://127.0.0.1@evil.com/",
      "http://evil.com@127.0.0.1/",
      "http://127.0.0.1/@evil.com",
      "http://127.0.0.1\\@evil.com/",
      "http://evil.com\\@127.0.0.1/",
      "http://127.0.0.1\\x@evil.com/",
      "http://10.0.0.1\\@evil.com",
      "http://127.0.0.1?x=@evil.com",
      "http://127.0.0.1#@evil.com",
      "http://[::1]/",
      // 主机名归一化：客户端会解码百分号、折叠句点变体、剥尾点
      "http://%31%32%37%2e%30%2e%30%2e%31/",
      "http://%6c%6f%63%61%6c%68%6f%73%74/",
      "http://127。0。0。1/",
      "http://127．0．0．1/",
      "http://127｡0｡0｡1/",
      "http://127.0.0.1./",
      "http://localhost./",
      "http://nas.local./",
      "http://%65xample.com/",
      "http://example.com./",
      "https://ok.example.com/a\\b",
      "https://cdn.example.com:8443/x?a=1",
    ]) {
      const realHost = new URL(url).hostname.replace(/^\[|\]$/g, "");
      if (isBlockedOutboundHost(realHost)) {
        expect(guardAllows(url), `${url} 应被拒绝（真实 host ${realHost}）`).toBe(false);
      } else {
        expect(guardAllows(url), `${url} 应放行（真实 host ${realHost}）`).toBe(true);
      }
    }
  });

  it("只允许 http/https", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "data:text/plain,x",
      "//example.com/x",
      "example.com",
    ]) {
      expect(() => assertPublicOutboundUrl(url, "测试"), url).toThrow(/只支持 HTTP\/HTTPS/);
    }
  });

  it("scheme 大小写不敏感", () => {
    expect(assertPublicOutboundUrl("HTTPS://example.com/x", "测试").hostname).toBe("example.com");
  });

  it("拒绝时错误信息带 label 与 host", () => {
    expect(() => assertPublicOutboundUrl("http://127.0.0.1/", "自定义音源")).toThrow(
      /自定义音源.*127\.0\.0\.1/,
    );
  });

  it("缺少 authority 时拒绝", () => {
    expect(() => assertPublicOutboundUrl("http:///x", "测试")).toThrow();
    expect(() => assertPublicOutboundUrl("http://@/x", "测试")).toThrow();
  });

  it("userinfo 里的端口不干扰 host 判定", () => {
    // 提取 host 时取最后一个 @ 之后的部分,端口随后被剥离;host 判定看到的是真实连接目标。
    expect(() => assertPublicOutboundUrl("http://127.0.0.1:8080@127.0.0.1/", "测试")).toThrow(
      /127\.0\.0\.1/,
    );
    // userinfo 里是内网、真正 host 是公网,应放行(与 WHATWG 语义一致)
    expect(assertPublicOutboundUrl("http://127.0.0.1:8080@evil.com/", "测试").hostname).toBe(
      "evil.com",
    );
  });

  it("host 大小写不敏感且 scheme 不区分大小写", () => {
    expect(() => assertPublicOutboundUrl("HTTP://LOCALHOST/", "测试")).toThrow(/本地|内网/);
    expect(() => assertPublicOutboundUrl("http://LocalHost./", "测试")).toThrow(/本地|内网/);
  });
});
