import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath) {
  const sourcePath = resolve(__dirname, relativePath);
  assert.equal(existsSync(sourcePath), true, `${relativePath} should exist`);
  return readFileSync(sourcePath, "utf8");
}

const personalFmSource = readSource("../src/views/PersonalFmView.tsx");
assert.match(
  personalFmSource,
  /const next = await fmNext\(\);\s*if \(next\) await play\(next as MusicInfo\);/s,
  "Personal FM initial autoplay should advance through fmNext before playing",
);
assert.doesNotMatch(
  personalFmSource,
  /play\(fmQueue\[0\] as MusicInfo\)/,
  "Personal FM should not play fmQueue[0] directly because that leaves fmIndex stale",
);

const playerStoreSource = readSource("../src/stores/playerStore.ts");
assert.match(
  playerStoreSource,
  /if \(fmMode\) \{\s*void playNextFmTrack\(get\);\s*return;\s*\}/s,
  "player ended handler should route FM mode to the FM auto-next path",
);
assert.match(
  playerStoreSource,
  /if \(fmMode\) \{\s*await playNextFmTrack\(get\);\s*return;\s*\}/s,
  "manual next should route FM mode to the FM next path",
);

console.log("personal FM tests passed");
