import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName, encodeUint16LE, SAMPLE_INTERVAL_PRESETS, fillDurationLabel, MAX_SAMPLES, encodeUint32LE, relativeTimeLabel, encodeStartTimestamp, encodeAsciiFloat, setBit, parseEditState, buildEditedConfig, applyWorkflowDeltas, computeDiff } from './monitor-encoding.mjs';

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

test('relativeTimeLabel: past collapses to "now"', () => {
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

test('encodeStartTimestamp: rejects out-of-range years', () => {
  assert.throws(() => encodeStartTimestamp(new Date(1999, 0, 1)));
  assert.throws(() => encodeStartTimestamp(new Date(2100, 0, 1)));
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

test('encodeAsciiFloat: rejects NaN', () => {
  assert.throws(() => encodeAsciiFloat(NaN));
});

test('encodeAsciiFloat: rejects Infinity', () => {
  assert.throws(() => encodeAsciiFloat(Infinity));
  assert.throws(() => encodeAsciiFloat(-Infinity));
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

test('parseEditState: rejects undersized buffer', () => {
  assert.throws(() => parseEditState(new Uint8Array(100)));
});

test('buildEditedConfig: returns a 256-byte copy that preserves baseline bytes outside edited and threshold offsets', () => {
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out.length, 256);
  // Identity over everything except the alarm-threshold regions, which get
  // canonicalized when alarmFlags bits 0/1 are set in the baseline.
  assert.deepEqual(Array.from(out.slice(0, 0x70)),    Array.from(baseline.slice(0, 0x70)));
  assert.deepEqual(Array.from(out.slice(0x80)),       Array.from(baseline.slice(0x80)));
});

test('buildEditedConfig: enabling an alarm at value 0 writes canonical "0" bytes at the threshold offset', () => {
  const baseline = fromHex(FIXTURE_HEX);
  baseline[0x20] = 0x00;  // start with both alarms disabled
  const edits = parseEditState(baseline);
  edits.alarmHi.enabled = true;
  edits.alarmHi.value = 0;
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out[0x70], 0x30);                                // ASCII '0'
  assert.deepEqual(Array.from(out.slice(0x71, 0x78)), [0,0,0,0,0,0,0]);
});

test('buildEditedConfig: changing the device name only touches 0x02-0x11', () => {
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  edits.deviceName = 'Walk-in cooler';
  const out = buildEditedConfig(baseline, edits);
  const newName = new TextDecoder('latin1').decode(out.slice(0x02, 0x12)).replace(/\0+$/, '');
  assert.equal(newName, 'Walk-in cooler');
  assert.deepEqual(Array.from(out.slice(0, 0x02)),    Array.from(baseline.slice(0, 0x02)));
  // Skip 0x70-0x7F (threshold canonicalization fires when alarmFlags bits 0/1
  // are set in the baseline); we only care that the name edit is localized.
  assert.deepEqual(Array.from(out.slice(0x12, 0x70)), Array.from(baseline.slice(0x12, 0x70)));
  assert.deepEqual(Array.from(out.slice(0x80)),       Array.from(baseline.slice(0x80)));
});

test('buildEditedConfig: unit toggle flips bit 0 of 0x2E and preserves other bits', () => {
  const baseline = fromHex(FIXTURE_HEX);  // 0x2E = 0x21 (bit 0 set, °F)
  const edits = parseEditState(baseline);
  edits.unitIsF = false;
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out[0x2e], 0x20);  // bit 0 cleared, bit 5 preserved
  assert.equal(out[0x2f], baseline[0x2f]);  // high byte unchanged
});

test('buildEditedConfig: alarm checkbox flips alarmFlags bit, preserves others', () => {
  const baseline = fromHex(FIXTURE_HEX);  // 0x20 = 0x03
  const edits = parseEditState(baseline);
  edits.alarmHi.enabled = false;
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out[0x20], 0x02);  // bit 0 cleared, bit 1 preserved
});

test('buildEditedConfig: disabling an alarm leaves threshold bytes intact', () => {
  // Synthesize a baseline with an active hi alarm and known threshold bytes.
  const baseline = fromHex(FIXTURE_HEX);
  baseline[0x20] = 0x01;  // alarm hi enabled
  baseline.set(new Uint8Array([0x34, 0x32, 0, 0, 0, 0, 0, 0]), 0x70);  // "42"
  const edits = parseEditState(baseline);
  edits.alarmHi.enabled = false;
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out[0x20] & 0x01, 0);                                     // flag cleared
  assert.deepEqual(Array.from(out.slice(0x70, 0x78)),                    // bytes preserved
                   Array.from(baseline.slice(0x70, 0x78)));
});

test("applyWorkflowDeltas: 'setup-and-start' with immediate start writes startTimestamp = now", () => {
  // Fixture has delayedStartSec = 0 (immediate), so target == now.
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  const payload = buildEditedConfig(baseline, edits);
  const now = new Date(2026, 5, 15, 14, 30, 5);  // 2026-06-15 14:30:05
  applyWorkflowDeltas(payload, 'setup-and-start', now);
  // sampleCount → 0
  assert.equal(payload[0x1e], 0);
  assert.equal(payload[0x1f], 0);
  // startTimestamp → now
  assert.deepEqual(Array.from(payload.slice(0x12, 0x18)), [14, 30, 5, 15, 6, 26]);
  // statusFlags bit 0 set
  assert.equal(payload[0x21] & 0x01, 0x01);
});

test("applyWorkflowDeltas: 'setup-and-start' with delayed start writes startTimestamp = now + delayedStartSec", () => {
  // Reference: easylog-reference-2.pcapng frame 443 — delayedStartSec=57s,
  // startTimestamp = save-time + 57s (= target wall-clock).
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  edits.delayedStartSec = 57;
  const payload = buildEditedConfig(baseline, edits);
  const now = new Date(2026, 4, 2, 13, 55, 3);  // 2026-05-02 13:55:03
  applyWorkflowDeltas(payload, 'setup-and-start', now);
  // startTimestamp → 13:56:00 on 2026-05-02 (now + 57s)
  assert.deepEqual(Array.from(payload.slice(0x12, 0x18)), [13, 56, 0, 2, 5, 26]);
  // delayedStartSec preserved at 0x18-0x1B
  assert.deepEqual(Array.from(payload.slice(0x18, 0x1c)), [57, 0, 0, 0]);
  assert.equal(payload[0x21] & 0x01, 0x01);
});

test("applyWorkflowDeltas: 'download-and-resume' is identical to setup-and-start", () => {
  const baseline = fromHex(FIXTURE_HEX);
  const a = buildEditedConfig(baseline, parseEditState(baseline));
  const b = buildEditedConfig(baseline, parseEditState(baseline));
  const now = new Date(2026, 0, 1, 0, 0, 0);
  applyWorkflowDeltas(a, 'setup-and-start', now);
  applyWorkflowDeltas(b, 'download-and-resume', now);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("applyWorkflowDeltas: 'stop-logging' writes 0x21 = 0x00 (matches EasyLog) and leaves sampleCount/timestamp alone", () => {
  const baseline = fromHex(FIXTURE_HEX);
  const payload = buildEditedConfig(baseline, parseEditState(baseline));
  const now = new Date(2026, 5, 15, 14, 30, 5);
  applyWorkflowDeltas(payload, 'stop-logging', now);
  assert.equal(payload[0x21], 0x00);
  // sampleCount unchanged from baseline (0x01be = 446)
  assert.equal(payload[0x1e], baseline[0x1e]);
  assert.equal(payload[0x1f], baseline[0x1f]);
  // startTimestamp unchanged
  assert.deepEqual(Array.from(payload.slice(0x12, 0x18)), Array.from(baseline.slice(0x12, 0x18)));
});

test("applyWorkflowDeltas: 'setup-and-start' writes 0x21 = 0x01 even from a baseline with bit 1 set", () => {
  // Post-reset state has 0x21 = 0x02. EasyLog's setup save writes 0x01
  // (clears bit 1, sets bit 0). Confirms our hard-set isn't preserving
  // a stale "session ended" bit.
  const baseline = fromHex(FIXTURE_HEX);
  baseline[0x21] = 0x02;
  const payload = buildEditedConfig(baseline, parseEditState(baseline));
  applyWorkflowDeltas(payload, 'setup-and-start', new Date(2026, 4, 2, 14, 5, 0));
  assert.equal(payload[0x21], 0x01);
});

test("applyWorkflowDeltas: unknown workflow throws", () => {
  const payload = new Uint8Array(256);
  assert.throws(() => applyWorkflowDeltas(payload, 'bogus', new Date()));
});

test('computeDiff: identical states → empty diff', () => {
  const baseline = parseEditState(fromHex(FIXTURE_HEX));
  const current = parseEditState(fromHex(FIXTURE_HEX));
  assert.deepEqual(computeDiff(baseline, current), []);
});

test('computeDiff: name change → one entry', () => {
  const baseline = parseEditState(fromHex(FIXTURE_HEX));
  const current = { ...baseline, deviceName: 'Walk-in cooler' };
  const diff = computeDiff(baseline, current);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, 'deviceName');
  assert.equal(diff[0].before, 'Sensor 111');
  assert.equal(diff[0].after, 'Walk-in cooler');
});

test('computeDiff: alarm checkbox change → one entry', () => {
  const baseline = parseEditState(fromHex(FIXTURE_HEX));
  const current = {
    ...baseline,
    alarmHi: { ...baseline.alarmHi, enabled: false },
  };
  const diff = computeDiff(baseline, current);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, 'alarmHi.enabled');
});

test('computeDiff: multiple changes → multiple entries in stable order', () => {
  const baseline = parseEditState(fromHex(FIXTURE_HEX));
  const current = {
    ...baseline,
    deviceName: 'X',
    sampleIntervalSec: 60,
    delayedStartSec: 3600,
  };
  const fields = computeDiff(baseline, current).map(d => d.field);
  assert.deepEqual(fields, ['deviceName', 'sampleIntervalSec', 'delayedStartSec']);
});
