// End-to-end check against a real book.
//
// Needs a signed-in session (see test/e2e/README.md). It exports a book,
// verifies the result against the numbers published by the platform and exits
// non-zero when something does not add up.

import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../src/cli.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const bookId = arg('book', process.env.HOEPLI_E2E_BOOK || '4130');
const out = arg('out', path.join(process.cwd(), `e2e-${bookId}.pdf`));
const reportFile = arg('report', path.join(process.cwd(), `e2e-${bookId}-report.json`));

await main(['book', String(bookId), '--out', out, '--keep-pages', '--report', reportFile]);

if (!fs.existsSync(reportFile)) {
  console.error('no report produced');
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const problems = [];

if (report.download.failed.length) problems.push(`${report.download.failed.length} page(s) failed`);
if (report.download.md5_verified !== report.download.files) {
  problems.push(`md5 verified ${report.download.md5_verified}/${report.download.files}`);
}
if (report.book.page_count !== null && report.manifest.pages !== report.book.page_count) {
  problems.push(`manifest ${report.manifest.pages} pages vs platform page_count ${report.book.page_count}`);
}
if (report.verification?.pages !== report.manifest.pages) {
  problems.push(`output has ${report.verification?.pages} pages, expected ${report.manifest.pages}`);
}
if (report.manifest.toc_entries && report.verification?.outline !== report.manifest.toc_entries) {
  problems.push(`outline ${report.verification?.outline} entries, expected ${report.manifest.toc_entries}`);
}

console.log('');
if (problems.length) {
  console.error('E2E FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`E2E OK: ${report.verification.pages} pages, ${report.verification.outline} outline entries, ${report.download.md5_verified} md5 verified`);
process.exit(0);
