import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, safeName, safeText, formatBytes } from '../../src/util.mjs';
import { mergePages, readOutline } from '../../src/merge.mjs';
import { verifyOutput } from '../../src/verify.mjs';
import { makePdf, makeContainer, TEST_KEY_B64 } from '../helpers/fixture.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('redacts session material from log text', () => {
  const text = 'cookie _bsw_session_v1_production=abcdef123456 user@example.com AUTH_TOKEN: ZZZZZZZZZZ';
  const out = redact(text);
  assert.equal(out.includes('abcdef123456'), false);
  assert.equal(out.includes('user@example.com'), false);
  assert.equal(out.includes('ZZZZZZZZZZ'), false);
});

test('builds safe file names', () => {
  assert.equal(safeName('Programmazione Java — "De Sio"'), 'Programmazione-Java-De-Sio');
  assert.equal(safeName(''), 'book');
});

test('keeps spaces in the author part of a file name', () => {
  assert.equal(safeText('Claudio De Sio Cesari'), 'Claudio De Sio Cesari');
  assert.equal(safeText('a/b:c'), 'a-b-c');
});

test('formats byte counts', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('merges pages and writes a navigable outline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoepli-merge-'));
  const files = [];
  for (let i = 0; i < 3; i++) {
    const pdf = await makePdf({ pages: 1, text: `Page ${i + 1}` });
    const file = path.join(dir, `${i}.pdf`);
    fs.writeFileSync(file, pdf);
    files.push(file);
  }
  const out = path.join(dir, 'out.pdf');
  const toc = [
    { level: 1, title: 'Parte 1', page: 1 },
    { level: 2, title: 'Capitolo 1', page: 2 },
    { level: 2, title: 'Capitolo 2', page: 3 },
  ];
  const result = await mergePages({ files, outFile: out, toc, metadata: { title: 'Test', author: 'Tester' } });
  assert.equal(result.pages, 3);
  assert.equal(result.outline, 3);

  const bytes = fs.readFileSync(out);
  const outline = await readOutline(bytes);
  assert.equal(outline.items, 3);
  assert.equal(outline.titles[0], 'Parte 1');
  assert.equal(outline.titles[2], 'Capitolo 2');

  const verification = await verifyOutput({ file: out, expectedPages: 3, expectOutline: 3 });
  assert.equal(verification.pages, 3);
  assert.equal(verification.outline, 3);
  assert.equal(verification.ok, true);
  assert.equal(verification.metadata.title, 'Test');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a decrypted page is a valid PDF document', async () => {
  const pdf = await makePdf({ pages: 1, text: 'Sintetica' });
  const container = makeContainer(pdf, { keyB64: TEST_KEY_B64 });
  const { decryptAsset } = await import('../../src/decrypt.mjs');
  const { pdf: restored } = decryptAsset(container, TEST_KEY_B64);
  assert.equal(restored.subarray(0, 5).toString('latin1'), '%PDF-');
});
