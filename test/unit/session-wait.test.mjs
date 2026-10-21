import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForAuthentication } from '../../src/session.mjs';
import { SessionError } from '../../src/session.mjs';

test('returns the session as soon as the probe succeeds', async () => {
  let calls = 0;
  const session = await waitForAuthentication({
    timeoutSec: 5,
    probe: async () => {
      calls++;
      return calls >= 2 ? { ok: true } : null;
    },
  });
  assert.deepEqual(session, { ok: true });
  assert.equal(calls, 2);
});

test('keeps waiting while the probe fails with 401', async () => {
  let calls = 0;
  const session = await waitForAuthentication({
    timeoutSec: 5,
    probe: async () => {
      calls++;
      if (calls < 2) {
        const error = new SessionError('nope', 401);
        throw error;
      }
      return 'ready';
    },
  });
  assert.equal(session, 'ready');
});

test('gives up after the timeout', async () => {
  await assert.rejects(
    waitForAuthentication({
      timeoutSec: 1,
      probe: async () => null,
    }),
    /no valid session/
  );
});

test('lets unexpected errors through', async () => {
  await assert.rejects(
    waitForAuthentication({
      timeoutSec: 5,
      probe: async () => {
        const error = new Error('network down');
        error.status = 500;
        throw error;
      },
    }),
    /network down/
  );
});
