import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName, encodeUint16LE, SAMPLE_INTERVAL_PRESETS, fillDurationLabel, MAX_SAMPLES, encodeUint32LE, relativeTimeLabel, encodeStartTimestamp, encodeAsciiFloat, setBit, parseEditState } from './monitor-encoding.mjs';

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

test('encodeUint32LE: typical values', () => {
  assert.deepEqual(Array.from(encodeUint32LE(0)),          [0x00, 0x00, 0x00, 0x00]);
  assert.deepEqual(Array.from(encodeUint32LE(1)),          [0x01, 0x00, 0x00, 0x00]);
  assert.deepEqual(Array.from(encodeUint32LE(60)),         [0x3c, 0x00, 0x00, 0x00]);
  assert.deepEqual(Array.from(encodeUint32LE(86400)),      [0x80, 0x51, 0x01, 0x00]);
  assert.deepEqual(Array.from(encodeUint32LE(0xffffffff)), [0xff, 0xff, 0xff, 0xff]);
});

test('encodeUint32LE: rejects out-of-range', () => {
  assert.throws(() => encodeUint32LE(-1));
  assert.throws(() => encodeUint32LE(0x100000000));
});

test('relativeTimeLabel: zero is "now"', () => {
  assert.equal(relativeTimeLabel(0), 'now');
});

test('relativeTimeLabel: future is "in X..."', () => {
  assert.equal(relativeTimeLabel(45),     'in 45s');
  assert.equal(relativeTimeLabel(120),    'in 2m');
  assert.equal(relativeTimeLabel(3700),   'in 1h 1m');
  assert.equal(relativeTimeLabel(90000),  'in 1d 1h');
  assert.equal(relativeTimeLabel(165180), 'in 1d 21h');
});

test('relativeTimeLabel: past is empty (we never set delays in the past)', () => {
  assert.equal(relativeTimeLabel(-1), 'now');
});

test('encodeStartTimestamp: 2026-05-01 21:07:32 → [HH MI SS DD MO YY]', () => {
  // EasyLog reference capture used a local-time wall clock.
  const d = new Date(2026, 4, 1, 21, 7, 32);  // months are 0-indexed in JS
  const out = encodeStartTimestamp(d);
  assert.deepEqual(Array.from(out), [0x15, 0x07, 0x20, 0x01, 0x05, 0x1a]);
  // Verifies HH=21=0x15, MI=7=0x07, SS=32=0x20, DD=1=0x01, MO=5=0x05, YY=26=0x1a.
});

test('encodeStartTimestamp: midnight epoch boundary', () => {
  const d = new Date(2030, 0, 1, 0, 0, 0);
  assert.deepEqual(Array.from(encodeStartTimestamp(d)), [0, 0, 0, 1, 1, 30]);
});

test('encodeAsciiFloat: integer value formats compactly, NUL-padded to 8 bytes', () => {
  const out = encodeAsciiFloat(42);
  assert.equal(out.length, 8);
  assert.equal(String.fromCharCode(...out.slice(0, 2)), '42');
  assert.deepEqual(Array.from(out.slice(2)), [0, 0, 0, 0, 0, 0]);
});

test('encodeAsciiFloat: fractional value', () => {
  const out = encodeAsciiFloat(36.5);
  const ascii = String.fromCharCode(...out).replace(/\0+$/, '');
  assert.equal(ascii, '36.5');
});

test('encodeAsciiFloat: negative value', () => {
  const out = encodeAsciiFloat(-12.3);
  const ascii = String.fromCharCode(...out).replace(/\0+$/, '');
  assert.equal(ascii, '-12.3');
});

test('encodeAsciiFloat: throws if formatted value exceeds 8 bytes', () => {
  assert.throws(() => encodeAsciiFloat(123456.789));
});

test('setBit: set a clear bit', () => {
  assert.equal(setBit(0x00, 0, true), 0x01);
  assert.equal(setBit(0x00, 4, true), 0x10);
  assert.equal(setBit(0x21, 0, true), 0x21);  // already set, no change
  assert.equal(setBit(0x20, 0, true), 0x21);
});

test('setBit: clear a set bit', () => {
  assert.equal(setBit(0x21, 0, false), 0x20);
  assert.equal(setBit(0xff, 7, false), 0x7f);
  assert.equal(setBit(0x20, 0, false), 0x20);  // already clear, no change
});

test('setBit: rejects invalid index', () => {
  assert.throws(() => setBit(0, -1, true));
  assert.throws(() => setBit(0, 8, true));
});

const FIXTURE_HEX = (
  '0a0053656e736f72203131310000000000001507200105' +
  '1a000000000500be01030110131d265038a751b23c0000' +
  '21000000000019060000100e0000ffffffff' +
  '00'.repeat(256 - 64)  // remainder mostly zeros / 0xff
);

function fromHex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

test('parseEditState: extracts editable fields from a real config block', () => {
  const buf = fromHex(FIXTURE_HEX);
  const st = parseEditState(buf);
  assert.equal(st.deviceName, 'Sensor 111');
  assert.equal(st.unitIsF, true);          // 0x2E = 0x21, bit 0 set → °F
  assert.equal(st.sampleIntervalSec, 5);   // 0x1C-0x1D = 05 00
  assert.equal(st.delayedStartSec, 0);     // 0x18-0x1B = 00 00 00 00
});

test('parseEditState: alarmFlags bits become alarm.enabled', () => {
  const buf = fromHex(FIXTURE_HEX);
  const st = parseEditState(buf);
  // 0x20 = 0x03 → bits 0 and 1 are set; we map bit 0 → hi, bit 1 → lo.
  assert.equal(st.alarmHi.enabled, true);
  assert.equal(st.alarmLo.enabled, true);
});
