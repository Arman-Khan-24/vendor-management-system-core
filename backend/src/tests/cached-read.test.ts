import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedRead } from '../services/cached-read.js';

test('public reads share in-flight work and retry after the configured cache window', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const load = cachedRead(async () => {
    calls++;
    if (calls === 2) throw new Error('unavailable');
    return calls;
  }, 3000);

  assert.deepEqual(await Promise.all([load(), load(), load()]), [1, 1, 1]);
  assert.equal(calls, 1);
  now = 3000;
  await assert.rejects(load(), /unavailable/);
  await assert.rejects(load(), /unavailable/);
  assert.equal(calls, 2);
  now = 4000;
  assert.equal(await load(), 3);
});
