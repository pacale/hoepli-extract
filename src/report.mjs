// Human readable summary plus the machine readable report.

import fs from 'node:fs';
import path from 'node:path';
import { log, formatBytes, nowIso } from './util.mjs';

export function buildReport({
  book,
  session,
  key,
  manifest,
  download,
  merge,
  verification,
  output,
  startedAt,
  warnings = [],
}) {
  return {
    tool: 'hoepli-extract',
    version: '0.1.0',
    generated_at: nowIso(),
    duration_ms: startedAt ? Date.now() - startedAt : null,
    book: {
      id: book?.id ?? null,
      title: book?.title ?? null,
      author: book?.author ?? null,
      publisher: book?.publisher ?? null,
      revision: book?.revision ?? null,
      page_count: book?.page_count ?? null,
      typology: book?.typology ?? null,
      liquid_text: book?.liquid_text ?? null,
    },
    session: { authenticated: !!session, key_source: key?.source ?? null, key_validated: key?.validated ?? null },
    manifest: {
      pages: manifest?.pages?.length ?? 0,
      pages_without_asset: manifest?.missing?.length ?? 0,
      toc_entries: manifest?.toc?.length ?? 0,
    },
    download: {
      files: download?.files?.length ?? 0,
      failed: download?.failed?.length ?? 0,
      bytes: download?.bytes ?? 0,
      md5_verified: download?.md5ok ?? 0,
      decrypted_assets: download?.decrypted ?? 0,
      resumed_from_cache: download?.resumed ?? 0,
      retried: download?.retried ?? 0,
      failures: download?.failed ?? [],
    },
    merge: merge ?? null,
    verification: verification ?? null,
    output: output ?? null,
    warnings,
  };
}

export function printSummary(report) {
  const b = report.book;
  console.log('');
  console.log(`  book      ${b.title ?? '(unknown)'}${b.author ? ` — ${b.author}` : ''}`);
  console.log(`  id        ${b.id}   revision ${b.revision ?? '?'}   pages ${b.page_count ?? '?'}`);
  console.log(`  manifest  ${report.manifest.pages} pages, ${report.manifest.toc_entries} outline entries`);
  console.log(
    `  download  ${report.download.files} files, ${formatBytes(report.download.bytes)}, ` +
      `md5 ${report.download.md5_verified}/${report.download.files}` +
      (report.download.resumed_from_cache ? `, ${report.download.resumed_from_cache} dalla cache` : '') +
      (report.download.retried ? `, ${report.download.retried} ritentate` : '')
  );
  if (report.download.failed) {
    console.log(`  failed    ${report.download.failed.length} page(s)`);
    for (const f of report.download.failed.slice(0, 10)) {
      console.log(`            - #${f.order} ${f.code} [${f.kind || 'network'}]: ${f.error}`);
    }
  }
  if (report.merge?.skipped?.length) {
    console.log(`  skipped   ${report.merge.skipped.length} unreadable page file(s) at merge time`);
  }
  if (report.merge) {
    console.log(`  merged    ${report.merge.pages} pages, ${report.merge.outline} outline entries, ${formatBytes(report.merge.bytes)}`);
  }
  if (report.output) console.log(`  output    ${report.output}`);
  if (report.verification) {
    console.log(`  verified  ${report.verification.ok ? 'OK' : 'with warnings'}`);
    for (const w of report.verification.warnings ?? []) console.log(`            ! ${w}`);
  }
  for (const w of report.warnings) console.log(`  warning   ${w}`);
  console.log('');
}

export function writeReport(report, file) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  log.debug(`report written to ${file}`);
}
