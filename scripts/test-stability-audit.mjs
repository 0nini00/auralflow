import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoreDirs = new Set([
  ".git",
  ".pnpm-store",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function addLineHits(issues, kind, file, text, regex) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      issues.push(`${kind}: ${rel(file)}:${index + 1}: ${line.trim()}`);
    }
    regex.lastIndex = 0;
  });
}

const files = await walk(root);
const issues = [];

for (const file of files) {
  const relative = rel(file);
  if (relative.startsWith("src-tauri/src/") && relative.endsWith(".rs")) {
    const text = await readFile(file, "utf8");
    addLineHits(issues, "Rust panic API", file, text, /\.(?:unwrap|expect)\s*\(/g);
  }

  if (relative.startsWith("src/") && /\.(?:ts|tsx)$/.test(relative)) {
    const text = await readFile(file, "utf8");
    addLineHits(
      issues,
      "Silent promise catch",
      file,
      text,
      /\.catch\s*\(\s*(?:\(\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/g,
    );
    addLineHits(issues, "Silent catch block", file, text, /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g);
  }
}

const txProvider = await readFile(path.join(root, "src/services/sources/txProvider.ts"), "utf8");
if (
  /playlist detail not yet implemented|Return empty for now/.test(txProvider) ||
  /async\s+getPlaylistDetail\s*\([^)]*\)\s*:\s*Promise<MusicInfo\[]>\s*\{[\s\S]*?return\s+\[\]\s*;[\s\S]*?\}/.test(txProvider)
) {
  issues.push("QQ playlist detail is still a placeholder");
}

const customRuntime = await readFile(path.join(root, "src/services/customSourceRuntime.ts"), "utf8");
if (/没有提供 zlib 能力/.test(customRuntime)) {
  issues.push("Custom source runtime still lacks zlib inflate/deflate support");
}

const compression = await readFile(path.join(root, "src/utils/compression.ts"), "utf8");
if (!/zlib_inflate/.test(compression) || !/zlib_deflate/.test(compression)) {
  issues.push("Compression helpers must fall back to Tauri zlib commands when browser streams are unavailable");
}

const webdavSync = await readFile(path.join(root, "src/services/webdavSyncService.ts"), "utf8");
if (/当前环境无法解压 desktop 音源备份/.test(webdavSync)) {
  issues.push("WebDAV restore still fails outright when DecompressionStream is unavailable");
}

const builtinBackend = await readFile(path.join(root, "src/services/playback/builtinNeteaseBackend.ts"), "utf8");
if (!/Tauri fetch 抛出异常/.test(builtinBackend)) {
  issues.push("Built-in playback fetch errors do not preserve both browser and Tauri failures");
}

if (issues.length > 0) {
  console.error(`Stability audit failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Stability audit passed.");
