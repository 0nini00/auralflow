import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'src', 'views');
let failures = 0;

async function check(file, predicate, label) {
  const content = await readFile(join(root, file), 'utf8');
  const ok = predicate(content);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} (${file})`);
  if (!ok) failures++;
}

await check(
  'DailyRecommendView.tsx',
  (c) => c.includes('pendingPlayAction') && c.includes("runPlayQueueAction('play-all'"),
  'DailyRecommendView has pendingPlayAction guard for play-all',
);

await check(
  'DailyRecommendView.tsx',
  (c) => c.includes('isShufflePending') && c.includes("runPlayQueueAction('shuffle'"),
  'DailyRecommendView guards shuffle play',
);

await check(
  'DailyRecommendView.tsx',
  (c) => c.includes('runPlayQueueAction(`track:${index}`') ,
  'DailyRecommendView guards individual track play',
);

await check(
  'DailyRecommendView.tsx',
  (c) => c.includes("disabled={daily.length === 0 || dailyLoading || isPlayAllPending}"),
  'DailyRecommendView disables play-all while pending',
);

await check(
  'FavoritesView.tsx',
  (c) => c.includes('pendingPlayAction') && c.includes("runPlayQueueAction('play-all'"),
  'FavoritesView has pendingPlayAction guard for play-all',
);

await check(
  'FavoritesView.tsx',
  (c) => c.includes("runPlayQueueAction(`track:${index}`"),
  'FavoritesView guards individual track play',
);

console.log('');
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All daily/favorites loading-UI checks passed.');
