import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMsgpack, encodeMeta } from '../../src/msgpack.mjs';

test('round-trips the container header', () => {
  const meta = { filename: 'pagine/X.pdf', md5: 'abc123', orig_size: 12345, start: 6789, path: 'pagine' };
  const encoded = encodeMeta(meta);
  const [decoded, end] = decodeMsgpack(encoded, 0);
  assert.equal(end, encoded.length);
  assert.deepEqual(decoded, meta);
});

test('decodes a fixed 256 byte header region', () => {
  const meta = { filename: 'a.pdf', md5: '0'.repeat(32), orig_size: 10, start: 20, path: 'p' };
  const header = Buffer.alloc(256);
  encodeMeta(meta).copy(header, 0);
  const [decoded] = decodeMsgpack(header, 0);
  assert.equal(decoded.filename, 'a.pdf');
  assert.equal(decoded.orig_size, 10);
});

test('rejects unsupported msgpack bytes', () => {
  assert.throws(() => decodeMsgpack(Buffer.from([0xc1]), 0), /unsupported byte/);
});
