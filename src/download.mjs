// Download and decrypt the page assets of a book.
//
// Every page is verified against the checksum published by the platform
// *before* it is written to disk, so a corrupted download can never end up in
// the merged PDF. Pages that keep failing are retried in a second, gentler
// pass and then reported.

import fs from 'node:fs';
import path from 'node:path';
import { log, formatBytes, sleep, md5 } from './util.mjs';
import { assetToPdf, looksLikePdf, DecryptError } from './decrypt.mjs';

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const PAGE_ATTEMPTS = 2;

export class PageError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // network | integrity | format | disk
  }
}

function isDiskError(e) {
  const code = e.code || e.errno;
  return code === 'ENOSPC' || code === 'EDQUOT' || code === 'EACCES' || code === 'EPERM';
}

/** Exponential backoff with jitter, so parallel workers do not retry in sync. */
export function backoffMs(attempt, base = 400, cap = 8000) {
  const raw = Math.min(cap, base * 2 ** attempt);
  return Math.round(raw * (0.6 + Math.random() * 0.8));
}

async function fetchWithRetry(url, { attempts = MAX_ATTEMPTS, timeoutMs = 60000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Referer: 'https://my.hoepliacademy.it/' },
        signal: controller.signal,
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const retryable = RETRYABLE.has(res.status);
      lastError = new PageError(`HTTP ${res.status}`, 'network');
      if (!retryable || attempt === attempts) throw lastError;
    } catch (e) {
      if (e instanceof PageError) lastError = e;
      else if (isDiskError(e)) throw new PageError(`disk error: ${e.code || e.message}`, 'disk');
      else lastError = new PageError(e.message || String(e), 'network');
      if (attempt === attempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    const wait = backoffMs(attempt);
    log.debug(`retry ${attempt}/${attempts - 1} in ${wait}ms (${lastError.message})`);
    await sleep(wait);
  }
  throw lastError;
}

/** Fetch, decrypt and verify one page. */
async function fetchVerifiedPage(page, key) {
  const raw = await fetchWithRetry(page.url);
  let pdf;
  let wasEncrypted = false;
  try {
    const converted = assetToPdf(raw, key);
    pdf = converted.pdf;
    wasEncrypted = converted.decrypted;
  } catch (e) {
    throw new PageError(e instanceof DecryptError ? e.message : String(e.message || e), 'format');
  }
  if (!looksLikePdf(pdf)) throw new PageError('payload is not a PDF', 'format');
  if (page.md5) {
    const digest = md5(pdf);
    if (digest !== page.md5) {
      throw new PageError(`md5 mismatch (expected ${page.md5}, got ${digest})`, 'integrity');
    }
  }
  return { pdf, wasEncrypted };
}

async function acquirePage(page, key, file) {
  let last = null;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      const { pdf, wasEncrypted } = await fetchVerifiedPage(page, key);
      fs.writeFileSync(file, pdf);
      return { pdf, attempts: attempt, wasEncrypted };
    } catch (e) {
      last = e;
      if (e.kind === 'disk') throw e;
      if (attempt < PAGE_ATTEMPTS) {
        log.debug(`page ${page.order} failed (${e.message}), retry ${attempt}`);
        await sleep(backoffMs(attempt));
      }
    }
  }
  throw last;
}

/**
 * Download every page of a book into `outDir`.
 *
 * @returns {{files: string[], failed: object[], bytes: number, md5ok: number,
 *            decrypted: number, resumed: number, retried: number}}
 */
export async function downloadPages({
  pages,
  outDir,
  key,
  concurrency = 6,
  keepPages = true,
  onProgress,
  extraPassConcurrency = 2,
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const failures = new Map();
  let bytes = 0;
  let md5ok = 0;
  let decrypted = 0;
  let resumed = 0;
  let retried = 0;
  let index = 0;
  let done = 0;

  const fileFor = (page) => path.join(outDir, `${String(page.order).padStart(5, '0')}.pdf`);

  async function worker(pool) {
    while (true) {
      const i = index++;
      if (i >= pool.length) return;
      const page = pool[i];
      const file = fileFor(page);
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 0) {
          // Resume: reuse the file only after checking it against the
          // checksum published by the platform, otherwise fetch it again.
          const existing = fs.readFileSync(file);
          if (!page.md5 || md5(existing) === page.md5) {
            files.push(file);
            bytes += existing.length;
            md5ok++;
            resumed++;
            done++;
            continue;
          }
          log.warn(`cached page ${page.order} does not match the published md5, refetching`);
          fs.rmSync(file, { force: true });
        }
        const { pdf, attempts, wasEncrypted } = await acquirePage(page, key, file);
        if (attempts > 1) retried++;
        if (wasEncrypted) decrypted++;
        files.push(file);
        bytes += pdf.length;
        md5ok++;
        done++;
        failures.delete(page.order);
        if (onProgress && done % 25 === 0) onProgress({ done, total: pages.length, bytes });
      } catch (e) {
        if (e.kind === 'disk') {
          log.error(`no space left while writing the pages: ${e.message}`);
          const fatal = new PageError(e.message, 'disk');
          fatal.fatal = true;
          throw fatal;
        }
        failures.set(page.order, {
          order: page.order,
          code: page.code,
          error: e.message,
          kind: e.kind || 'network',
        });
        log.warn(`page ${page.order} (${page.code}) failed: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker(pages)));

  // second, gentler pass for the pages that did not make it
  if (failures.size) {
    log.info(`retrying ${failures.size} failed page(s) with a lower concurrency`);
    const retryPool = [...failures.keys()]
      .map((order) => pages.find((p) => p.order === order))
      .filter(Boolean);
    index = 0;
    await Promise.all(Array.from({ length: Math.max(1, extraPassConcurrency) }, () => worker(retryPool)));
  }

  const failed = [...failures.values()].sort((a, b) => a.order - b.order);
  files.sort();
  if (onProgress) onProgress({ done, total: pages.length, bytes });
  if (!keepPages) {
    for (const f of files) fs.rmSync(f, { force: true });
  }
  return { files, failed, bytes, md5ok, decrypted, resumed, retried };
}
