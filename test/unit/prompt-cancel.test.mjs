import test from 'node:test';
import assert from 'node:assert/strict';
import { isCancel, formatBookLine, pickBook, setInteractive } from '../../src/prompt.mjs';

/** Run the interactive picker with a scripted answer. */
async function pickWith(input, books) {
  setInteractive(true);
  try {
    return await pickBook(books, { ask: async () => input });
  } finally {
    setInteractive(null);
  }
}

test('the cancel words are recognised', () => {
  for (const word of ['nulla', 'Nulla', 'NULLA', 'niente', 'no', 'n', 'esci', 'exit', 'q', 'annulla', 'cancel', '  ']) {
    assert.equal(isCancel(word), true, `"${word}" should cancel`);
  }
});

test('a real answer does not cancel', () => {
  for (const word of ['1', 'Java', 'y', 's', 'si', 'yes']) {
    assert.equal(isCancel(word), false, `"${word}" should not cancel`);
  }
});

test('typing "nulla" in the picker cancels instead of looping', async () => {
  const books = [{ id: 1, title: 'Java', author: 'De Sio Cesari', page_count: 706, typology: 'ebook' }];
  const picked = await pickWith('nulla\n', books);
  assert.equal(picked, null, '"nulla" must cancel the picker');
});

test('typing a number in the picker selects the book', async () => {
  const books = [
    { id: 1, title: 'Java', author: 'De Sio Cesari', page_count: 706, typology: 'ebook' },
    { id: 2, title: 'Python', author: 'Rossi', page_count: 400, typology: 'ebook' },
  ];
  const picked = await pickWith('2\n', books);
  assert.equal(picked.title, 'Python');
});

test('the book line is still formatted the same way', () => {
  const line = formatBookLine({ id: 1, title: 'Java', author: 'De Sio Cesari', page_count: 706, typology: 'ebook' }, 0);
  assert.match(line, /1\)/);
  assert.match(line, /706 pp/);
});
