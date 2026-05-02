import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName, encodeUint16LE, SAMPLE_INTERVAL_PRESETS, fillDurationLabel, MAX_SAMPLES } from './monitor-encoding.mjs';

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

test('encodeUint16LE: typical values', () => {
  assert.deepEqual(Array.from(encodeUint16LE(0)),     [0x00, 0x00]);
  assert.deepEqual(Array.from(encodeUint16LE(1)),     [0x01, 0x00]);
  assert.deepEqual(Array.from(encodeUint16LE(60)),    [0x3c, 0x00]);
  assert.deepEqual(Array.from(encodeUint16LE(446)),   [0xbe, 0x01]);
  assert.deepEqual(Array.from(encodeUint16LE(43200)), [0xc0, 0xa8]);
  assert.deepEqual(Array.from(encodeUint16LE(65535)), [0xff, 0xff]);
});

test('encodeUint16LE: rejects out-of-range', () => {
  assert.throws(() => encodeUint16LE(-1));
  assert.throws(() => encodeUint16LE(65536));
});

test('SAMPLE_INTERVAL_PRESETS: every value fits in uint16', () => {
  for (const p of SAMPLE_INTERVAL_PRESETS) {
    assert.ok(p.seconds >= 1 && p.seconds <= 65535, `${p.seconds} out of range`);
  }
});

test('fillDurationLabel: a 1-min interval at 32510 samples is ~22d 14h', () => {
  assert.equal(fillDurationLabel(60), '22d 13h');
  assert.equal(fillDurationLabel(1),  '9h 1m');
  assert.equal(fillDurationLabel(43200), '16255d');  // 12h interval, days only
});

test('SAMPLE_INTERVAL_PRESETS: labels match fillDurationLabel output', () => {
  // Sanity that the dropdown labels are derivable from the seconds value.
  for (const p of SAMPLE_INTERVAL_PRESETS) {
    const dur = fillDurationLabel(p.seconds, MAX_SAMPLES);
    assert.ok(dur.length > 0, `no duration for ${p.label}`);
  }
});
