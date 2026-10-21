import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, configPath, expandHome, DEFAULTS } from '../../src/config.mjs';

function withHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoepli-cfg-'));
  const previous = process.env.HOEPLI_HOME;
  process.env.HOEPLI_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.HOEPLI_HOME;
    else process.env.HOEPLI_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('uses the defaults when there is no configuration file', () => {
  withHome(() => {
    const config = loadConfig();
    assert.equal(config.concurrency, DEFAULTS.concurrency);
    assert.equal(config.openAfter, true);
    assert.equal(path.isAbsolute(config.outputDir), true);
    assert.equal(config.outputDir.endsWith('Downloads'), true);
  });
});

test('reads the values from the configuration file', () => {
  withHome(() => {
    fs.writeFileSync(configPath(), JSON.stringify({ outputDir: '~/Books', concurrency: 3, openAfter: false }));
    const config = loadConfig();
    assert.equal(config.concurrency, 3);
    assert.equal(config.openAfter, false);
    assert.equal(config.outputDir, path.join(os.homedir(), 'Books'));
  });
});

test('command line overrides win over the file', () => {
  withHome(() => {
    fs.writeFileSync(configPath(), JSON.stringify({ concurrency: 3 }));
    assert.equal(loadConfig({ concurrency: 9 }).concurrency, 9);
  });
});

test('saves and reloads the configuration', () => {
  withHome(() => {
    saveConfig({ outputDir: '/tmp/books', openAfter: false });
    const config = loadConfig();
    assert.equal(config.outputDir, path.resolve('/tmp/books'));
    assert.equal(config.openAfter, false);
  });
});

test('expands ~ in paths', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/x'), path.join(os.homedir(), 'x'));
  assert.equal(expandHome('/abs'), '/abs');
});

test('clamps the concurrency to a sane range', () => {
  withHome(() => {
    assert.equal(loadConfig({ concurrency: 0 }).concurrency, DEFAULTS.concurrency);
    assert.equal(loadConfig({ concurrency: 999 }).concurrency, 16);
  });
});
