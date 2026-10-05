import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('HistoryDock final behavior is owned by its definition without runtime class replacement', async () => {
  const dock = await readFile(new URL('../src/ui/history-dock.js', import.meta.url), 'utf8');

  expect(dock).toContain('entries.map((entry, index) => ({ entry, index })).reverse()');
  expect(dock).not.toContain('class V17HistoryDock');
});
