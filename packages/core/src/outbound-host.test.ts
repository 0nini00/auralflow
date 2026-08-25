import { describe, expect, it } from "vitest";
import { assertPublicOutboundUrl, isBlockedOutboundHost } from "./outbound-host";

describe("isBlockedOutboundHost", () => {
  it("blocks loopback, private and link-local literals", () => {
    const blocked = [
      "127.0.0.1",
      "127.9.9.9",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1",
      "localhost",
      "nas.local",
      "app.localhost",
    ];
    for (const host of blocked) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("blocks IPv6 loopback, ULA, link-local and mapped IPv4", () => {
    const blocked = [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.0.1",
      "::127.0.0.1",
      "0:0:0:0:0:0:0:1",
    ];
    for (const host of blocked) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("blocks decimal-encoded IPv4", () => {
    // 2130706433 === 127.0.0.1
    expect(isBlockedOutboundHost("2130706433")).toBe(true);
    // 3232235777 === 192.168.1.1
    expect(isBlockedOutboundHost("3232235777")).toBe(true);
  });

  it("allows public hosts", () => {
    const allowed = [
      "dav.jianguoyun.com",
      "raw.githubusercontent.com",
      "music-api.gdstudio.xyz",
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "192.169.0.1",
      "2001:4860:4860::8888",
    ];
    for (const host of allowed) {
      expect(isBlockedOutboundHost(host), host).toBe(false);
    }
  });
});

describe("assertPublicOutboundUrl", () => {
  it("rejects non-http schemes", () => {
    expect(() => assertPublicOutboundUrl("file:///etc/passwd", "测试")).toThrow();
    expect(() => assertPublicOutboundUrl("ftp://example.com/x", "测试")).toThrow();
  });

  it("rejects internal targets", () => {
    expect(() => assertPublicOutboundUrl("http://127.0.0.1:8080/x", "测试")).toThrow();
    expect(() => assertPublicOutboundUrl("http://[::1]/x", "测试")).toThrow();
    expect(() => assertPublicOutboundUrl("http://169.254.169.254/latest", "测试")).toThrow();
  });

  it("accepts public targets", () => {
    expect(assertPublicOutboundUrl("https://dav.jianguoyun.com/dav/", "测试").hostname).toBe(
      "dav.jianguoyun.com",
    );
  });
});
