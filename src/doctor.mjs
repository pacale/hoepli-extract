// Environment diagnostics: tells whether the tool is ready to export, and
// what to do when it is not.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { log, formatBytes, homeDir } from './util.mjs';
import { findBrowser, chromePath, readCookies, ensureBrowser, platformInfo, attachedProfile } from './browser.mjs';
import { API_BASE, Session } from './session.mjs';

const DOWNLOAD_LINKS = {
  win32: 'https://www.google.com/chrome/',
  darwin: 'https://www.google.com/chrome/',
  linux: 'https://www.google.com/chrome/ (or: sudo apt install chromium)',
};

function check(name, ok, detail, hint) {
  return { name, ok, detail, hint };
}

export async function runDoctor({ launch = false, deep = false, port = 9222 } = {}) {
  const checks = [];
  const info = platformInfo();
  console.log('');
  console.log(`  node      ${info.node} (${info.platform}/${info.arch})`);
  console.log(`  home      ${info.home}`);
  console.log('');

  // 1. node
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;
  checks.push(
    check('node version', nodeOk, `${info.node}${nodeOk ? '' : ' (too old)'}`,
      nodeOk ? null : 'https://nodejs.org/en/download (>= 20.6)')
  );

  // 2. chrome
  const chrome = chromePath();
  checks.push(
    check('chrome', !!chrome, chrome || 'not found', chrome ? null : DOWNLOAD_LINKS[info.platform] || DOWNLOAD_LINKS.linux)
  );

  // 3. devtools endpoint (informational: the tool starts its own browser)
  let browser = await findBrowser();
  if (!browser && launch) {
    try {
      browser = await ensureBrowser({ port });
    } catch (e) {
      checks.push(check('browser', false, e.message, 'check that Chrome can be started'));
    }
  }
  checks.push(
    check(
      'devtools endpoint',
      true,
      browser ? `http://127.0.0.1:${browser.port} (${browser.version?.Browser})` : 'none running, the tool will start one',
      null
    )
  );

  // 4. session
  let session = null;
  if (browser) {
    try {
      const { header, names } = await readCookies(browser.port);
      const sessionCookies = names.filter((n) => /session|remember|token/i.test(n));
      if (!sessionCookies.length) {
        checks.push(check('session', false, 'no session cookie in the browser', 'sign in on https://my.hoepliacademy.it/'));
      } else {
        const candidate = await Session.fromCookieHeader(header).catch((e) => {
          checks.push(check('session', false, e.message, 'sign in on https://my.hoepliacademy.it/'));
          return null;
        });
        if (candidate) {
          session = candidate;
          const profile = await attachedProfile(browser.port).catch(() => null);
          const ours = path.join(homeDir(), 'chrome-profile');
          const sameProfile = !profile || path.resolve(profile) === path.resolve(ours);
          checks.push(
            check('session', sameProfile, sameProfile ? 'valid' : `valid, but the browser uses another profile (${profile})`,
              sameProfile ? null : 'run "hoepli doctor --launch" to use the browser of the tool')
          );
        }
      }
    } catch (e) {
      checks.push(check('session', false, e.message, null));
    }
  }

  // 5. platform reachable (with the session, when we have one)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const headers = session ? session.headers() : { Accept: 'application/json' };
    const res = await fetch(`${API_BASE}/api/v6/user`, { headers, signal: controller.signal });
    clearTimeout(timer);
    checks.push(
      check('platform', res.status < 500, `HTTP ${res.status}${session ? ' (authenticated)' : ' (anonymous)'}`,
        res.status >= 500 ? 'try again later' : null)
    );
  } catch (e) {
    checks.push(check('platform', false, e.message, 'check the network, the proxy or the firewall'));
  }

  // 6. the export chain (optional, needs a session and a book)
  if (deep && session) {
    try {
      const { fetchBooks, fetchBookDetail, fetchRevision, fetchResources, fetchLinks, buildManifest } = await import('./api.mjs');
      const { captureKey } = await import('./key.mjs');
      const books = await fetchBooks(session);
      if (!books.length) {
        checks.push(check('export chain', false, 'your library is empty', null));
      } else {
        const book = books[0];
        const detail = await fetchBookDetail(session, book.id);
        const revision = await fetchRevision(session, book.id, detail);
        const [resources, links] = await Promise.all([
          fetchResources(session, book.id, revision),
          fetchLinks(session, book.id, revision),
        ]);
        const manifest = buildManifest({ resources, links });
        const asset = manifest.pages[0]?.url;
        const key = await captureKey({ port: browser.port, bookId: book.id, assetUrl: asset });
        checks.push(
          check('export chain', Boolean(key.validated),
            key.validated ? 'session, key and decryption all work' : 'the key was observed but did not decrypt a page',
            key.validated ? null : 'the platform may have changed the asset format')
        );
      }
    } catch (e) {
      checks.push(check('export chain', false, e.message, 'the export would fail right now'));
    }
  }

  // 7. platform tools
  if (info.platform === 'linux') {
    const has = await new Promise((r) => {
      const p = spawn('which', ['xdg-open']);
      p.on('close', (code) => r(code === 0));
      p.on('error', () => r(false));
    });
    checks.push(check('xdg-open', has, has ? 'available' : 'missing', has ? null : 'sudo apt install xdg-utils'));
  }

  // 8. pdf-lib
  try {
    const pkg = await import('pdf-lib');
    checks.push(check('pdf-lib', typeof pkg.PDFDocument === 'function', 'installed',
      'run npm install in the folder of the tool'));
  } catch {
    checks.push(check('pdf-lib', false, 'missing', 'run npm install in the folder of the tool'));
  }

  // 9. output folder
  const outDir = process.env.HOEPLI_OUT_DIR || path.join(os.homedir(), 'Downloads');
  let writable = false;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const probe = path.join(outDir, '.hoepli-write-test');
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push(check('output folder', writable, outDir, writable ? null : 'choose another folder with "hoepli config set outputDir ..."'));

  // print
  for (const c of checks) {
    const mark = c.ok ? 'ok  ' : 'warn';
    console.log(`  [${mark}] ${c.name.padEnd(18)} ${c.detail ?? ''}`);
    if (!c.ok && c.hint) console.log(`         -> ${c.hint}`);
  }
  console.log('');
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.log(`  ${failed.length} check(s) need attention, the export would not work yet`);
    console.log('');
  } else {
    console.log('  everything is ready: run "hoepli"');
    console.log('');
  }
  return checks;
}
