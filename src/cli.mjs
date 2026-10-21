// Command line interface.

import fs from 'node:fs';
import path from 'node:path';
import { log, setLogLevel, safeName, safeText, formatBytes, homeDir } from './util.mjs';
import { ensureBrowser, readCookies, openTab, listTargets, chromePath } from './browser.mjs';
import { Session, SessionError, waitForAuthentication, READER_BASE } from './session.mjs';
import {
  fetchBooks,
  fetchBookDetail,
  fetchRevision,
  fetchResources,
  fetchLinks,
  fetchIndex,
  buildManifest,
  buildToc,
} from './api.mjs';
import { resolveBook, closestTitles } from './resolve.mjs';
import { captureKey } from './key.mjs';
import { downloadPages } from './download.mjs';
import { mergePages } from './merge.mjs';
import { verifyOutput } from './verify.mjs';
import { buildReport, printSummary, writeReport } from './report.mjs';
import { runDoctor } from './doctor.mjs';
import { loadConfig, saveConfig, describeConfig, configPath } from './config.mjs';
import { confirm, pickBook, isInteractive, openFile } from './prompt.mjs';
import { createProgress } from './progress.mjs';
import { runInstall, runUninstall, repoRoot } from './install.mjs';

const VERSION = '0.2.0';

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
hoepli ${VERSION} — export the books you are licensed to read on
HoepliAcademy+ as a single vector PDF.

Usage
  hoepli                              interactive menu (list, pick, export)
  hoepli book <id|titolo>             export one book
  hoepli books [--json]               list the books of your account
  hoepli info <id|titolo> [--json]    metadata and page plan, nothing downloaded
  hoepli key [--book <id>]            show the key the client uses
  hoepli doctor [--launch]            check the environment
  hoepli install | uninstall          global command, shortcut, configuration
  hoepli config [key [value]]         show or change the configuration

Options
  --out <file>        output PDF (default: <outputDir>/<title> - <author>.pdf)
  --out-dir <dir>     output folder (default: ~/Downloads)
  --pages <a-b>       export only that range of pages
  --concurrency <n>   parallel asset downloads (default 6)
  --aes-key <base64>  use this key instead of capturing it at runtime
  --cookie <string>   session cookie (otherwise read from the browser)
  --token <string>    AUTH_TOKEN (otherwise read from the account)
  --port <n>          DevTools port to use (default 9222)
  --headless          start the dedicated browser without a window (servers)
  --open / --no-open  open the PDF when the export finishes
  --yes               do not ask for confirmation
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

function configFromArgs(args) {
  const overrides = {};
  if (args['out-dir']) overrides.outputDir = args['out-dir'];
  if (args.concurrency) overrides.concurrency = Number(args.concurrency);
  if (args.port) overrides.port = Number(args.port);
  if (args['no-open']) overrides.openAfter = false;
  if (args.open) overrides.openAfter = true;
  return loadConfig(overrides);
}

/** Build a session, waiting for the user to sign in when necessary. */
async function resolveSession(args, config, { needBrowser = true } = {}) {
  const cookie = args.cookie || process.env.HOEPLI_COOKIE;
  const token = args.token || process.env.HOEPLI_TOKEN;
  if (cookie) return { session: await Session.fromCredentials({ cookie, token }), browser: null };
  if (!needBrowser) throw new SessionError('no session: pass --cookie or run with a browser available');

  const port = config.port;
  const browser = await ensureBrowser({
    port,
    url: `${READER_BASE}/`,
    headless: Boolean(args.headless),
  });
  const probe = async () => {
    const { header } = await readCookies(browser.port);
    if (!header) return null;
    return Session.fromCookieHeader(header);
  };

  let session = null;
  try {
    session = await probe();
  } catch (e) {
    if (e.status && e.status !== 401) throw e;
  }
  if (session) return { session, browser };

  log.info('nessuna sessione valida: preparo la finestra di accesso');
  await openTab(browser.port, `${READER_BASE}/`).catch(() => {});
  if (!isInteractive() && !args.yes) {
    throw new SessionError(
      'the browser session is not signed in and there is no interactive terminal to wait in. ' +
        'Open a browser, sign in on my.hoepliacademy.it and run the command again.'
    );
  }
  session = await waitForAuthentication({
    timeoutSec: config.waitLoginSec,
    probe,
    onTick: (attempt, remaining) => {
      if (attempt % 3 === 1) console.log(`  accesso in corso… (${remaining}s rimanenti)`);
    },
  });
  log.info('sessione valida, procedo');
  return { session, browser };
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

function outputFileFor(book, config, args) {
  if (args.out) return path.resolve(args.out);
  const title = safeName(book.title);
  const author = safeText(book.author);
  const name = author ? `${title} - ${author}.pdf` : `${title}.pdf`;
  return path.join(config.outputDir, name);
}

async function cmdDoctor(args) {
  await runDoctor({ launch: !!args.launch });
}

async function cmdBooks(args) {
  const config = configFromArgs(args);
  const { session } = await resolveSession(args, config);
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
  return books;
}

async function pickBookByQuery(session, books, query) {
  if (books.length === 1 && !query) return books[0];
  const resolved = resolveBook(books, query);
  if (resolved.kind === 'exact') return resolved.book;
  if (resolved.kind === 'ambiguous') {
    console.log('');
    console.log(`  "${query}" corrisponde a più libri:`);
    const picked = await pickBook(resolved.books, { title: '' });
    return picked;
  }
  const closest = closestTitles(books, query);
  throw new Error(
    `nessun libro corrisponde a "${query}"` +
      (closest.length ? `. Titoli simili: ${closest.join(', ')}` : '')
  );
}

async function cmdInfo(args) {
  const config = configFromArgs(args);
  const { session } = await resolveSession(args, config);
  const books = await fetchBooks(session);
  const query = args._[1];
  const book = await pickBookByQuery(session, books, query);
  const { manifest } = await loadBookPlan(session, book.id);
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
  console.log(`  id ${book.id}  revision ${book.revision ?? '?'}  typology ${book.typology}`);
  console.log(`  ${plan.pages} downloadable pages, ${plan.toc_entries} outline entries`);
  if (plan.pages_without_asset) console.log(`  ${plan.pages_without_asset} page resources without a PDF asset`);
  console.log('');
}

async function cmdKey(args) {
  const config = configFromArgs(args);
  const port = config.port;
  const browser = await ensureBrowser({ port, url: `${READER_BASE}/`, headless: Boolean(args.headless) });
  let assetUrl = null;
  let bookId = Number(args.book || 4130);
  try {
    const { session } = await resolveSession(args, config);
    const books = await fetchBooks(session);
    const book = await pickBookByQuery(session, books, args.book ? String(args.book) : '');
    bookId = book.id;
    const { manifest } = await loadBookPlan(session, bookId);
    assetUrl = manifest.pages[0]?.url ?? null;
  } catch (e) {
    log.warn(`cannot resolve a page asset (${e.message}); capturing without validation`);
  }
  const { key, source, validated } = await captureKey({ port: browser.port, bookId, assetUrl });
  console.log(key);
  console.error(`source: ${source}${validated ? ' (validated against a page asset)' : ' (not validated)'}`);
}

async function cmdBook(args, { book: presetBook = null } = {}) {
  const startedAt = Date.now();
  const config = configFromArgs(args);
  if (args['log-level']) setLogLevel(args['log-level']);

  const { session, browser } = await resolveSession(args, config);
  const books = await fetchBooks(session);
  const query = args._[1];
  const book = presetBook || (await pickBookByQuery(session, books, query));

  const { book: details, manifest } = await loadBookPlan(session, book.id);
  log.info(`${details.title} — revision ${details.revision}, ${manifest.pages.length} pages`);

  const warnings = [];
  if (details.liquid_text) {
    warnings.push('this book is published as liquid text: there are no PDF assets to export');
  }
  if (!manifest.pages.length) {
    if (manifest.standalone.length === 1) {
      warnings.push('the book is served as a single PDF asset');
      return await exportStandalone({ args, config, book: details, manifest, session, startedAt, warnings });
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

  const outFile = outputFileFor(details, config, args);
  if (!args.yes && isInteractive()) {
    const ok = await confirm(
      `  Esporto "${details.title}" (${pages.length} pagine) in ${path.dirname(outFile)}?`
    );
    if (!ok) {
      console.log('  annullato');
      return;
    }
  }

  const key = args['aes-key'] || process.env.HOEPLI_AES_KEY || null;
  let keyInfo = key ? { key, source: 'provided', validated: false } : null;
  if (!key) {
    if (!browser) throw new Error('no browser available to capture the decryption key; pass --aes-key');
    log.info('catturo la chiave di decifratura dal client in esecuzione');
    keyInfo = await captureKey({ port: browser.port, bookId: details.id, assetUrl: pages[0]?.url });
  }

  const workDir = path.join(homeDir(), 'work', String(details.id));
  const pagesDir = path.join(workDir, 'pages');
  const downloadProgress = createProgress({ total: pages.length, label: 'download' });
  downloadProgress.start();
  const download = await downloadPages({
    pages,
    outDir: pagesDir,
    key: keyInfo.key,
    concurrency: config.concurrency,
    keepPages: true,
    onProgress: ({ done, total, bytes }) => downloadProgress.update(done, bytes),
  });
  downloadProgress.stop(`${download.files.length} pagine scaricate (${formatBytes(download.bytes)})`);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  let merge = null;
  if (!args['no-merge']) {
    const toc = args['no-toc'] ? [] : manifest.toc;
    const mergeProgress = createProgress({ total: download.files.length, label: 'merge' });
    mergeProgress.start();
    merge = await mergePages({
      files: download.files,
      outFile,
      toc,
      metadata: {
        title: details.title,
        author: details.author,
        subject: `HoepliAcademy+ book ${details.id} (revision ${details.revision})`,
        keywords: ['hoepli', 'ebook', 'offline'],
        creator: 'hoepli-extract',
      },
      onProgress: ({ done, total }) => mergeProgress.update(done, 0),
    });
    mergeProgress.stop(`${merge.pages} pagine unite, ${merge.outline} segnalibri`);
    log.info(`output: ${outFile} (${formatBytes(merge.bytes)})`);
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
    book: details,
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

  if (config.openAfter && !args['no-merge']) {
    const opened = await openFile(outFile);
    console.log(opened ? `  aperto: ${outFile}` : `  apri manualmente: ${outFile}`);
  }

  if (args.strict && download.failed.length) {
    log.error(`strict mode: ${download.failed.length} page(s) failed`);
    process.exitCode = 2;
  } else if (download.failed.length) {
    process.exitCode = 2;
  } else if (!verification.ok) {
    process.exitCode = 2;
  }
}

async function exportStandalone({ args, config, book, manifest, session, startedAt, warnings }) {
  const asset = manifest.standalone[0];
  const key = args['aes-key'] || process.env.HOEPLI_AES_KEY || null;
  let keyUsed = key;
  if (!key) {
    const browser = await ensureBrowser({ port: config.port, url: `${READER_BASE}/` });
    keyUsed = (await captureKey({ port: browser.port, bookId: book.id, assetUrl: asset.url })).key;
  }
  const outFile = outputFileFor(book, config, args);
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
  if (config.openAfter) {
    const opened = await openFile(outFile);
    console.log(opened ? `  aperto: ${outFile}` : `  apri manualmente: ${outFile}`);
  }
}

async function cmdMenu(args) {
  const config = configFromArgs(args);
  const { session, browser } = await resolveSession(args, config);
  const books = await fetchBooks(session);
  if (!books.length) {
    console.log('  la tua libreria è vuota');
    return;
  }
  const picked = await pickBook(books);
  if (!picked) {
    console.log('  annullato');
    return;
  }
  await cmdBook(args, { book: picked });
}

async function cmdConfig(args) {
  const [key, value] = args._.slice(1);
  if (!key) {
    const config = loadConfig();
    console.log('');
    for (const [name, current] of describeConfig(config)) console.log(`  ${name.padEnd(14)} ${current}`);
    console.log(`\n  file: ${configPath()}\n`);
    return;
  }
  if (value === undefined) {
    const config = loadConfig();
    console.log(`${key} = ${config[key]}`);
    return;
  }
  const parsed = value === 'true' ? true : value === 'false' ? false : Number.isNaN(Number(value)) ? value : Number(value);
  saveConfig({ [key]: parsed });
  console.log(`  ${key} = ${parsed}`);
}

async function cmdInstall(args) {
  const config = configFromArgs(args);
  runInstall({ config });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || (isInteractive() ? 'menu' : 'help');
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
      case 'menu':
        return await cmdMenu(args);
      case 'install':
        return await cmdInstall(args);
      case 'uninstall':
        return runUninstall();
      case 'config':
        return await cmdConfig(args);
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
