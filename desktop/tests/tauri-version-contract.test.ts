import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tauri 的 JS 包与 Rust crate 必须停在同一个 major.minor。
 *
 * 两边通过 IPC 约定的私有协议通信，协议随 minor 版本变化却没有运行时协商。
 * 1.0.3 发版时 Cargo.lock 被整体重新解析，tauri-plugin-http 升到 2.9.0（请求配置
 * 改从 IPC header 读取），前端仍是 2.5.9（配置放在调用参数里），于是每个请求都在
 * 插件层被拒，报 `missing client-config header`，首页与登录全部不可用。
 *
 * 这里直接比对两份锁文件：谁单独升级了一边，测试就失败。
 */
const repoRoot = resolve(__dirname, "../..");

function readLock(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function majorMinor(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\./);
  if (!match) throw new Error(`无法解析版本号：${version}`);
  return `${match[1]}.${match[2]}`;
}

/** Cargo.lock 里的 `tauri` 与 `tauri-plugin-*`：crate 名 → 版本。 */
function readRustVersions(): Map<string, string> {
  const versions = new Map<string, string>();
  const pattern = /name = "(tauri|tauri-plugin-[a-z-]+)"\nversion = "([^"]+)"/g;
  for (const [, name, version] of readLock("desktop/src-tauri/Cargo.lock").matchAll(pattern)) {
    versions.set(name, version);
  }
  return versions;
}

/** pnpm-lock.yaml 各 importer 解析到的 `@tauri-apps/api` 与 `@tauri-apps/plugin-*`。 */
function readJsVersions(): Array<{ name: string; version: string }> {
  const pattern = /'@tauri-apps\/(api|plugin-[a-z-]+)':\n\s+specifier: [^\n]+\n\s+version: ([^\s(]+)/g;
  return [...readLock("pnpm-lock.yaml").matchAll(pattern)].map(([, name, version]) => ({ name, version }));
}

function crateNameFor(jsName: string): string {
  return jsName === "api" ? "tauri" : `tauri-${jsName}`;
}

describe("Tauri JS 包与 Rust crate 版本一致", () => {
  const rustVersions = readRustVersions();
  const jsVersions = readJsVersions();

  it("两份锁文件都能读到 Tauri 依赖", () => {
    expect(rustVersions.get("tauri")).toBeDefined();
    expect(jsVersions.map((entry) => entry.name)).toContain("plugin-http");
  });

  it.each(jsVersions)("@tauri-apps/$name $version 与对应 crate 同一 major.minor", ({ name, version }) => {
    const crateName = crateNameFor(name);
    const crateVersion = rustVersions.get(crateName);
    if (!crateVersion) throw new Error(`Cargo.lock 里找不到 ${crateName}，但前端依赖了 @tauri-apps/${name}`);
    expect(majorMinor(version), `@tauri-apps/${name} ${version} 对 ${crateName} ${crateVersion}`).toBe(majorMinor(crateVersion));
  });
});
