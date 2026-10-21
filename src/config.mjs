// Persistent configuration.
//
// The file lives next to the other tool state (~/.hoepli-extract/config.json)
// and is merged over the defaults; command line flags always win.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { homeDir, ensureDir, log } from './util.mjs';

export const DEFAULTS = {
  outputDir: path.join(os.homedir(), 'Downloads'),
  concurrency: 6,
  openAfter: true,
  port: 9222,
  waitLoginSec: 600,
};

export function configPath() {
  return path.join(homeDir(), 'config.json');
}

export function expandHome(value) {
  const text = String(value ?? '');
  if (text === '~') return os.homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2));
  return text;
}

/** Load the configuration: defaults < file < overrides. */
export function loadConfig(overrides = {}) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    file = {};
  }
  const merged = { ...DEFAULTS, ...file, ...overrides };
  merged.outputDir = path.resolve(expandHome(merged.outputDir));
  merged.concurrency = Math.max(1, Math.min(16, Number(merged.concurrency) || DEFAULTS.concurrency));
  merged.port = Number(merged.port) || DEFAULTS.port;
  merged.waitLoginSec = Number(merged.waitLoginSec) || DEFAULTS.waitLoginSec;
  merged.openAfter = merged.openAfter !== false;
  return merged;
}

export function saveConfig(patch = {}) {
  ensureDir(homeDir());
  const current = loadConfig();
  const next = { ...current, ...patch };
  const serialisable = {
    outputDir: next.outputDir,
    concurrency: next.concurrency,
    openAfter: next.openAfter,
    port: next.port,
    waitLoginSec: next.waitLoginSec,
  };
  fs.writeFileSync(configPath(), `${JSON.stringify(serialisable, null, 2)}\n`);
  log.debug(`configuration written to ${configPath()}`);
  return serialisable;
}

export function describeConfig(config) {
  return [
    ['outputDir', config.outputDir],
    ['concurrency', config.concurrency],
    ['openAfter', config.openAfter],
    ['port', config.port],
    ['waitLoginSec', config.waitLoginSec],
  ];
}
