import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backoffMs, PageError, downloadPages } from '../../src/download.mjs';
import { mergePages } from '../../src/merge.mjs';
import { acquireLock } from '../../src/lock.mjs';
import { makePdf } from '../helpers/fixture.mjs';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('the backoff grows and stays jittered', () => {
  const samples = Array.from({ length: 40 }, () => backoffMs(1));
  assert.ok(samples.every((v) => v >= 480 && v <= 1600), 'the jitter stays around the nominal value');
  assert.ok(new Set(samples).size > 5, 'the jitter is actually random');
  assert.ok(backoffMs(10) <= 8000 * 1.4, 'the backoff is capped');
});

test('a page whose checksum does not match is never written to disk', async () => {
  const dir = tmpdir('hoepli-dl-');
  const good = await makePdf({ pages: 1, text: 'good' });
  const page = {
    order: 1,
    code: 'P_01',
    url: 'https://example.invalid/does-not-exist',
    md5: '00000000000000000000000000000000',
  };
  // the fetch fails, so nothing must be written
  const result = await downloadPages({ pages: [page], outDir: dir, key: null, concurrency: 1 });
  assert.equal(result.files.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a damaged page does not throw away the whole merge', async () => {
  const dir = tmpdir('hoepli-merge-');
  const good = path.join(dir, '0001.pdf');
  const broken = path.join(dir, '0002.pdf');
  fs.writeFileSync(good, await makePdf({ pages: 1, text: 'good' }));
  fs.writeFileSync(broken, Buffer.from('this is not a pdf at all'));
  const out = path.join(dir, 'out.pdf');
  const result = await mergePages({ files: [good, broken], outFile: out, toc: [] });
  assert.equal(result.pages, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(fs.existsSync(out), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the lock is exclusive and can be released', async () => {
  const dir = tmpdir('hoepli-lock-');
  const lock = await acquireLock(dir);
  assert.equal(fs.existsSync(lock.path), true);
  lock.release();
  assert.equal(fs.existsSync(lock.path), false);
  const again = await acquireLock(dir);
  again.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a stale lock is taken over', async () => {
  const dir = tmpdir('hoepli-lock2-');
  fs.writeFileSync(path.join(dir, '.lock'), '999999\n2020-01-01T00:00:00Z\n');
  const lock = await acquireLock(dir);
  assert.equal(fs.existsSync(lock.path), true);
  lock.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('page errors carry a kind', () => {
  const err = new PageError('boom', 'integrity');
  assert.equal(err.kind, 'integrity');
});
