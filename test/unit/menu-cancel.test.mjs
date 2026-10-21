import test from 'node:test';
import assert from 'node:assert/strict';
import { cmdMenu, setBrowserCloser } from '../../src/cli.mjs';
import { setInteractive } from '../../src/prompt.mjs';

const books = [
  { id: 4130, title: 'Java', author: 'Claudio De Sio Cesari', page_count: 706, typology: 'ebook' },
];

function withSpy(fn) {
  const closed = [];
  setBrowserCloser((port) => {
    closed.push(port);
    return true;
  });
  return { closed, restore: () => setBrowserCloser(() => true) };
}

test('"nulla" in the menu cancels and closes the browser the tool started', async () => {
  setInteractive(true);
  const spy = withSpy();
  try {
    await cmdMenu({}, {
      session: {},
      browser: { owned: true, port: 65535 },
      books,
      ask: async () => 'nulla',
    });
  } finally {
    setInteractive(null);
    spy.restore();
  }
  assert.equal(spy.closed.length, 1, 'the browser must be closed when the run is cancelled');
  assert.equal(spy.closed[0], 65535);
});

test('the menu does not close a browser it did not start', async () => {
  setInteractive(true);
  const spy = withSpy();
  try {
    await cmdMenu({}, {
      session: {},
      browser: { owned: false, port: 9222 },
      books,
      ask: async () => 'nulla',
    });
  } finally {
    setInteractive(null);
    spy.restore();
  }
  assert.equal(spy.closed.length, 0, "the user's own browser must be left alone");
});
