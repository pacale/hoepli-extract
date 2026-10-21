// Platform API wrappers: library listing, book metadata and the per-book
// page manifest (resources + reading order + table of contents).

import { log } from './util.mjs';

const PAGE_RESOURCE_TYPE = 14; // a rendered book page
const BOOK_RESOURCE_TYPE = 12; // the book itself
const PER_PAGE = 500;

async function paged(session, pathBase) {
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const sep = pathBase.includes('?') ? '&' : '?';
    const chunk = await session.json(`${pathBase}${sep}per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < PER_PAGE) break;
    log.debug(`${pathBase} page ${page}: ${chunk.length} rows (total ${out.length})`);
  }
  return out;
}

export async function fetchBooks(session) {
  const raw = await session.json('/api/v6/books?page_thumb_size=medium&per_page=25000');
  const books = Array.isArray(raw) ? raw : raw?.books || [];
  return books.map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle || null,
    author: Array.isArray(b.authors)
      ? b.authors.map((a) => [a.name, a.surname].filter(Boolean).join(' ')).join(', ')
      : b.author || null,
    publisher: b.brand?.publisher?.name || b.brand?.name || null,
    page_count: b.page_count ?? null,
    page_count_no_role: b.page_count_no_role ?? null,
    typology: b.book_typology || null,
    liquid_text: b.liquid_text ?? null,
    revision: b.current_edition?.revision ?? b.localRevision ?? null,
    state: b.state ?? null,
    licence: b.licence ?? null,
  }));
}

export async function fetchBookDetail(session, bookId) {
  return session.json(`/api/v6/books/by_book_id/${bookId}`);
}

export async function fetchRevision(session, bookId, detail) {
  const fromDetail = detail?.current_edition?.revision;
  if (typeof fromDetail === 'number') return fromDetail;
  const raw = await session.json(`/api/v5/books/${bookId}`);
  const rev = raw?.revision ?? raw?.current_edition?.revision;
  if (typeof rev !== 'number') throw new Error(`cannot determine revision for book ${bookId}`);
  return rev;
}

export async function fetchResources(session, bookId, revision) {
  return paged(session, `/api/v5/books/${bookId}/${revision}/resources`);
}

export async function fetchLinks(session, bookId, revision) {
  return paged(session, `/api/v5/books/${bookId}/${revision}/links`);
}

export async function fetchIndex(session, bookId, revision) {
  const raw = await session.json(`/api/v5/books/${bookId}/${revision}/index`);
  return Array.isArray(raw) ? raw : [];
}

function pickAsset(resource, use) {
  return (resource?.assets || []).find((a) => a.use === use) || null;
}

/**
 * Build the ordered page manifest of a book.
 *
 * The reading order comes from the /links endpoint: every link of type PAGE
 * that points at the book resource carries an `order` field.
 */
export function buildManifest({ resources, links }) {
  const byId = new Map(resources.map((r) => [r.id, r]));

  let bookResourceId = resources.find((r) => r.resource_type_id === BOOK_RESOURCE_TYPE)?.id;
  if (bookResourceId === undefined) {
    const counts = new Map();
    for (const l of links) counts.set(l.target_id, (counts.get(l.target_id) || 0) + 1);
    bookResourceId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  const pageLinks = links
    .filter((l) => l.resource_type_id === PAGE_RESOURCE_TYPE && l.target_id === bookResourceId && l.order != null)
    .sort((a, b) => a.order - b.order);

  const pages = [];
  const missing = [];
  for (const link of pageLinks) {
    const resource = byId.get(link.resource_id);
    const asset = pickAsset(resource, 'page_pdf');
    if (!asset?.url) {
      missing.push({ resource_id: link.resource_id, order: link.order, title: resource?.title ?? null });
      continue;
    }
    pages.push({
      order: link.order,
      resource_id: link.resource_id,
      code: resource?.resource_code ?? null,
      title: resource?.title ?? null,
      asset_id: asset.id,
      filename: asset.filename ?? null,
      url: asset.url,
      md5: asset.md5 ?? null,
      size: asset.size ?? null,
      encrypted: asset.encrypted ?? null,
    });
  }

  const standalone = [];
  for (const resource of resources) {
    if (resource.resource_type_id === PAGE_RESOURCE_TYPE) continue;
    for (const asset of resource.assets || []) {
      if (asset.use === 'page_pdf' && asset.url) {
        standalone.push({
          resource_id: resource.id,
          code: resource.resource_code ?? null,
          title: resource.title ?? null,
          asset_id: asset.id,
          filename: asset.filename ?? null,
          url: asset.url,
          md5: asset.md5 ?? null,
          size: asset.size ?? null,
          encrypted: asset.encrypted ?? null,
        });
      }
    }
  }

  return { pages, missing, standalone, bookResourceId };
}

/** Map the platform table of contents onto PDF page numbers (1-based). */
export function buildToc(index, pages) {
  const orderByResource = new Map(pages.map((p) => [p.resource_id, p.order]));
  const toc = [];
  for (const unit of index || []) {
    const first = orderByResource.get(unit?.first_page?.id);
    if (first === undefined) continue;
    const last = orderByResource.get(unit?.last_page?.id);
    const skin = unit.skin || '';
    const level = skin === 'section' || skin === 'text_index' ? 1 : 2;
    const title = unit.titolo_sito_libro || unit.title || '(senza titolo)';
    toc.push({ level, title, page: first, page_end: last ?? null });
  }
  toc.sort((a, b) => a.page - b.page);
  return toc;
}
