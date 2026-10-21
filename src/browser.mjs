// Chrome DevTools Protocol helper and Chrome bootstrap.
//
// The tool reuses a browser that already exposes a debugging endpoint
// (http://127.0.0.1:9222 by default). If none is reachable it starts its own
// Chrome instance with a dedicated profile, so the user's everyday browser is
// never touched. The session cookie is read from the browser, never stored.

import { spawn, execFileSync } from 'node:child_process';import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log, homeDir, ensureDir, sleep } from './util.mjs';

const DEFAULT_PORTS = [9222, 9223, 9333];

export class CdpError extends Error {}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new CdpError(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) {
          try {
            fn(msg.params);
          } catch {
            /* listener errors must not break the session */
          }
        }
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new CdpError('CDP connection closed'));
      this.pending.clear();
    });
  }

  static async connect(wsUrl, timeoutMs = 15000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError('CDP connect timeout')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new CdpError(`CDP connect failed: ${e.message || 'websocket error'}`));
      }, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 120000) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new CdpError(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

async function httpJson(port, route, { method = 'GET', timeout = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function chromeCandidates() {
  const list = [];
  if (process.env.HOEPLI_CHROME) list.push(process.env.HOEPLI_CHROME);
  const roots = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/var/lib/flatpak/exports/bin/com.google.Chrome',
    '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
  ];
  for (const p of roots) if (fs.existsSync(p)) list.push(p);
  return list;
}

export async function findBrowser(ports = DEFAULT_PORTS) {
  for (const port of ports) {
    try {
      const version = await httpJson(port, '/json/version');
      log.debug(`CDP alive on :${port} (${version.Browser})`);
      return { port, version, owned: false };
    } catch {
      /* try next port */
    }
  }
  return null;
}

export async function launchBrowser({ port = 9222, profileDir, headless = false, url = null } = {}) {
  const exe = chromeCandidates()[0];
  if (!exe) throw new Error('no Chrome executable found; set HOEPLI_CHROME');
  const dir = ensureDir(profileDir || path.join(homeDir(), 'chrome-profile'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints',
  ];
  if (headless) args.push('--headless=new');
  if (url) args.push(url);
  log.info(`starting a dedicated Chrome instance on :${port} (profile ${dir})`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const version = await httpJson(port, '/json/version');
      return { port, version, owned: true, pid: child.pid, profileDir: dir };
    } catch {
      /* keep waiting */
    }
  }
  throw new Error(`Chrome did not expose a debugging port on :${port}`);
}

export async function ensureBrowser(options = {}) {
  const found = await findBrowser(options.ports || DEFAULT_PORTS);
  if (found) return found;
  return launchBrowser({ url: options.url ?? 'https://my.hoepliacademy.it/', ...options });
}
/** Browser-level WebSocket URL, used for cookie access. */
export async function browserWsUrl(port) {
  const version = await httpJson(port, '/json/version');
  if (!version.webSocketDebuggerUrl) throw new Error('browser websocket URL unavailable');
  return version.webSocketDebuggerUrl;
}

/** Read cookies of the platform domains, formatted as a Cookie header. */
export async function readCookies(port, domains = ['hoepliacademy.it']) {
  const cdp = await Cdp.connect(await browserWsUrl(port));
  try {
    const { cookies } = await cdp.send('Storage.getCookies');
    const wanted = cookies.filter((c) => domains.some((d) => c.domain.replace(/^\./, '').endsWith(d)));
    return {
      header: wanted.map((c) => `${c.name}=${c.value}`).join('; '),
      names: wanted.map((c) => `${c.domain} ${c.name}`),
    };
  } finally {
    cdp.close();
  }
}

export async function listTargets(port) {
  return httpJson(port, '/json/list');
}

/** Ask the browser to quit (only ever used for an instance we started). */
export async function closeBrowser(port) {
  try {
    const cdp = await Cdp.connect(await browserWsUrl(port));
    await cdp.send('Browser.close');
    cdp.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * The --user-data-dir of the browser listening on the port, when it can be
 * detected. Used to warn when the tool attaches to somebody else's browser
 * (a different profile means different cookies).
 */
export async function attachedProfile(port) {
  const marker = '--user-data-dir';
  try {
    if (process.platform === 'win32') {
      const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'browser-profile.ps1');
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(port)],
        { encoding: 'utf8' }
      );
      return out.trim() || null;
    }
    const list = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    for (const line of list.split('\n')) {
      if (line.includes(marker) && line.includes(`remote-debugging-port=${port}`)) {
        const i = line.indexOf(marker);
        return line.slice(i + marker.length).trim().split(/\s+/)[0] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open tab: HTTP ${res.status}`);
  return res.json();
}

export async function closeTab(port, targetId) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
  } catch {
    /* best effort */
  }
}

/** Find (or create) a page target and attach to it. */
export async function attachPage(port, { url } = {}) {
  const targets = await listTargets(port);
  let target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  let opened = false;
  if (!target && url) {
    target = await openTab(port, url);
    opened = true;
  }
  if (!target) throw new Error('no page target available');
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, target, opened };
}

export async function evaluate(cdp, expression, { awaitPromise = true } = {}) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (res.exceptionDetails) {
    throw new CdpError(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate failed');
  }
  return res.result?.value;
}

/** Locate the chrome executable for diagnostics. */
export function chromePath() {
  return chromeCandidates()[0] || null;
}

export function platformInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    home: homeDir(),
    chrome: chromePath(),
    curlAvailable: (() => {
      try {
        execFileSync('curl', ['--version'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })(),
  };
}
