import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptAsset, assetToPdf, looksLikePdf, DecryptError, HEADER_LEN } from '../../src/decrypt.mjs';
import { makePdf, makeContainer, TEST_KEY_B64 } from '../helpers/fixture.mjs';

test('decrypts a container back into the original PDF', async () => {
  const pdf = await makePdf({ pages: 2 });
  const container = makeContainer(pdf);
  assert.equal(container.length > pdf.length, true);

  const { pdf: restored, meta, decrypted } = assetToPdf(container, TEST_KEY_B64);
  assert.equal(decrypted, true);
  assert.equal(looksLikePdf(restored), true);
  assert.equal(restored.length, pdf.length);
  assert.equal(meta.orig_size, pdf.length);
  assert.deepEqual(restored, pdf);
});

test('keeps a plain PDF untouched', async () => {
  const pdf = await makePdf();
  const { pdf: out, decrypted } = assetToPdf(pdf, null);
  assert.equal(decrypted, false);
  assert.deepEqual(out, pdf);
});

test('fails with a wrong key', async () => {
  const pdf = await makePdf();
  const container = makeContainer(pdf);
  const wrong = Buffer.from('fedcba9876543210').toString('base64');
  assert.throws(() => decryptAsset(container, wrong), DecryptError);
});

test('detects a truncated container', async () => {
  const pdf = await makePdf();
  const container = makeContainer(pdf);
  assert.throws(() => decryptAsset(container.subarray(0, HEADER_LEN + 4), TEST_KEY_B64), DecryptError);
});

test('refuses a key with an invalid length', async () => {
  const pdf = await makePdf();
  const container = makeContainer(pdf);
  const short = Buffer.from('abc').toString('base64');
  assert.throws(() => decryptAsset(container, short), /16, 24 or 32/);
});
