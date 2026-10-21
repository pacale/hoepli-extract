// Verification of the produced PDF: page count, metadata, outline and a
// sanity check that the pages carry content.

import fs from 'node:fs';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { readOutline } from './merge.mjs';

export async function verifyOutput({ file, expectedPages = null, expectOutline = null }) {
  const result = { file, ok: false, pages: null, outline: null, metadata: {}, warnings: [] };
  if (!fs.existsSync(file)) {
    result.warnings.push('output file missing');
    return result;
  }
  const bytes = fs.readFileSync(file);
  result.bytes = bytes.length;
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    result.warnings.push(`cannot open output: ${e.message}`);
    return result;
  }
  result.pages = doc.getPageCount();
  result.metadata = {
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    producer: doc.getProducer() ?? null,
  };
  const outline = await readOutline(bytes);
  result.outline = outline.items;

  if (expectedPages !== null && result.pages !== expectedPages) {
    result.warnings.push(`page count ${result.pages} differs from expected ${expectedPages}`);
  }
  if (expectOutline !== null && result.outline !== expectOutline) {
    result.warnings.push(`outline entries ${result.outline} differ from expected ${expectOutline}`);
  }
  if (result.pages > 0) {
    const sample = Math.min(result.pages, 5);
    let empty = 0;
    for (let i = 0; i < sample; i++) {
      const contents = doc.getPage(i).node.get(PDFName.of('Contents'));
      const size = contentLength(doc, contents);
      if (size === 0) empty++;
    }
    if (empty === sample) result.warnings.push('sampled pages have no content stream');
  }
  result.ok = result.warnings.length === 0;
  return result;
}

function contentLength(doc, contents) {
  if (!contents) return 0;
  try {
    const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
    if (resolved?.asArray) {
      return resolved.asArray().reduce((sum, item) => sum + contentLength(doc, item), 0);
    }
    if (resolved?.getContentsSize) return resolved.getContentsSize();
  } catch {
    return -1;
  }
  return 0;
}
