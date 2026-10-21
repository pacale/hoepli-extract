// Download and decrypt the page assets of a book.

import fs from 'node:fs';
import path from 'node:path';
import { log, formatBytes, sleep, md5 } from './util.mjs';
import { assetToPdf, looksLikePdf, DecryptError } from './decrypt.mjs';

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchWithRetry(url, { attempts = 4, timeoutMs = 60000 } = {}) {
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
      lastError = new Error(`HTTP ${res.status}`);
      if (!retryable || attempt === attempts) throw lastError;
    } catch (e) {
      lastError = e;
      if (attempt === attempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    const wait = Math.min(8000, 400 * 2 ** attempt);
    log.debug(`retry ${attempt}/${attempts - 1} in ${wait}ms (${lastError.message})`);
    await sleep(wait);
  }
  throw lastError;
}

/**
 * Download every page of a book into `outDir`.
 *
 * @returns {{files: string[], failed: object[], bytes: number, md5ok: number, decrypted: number}}
 */
export async function downloadPages({ pages, outDir, key, concurrency = 6, keepPages = true, onProgress }) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  const failed = [];
  let bytes = 0;
  let md5ok = 0;
  let decrypted = 0;
  let index = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= pages.length) return;
      const page = pages[i];
      const file = path.join(outDir, `${String(page.order).padStart(5, '0')}.pdf`);
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 0) {
          // Resume: reuse the file only after checking it against the
          // checksum published by the platform, otherwise fetch it again.
          const existing = fs.readFileSync(file);
          if (!page.md5 || md5(existing) === page.md5) {
            files.push(file);
            bytes += existing.length;
            md5ok++;
            done++;
            continue;
          }
          log.warn(`cached page ${page.order} does not match the published md5, refetching`);
          fs.rmSync(file, { force: true });
        }
        const raw = await fetchWithRetry(page.url);
        const { pdf, decrypted: wasEncrypted } = assetToPdf(raw, key);
        if (wasEncrypted) decrypted++;
        if (page.md5 && md5(pdf) === page.md5) md5ok++;
        if (!looksLikePdf(pdf)) throw new DecryptError('payload is not a PDF');
        fs.writeFileSync(file, pdf);
        files.push(file);
        bytes += pdf.length;
        done++;
        if (onProgress && done % 25 === 0) onProgress({ done, total: pages.length, bytes });
      } catch (e) {
        failed.push({ order: page.order, code: page.code, error: e.message });
        log.warn(`page ${page.order} (${page.code}) failed: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  files.sort();
  if (onProgress) onProgress({ done, total: pages.length, bytes });
  if (!keepPages) {
    for (const f of files) fs.rmSync(f, { force: true });
  }
  return { files, failed, bytes, md5ok, decrypted };
}
