// Merge the per-page PDFs into a single document and build the outline.
//
// pdf-lib has no high-level bookmark API, so the outline is assembled with
// the low-level PDF object API: /Outlines dictionary, one item per chapter,
// linked as a doubly linked list and nested by level.

import fs from 'node:fs';
import { PDFDocument, PDFName, PDFHexString, PDFDict, PDFNumber, PDFRef } from 'pdf-lib';
import { log } from './util.mjs';

function buildOutline(doc, toc) {
  const context = doc.context;
  const outlines = PDFDict.withContext(context);
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  const outlinesRef = context.register(outlines);

  const root = { ref: outlinesRef, dict: outlines, level: 0, children: [] };
  const stack = [root];
  let created = 0;

  for (const entry of toc) {
    const pageIndex = (entry.page | 0) - 1;
    if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(pageIndex);
    const dict = PDFDict.withContext(context);
    dict.set(PDFName.of('Title'), PDFHexString.fromText(String(entry.title ?? '(untitled)')));
    dict.set(PDFName.of('Dest'), context.obj([page.ref, PDFName.of('Fit')]));
    const ref = context.register(dict);

    const item = { ref, dict, level: entry.level || 1, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
    const parent = stack[stack.length - 1];

    const siblings = parent.children;
    if (siblings.length) {
      const prev = siblings[siblings.length - 1];
      prev.dict.set(PDFName.of('Next'), item.ref);
      item.dict.set(PDFName.of('Prev'), prev.ref);
    }
    siblings.push(item);
    if (siblings.length === 1) parent.dict.set(PDFName.of('First'), item.ref);
    parent.dict.set(PDFName.of('Last'), item.ref);
    item.dict.set(PDFName.of('Parent'), parent.ref);

    stack.push(item);
    created++;
  }

  const totalDescendants = (node) => node.children.reduce((sum, c) => sum + 1 + totalDescendants(c), 0);
  for (const node of root.children) {
    const n = totalDescendants(node);
    if (n > 0) node.dict.set(PDFName.of('Count'), PDFNumber.of(n));
  }
  if (created > 0) outlines.set(PDFName.of('Count'), PDFNumber.of(created));

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return created;
}

/**
 * Merge page files into one PDF.
 * @returns {Promise<{pages: number, outline: number, bytes: number}>}
 */
export async function mergePages({ files, outFile, toc = [], metadata = {}, onProgress }) {
  const merged = await PDFDocument.create();
  let index = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    const src = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const indices = src.getPageIndices();
    const copied = await merged.copyPages(src, indices);
    for (const page of copied) merged.addPage(page);
    index++;
    if (onProgress && index % 50 === 0) onProgress({ done: index, total: files.length });
  }

  if (metadata.title) merged.setTitle(String(metadata.title));
  if (metadata.author) merged.setAuthor(String(metadata.author));
  if (metadata.subject) merged.setSubject(String(metadata.subject));
  if (metadata.keywords) merged.setKeywords([].concat(metadata.keywords));
  if (metadata.creator) merged.setCreator(String(metadata.creator));
  merged.setProducer('hoepli-extract');
  merged.setModificationDate(new Date());

  const outline = toc.length ? buildOutline(merged, toc) : 0;

  const bytes = await merged.save({ useObjectStreams: true, addDefaultPage: false });
  fs.writeFileSync(outFile, bytes);
  return { pages: merged.getPageCount(), outline, bytes: bytes.length };
}

/** Read back the outline of a saved document (used by the verification step). */
export async function readOutline(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true });
  const context = doc.context;
  const outlinesRef = doc.catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) return { items: 0, first: null, titles: [] };
  const resolve = (obj) => (obj instanceof PDFRef ? context.lookup(obj) : obj);
  const outlines = resolve(outlinesRef);
  if (!outlines || typeof outlines.get !== 'function') return { items: 0, first: null, titles: [] };
  const items = [];
  const walk = (node, depth) => {
    let current = node;
    let guard = 0;
    while (current && typeof current.get === 'function' && guard++ < 10000) {
      const title = current.get(PDFName.of('Title'));
      let text = null;
      if (title) {
        if (typeof title.decodeText === 'function') text = title.decodeText();
        else if (typeof title.asString === 'function') text = title.asString();
        else if (typeof title.value === 'string') text = title.value;
      }
      items.push({ title: text, dest: !!current.get(PDFName.of('Dest')), depth });
      const child = resolve(current.get(PDFName.of('First')));
      if (child) walk(child, depth + 1);
      current = resolve(current.get(PDFName.of('Next')));
    }
  };
  walk(resolve(outlines.get(PDFName.of('First'))), 1);
  return { items: items.length, first: items[0] ?? null, titles: items.map((i) => i.title) };
}
