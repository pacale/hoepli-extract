import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as cryptoModule from 'node:crypto';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

export function homeDir() {
  return process.env.HOEPLI_HOME || path.join(os.homedir(), '.hoepli-extract');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

let level = LEVELS[process.env.HOEPLI_LOG_LEVEL] ?? LEVELS.info;

export function setLogLevel(name) {
  if (name in LEVELS) level = LEVELS[name];
}

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  debug: (...a) => level <= LEVELS.debug && console.log(`[${stamp()}] debug`, ...a),
  info: (...a) => level <= LEVELS.info && console.log(`[${stamp()}]  info`, ...a),
  warn: (...a) => level <= LEVELS.warn && console.warn(`[${stamp()}]  warn`, ...a),
  error: (...a) => level <= LEVELS.error && console.error(`[${stamp()}] error`, ...a),
  step: (...a) => level <= LEVELS.info && console.log(`[${stamp()}]   ->  ${a.join(' ')}`),
};

const SECRET_PATTERNS = [
  { re: /(_bsw_session_v1_[A-Za-z0-9]+=)([^;]+)/g, keep: 1 },
  { re: /(remember_user_token=)([^;]+)/g, keep: 1 },
  { re: /(AUTH_TOKEN["']?\s*[:=]\s*["']?)([A-Za-z0-9_-]{8,})/g, keep: 1 },
  { re: /(auth_token["']?\s*[:=]\s*["']?)([A-Za-z0-9]{8,})/g, keep: 1 },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, keep: -1 },
];

export function redact(text) {
  let out = String(text);
  for (const { re, keep } of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) => {
      if (keep === -1) return '***';
      const group = groups[keep];
      if (group === undefined) return '***';
      return match.replace(group, '***');
    });
  }
  return out;
}

export function safeName(text, fallback = 'book') {
  const cleaned = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function md5(buf) {
  return cryptoModule.createHash('md5').update(buf).digest('hex');
}

export function sha256(buf) {
  return cryptoModule.createHash('sha256').update(buf).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}
