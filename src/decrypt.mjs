// Asset container decryption.
//
// Layout observed on the platform (see docs/architecture.md):
//
//   [ 0                256 )  MessagePack meta { filename, md5, orig_size, start, path }
//   [ 256              start)  IV (16 bytes) || AES-CBC ciphertext
//   [ start            EOF  )  clear-text tail
//
// The web client decrypts the middle segment and concatenates it with the
// clear tail, which restores the original PDF byte for byte.

import crypto from 'node:crypto';
import { decodeMsgpack } from './msgpack.mjs';

export const HEADER_LEN = 256;
const IV_LEN = 16;

export class DecryptError extends Error {}

function algFor(keyLen) {
  if (keyLen === 16) return 'aes-128-cbc';
  if (keyLen === 24) return 'aes-192-cbc';
  if (keyLen === 32) return 'aes-256-cbc';
  throw new DecryptError(`unsupported key length: ${keyLen} bytes`);
}

export function parseMeta(buf) {
  const [meta, end] = decodeMsgpack(buf, 0);
  if (!meta || typeof meta !== 'object') throw new DecryptError('container header is not a map');
  if (typeof meta.start !== 'number' || typeof meta.orig_size !== 'number') {
    throw new DecryptError('container header misses start/orig_size');
  }
  if (end > HEADER_LEN) throw new DecryptError('container header overflows the reserved area');
  return { meta, headerEnd: end };
}

/**
 * Decrypt one asset container.
 * @param {Buffer} buf raw container bytes
 * @param {string} keyB64 base64 AES key
 * @returns {{pdf: Buffer, meta: object, plainLen: number, tailLen: number}}
 */
export function decryptAsset(buf, keyB64) {
  const { meta, headerEnd } = parseMeta(buf);
  const key = Buffer.from(keyB64, 'base64');
  if (![16, 24, 32].includes(key.length)) {
    throw new DecryptError(`key must be 16, 24 or 32 bytes, got ${key.length}`);
  }
  const start = meta.start;
  if (start <= HEADER_LEN || start > buf.length) {
    throw new DecryptError(`invalid start offset ${start} (header ${HEADER_LEN}, size ${buf.length})`);
  }
  // The encrypted segment always starts at the fixed HEADER_LEN offset; the
  // MessagePack map is padded with zeroes up to that boundary.
  const segment = buf.subarray(HEADER_LEN, start);
  if (segment.length <= IV_LEN) throw new DecryptError('encrypted segment too short');
  const iv = segment.subarray(0, IV_LEN);
  const ciphertext = segment.subarray(IV_LEN);
  const tail = buf.subarray(start);

  const decipher = crypto.createDecipheriv(algFor(key.length), key, iv);
  decipher.setAutoPadding(true);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new DecryptError(`AES-CBC failed (wrong key?): ${e.message}`);
  }
  const pdf = Buffer.concat([plain, tail]);
  if (meta.orig_size && pdf.length !== meta.orig_size) {
    throw new DecryptError(`size mismatch: got ${pdf.length}, expected ${meta.orig_size}`);
  }
  return { pdf, meta, plainLen: plain.length, tailLen: tail.length };
}

/** True when the buffer already is a plain PDF (no container involved). */
export function looksLikePdf(buf) {
  return buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Turn an asset into a PDF, decrypting only when needed.
 * @param {Buffer} buf raw asset bytes
 * @param {string|null} keyB64 base64 key, or null when the asset is not encrypted
 */
export function assetToPdf(buf, keyB64) {
  if (looksLikePdf(buf)) return { pdf: buf, meta: null, decrypted: false };
  if (!keyB64) throw new DecryptError('asset is not a plain PDF and no key was provided');
  const res = decryptAsset(buf, keyB64);
  if (!looksLikePdf(res.pdf)) throw new DecryptError('decrypted asset is still not a PDF');
  return { ...res, decrypted: true };
}
