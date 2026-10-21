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

export async function captureKey({ port, bookId, assetUrl, timeoutMs = 90000 }) {
  const readerUrl = `https://my.hoepliacademy.it/#/books/${bookId}?page=1`;
  const { cdp, target } = await attachPage(port, { url: readerUrl });
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    const current = await evaluate(cdp, 'location.href');
    if (current && current.includes(`books/${bookId}`)) {
      await cdp.send('Page.reload', { ignoreCache: true });
    } else {
      await cdp.send('Page.navigate', { url: readerUrl });
    }

    const deadline = Date.now() + timeoutMs;
    let candidates = [];
    while (Date.now() < deadline) {
      await sleep(700);
      try {
        candidates = (await evaluate(cdp, 'JSON.stringify(window.__hoepliKeys || [])')) || [];
        candidates = JSON.parse(candidates);
      } catch {
        candidates = [];
      }
      if (candidates.length) break;
    }
    if (!candidates.length) {
      throw new Error(
        'no decryption key observed: the reader did not decrypt any asset. ' +
          'Check that the session is signed in and licensed for this book.'
      );
    }
    log.debug(`observed ${candidates.length} candidate key(s) in the client`);

    if (!assetUrl) return { key: candidates[0], source: 'runtime', validated: false };
    const validated = await validateCandidate(candidates, assetUrl);
    if (!validated) {
      throw new Error('none of the observed keys decrypts the page assets (unsupported asset format?)');
    }
    return { key: validated, source: 'runtime', validated: true, candidates: candidates.length };
  } finally {
    cdp.close();
    await closeTab(port, target.id).catch(() => {});
  }
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
