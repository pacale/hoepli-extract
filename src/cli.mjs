// Command line interface.

import fs from 'node:fs';
import path from 'node:path';
import { log, setLogLevel, safeName, formatBytes, homeDir } from './util.mjs';
import { ensureBrowser, readCookies, openTab, chromePath } from './browser.mjs';
import { Session, SessionError } from './session.mjs';
import { fetchBooks, fetchBookDetail, fetchRevision, fetchResources, fetchLinks, fetchIndex, buildManifest, buildToc } from './api.mjs';
import { captureKey } from './key.mjs';
import { downloadPages } from './download.mjs';
import { mergePages } from './merge.mjs';
import { verifyOutput } from './verify.mjs';
import { buildReport, printSummary, writeReport } from './report.mjs';
import { runDoctor } from './doctor.mjs';

const VERSION = '0.1.0';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=');
      const next = argv[i + 1];
      if (inline !== undefined) args[key] = inline;
      else if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(`
hoepli ${VERSION} — download the pages of a book you are licensed to read on
HoepliAcademy+ and merge them into a single vector PDF.

Usage
  hoepli doctor [--launch]                 check the environment
  hoepli books [--json]                    list the books of your account
  hoepli info <bookId> [--json]            show metadata and the page plan
  hoepli key [--book <bookId>]              show the key the client uses
  hoepli book <bookId> --out <file.pdf>    download, merge and verify

Common options
  --out <file>        output PDF (default: ./<title>.pdf)
  --pages <a-b>       only export pages in that range
  --concurrency <n>   parallel asset downloads (default 6)
  --aes-key <base64>  use this key instead of capturing it at runtime
  --cookie <string>   session cookie (otherwise read from the browser)
  --token <string>    AUTH_TOKEN (otherwise read from the account)
  --port <n>          devtools port to use (default 9222)
  --no-toc            do not build the outline
  --no-merge          keep the single page files, skip merging
  --keep-pages        keep the single page files next to the output
  --strict            fail if any page is missing
  --json              machine readable output
  --report <file>     write the JSON report
  --log-level <lvl>   debug | info | warn | error | silent

Environment
  HOEPLI_AES_KEY      default AES key
  HOEPLI_COOKIE       default session cookie
  HOEPLI_TOKEN        default AUTH_TOKEN
  HOEPLI_CHROME       Chrome executable to use
  HOEPLI_HOME         state directory (default ~/.hoepli-extract)
`);
}

async function resolveSession(args, { needBrowser = true } = {}) {
  const cookie = args.cookie || process.env.HOEPLI_COOKIE;
  const token = args.token || process.env.HOEPLI_TOKEN;
  if (cookie) return { session: await Session.fromCredentials({ cookie, token }), browser: null };
  if (!needBrowser) throw new SessionError('no session: pass --cookie or run with a browser available');
  const port = Number(args.port || 9222);
  const browser = await ensureBrowser({ port, url: 'https://my.hoepliacademy.it/' });
  const { header, names } = await readCookies(browser.port);
  if (!header) {
    await openTab(browser.port, 'https://my.hoepliacademy.it/').catch(() => {});
    throw new SessionError(
      'no HoepliAcademy+ session cookie in the browser. A Chrome window has been opened ' +
        'on the sign-in page: sign in there and run the command again.'
    );
  }
  log.debug(`using ${names.length} platform cookie(s) from :${browser.port}`);
  let session;
  try {
    session = await Session.fromCookieHeader(header);
  } catch (e) {
    if (e.status === 401) {
      await openTab(browser.port, 'https://my.hoepliacademy.it/').catch(() => {});
      throw new SessionError(
        'the browser session is not signed in. A Chrome window has been opened on the ' +
          'sign-in page: sign in there and run the command again.'
      );
    }
    throw e;
  }
  return { session, browser };
}

async function cmdDoctor(args) {
  await runDoctor({ launch: !!args.launch });
}

async function cmdBooks(args) {
  const { session } = await resolveSession(args);
  const books = await fetchBooks(session);
  if (args.json) {
    console.log(JSON.stringify(books, null, 2));
    return;
  }
  console.log('');
  for (const b of books) {
    console.log(
      `  ${String(b.id).padEnd(7)} ${String(b.page_count ?? '?').padStart(4)} pp  ` +
        `${b.typology ?? '?'}  ${b.title}${b.author ? ` — ${b.author}` : ''}`
    );
  }
  console.log(`\n  ${books.length} book(s)\n`);
}

async function loadBookPlan(session, bookId) {
  const detail = await fetchBookDetail(session, bookId);
  const revision = await fetchRevision(session, bookId, detail);
  const [resources, links, index] = await Promise.all([
    fetchResources(session, bookId, revision),
    fetchLinks(session, bookId, revision),
    fetchIndex(session, bookId, revision),
  ]);
  const manifest = buildManifest({ resources, links });
  const toc = buildToc(index, manifest.pages);
  const book = {
    id: detail.id ?? bookId,
    title: detail.title ?? `book-${bookId}`,
    author: Array.isArray(detail.authors)
      ? detail.authors.map((a) => [a.name, a.surname].filter(Boolean).join(' ')).join(', ')
      : null,
    publisher: detail.brand?.publisher?.name ?? detail.brand?.name ?? null,
    revision,
    page_count: detail.page_count ?? null,
    typology: detail.book_typology ?? null,
    liquid_text: detail.liquid_text ?? null,
  };
  return { book, manifest: { ...manifest, toc }, detail };
}

async function cmdInfo(args) {
  const bookId = Number(args._[1]);
  if (!bookId) throw new Error('usage: hoepli info <bookId>');
  const { session } = await resolveSession(args);
  const { book, manifest } = await loadBookPlan(session, bookId);
  const plan = {
    book,
    pages: manifest.pages.length,
    pages_without_asset: manifest.missing.length,
    standalone_assets: manifest.standalone.length,
    toc_entries: manifest.toc.length,
    first_pages: manifest.pages.slice(0, 5).map((p) => ({ order: p.order, title: p.title, bytes: p.size })),
  };
  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log('');
  console.log(`  ${book.title}${book.author ? ` — ${book.author}` : ''}`);
  console.log(`  id ${book.id}  revision ${book.revision}  typology ${book.typology}  liquid_text ${book.liquid_text}`);
  console.log(`  ${plan.pages} downloadable pages, ${plan.toc_entries} outline entries`);
  if (plan.pages_without_asset) console.log(`  ${plan.pages_without_asset} page resources without a PDF asset`);
  console.log('');
}

async function cmdKey(args) {
  const bookId = Number(args.book || args._[1] || 4130);
  const port = Number(args.port || 9222);
  const browser = await ensureBrowser({ port });
  let assetUrl = null;
  try {
    const { session } = await resolveSession({ ...args, port });
    const { manifest } = await loadBookPlan(session, bookId);
    assetUrl = manifest.pages[0]?.url ?? null;
  } catch (e) {
    log.warn(`cannot resolve a page asset (${e.message}); capturing without validation`);
  }
  const { key, source, validated } = await captureKey({ port: browser.port, bookId, assetUrl });
  console.log(key);
  console.error(`source: ${source}${validated ? ' (validated against a page asset)' : ' (not validated)'}`);
}

async function cmdBook(args) {
  const startedAt = Date.now();
  const bookId = Number(args._[1]);
  if (!bookId) throw new Error('usage: hoepli book <bookId> --out <file.pdf>');
  if (args['log-level']) setLogLevel(args['log-level']);

  const { session, browser } = await resolveSession(args);
  const { book, manifest } = await loadBookPlan(session, bookId);
  log.info(`${book.title} — revision ${book.revision}, ${manifest.pages.length} pages`);

  const warnings = [];
  if (book.liquid_text) {
    warnings.push('this book is published as liquid text: there are no PDF assets to export');
  }
  if (!manifest.pages.length) {
    if (manifest.standalone.length === 1) {
      warnings.push('the book is served as a single PDF asset');
      return await exportStandalone({ args, book, manifest, session, browser, startedAt, warnings });
    }
    throw new Error('no PDF page assets found for this book (unsupported typology or no licence?)');
  }
  if (manifest.missing.length) {
    warnings.push(`${manifest.missing.length} page resources have no PDF asset (teacher pages or not licensed)`);
  }

  let pages = manifest.pages;
  if (args.pages) {
    const [from, to] = String(args.pages).split('-').map((n) => Number(n));
    pages = pages.filter((p) => p.order >= from && (!to || p.order <= to));
    log.info(`restricted to pages ${args.pages} (${pages.length} files)`);
  }

  const key = args['aes-key'] || process.env.HOEPLI_AES_KEY || null;
  let keyInfo = key ? { key, source: 'provided', validated: false } : null;
  if (!key) {
    if (!browser) throw new Error('no browser available to capture the decryption key; pass --aes-key');
    const port = Number(args.port || 9222);
    log.info('capturing the decryption key from the running client');
    keyInfo = await captureKey({ port, bookId, assetUrl: pages[0]?.url });
  }

  const workDir = path.join(homeDir(), 'work', String(bookId));
  const pagesDir = path.join(workDir, 'pages');
  const download = await downloadPages({
    pages,
    outDir: pagesDir,
    key: keyInfo.key,
    concurrency: Number(args.concurrency || 6),
    keepPages: true,
    onProgress: ({ done, total, bytes }) => log.info(`downloaded ${done}/${total} pages (${formatBytes(bytes)})`),
  });

  const outFile = path.resolve(
    args.out || path.join(process.cwd(), `${safeName(book.title)}-${book.id}.pdf`)
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  let merge = null;
  if (!args['no-merge']) {
    const toc = args['no-toc'] ? [] : manifest.toc;
    merge = await mergePages({
      files: download.files,
      outFile,
      toc,
      metadata: {
        title: book.title,
        author: book.author,
        subject: `HoepliAcademy+ book ${book.id} (revision ${book.revision})`,
        keywords: ['hoepli', 'ebook', 'offline'],
        creator: 'hoepli-extract',
      },
      onProgress: ({ done, total }) => log.info(`merged ${done}/${total}`),
    });
    log.info(`merged ${merge.pages} pages -> ${outFile} (${formatBytes(merge.bytes)})`);
  } else {
    fs.copyFileSync(download.files[0] ?? '', outFile);
  }

  const verification = await verifyOutput({
    file: outFile,
    expectedPages: args['no-merge'] ? null : merge?.pages,
    expectOutline: args['no-toc'] || args['no-merge'] ? null : merge?.outline,
  });

  if (!args['keep-pages'] && !args['no-merge']) {
    fs.rmSync(pagesDir, { recursive: true, force: true });
  }

  const report = buildReport({
    book,
    session,
    key: keyInfo,
    manifest,
    download,
    merge,
    verification,
    output: outFile,
    startedAt,
    warnings,
  });
  printSummary(report);
  writeReport(report, args.report);

  if (args.strict && download.failed.length) {
    log.error(`strict mode: ${download.failed.length} page(s) failed`);
    process.exitCode = 2;
  } else if (download.failed.length) {
    process.exitCode = 2;
  } else if (!verification.ok) {
    process.exitCode = 2;
  }
}

async function exportStandalone({ args, book, manifest, session, browser, startedAt, warnings }) {
  const asset = manifest.standalone[0];
  const { downloadPages } = await import('./download.mjs');
  const key = args['aes-key'] || process.env.HOEPLI_AES_KEY || null;
  if (!key) {
    const port = Number(args.port || 9222);
    const keyInfo = await captureKey({ port, bookId: book.id, assetUrl: asset.url });
    var keyUsed = keyInfo.key;
  } else {
    var keyUsed = key;
  }
  const outFile = path.resolve(args.out || path.join(process.cwd(), `${safeName(book.title)}-${book.id}.pdf`));
  const res = await downloadPages({
    pages: [{ ...asset, order: 1 }],
    outDir: path.join(homeDir(), 'work', String(book.id), 'pages'),
    key: keyUsed,
    concurrency: 1,
  });
  if (res.files.length) fs.copyFileSync(res.files[0], outFile);
  const report = buildReport({
    book,
    session,
    key: { source: key ? 'provided' : 'runtime' },
    manifest: { ...manifest, toc: [] },
    download: res,
    merge: null,
    verification: await verifyOutput({ file: outFile }),
    output: outFile,
    startedAt,
    warnings,
  });
  printSummary(report);
  writeReport(report, args.report);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'help';
  if (args.version || command === 'version' || command === '--version') {
    console.log(VERSION);
    return;
  }
  if (args.help || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  try {
    switch (command) {
      case 'doctor':
        return await cmdDoctor(args);
      case 'books':
        return await cmdBooks(args);
      case 'info':
        return await cmdInfo(args);
      case 'key':
        return await cmdKey(args);
      case 'book':
        return await cmdBook(args);
      default:
        usage();
        process.exitCode = 1;
    }
  } catch (e) {
    log.error(e.message);
    if (process.env.HOEPLI_LOG_LEVEL === 'debug') console.error(e.stack);
    process.exitCode = 1;
  }
}
