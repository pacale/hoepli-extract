import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProgress, createProgress } from '../../src/progress.mjs';

test('formats the progress line', () => {
  const line = formatProgress({ done: 50, total: 100, bytes: 1048576, rate: 1048576, elapsedMs: 1000 });
  assert.match(line, /50%/);
  assert.match(line, /50\/100/);
  assert.match(line, /1\.0 MB/);
  assert.match(line, /ETA/);
});

test('shows no eta when the work is finished', () => {
  const line = formatProgress({ done: 100, total: 100, bytes: 100, rate: 1, elapsedMs: 1000 });
  assert.equal(line.includes('ETA'), false);
});

test('the progress reporter stays quiet when disabled', () => {
  const lines = [];
  const stream = { isTTY: false, write: (line) => lines.push(line) };
  const progress = createProgress({ total: 10, enabled: false, stream });
  progress.start();
  progress.update(5, 100);
  progress.stop();
  assert.equal(lines.length, 0);
});

test('the progress reporter writes to a non interactive stream', () => {
  const lines = [];
  const stream = { isTTY: false, write: (line) => lines.push(line) };
  const progress = createProgress({ total: 10, enabled: true, stream });
  progress.start();
  progress.update(10, 100);
  progress.stop('done');
  assert.ok(lines.length >= 1);
});
