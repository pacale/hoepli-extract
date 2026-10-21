// Benchmark harness: runs the export pipeline with instrumentation.
//
// It is deliberately written against the public surface of src/ (the same
// functions the CLI uses) so that the same file can measure two different
// revisions of the tool.
//
//   node test/bench/bench.mjs --pages 150 --runs 3 --out results.json
//
// Every run uses a clean cache, so the numbers of the two revisions are
// comparable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { listTargets } from '../../src/browser.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return acc;
  }, [])
);

const PAGES = Number(args.pages || 150);
const RUNS = Number(args.runs || 3);
const OUT = args.out || 'bench-results.json';
const LABEL = args.label || 'current';
const BOOK = Number(args.book || 4130);
const CONCURRENCY = Number(args.concurrency || 6);
const PORT = Number(args.port || 9222);

// ---- counters -------------------------------------------------------------
const counters = { requests: 0, bytesDownloaded: 0, responses: { ok: 0, error: 0, status: {} } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  counters.requests++;
  const res = await realFetch(...a);
  counters.responses.status[res.status] = (counters.responses.status[res.status] || 0) + 1;
  if (!res.ok) {
    counters.responses.error++;
    return res;
  }
  counters.responses.ok++;
  const clone = res.clone();
  try {
    const buf = await clone.arrayBuffer();
    counters.bytesDownloaded += buf.byteLength;
  } catch {
    /* not every response has a body */
  }
  return res;
};

// ---- memory sampling ------------------------------------------------------
let peakRss = 0;
const rssTimer = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
}, 150);

function chromeRssMb() {
  try {
    const marker = 'chrome-profile';
    if (process.platform === 'win32') {
      const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'chrome-rss.ps1');
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, marker],
        { encoding: 'utf8' }
      );
      return Number(out.trim()) || 0;
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-eo', 'rss=,command='], { encoding: 'utf8' });
      let kb = 0;
      for (const line of out.split('\n')) {
        if (line.includes(marker)) kb += Number(line.trim().split(/\s+/)[0] || 0);
      }
      return kb / 1024;
    }
    let kb = 0;
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
        if (!cmd.includes(marker)) continue;
        const statm = fs.readFileSync(`/proc/${entry}/statm`, 'utf8').split(' ');
        kb += Number(statm[1]) * 4;
      } catch {
        /* the process went away */
      }
    }
    return kb / 1024;
  } catch {
    return 0;
  }
}

function dirSizeMb(dir) {
  let bytes = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          bytes += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return bytes / 1048576;
}

// ---- pipeline -------------------------------------------------------------
const { ensureBrowser, readCookies } = await import('../../src/browser.mjs');
const { Session: ApiSession } = await import('../../src/session.mjs');
const { fetchBooks, fetchBookDetail, fetchRevision, fetchResources, fetchLinks, fetchIndex, buildManifest, buildToc } =
  await import('../../src/api.mjs');
const { captureKey } = await import('../../src/key.mjs');
const { downloadPages } = await import('../../src/download.mjs');
const { mergePages } = await import('../../src/merge.mjs');
const { verifyOutput } = await import('../../src/verify.mjs');

const home = process.env.HOEPLI_HOME || path.join(os.homedir(), '.hoepli-extract');
const workDir = path.join(home, 'work', String(BOOK));
const pagesDir = path.join(workDir, 'pages');
const outFile = path.join(home, 'bench', `bench-${BOOK}.pdf`);

async function runOnce(index) {
  // identical starting conditions for every revision
  fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(outFile, { force: true });

  const phases = {};
  const mark = async (name, fn) => {
    const t0 = performance.now();
    const value = await fn();
    phases[name] = Math.round(performance.now() - t0);
    return value;
  };

  const chromeBefore = chromeRssMb();
  counters.requests = 0;
  counters.bytesDownloaded = 0;

  const browser = await mark('browser', () => ensureBrowser({ port: PORT, url: 'https://my.hoepliacademy.it/' }));
  const { header } = await mark('cookies', () => readCookies(browser.port));
  const session = await mark('session', () => ApiSession.fromCookieHeader(header));
  const books = await mark('library', () => fetchBooks(session));
  const detail = await mark('detail', () => fetchBookDetail(session, BOOK));
  const revision = await mark('revision', () => fetchRevision(session, BOOK, detail));
  const resources = await mark('resources', () => fetchResources(session, BOOK, revision));
  const links = await mark('links', () => fetchLinks(session, BOOK, revision));
  const index_ = await mark('index', () => fetchIndex(session, BOOK, revision));
  const manifest = buildManifest({ resources, links });
  const toc = buildToc(index_, manifest.pages);
  const pages = manifest.pages.slice(0, PAGES);

  const key = await mark('key_capture', () => captureKey({ port: browser.port, bookId: BOOK, assetUrl: pages[0]?.url }));

  const download = await mark('download', () =>
    downloadPages({ pages, outDir: pagesDir, key: key.key, concurrency: CONCURRENCY, keepPages: true })
  );
  const merge = await mark('merge', () =>
    mergePages({
      files: download.files,
      outFile,
      toc: toc.filter((t) => t.page <= PAGES),
      metadata: { title: detail.title, author: 'bench' },
    })
  );
  const verification = await mark('verify', () =>
    verifyOutput({ file: outFile, expectedPages: merge.pages, expectOutline: null })
  );

  const chromeAfter = chromeRssMb();
  const runPeakRss = peakRss;
  peakRss = 0;

  return {
    run: index + 1,
    phases,
    total_ms: Object.values(phases).reduce((a, b) => a + b, 0),
    peak_rss_mb: +(runPeakRss / 1048576).toFixed(1),
    chrome_rss_before_mb: +chromeBefore.toFixed(1),
    chrome_rss_after_mb: +chromeAfter.toFixed(1),
    pages: pages.length,
    pages_failed: download.failed.length,
    md5_verified: download.md5ok,
    bytes_downloaded: counters.bytesDownloaded,
    http_requests: counters.requests,
    http_status: counters.responses.status,
    artifact_mb: +(fs.statSync(outFile).size / 1048576).toFixed(2),
    cache_mb: +dirSizeMb(pagesDir).toFixed(2),
    verified: verification.ok,
  };
}

// ---- go -------------------------------------------------------------------
const targets = await listTargets(PORT).catch(() => []);
if (!targets.length) console.log(`(nessun browser su :${PORT}, verrà avviato dal tool)`);

const runs = [];
for (let i = 0; i < RUNS; i++) {
  process.stdout.write(`run ${i + 1}/${RUNS} ... `);
  const r = await runOnce(i);
  runs.push(r);
  console.log(`${(r.total_ms / 1000).toFixed(1)}s  peak=${r.peak_rss_mb}MB  chrome=${r.chrome_rss_before_mb}->${r.chrome_rss_after_mb}MB`);
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const summary = {
  label: LABEL,
  pages: PAGES,
  runs: RUNS,
  concurrency: CONCURRENCY,
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  median_total_s: +(median(runs.map((r) => r.total_ms)) / 1000).toFixed(1),
  median_phases_s: Object.fromEntries(
    Object.keys(runs[0].phases).map((k) => [k, +(median(runs.map((r) => r.phases[k])) / 1000).toFixed(1)])
  ),
  median_peak_rss_mb: median(runs.map((r) => r.peak_rss_mb)),
  median_chrome_rss_before_mb: median(runs.map((r) => r.chrome_rss_before_mb)),
  median_chrome_rss_after_mb: median(runs.map((r) => r.chrome_rss_after_mb)),
  median_http_requests: median(runs.map((r) => r.http_requests)),
  median_bytes_downloaded: median(runs.map((r) => r.bytes_downloaded)),
  median_artifact_mb: median(runs.map((r) => r.artifact_mb)),
  median_cache_mb: median(runs.map((r) => r.cache_mb)),
  pages_failed: median(runs.map((r) => r.pages_failed)),
  md5_verified: median(runs.map((r) => r.md5_verified)),
  runs,
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
clearInterval(rssTimer);
console.log('');
console.log(JSON.stringify({ ...summary, runs: undefined }, null, 2));
console.log(`\nscritto in ${OUT}`);
process.exit(0);
