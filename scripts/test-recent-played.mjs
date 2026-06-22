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

const homeSource = readSource("../src/views/HomeView.tsx");
assert.match(
  homeSource,
  /import \{ SongAddMenuButton \} from "@\/components\/SongAddMenuButton";/,
  "recent played view should import the shared add-to-playlist menu",
);
assert.match(
  homeSource,
  /<SongAddMenuButton\s+song=\{track\}/,
  "recent played cards should expose add to favorite/local playlist/WY playlist actions",
);
assert.match(
  homeSource,
  /recent\.slice\(0,\s*10\)/,
  "home recent played preview should show up to 10 songs",
);

const musicCardSource = readSource("../src/components/MusicCard.tsx");
assert.match(
  musicCardSource,
  /actions\?: ReactNode;/,
  "MusicCard should support an optional actions slot",
);
assert.match(
  musicCardSource,
  /className="af-music-card-actions"[\s\S]*onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  "MusicCard actions should not trigger card playback when clicked",
);

const homeCss = readSource("../src/styles/home.css");
assert.match(
  homeCss,
  /\.af-music-card-title-row/,
  "music card styles should reserve space for inline actions without breaking title ellipsis",
);

console.log("recent played tests passed");
