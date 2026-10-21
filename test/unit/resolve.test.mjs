import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBook, closestTitles, levenshtein } from '../../src/resolve.mjs';

const books = [
  { id: 4130, title: 'Java', author: 'Claudio De Sio Cesari', page_count: 706 },
  { id: 4200, title: 'Programmazione in Python', author: 'Marco Rossi', page_count: 400 },
  { id: 4300, title: 'Basi di dati', author: 'Laura Verdi', page_count: 520 },
];

test('resolves a book by id', () => {
  const result = resolveBook(books, '4130');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.title, 'Java');
});

test('resolves a book by exact title', () => {
  const result = resolveBook(books, 'Java');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.id, 4130);
});

test('resolves a book by title prefix', () => {
  const result = resolveBook(books, 'Basi');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.id, 4300);
});

test('resolves a book by title fragment', () => {
  const result = resolveBook(books, 'Python');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.id, 4200);
});

test('resolves a book by author', () => {
  const result = resolveBook(books, 'Verdi');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.id, 4300);
});

test('tolerates a typo', () => {
  const result = resolveBook(books, 'Jva');
  assert.equal(result.kind, 'exact');
  assert.equal(result.book.id, 4130);
});

test('reports ambiguity instead of guessing', () => {
  const result = resolveBook(books, 'a');
  assert.equal(result.kind, 'ambiguous');
  assert.ok(result.books.length >= 2);
});

test('reports no match', () => {
  const result = resolveBook(books, 'Fisica quantistica');
  assert.equal(result.kind, 'none');
});

test('suggests the closest titles', () => {
  const closest = closestTitles(books, 'Jav');
  assert.equal(closest[0], 'Java');
});

test('computes the edit distance', () => {
  assert.equal(levenshtein('Java', 'Java'), 0);
  assert.equal(levenshtein('Java', 'Jva'), 1);
});
