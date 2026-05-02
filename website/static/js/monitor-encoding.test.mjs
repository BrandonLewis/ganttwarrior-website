import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName } from './monitor-encoding.mjs';

test('encodeDeviceName: short name right-padded with NUL to 16 bytes', () => {
  const out = encodeDeviceName('Sensor 111');
  assert.equal(out.length, 16);
  assert.deepEqual(Array.from(out.slice(0, 10)), [0x53, 0x65, 0x6e, 0x73, 0x6f, 0x72, 0x20, 0x31, 0x31, 0x31]);
  assert.deepEqual(Array.from(out.slice(10)), [0, 0, 0, 0, 0, 0]);
});
