import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 副窗口（桌面歌词 / 迷你播放器 / 歌词解锁）不持有播放：音频、队列、取链都在主窗口，
 * 副窗口只显示主窗口广播的快照（stores/playbackMirrorStore.ts）。
 *
 * 一旦副窗口的静态导入链碰到 playerStore，就会连带拉起播放引擎、预取，以及各个
 * 一加载就读盘的 library store。这种回归在界面上看不出来，所以按源码导入边锁住。
 * 仅类型的导入（import type）不产生运行时依赖，不计入。
 */
const srcRoot = resolve(__dirname, '../src');

function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(srcRoot, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
  for (const match of text.matchAll(pattern)) specs.push(match[1] ?? match[2] ?? match[3]);
  return specs;
}

function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [join(srcRoot, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const spec of runtimeImports(file)) {
      const target = resolveModule(file, spec);
      if (target) queue.push(target);
    }
  }
  return [...seen].map((file) => relative(srcRoot, file).replace(/\\/g, '/'));
}

/** 只属于主窗口的模块：播放本体，以及一加载就读盘的 library store。 */
const MAIN_WINDOW_ONLY = [
  'stores/playerStore.ts',
  'stores/playerSyncMain.ts',
  'services/playerEngine.ts',
  'stores/libraryPersistence.ts',
  'stores/libraryStore.ts',
  'stores/historyStore.ts',
  'stores/customSourceStore.ts',
  'stores/variantPinStore.ts',
  'stores/listeningStatsStore.ts',
];

/**
 * 歌词窗目前仍留着的一条链：它自己取歌词（useLyrics -> lyricsService -> persistentCache），
 * 而歌词缓存要过自定义音源门禁（customSourceGate -> customSourceStore），于是会读
 * library/customSources.json 这一份。去掉它需要改成由主窗口把歌词随快照送过来，是行为变更，
 * 单独做；这里如实登记，新增别的就会失败。
 */
const LYRIC_WINDOW_KNOWN = ['stores/customSourceStore.ts', 'stores/libraryPersistence.ts'];

describe('副窗口不加载播放本体', () => {
  it.each([
    ['views/MiniPlayerView.tsx', []],
    ['views/LyricUnlockView.tsx', []],
    ['views/LyricWindowView.tsx', LYRIC_WINDOW_KNOWN],
    // App.tsx 是四个窗口共用的壳：经 windowModules 的动态 import 能到达每个窗口的界面，
    // 主窗口那一份是它自己的 chunk，不算在壳里。
    ['App.tsx', LYRIC_WINDOW_KNOWN],
  ] as const)('%s 的运行时导入链里没有主窗口专属模块', (entry, known) => {
    const closure = entry === 'App.tsx' ? runtimeClosureWithout(entry, 'MainWindow.tsx') : runtimeClosure(entry);
    expect(closure.filter((file) => MAIN_WINDOW_ONLY.includes(file)).sort()).toEqual([...known].sort());
  });

  it('检查本身有效：主窗口确实会加载它们', () => {
    const closure = runtimeClosure('MainWindow.tsx');
    expect(MAIN_WINDOW_ONLY.filter((file) => !closure.includes(file))).toEqual([]);
  });
});

function runtimeClosureWithout(entry: string, excluded: string): string[] {
  const excludedFile = join(srcRoot, excluded);
  const seen = new Set<string>([excludedFile]);
  const queue = [join(srcRoot, entry)];
  const result: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    result.push(relative(srcRoot, file).replace(/\\/g, '/'));
    if (!/\.tsx?$/.test(file)) continue;
    for (const spec of runtimeImports(file)) {
      const target = resolveModule(file, spec);
      if (target) queue.push(target);
    }
  }
  return result;
}
