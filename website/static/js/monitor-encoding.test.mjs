import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName } from './monitor-encoding.mjs';

test('encodeDeviceName: short name right-padded with NUL to 16 bytes', () => {
  const out = encodeDeviceName('Sensor 111');
  assert.equal(out.length, 16);
  assert.deepEqual(Array.from(out.slice(0, 10)), [0x53, 0x65, 0x6e, 0x73, 0x6f, 0x72, 0x20, 0x31, 0x31, 0x31]);
  assert.deepEqual(Array.from(out.slice(10)), [0, 0, 0, 0, 0, 0]);
});

test('encodeDeviceName: empty string is all NULs', () => {
  const out = encodeDeviceName('');
  assert.equal(out.length, 16);
  assert.deepEqual(Array.from(out), Array(16).fill(0));
});

test('encodeDeviceName: exactly 16 chars uses every byte', () => {
  const out = encodeDeviceName('Walk-in cooler X');  // 16 chars
  assert.equal(out.length, 16);
  assert.equal(out[15], 0x58);  // 'X'
});

test('encodeDeviceName: oversize is truncated to 16 bytes', () => {
  const out = encodeDeviceName('A'.repeat(20));
  assert.equal(out.length, 16);
  assert.deepEqual(Array.from(out), Array(16).fill(0x41));
});

test('encodeDeviceName: non-ASCII chars are coerced to ? (we only support 7-bit ASCII)', () => {
  const out = encodeDeviceName('café');
  assert.equal(out[3], 0x3f);  // '?'
});
