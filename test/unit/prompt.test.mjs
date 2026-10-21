import test from 'node:test';
import assert from 'node:assert/strict';
import { openCommandFor, formatBookLine } from '../../src/prompt.mjs';

test('picks the right opener per platform', () => {
  assert.deepEqual(openCommandFor('win32'), { command: 'cmd', args: ['/c', 'start', ''] });
  assert.deepEqual(openCommandFor('darwin'), { command: 'open', args: [] });
  assert.deepEqual(openCommandFor('linux'), { command: 'xdg-open', args: [] });
});

test('formats a book line with number, title, author and details', () => {
  const line = formatBookLine({ id: 1, title: 'Java', author: 'De Sio Cesari', page_count: 706, typology: 'ebook' }, 0);
  assert.match(line, /1\)/);
  assert.match(line, /Java/);
  assert.match(line, /De Sio Cesari/);
  assert.match(line, /706 pp/);
});
