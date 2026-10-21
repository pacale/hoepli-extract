// A simple lock file, so two runs of the tool on the same book do not write
// into the same cache at the same time.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, log } from './util.mjs';

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Acquire the lock for a directory.
 * @returns {{release: () => void, path: string, stale: boolean}}
 */
export async function acquireLock(dir, { timeoutMs = 5000 } = {}) {
  ensureDir(dir);
  const file = path.join(dir, '.lock');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      return {
        path: file,
        stale: false,
        release() {
          try {
            fs.rmSync(file, { force: true });
          } catch {
            /* already gone */
          }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try {
        owner = Number(String(fs.readFileSync(file, 'utf8')).split('\n')[0]);
      } catch {
        owner = null;
      }
      if (owner && !isAlive(owner)) {
        log.warn(`removing a stale lock left by pid ${owner}`);
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `another run is using this cache (lock ${file}, pid ${owner ?? 'unknown'}). ` +
            'Wait for it to finish or remove the lock file.'
        );
      }
      const wait = new Promise((r) => setTimeout(r, 250));
      await wait;
    }
  }
}
