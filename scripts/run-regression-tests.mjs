import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(content, needle, label) {
  assert(content.includes(needle), `${label} should include ${needle}`);
}

function assertNotIncludes(content, needle, label) {
  assert(!content.includes(needle), `${label} should not include ${needle}`);
}

function testSearchLayoutContract() {
  const searchView = read("src/views/SearchView.tsx");
  const header = read("src/components/Layout/Header.tsx");
  const searchCss = read("src/styles/search.css");
  const layoutCss = read("src/styles/layout.css");
  const suggestions = read("src/services/search/searchSuggestions.ts");

  assertIncludes(searchView, 'type ResultFilter = "overview" | "song" | "artist" | "album" | "playlist"', "SearchView filters");
  assertIncludes(searchView, '{ id: "overview", label: "综合" }', "SearchView tabs");
  assertIncludes(searchView, '{ id: "playlist", label: "歌单" }', "SearchView tabs");
  assertNotIncludes(searchView, '{ id: "all", label: "全部" }', "SearchView tabs");
  assertIncludes(searchView, "showPlaylistResults", "SearchView playlist tab content");
  assertIncludes(searchView, "af-search-overview", "SearchView overview layout");
  assertIncludes(searchView, "af-search-suggestions", "SearchView suggestions");
  assertIncludes(header, "buildSearchSuggestions", "Header suggestions");
  assertIncludes(header, "fetchWySearchSuggestions", "Header online suggestions");
  assertIncludes(header, "recordSearchKeyword", "Header recent keywords");
  assertIncludes(searchView, "fetchWySearchSuggestions", "SearchView online suggestions");
  assertIncludes(searchCss, ".af-search-overview", "Search styles");
  assertIncludes(searchCss, ".af-search-suggestions", "Search suggestion styles");
  assertIncludes(layoutCss, ".af-header-search-popover", "Header suggestion styles");
  assertIncludes(suggestions, "buildSearchSuggestions", "Suggestion service");
  assertIncludes(suggestions, "fetchWySearchSuggestions", "Suggestion service");
  assertIncludes(suggestions, "recordSearchKeyword", "Suggestion service");
}

const tests = [
  ["search layout contract", testSearchLayoutContract],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    test();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`${passed}/${tests.length} regression tests passed`);
