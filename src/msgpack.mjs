// Minimal MessagePack reader/writer for the 256-byte asset container header.
//
// The container header is a MessagePack map with the fields the web client
// needs: filename, md5, orig_size, start and path. `start` marks the offset
// where the encrypted segment ends and the clear-text tail begins.

export function decodeMsgpack(buf, p = 0) {
  const b = buf[p];
  if (b === undefined) throw new Error('msgpack: unexpected end of buffer');
  if (b < 0x80) return [b, p + 1];
  if (b >= 0xe0) return [b - 0x100, p + 1];
  if (b >= 0xa0 && b <= 0xbf) {
    const n = b & 0x1f;
    return [buf.toString('utf8', p + 1, p + 1 + n), p + 1 + n];
  }
  if (b >= 0x90 && b <= 0x9f) {
    const n = b & 0x0f;
    const out = [];
    let q = p + 1;
    for (let i = 0; i < n; i++) {
      const [v, nq] = decodeMsgpack(buf, q);
      out.push(v);
      q = nq;
    }
    return [out, q];
  }
  if (b >= 0x80 && b <= 0x8f) {
    const n = b & 0x0f;
    const obj = {};
    let q = p + 1;
    for (let i = 0; i < n; i++) {
      const [k, nq] = decodeMsgpack(buf, q);
      const [v, nq2] = decodeMsgpack(buf, nq);
      obj[k] = v;
      q = nq2;
    }
    return [obj, q];
  }
  switch (b) {
    case 0xc0: return [null, p + 1];
    case 0xc2: return [false, p + 1];
    case 0xc3: return [true, p + 1];
    case 0xcc: return [buf.readUInt8(p + 1), p + 2];
    case 0xcd: return [buf.readUInt16BE(p + 1), p + 3];
    case 0xce: return [buf.readUInt32BE(p + 1), p + 5];
    case 0xcf: return [Number(buf.readBigUInt64BE(p + 1)), p + 9];
    case 0xd0: return [buf.readInt8(p + 1), p + 2];
    case 0xd1: return [buf.readInt16BE(p + 1), p + 3];
    case 0xd2: return [buf.readInt32BE(p + 1), p + 5];
    case 0xd3: return [Number(buf.readBigInt64BE(p + 1)), p + 9];
    case 0xca: return [buf.readFloatBE(p + 1), p + 5];
    case 0xcb: return [buf.readDoubleBE(p + 1), p + 9];
    case 0xd9: {
      const n = buf.readUInt8(p + 1);
      return [buf.toString('utf8', p + 2, p + 2 + n), p + 2 + n];
    }
    case 0xda: {
      const n = buf.readUInt16BE(p + 1);
      return [buf.toString('utf8', p + 3, p + 3 + n), p + 3 + n];
    }
    case 0xdb: {
      const n = buf.readUInt32BE(p + 1);
      return [buf.toString('utf8', p + 5, p + 5 + n), p + 5 + n];
    }
    case 0xc4: {
      const n = buf.readUInt8(p + 1);
      return [Buffer.from(buf.subarray(p + 2, p + 2 + n)), p + 2 + n];
    }
    case 0xc5: {
      const n = buf.readUInt16BE(p + 1);
      return [Buffer.from(buf.subarray(p + 3, p + 3 + n)), p + 3 + n];
    }
    case 0xc6: {
      const n = buf.readUInt32BE(p + 1);
      return [Buffer.from(buf.subarray(p + 5, p + 5 + n)), p + 5 + n];
    }
    case 0xdc: {
      const n = buf.readUInt16BE(p + 1);
      const out = [];
      let q = p + 3;
      for (let i = 0; i < n; i++) {
        const [v, nq] = decodeMsgpack(buf, q);
        out.push(v);
        q = nq;
      }
      return [out, q];
    }
    case 0xdd: {
      const n = buf.readUInt32BE(p + 1);
      const out = [];
      let q = p + 5;
      for (let i = 0; i < n; i++) {
        const [v, nq] = decodeMsgpack(buf, q);
        out.push(v);
        q = nq;
      }
      return [out, q];
    }
    case 0xde: {
      const n = buf.readUInt16BE(p + 1);
      const obj = {};
      let q = p + 3;
      for (let i = 0; i < n; i++) {
        const [k, nq] = decodeMsgpack(buf, q);
        const [v, nq2] = decodeMsgpack(buf, nq);
        obj[k] = v;
        q = nq2;
      }
      return [obj, q];
    }
    case 0xdf: {
      const n = buf.readUInt32BE(p + 1);
      const obj = {};
      let q = p + 5;
      for (let i = 0; i < n; i++) {
        const [k, nq] = decodeMsgpack(buf, q);
        const [v, nq2] = decodeMsgpack(buf, nq);
        obj[k] = v;
        q = nq2;
      }
      return [obj, q];
    }
    default:
      throw new Error(`msgpack: unsupported byte 0x${b.toString(16)} at ${p}`);
  }
}

function encodeString(str) {
  const bytes = Buffer.from(str, 'utf8');
  if (bytes.length < 32) return Buffer.concat([Buffer.from([0xa0 | bytes.length]), bytes]);
  if (bytes.length < 256) return Buffer.concat([Buffer.from([0xd9, bytes.length]), bytes]);
  const head = Buffer.alloc(3);
  head[0] = 0xda;
  head.writeUInt16BE(bytes.length, 1);
  return Buffer.concat([head, bytes]);
}

function encodeUint(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0xcc, n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xcd;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xce;
  b.writeUInt32BE(n, 1);
  return b;
}

/**
 * Encode an asset container header the same way the platform does.
 * Used to build synthetic fixtures for the test-suite; the production path
 * only ever reads headers.
 */
export function encodeMeta(meta) {
  const keys = ['filename', 'md5', 'orig_size', 'start', 'path'];
  const parts = [Buffer.from([0x80 | keys.length])];
  for (const key of keys) {
    parts.push(encodeString(key));
    const value = meta[key];
    if (typeof value === 'number') parts.push(encodeUint(value));
    else parts.push(encodeString(String(value)));
  }
  return Buffer.concat(parts);
}
