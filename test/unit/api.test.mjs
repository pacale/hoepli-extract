import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, buildToc } from '../../src/api.mjs';

const resources = [
  { id: 900, resource_type_id: 12, resource_code: 'BOOK', title: 'book', assets: [] },
  { id: 901, resource_type_id: 14, resource_code: 'P_01', title: '1', assets: [{ id: 1, use: 'page_pdf', url: 'https://x/1', md5: 'm1', size: 10 }] },
  { id: 902, resource_type_id: 14, resource_code: 'P_02', title: '2', assets: [{ id: 2, use: 'page_thumb_medium', url: 'https://x/2t' }, { id: 3, use: 'page_pdf', url: 'https://x/2', md5: 'm2', size: 20 }] },
  { id: 903, resource_type_id: 14, resource_code: 'P_03', title: '3', assets: [] },
];

const links = [
  { resource_id: 902, target_id: 900, resource_type_id: 14, order: 2 },
  { resource_id: 901, target_id: 900, resource_type_id: 14, order: 1 },
  { resource_id: 903, target_id: 900, resource_type_id: 14, order: 3 },
  { resource_id: 950, target_id: 900, resource_type_id: 27, order: 0 },
];

test('orders the pages and keeps the reading order', () => {
  const m = buildManifest({ resources, links });
  assert.equal(m.pages.length, 2);
  assert.deepEqual(m.pages.map((p) => p.order), [1, 2]);
  assert.equal(m.pages[1].md5, 'm2');
});

test('reports pages without a PDF asset instead of failing', () => {
  const m = buildManifest({ resources, links });
  assert.equal(m.missing.length, 1);
  assert.equal(m.missing[0].order, 3);
});

test('maps the table of contents onto page numbers', () => {
  const m = buildManifest({ resources, links });
  const index = [
    { skin: 'text_index', title: 'Indice', first_page: { id: 901 }, last_page: { id: 901 } },
    { skin: 'unit1', title: 'Capitolo 1', first_page: { id: 901 }, last_page: { id: 902 } },
  ];
  const toc = buildToc(index, m.pages);
  assert.equal(toc.length, 2);
  assert.equal(toc[0].level, 1);
  assert.equal(toc[0].page, 1);
  assert.equal(toc[1].level, 2);
  assert.equal(toc[1].page_end, 2);
});

test('ignores table of contents entries without a page', () => {
  const m = buildManifest({ resources, links });
  const toc = buildToc([{ skin: 'unit1', title: 'Missing', first_page: { id: 4242 } }], m.pages);
  assert.equal(toc.length, 0);
});
