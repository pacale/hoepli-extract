// Environment diagnostics.

import { log, formatBytes } from './util.mjs';
import { findBrowser, chromePath, readCookies, ensureBrowser, platformInfo } from './browser.mjs';
import { API_BASE } from './session.mjs';

export async function runDoctor({ launch = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    const mark = ok ? 'ok  ' : 'warn';
    console.log(`  [${mark}] ${name.padEnd(28)} ${detail ?? ''}`);
  };

  const info = platformInfo();
  console.log('');
  console.log(`  node      ${info.node} (${info.platform}/${info.arch})`);
  console.log(`  home      ${info.home}`);
  console.log('');

  add('chrome executable', !!info.chrome, info.chrome || 'not found (set HOEPLI_CHROME)');

  let browser = await findBrowser();
  if (!browser && launch) {
    try {
      browser = await ensureBrowser();
    } catch (e) {
      add('browser', false, e.message);
    }
  }
  add('devtools endpoint', !!browser, browser ? `http://127.0.0.1:${browser.port} (${browser.version?.Browser})` : 'no endpoint on 9222/9223/9333');

  if (browser) {
    try {
      const { names } = await readCookies(browser.port);
      add('session cookie', names.length > 0, names.length ? names.map((n) => n.split(' ')[1]).join(', ') : 'no platform cookie found');
    } catch (e) {
      add('session cookie', false, e.message);
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}/api/v6/user`, { signal: controller.signal });
    clearTimeout(timer);
    add('platform reachable', res.status < 500, `HTTP ${res.status} (401 means reachable but unauthenticated)`);
  } catch (e) {
    add('platform reachable', false, e.message);
  }

  try {
    const pkg = await import('pdf-lib');
    add('pdf-lib', typeof pkg.PDFDocument === 'function', 'installed');
  } catch (e) {
    add('pdf-lib', false, 'missing: run npm install');
  }

  console.log('');
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `  ${failed} check(s) need attention` : '  all checks passed');
  console.log('');
  return checks;
}
