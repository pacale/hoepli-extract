// Runtime capture of the asset decryption key.
//
// The web client assembles the AES key at runtime (it is not a literal in the
// bundle), so the only reliable way to obtain it is to observe the client
// while it decrypts an asset. The key travels to the crypto layer as a
// base64 string, therefore it is intercepted at `atob`.
//
// Every candidate is validated against a real page asset before it is used:
// a candidate is accepted only when it actually turns an encrypted container
// back into a PDF. That makes the capture robust against unrelated base64
// strings of the same length.

import { log, sleep } from './util.mjs';
import { attachPage, evaluate, closeTab } from './browser.mjs';
import { decryptAsset, looksLikePdf } from './decrypt.mjs';

const HOOK = `(() => {
  if (window.__hoepliKeyHook) return 'already-installed';
  window.__hoepliKeyHook = true;
  window.__hoepliKeys = [];
  const oAtob = window.atob;
  window.atob = function (s) {
    try {
      const out = oAtob.call(this, s);
      if (typeof out === 'string' && (out.length === 16 || out.length === 24 || out.length === 32)) {
        if (window.__hoepliKeys.indexOf(String(s)) < 0 && window.__hoepliKeys.length < 200) {
          window.__hoepliKeys.push(String(s));
        }
      }
    } catch (e) {}
    return oAtob.apply(this, arguments);
  };
  return 'hook-installed';
})()`;

export async function captureKey({ port, bookId, assetUrl, timeoutMs = 90000, attempts = 2 }) {
  const readerUrl = `https://my.hoepliacademy.it/#/books/${bookId}?page=1`;
  const { cdp, target, opened } = await attachPage(port, { url: readerUrl });
  try {
    // The hook must be in place before the application boots, so it is
    // registered for new documents and the page is then reloaded.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await cdp.send('Page.navigate', { url: readerUrl }).catch(() => {});
      await sleep(1200);
      // A hash-only navigation does not reload the document: force a real load
      // so the registered script runs against a fresh application instance.
      await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});

      const found = await waitForKeys(cdp, timeoutMs / attempts);
      if (found.length) {
        log.debug(`observed ${found.length} candidate key(s) in the client (attempt ${attempt})`);
        if (!assetUrl) return { key: found[0], source: 'runtime', validated: false };
        const validated = await validateCandidate(found, assetUrl);
        if (validated) return { key: validated, source: 'runtime', validated: true, candidates: found.length };
        throw new Error('none of the observed keys decrypts the page assets (unsupported asset format?)');
      }
      log.warn(`key not observed on attempt ${attempt}/${attempts}`);
    }
    throw new Error(
      'no decryption key observed: the reader did not decrypt any asset. ' +
        'Check that the session is signed in and licensed for this book.'
    );
  } finally {
    cdp.close();
    // Only close a tab we opened ourselves: closing somebody else's tab
    // would be rude, and closing the last tab quits the browser.
    if (opened) await closeTab(port, target.id).catch(() => {});
  }
}

async function waitForKeys(cdp, windowMs) {
  const deadline = Date.now() + windowMs;
  let candidates = [];
  while (Date.now() < deadline) {
    await sleep(700);
    try {
      const raw = await evaluate(cdp, 'JSON.stringify(window.__hoepliKeys || [])');
      candidates = raw ? JSON.parse(raw) : [];
    } catch {
      candidates = [];
    }
    if (candidates.length) return candidates;
  }
  return candidates;
}

async function validateCandidate(candidates, assetUrl) {
  const res = await fetch(assetUrl, { headers: { Referer: 'https://my.hoepliacademy.it/' } });
  if (!res.ok) throw new Error(`cannot fetch validation asset: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (looksLikePdf(buf)) return null; // not encrypted: no key needed
  for (const candidate of candidates) {
    try {
      const { pdf } = decryptAsset(buf, candidate);
      if (looksLikePdf(pdf)) return candidate;
    } catch {
      /* wrong key */
    }
  }
  return null;
}
