import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAURI_EVENTS } from "@lx/tauri-bridge";

/**
 * 事件名契约：`@lx/tauri-bridge` 的 TAURI_EVENTS 必须与 Rust 侧真正 emit 的名字逐一对应。
 *
 * 事件没有编译期约束——Rust 改了名字或新增了事件，前端只会「永远收不到」。这里直接
 * 扫 Rust 源码里的 emit / emit_to 调用，谁单独改了一边，测试就失败。
 */
const desktopRoot = resolve(__dirname, "..");

function readSources(dir: string, extensions: readonly string[]): Array<{ path: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readSources(path, extensions);
    if (!extensions.some((extension) => entry.name.endsWith(extension))) return [];
    return [{ path, text: readFileSync(path, "utf8").replace(/\r\n/g, "\n") }];
  });
}

/** 从 `(` 之后切出第 index 个顶层实参的源码（按括号深度找逗号）。 */
function argumentAt(text: string, start: number, index: number): string {
  let depth = 0;
  let current = 0;
  let from = start;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth -= 1;
    const closesCall = depth < 0;
    if (!closesCall && !(char === "," && depth === 0)) continue;
    if (current === index) return text.slice(from, i);
    if (closesCall) break;
    current += 1;
    from = i + 1;
  }
  throw new Error(`emit 调用缺少第 ${index + 1} 个实参：${text.slice(start, start + 80)}`);
}

/** 事件名实参可能是字面量、`if … { "a" } else { "b" }`，或同文件里的 `const X: &str = "…"`。 */
function eventNamesIn(expression: string, fileText: string, path: string): string[] {
  const literals = [...expression.matchAll(/"([^"]+)"/g)].map(([, name]) => name);
  if (literals.length > 0) return literals;
  const identifier = expression.trim();
  const constant = fileText.match(new RegExp(`const ${identifier}: &str = "([^"]+)"`));
  if (!constant) throw new Error(`${path}：无法解析 emit 的事件名表达式 \`${identifier}\`，请更新本测试的解析规则`);
  return [constant[1]];
}

function readRustEmittedEvents(): string[] {
  const names = new Set<string>();
  for (const { path, text } of readSources(join(desktopRoot, "src-tauri/src"), [".rs"])) {
    const code = text.replace(/\/\/[^\n]*/g, "");
    for (const match of code.matchAll(/\.(emit|emit_to)\(/g)) {
      // emit(name, payload) / emit_to(target, name, payload)
      const nameIndex = match[1] === "emit_to" ? 1 : 0;
      const expression = argumentAt(code, match.index + match[0].length, nameIndex);
      for (const name of eventNamesIn(expression, code, path)) names.add(name);
    }
  }
  return [...names].sort();
}

describe("Tauri 事件名与 Rust 侧一致", () => {
  it("TAURI_EVENTS 恰好是 Rust 侧 emit 的全部事件", () => {
    expect(Object.values(TAURI_EVENTS).sort()).toEqual(readRustEmittedEvents());
  });

  it("前端不再手写 Rust 事件名字面量", () => {
    const names = Object.values(TAURI_EVENTS);
    const offenders = readSources(join(desktopRoot, "src"), [".ts", ".tsx"]).flatMap(({ path, text }) => {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      return names.filter((name) => new RegExp(`["'\`]${name}["'\`]`).test(code)).map((name) => `${path}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it("每个事件都有前端监听者；没人听的必须在这里点名", () => {
    // lyric-window-lock-failed：Rust 在锁定/解锁落到窗口失败时发出（lyric_window.rs），
    // 注释写明「必须把错误暴露到前端」，但前端至今没有监听——失败仍然是静默的。
    // 补上监听后把它从这里删掉。
    const knownUnheard = ["lyricWindowLockFailed"];
    const frontend = readSources(join(desktopRoot, "src"), [".ts", ".tsx"]).map(({ text }) => text).join("\n");
    const unheard = Object.keys(TAURI_EVENTS).filter((key) => !frontend.includes(`TAURI_EVENTS.${key}`));
    expect(unheard).toEqual(knownUnheard);
  });
});
