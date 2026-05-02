# Monitor edit-and-update implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline editing of user-writable EL-USB-TC config on the `/monitor/` page and three workflow buttons (`Setup & Start`, `Download & Resume`, `Stop Logging`) that wrap Save Config with the right per-workflow byte deltas.

**Architecture:** The spec called for a single-file change to `website/templates/pages/monitor.html`. To make the encoding/diff logic unit-testable without browser/hardware, the pure functions move to a new ES module at `website/static/js/monitor-encoding.mjs`, imported via `<script type="module" src="{% static '...' %}">`. DOM glue and USB calls stay in `monitor.html`. Tests are `node:test` files run with `node --test`. No new npm dependencies.

**Tech stack:** Django template, ES modules, WebUSB API (existing), `node:test` (built-in to Node ≥ 18) for the new unit tests.

**Spec:** `docs/superpowers/specs/2026-05-02-monitor-edit-update-design.md`

---

## File structure

- **Create:** `website/static/js/monitor-encoding.mjs` — pure encoding, parsing, diff functions (no DOM, no USB)
- **Create:** `website/static/js/monitor-encoding.test.mjs` — `node:test` unit tests for the module
- **Modify:** `website/templates/pages/monitor.html` — import the module, add edit form + warning bar + workflow handlers, remove dead code from the DANGER zone

## Public API of `monitor-encoding.mjs`

```js
export const SAMPLE_INTERVAL_PRESETS;   // [{seconds, label}]
export const MAX_SAMPLES = 32510;        // EL-USB-TC sample memory cap
export function encodeDeviceName(name);            // → Uint8Array(16)
export function encodeUint16LE(value);             // → Uint8Array(2)
export function encodeUint32LE(value);             // → Uint8Array(4)
export function encodeStartTimestamp(date);        // → Uint8Array(6)
export function encodeAsciiFloat(value);           // → Uint8Array(8)
export function setBit(byte, index, on);           // → number
export function parseEditState(configBlock);      // → EditState
export function buildEditedConfig(baseline, edits); // → Uint8Array(256)
export function applyWorkflowDeltas(payload, workflow, now); // mutates
export function computeDiff(baselineState, currentState);    // → Array<{field, before, after}>
export function fillDurationLabel(intervalSec);              // → "22d 14h"
export function relativeTimeLabel(deltaSec);                 // → "in 1d 21h 33m"
```

`EditState` shape:
```js
{
  deviceName: string,            // up to 16 chars ASCII
  unitIsF: boolean,              // true = °F, false = °C
  sampleIntervalSec: number,     // one of SAMPLE_INTERVAL_PRESETS[i].seconds
  delayedStartSec: number,       // 0 means immediate start
  alarmHi: { enabled: boolean, value: number },
  alarmLo: { enabled: boolean, value: number },
}
```

Workflow names: `'setup-and-start'`, `'download-and-resume'`, `'stop-logging'`.

---

## Task 1: Scaffold encoding module + first failing test

**Files:**
- Create: `website/static/js/monitor-encoding.mjs`
- Create: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Create empty module with constants**

Write `website/static/js/monitor-encoding.mjs`:

```js
// Pure encoding / parsing / diff helpers for the EL-USB-TC config block.
// No DOM, no USB — everything in here is unit-testable with node:test.

export const MAX_SAMPLES = 32510;

export const SAMPLE_INTERVAL_PRESETS = [
  { seconds: 1,     label: '1 sec' },
  { seconds: 10,    label: '10 sec' },
  { seconds: 30,    label: '30 sec' },
  { seconds: 60,    label: '1 min' },
  { seconds: 300,   label: '5 min' },
  { seconds: 600,   label: '10 min' },
  { seconds: 1800,  label: '30 min' },
  { seconds: 3600,  label: '1 hr' },
  { seconds: 21600, label: '6 hr' },
  { seconds: 43200, label: '12 hr' },
];
```

- [ ] **Step 2: Write failing test for `encodeDeviceName`**

Write `website/static/js/monitor-encoding.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDeviceName } from './monitor-encoding.mjs';

test('encodeDeviceName: short name right-padded with NUL to 16 bytes', () => {
  const out = encodeDeviceName('Sensor 111');
  assert.equal(out.length, 16);
  assert.deepEqual(Array.from(out.slice(0, 10)), [0x53, 0x65, 0x6e, 0x73, 0x6f, 0x72, 0x20, 0x31, 0x31, 0x31]);
  assert.deepEqual(Array.from(out.slice(10)), [0, 0, 0, 0, 0, 0]);
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `node --test website/static/js/monitor-encoding.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'encodeDeviceName'`.

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "scaffold(monitor-encoding): add module with constants and one failing test"
```

---

## Task 2: `encodeDeviceName`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add the failing-edge tests**

Append to `monitor-encoding.test.mjs`:

```js
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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function encodeDeviceName(name) {
  const out = new Uint8Array(16);
  const truncated = (name ?? '').slice(0, 16);
  for (let i = 0; i < truncated.length; i++) {
    const code = truncated.charCodeAt(i);
    out[i] = code < 0x20 || code > 0x7e ? 0x3f : code;
  }
  return out;
}
```

- [ ] **Step 3: Run tests, verify they pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add encodeDeviceName with NUL right-padding and ASCII-only coercion"
```

---

## Task 3: `encodeUint16LE` + sample interval encoding

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { encodeUint16LE, SAMPLE_INTERVAL_PRESETS, fillDurationLabel, MAX_SAMPLES } from './monitor-encoding.mjs';

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
  assert.equal(fillDurationLabel(60), '22d 14h');
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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function encodeUint16LE(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`encodeUint16LE: ${value} out of [0, 65535]`);
  }
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

export function fillDurationLabel(intervalSec, maxSamples = MAX_SAMPLES) {
  const total = intervalSec * maxSamples;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0)              return `${days}d`;
  if (hours > 0)             return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`
Expected: all tests pass (now 10 total).

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add encodeUint16LE and fillDurationLabel"
```

---

## Task 4: `encodeUint32LE` + delayed start helpers

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { encodeUint32LE, relativeTimeLabel } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function encodeUint32LE(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`encodeUint32LE: ${value} out of [0, 4294967295]`);
  }
  return new Uint8Array([
    value         & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

export function relativeTimeLabel(deltaSec) {
  if (deltaSec <= 0) return 'now';
  const days = Math.floor(deltaSec / 86400);
  const hours = Math.floor((deltaSec % 86400) / 3600);
  const minutes = Math.floor((deltaSec % 3600) / 60);
  if (days > 0)    return `in ${days}d ${hours}h`;
  if (hours > 0)   return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return `in ${deltaSec}s`;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add encodeUint32LE and relativeTimeLabel"
```

---

## Task 5: `encodeStartTimestamp`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { encodeStartTimestamp } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function encodeStartTimestamp(date) {
  return new Uint8Array([
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getDate(),
    date.getMonth() + 1,
    date.getFullYear() - 2000,
  ]);
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add encodeStartTimestamp matching EL-USB-TC wall-clock format"
```

---

## Task 6: `encodeAsciiFloat`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { encodeAsciiFloat } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function encodeAsciiFloat(value) {
  // The EL-USB-TC stores alarm thresholds as ASCII floats in 8-byte fields,
  // right-padded with NUL. The exact format EasyLog writes is unverified
  // (the reference capture had no alarms set) — we trim trailing zeros to
  // keep things compact and let the firmware parse a standard decimal.
  const str = String(value);
  if (str.length > 8) {
    throw new RangeError(`encodeAsciiFloat: "${str}" exceeds 8 bytes`);
  }
  const out = new Uint8Array(8);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add encodeAsciiFloat for alarm threshold fields"
```

---

## Task 7: `setBit` and bit-ops

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { setBit } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function setBit(byte, index, on) {
  if (!Number.isInteger(index) || index < 0 || index > 7) {
    throw new RangeError(`setBit: index ${index} out of [0, 7]`);
  }
  const mask = 1 << index;
  return on ? (byte | mask) & 0xff : (byte & ~mask) & 0xff;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add setBit helper"
```

---

## Task 8: `parseEditState`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

The test fixture is the actual 256-byte payload from the EasyLog capture (frame 53). Append to `monitor-encoding.test.mjs`:

```js
import { parseEditState } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
const TD = new TextDecoder('latin1');

export function parseEditState(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const name = TD.decode(buf.slice(0x02, 0x12)).replace(/\0+$/, '');
  const unitWord = dv.getUint16(0x2e, true);
  const intervalSec = dv.getUint16(0x1c, true);
  const delaySec = dv.getUint32(0x18, true);
  const alarmFlags = dv.getUint8(0x20);

  // Alarm threshold ASCII fields — capture had them empty so this is
  // best-effort. parseFloat on garbage returns NaN; we coerce to 0.
  const hiStr = TD.decode(buf.slice(0x70, 0x78)).replace(/\0+/g, '').trim();
  const loStr = TD.decode(buf.slice(0x78, 0x80)).replace(/\0+/g, '').trim();
  const hi = parseFloat(hiStr); const lo = parseFloat(loStr);

  return {
    deviceName: name,
    unitIsF: (unitWord & 0x01) !== 0,
    sampleIntervalSec: intervalSec,
    delayedStartSec: delaySec,
    alarmHi: { enabled: (alarmFlags & 0x01) !== 0, value: Number.isFinite(hi) ? hi : 0 },
    alarmLo: { enabled: (alarmFlags & 0x02) !== 0, value: Number.isFinite(lo) ? lo : 0 },
  };
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add parseEditState for the editable subset of the config block"
```

---

## Task 9: `buildEditedConfig`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { buildEditedConfig } from './monitor-encoding.mjs';

test('buildEditedConfig: returns a 256-byte copy that preserves baseline bytes outside edited offsets', () => {
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);  // identity edit
  const out = buildEditedConfig(baseline, edits);
  assert.equal(out.length, 256);
  assert.deepEqual(Array.from(out), Array.from(baseline));
});

test('buildEditedConfig: changing the device name only touches 0x02-0x11', () => {
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  edits.deviceName = 'Walk-in cooler';
  const out = buildEditedConfig(baseline, edits);
  // Name region updated:
  const newName = TD.decode(out.slice(0x02, 0x12)).replace(/\0+$/, '');
  assert.equal(newName, 'Walk-in cooler');
  // Everything before and after is unchanged:
  assert.deepEqual(Array.from(out.slice(0, 0x02)), Array.from(baseline.slice(0, 0x02)));
  assert.deepEqual(Array.from(out.slice(0x12)),    Array.from(baseline.slice(0x12)));
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
```

You'll need `import { TD } from ...` — actually `TD` is module-private. Use `new TextDecoder('latin1')` inline in the test instead. Patch the relevant test:

```js
test('buildEditedConfig: changing the device name only touches 0x02-0x11', () => {
  const baseline = fromHex(FIXTURE_HEX);
  const edits = parseEditState(baseline);
  edits.deviceName = 'Walk-in cooler';
  const out = buildEditedConfig(baseline, edits);
  const newName = new TextDecoder('latin1').decode(out.slice(0x02, 0x12)).replace(/\0+$/, '');
  assert.equal(newName, 'Walk-in cooler');
  assert.deepEqual(Array.from(out.slice(0, 0x02)), Array.from(baseline.slice(0, 0x02)));
  assert.deepEqual(Array.from(out.slice(0x12)),    Array.from(baseline.slice(0x12)));
});
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function buildEditedConfig(baseline, edits) {
  if (baseline.length !== 256) {
    throw new RangeError(`buildEditedConfig: baseline must be 256 bytes, got ${baseline.length}`);
  }
  const out = new Uint8Array(baseline);  // copy

  // device name → 0x02-0x11
  out.set(encodeDeviceName(edits.deviceName), 0x02);

  // unit °F flag → bit 0 of 0x2E (preserve other bits including 0x2F)
  out[0x2e] = setBit(out[0x2e], 0, edits.unitIsF);

  // sample interval → 0x1C-0x1D
  out.set(encodeUint16LE(edits.sampleIntervalSec), 0x1c);

  // delayed start → 0x18-0x1B
  out.set(encodeUint32LE(edits.delayedStartSec), 0x18);

  // alarm thresholds → 0x70-0x77 (hi), 0x78-0x7F (lo)
  out.set(encodeAsciiFloat(edits.alarmHi.value), 0x70);
  out.set(encodeAsciiFloat(edits.alarmLo.value), 0x78);

  // alarmFlags → bits 0 (hi) and 1 (lo); preserve others
  let flags = out[0x20];
  flags = setBit(flags, 0, edits.alarmHi.enabled);
  flags = setBit(flags, 1, edits.alarmLo.enabled);
  out[0x20] = flags;

  return out;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add buildEditedConfig that splices edits into a baseline block"
```

---

## Task 10: `applyWorkflowDeltas`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { applyWorkflowDeltas } from './monitor-encoding.mjs';

test("applyWorkflowDeltas: 'setup-and-start' zeroes sampleCount, sets timestamp, sets statusFlags bit 0", () => {
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

test("applyWorkflowDeltas: 'download-and-resume' is identical to setup-and-start", () => {
  const baseline = fromHex(FIXTURE_HEX);
  const a = buildEditedConfig(baseline, parseEditState(baseline));
  const b = buildEditedConfig(baseline, parseEditState(baseline));
  const now = new Date(2026, 0, 1, 0, 0, 0);
  applyWorkflowDeltas(a, 'setup-and-start', now);
  applyWorkflowDeltas(b, 'download-and-resume', now);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("applyWorkflowDeltas: 'stop-logging' clears bit 0 of 0x21 and leaves sampleCount/timestamp alone", () => {
  const baseline = fromHex(FIXTURE_HEX);
  const payload = buildEditedConfig(baseline, parseEditState(baseline));
  const now = new Date(2026, 5, 15, 14, 30, 5);
  applyWorkflowDeltas(payload, 'stop-logging', now);
  assert.equal(payload[0x21] & 0x01, 0);
  // sampleCount unchanged from baseline (0x01be = 446)
  assert.equal(payload[0x1e], baseline[0x1e]);
  assert.equal(payload[0x1f], baseline[0x1f]);
  // startTimestamp unchanged
  assert.deepEqual(Array.from(payload.slice(0x12, 0x18)), Array.from(baseline.slice(0x12, 0x18)));
});

test("applyWorkflowDeltas: unknown workflow throws", () => {
  const payload = new Uint8Array(256);
  assert.throws(() => applyWorkflowDeltas(payload, 'bogus', new Date()));
});
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
export function applyWorkflowDeltas(payload, workflow, now) {
  if (payload.length !== 256) {
    throw new RangeError(`applyWorkflowDeltas: payload must be 256 bytes, got ${payload.length}`);
  }
  switch (workflow) {
    case 'setup-and-start':
    case 'download-and-resume':
      payload.set(encodeStartTimestamp(now), 0x12);
      payload[0x1e] = 0; payload[0x1f] = 0;
      payload[0x21] = setBit(payload[0x21], 0, true);
      break;
    case 'stop-logging':
      payload[0x21] = setBit(payload[0x21], 0, false);
      break;
    default:
      throw new Error(`applyWorkflowDeltas: unknown workflow ${workflow}`);
  }
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add applyWorkflowDeltas for the three workflow buttons"
```

---

## Task 11: `computeDiff`

**Files:**
- Modify: `website/static/js/monitor-encoding.mjs`
- Modify: `website/static/js/monitor-encoding.test.mjs`

- [ ] **Step 1: Add tests**

Append to `monitor-encoding.test.mjs`:

```js
import { computeDiff } from './monitor-encoding.mjs';

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
```

- [ ] **Step 2: Implement**

Append to `monitor-encoding.mjs`:

```js
const DIFF_FIELDS = [
  'deviceName',
  'unitIsF',
  'sampleIntervalSec',
  'delayedStartSec',
  'alarmHi.enabled',
  'alarmHi.value',
  'alarmLo.enabled',
  'alarmLo.value',
];

function getField(state, path) {
  const parts = path.split('.');
  let v = state;
  for (const p of parts) v = v?.[p];
  return v;
}

export function computeDiff(baseline, current) {
  const out = [];
  for (const field of DIFF_FIELDS) {
    const before = getField(baseline, field);
    const after  = getField(current, field);
    if (before !== after) out.push({ field, before, after });
  }
  return out;
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `node --test website/static/js/monitor-encoding.test.mjs`
Expected: all tests pass (~30 total).

- [ ] **Step 4: Commit**

```bash
git add website/static/js/monitor-encoding.mjs website/static/js/monitor-encoding.test.mjs
git commit -m "feat(monitor-encoding): add computeDiff for warning bar text"
```

---

## Task 12: HTML — add edit form fields to the device-configuration panel

**Files:**
- Modify: `website/templates/pages/monitor.html` (the device-configuration `<section>`, currently lines ~400-420)

- [ ] **Step 1: Replace the read-only kv block with an editable kv block**

Find the existing block:

```html
<section class="panel">
  <div class="panel-head"><span>device configuration</span><span class="meta" id="cfg-meta">load config to populate</span></div>
  <div class="panel-body">
    <div class="kv" id="config-kv">
      <div class="k">device type</div><div class="v"><span class="dim">·</span></div>
      ...existing kv rows...
    </div>
  </div>
</section>
```

Replace the inner `<div class="panel-body">` with this version. Read-only rows stay as kv divs; editable rows are inputs/selects/radios with `id`s prefixed `edit-`. The warning bar at the bottom is hidden by default (`hidden` attribute).

```html
  <div class="panel-body">
    <div class="kv" id="config-kv">
      <div class="k">device type</div><div class="v" id="ro-device-type"><span class="dim">·</span></div>
      <div class="k">device name</div>
      <div class="v"><input id="edit-name" type="text" maxlength="16" disabled> <span class="dim" id="edit-name-count">0/16</span></div>
      <div class="k">serial number</div><div class="v" id="ro-serial"><span class="dim">·</span></div>
      <div class="k">firmware</div><div class="v" id="ro-firmware"><span class="dim">·</span></div>
      <div class="k">unit</div>
      <div class="v"><select id="edit-unit" disabled><option value="F">°F</option><option value="C">°C</option></select></div>
      <div class="k">sample interval</div>
      <div class="v"><select id="edit-interval" disabled></select></div>
      <div class="k">delayed start</div>
      <div class="v">
        <label><input type="radio" name="edit-delay-mode" value="immediate" disabled> Immediate start</label>
        <label style="margin-left:12px"><input type="radio" name="edit-delay-mode" value="delayed" disabled> Delay the start</label>
        <div id="edit-delay-fields" style="margin-top:6px;margin-left:18px" hidden>
          <input id="edit-delay-date" type="date" disabled>
          <input id="edit-delay-time" type="time" step="1" disabled>
          <select id="edit-delay-ampm" disabled><option>AM</option><option>PM</option></select>
          <span id="edit-delay-hint" class="dim" style="margin-left:8px"></span>
        </div>
      </div>
      <div class="k">temp alarm hi</div>
      <div class="v"><label><input id="edit-alarm-hi-on" type="checkbox" disabled> alarm on hi</label>
        <input id="edit-alarm-hi-value" type="number" step="0.1" disabled style="width:80px;margin-left:10px"> <span class="dim" id="edit-alarm-hi-unit">°F</span></div>
      <div class="k">temp alarm lo</div>
      <div class="v"><label><input id="edit-alarm-lo-on" type="checkbox" disabled> alarm on lo</label>
        <input id="edit-alarm-lo-value" type="number" step="0.1" disabled style="width:80px;margin-left:10px"> <span class="dim" id="edit-alarm-lo-unit">°F</span></div>
      <div class="k">sample count</div><div class="v" id="ro-sample-count"><span class="dim">·</span></div>
      <div class="k">last start timestamp</div><div class="v" id="ro-start-ts"><span class="dim">·</span></div>
      <div class="k">cal1 / cal2</div><div class="v" id="ro-cal"><span class="dim">·</span></div>
      <div class="k">alarm flags / status flags</div><div class="v" id="ro-flags"><span class="dim">·</span></div>
    </div>

    <div id="edit-warning" class="warning-bar" hidden style="margin-top:14px;padding:10px;background:#2a1a0a;border:1px solid #6a4a1a;border-radius:4px;color:#f0a050">
      ⚠ <strong><span id="edit-change-count">0 fields modified</span></strong> — writes to flash<br>
      <span id="edit-diff-text" style="font-size:11px;color:#caa080"></span>
      <div style="margin-top:6px">
        <button id="btn-setup-start">Setup &amp; Start</button>
        <button id="btn-download-resume">Download &amp; Resume</button>
        <button id="btn-stop-logging">Stop Logging</button>
        <button id="btn-discard" class="ghost">Discard changes</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Visual check**

Start the Django dev server: `python website/manage.py runserver` (or whatever the project's runserver invocation is).
Open `http://localhost:8000/monitor/`. Confirm:
- The device-configuration panel renders with inputs visible but greyed out (`disabled`).
- The warning bar at the bottom is hidden.
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): add editable form fields and warning bar to device-configuration panel"
```

---

## Task 13: HTML — remove the DANGER-zone buttons

**Files:**
- Modify: `website/templates/pages/monitor.html` (the `actions` row containing the DANGER zone, currently lines ~392-396)

- [ ] **Step 1: Remove the DANGER-zone block entirely**

Delete this entire `<div>`:

```html
<div class="actions" style="border-top:1px dashed var(--border);padding-top:8px;margin-top:6px">
  <span style="color:var(--orange);font-size:11px;font-family:var(--mono)">⚠ writes flash · armed pending hardware verification ...</span>
  <button id="btn-read-and-restart" ...>Read &amp; Restart</button>
  <button id="btn-restart-logging" ...>Restart Logging</button>
</div>
```

The new workflow buttons live inside `#edit-warning` from Task 12.

- [ ] **Step 2: Visual check**

Reload `http://localhost:8000/monitor/`. Confirm:
- The DANGER-zone `Read & Restart` and `Restart Logging` buttons are gone.
- The `Read sensor → CSV`, `Load Config`, `Download Samples`, `Export CSV`, `Clear Log` buttons remain.
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "refactor(monitor): remove DANGER-zone Read & Restart / Restart Logging buttons"
```

---

## Task 14: JS — load encoding module and populate form on Load Config

**Files:**
- Modify: `website/templates/pages/monitor.html` (the `<script>` block at the top of the `<body>`'s scripts; convert to module)

- [ ] **Step 1: Add `{% load static %}` and convert the script tag to a module**

At the very top of the file, just inside `{% extends ... %}` blocks if any, ensure `{% load static %}` is present. If the file extends a base template, add the load tag to the appropriate `{% block %}`.

Change `<script>` (line ~471) to:

```html
<script type="module">
import {
  SAMPLE_INTERVAL_PRESETS,
  MAX_SAMPLES,
  parseEditState,
  buildEditedConfig,
  applyWorkflowDeltas,
  computeDiff,
  fillDurationLabel,
  relativeTimeLabel,
} from "{% static 'js/monitor-encoding.mjs' %}";
```

The closing `</script>` stays as-is.

- [ ] **Step 2: Populate the sample-interval dropdown on page load**

Find the existing init code at the bottom (`enableConnected(false); setStatus('', 'disconnected'); ...`). Just before those lines, add:

```js
function populateIntervalDropdown() {
  const sel = document.getElementById('edit-interval');
  sel.innerHTML = '';
  for (const p of SAMPLE_INTERVAL_PRESETS) {
    const opt = document.createElement('option');
    opt.value = String(p.seconds);
    opt.textContent = `${p.label}  (${fillDurationLabel(p.seconds)})`;
    sel.appendChild(opt);
  }
}
populateIntervalDropdown();
```

- [ ] **Step 3: Add `populateEditForm` and call it from `loadConfig`**

Add this helper before `loadConfig`:

```js
let baselineEditState = null;  // last loaded EditState (for diff and discard)

function populateEditForm(configBlock) {
  const st = parseEditState(configBlock);
  baselineEditState = st;

  document.getElementById('edit-name').value = st.deviceName;
  document.getElementById('edit-name-count').textContent = `${st.deviceName.length}/16`;
  document.getElementById('edit-unit').value = st.unitIsF ? 'F' : 'C';
  document.getElementById('edit-interval').value = String(st.sampleIntervalSec);

  const isImmediate = st.delayedStartSec === 0;
  document.querySelector('input[name="edit-delay-mode"][value="immediate"]').checked = isImmediate;
  document.querySelector('input[name="edit-delay-mode"][value="delayed"]').checked = !isImmediate;
  document.getElementById('edit-delay-fields').hidden = isImmediate;

  document.getElementById('edit-alarm-hi-on').checked = st.alarmHi.enabled;
  document.getElementById('edit-alarm-hi-value').value = st.alarmHi.value;
  document.getElementById('edit-alarm-lo-on').checked = st.alarmLo.enabled;
  document.getElementById('edit-alarm-lo-value').value = st.alarmLo.value;

  // Enable inputs (they start disabled when no device is connected)
  for (const id of ['edit-name', 'edit-unit', 'edit-interval',
                    'edit-alarm-hi-on', 'edit-alarm-hi-value',
                    'edit-alarm-lo-on', 'edit-alarm-lo-value']) {
    document.getElementById(id).disabled = false;
  }
  for (const r of document.querySelectorAll('input[name="edit-delay-mode"]')) r.disabled = false;
  for (const id of ['edit-delay-date', 'edit-delay-time', 'edit-delay-ampm']) {
    document.getElementById(id).disabled = isImmediate;
  }
}
```

In the existing `loadConfig` function, after the line `renderConfig(lastConfig);`, add:

```js
populateEditForm(buf);
```

- [ ] **Step 4: Visual check**

Reload `/monitor/`. Connect to a real device → Load Config. Confirm:
- The interval dropdown is populated with `1 sec (9h 1m)`, `10 sec (3d 18h)`, …, `12 hr (16255d)`.
- After Load Config, the device-name input shows the device name, the interval dropdown is set to the device's current interval, the unit select shows °F/°C, the alarm checkboxes/inputs reflect the device.

- [ ] **Step 5: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): import encoding module and populate edit form on Load Config"
```

---

## Task 15: JS — dirty tracking and warning-bar visibility

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Add `getCurrentEditState` and `updateWarningBar`**

Add after `populateEditForm`:

```js
function getCurrentEditState() {
  const delayMode = document.querySelector('input[name="edit-delay-mode"]:checked')?.value;
  let delayedStartSec = 0;
  if (delayMode === 'delayed') {
    const date = document.getElementById('edit-delay-date').value;       // "2026-05-04"
    const time = document.getElementById('edit-delay-time').value;       // "08:00:00"
    const ampm = document.getElementById('edit-delay-ampm').value;       // "AM" | "PM"
    if (date && time) {
      const [h, m, s] = time.split(':').map(Number);
      const hour24 = ampm === 'PM' ? (h % 12) + 12 : (h % 12);
      const target = new Date(`${date}T${String(hour24).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s||0).padStart(2,'0')}`);
      delayedStartSec = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
    }
  }
  return {
    deviceName: document.getElementById('edit-name').value,
    unitIsF: document.getElementById('edit-unit').value === 'F',
    sampleIntervalSec: parseInt(document.getElementById('edit-interval').value, 10),
    delayedStartSec,
    alarmHi: {
      enabled: document.getElementById('edit-alarm-hi-on').checked,
      value: parseFloat(document.getElementById('edit-alarm-hi-value').value) || 0,
    },
    alarmLo: {
      enabled: document.getElementById('edit-alarm-lo-on').checked,
      value: parseFloat(document.getElementById('edit-alarm-lo-value').value) || 0,
    },
  };
}

function updateWarningBar() {
  if (!baselineEditState) {
    document.getElementById('edit-warning').hidden = true;
    document.getElementById('edit-delay-hint').textContent = '';
    return;
  }
  const current = getCurrentEditState();
  const diff = computeDiff(baselineEditState, current);
  // Always update the delayed-start hint, even when nothing is dirty.
  document.getElementById('edit-delay-hint').textContent =
    current.delayedStartSec > 0 ? relativeTimeLabel(current.delayedStartSec) : '';
  const bar = document.getElementById('edit-warning');
  if (diff.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById('edit-change-count').textContent =
    `${diff.length} field${diff.length === 1 ? '' : 's'} modified`;
  document.getElementById('edit-diff-text').textContent =
    diff.map(d => `${d.field}: ${d.before} → ${d.after}`).join(' · ');
}
```

- [ ] **Step 2: Wire change listeners on every editable input**

Add after `populateIntervalDropdown();`:

```js
const EDIT_INPUT_IDS = [
  'edit-name', 'edit-unit', 'edit-interval',
  'edit-delay-date', 'edit-delay-time', 'edit-delay-ampm',
  'edit-alarm-hi-on', 'edit-alarm-hi-value',
  'edit-alarm-lo-on', 'edit-alarm-lo-value',
];
for (const id of EDIT_INPUT_IDS) {
  document.getElementById(id).addEventListener('input', updateWarningBar);
  document.getElementById(id).addEventListener('change', updateWarningBar);
}
for (const r of document.querySelectorAll('input[name="edit-delay-mode"]')) {
  r.addEventListener('change', () => {
    const delayed = document.querySelector('input[name="edit-delay-mode"]:checked').value === 'delayed';
    document.getElementById('edit-delay-fields').hidden = !delayed;
    for (const id of ['edit-delay-date', 'edit-delay-time', 'edit-delay-ampm']) {
      document.getElementById(id).disabled = !delayed;
    }
    updateWarningBar();
  });
}
document.getElementById('edit-name').addEventListener('input', () => {
  const len = document.getElementById('edit-name').value.length;
  document.getElementById('edit-name-count').textContent = `${len}/16`;
});
```

- [ ] **Step 3: Visual check**

Reload, connect, Load Config. Edit the device-name field. Confirm:
- Warning bar appears at the bottom of the panel.
- The change count says `1 field modified` and the diff text reads `deviceName: <old> → <new>`.
- Reverting the field back to the original value hides the bar.

- [ ] **Step 4: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): dirty tracking with warning bar and inline diff"
```

---

## Task 16: JS — Discard changes handler

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Wire the Discard button**

Add near the other event-handler wirings at the bottom of the script:

```js
document.getElementById('btn-discard').addEventListener('click', () => {
  if (!baselineEditState || !lastConfig?.raw) return;
  populateEditForm(lastConfig.raw);
  updateWarningBar();
  log('discarded pending edits — form back to last-loaded values', 'info');
});
```

- [ ] **Step 2: Visual check**

Reload, connect, Load Config, edit a field, click `Discard changes`. Confirm:
- Field reverts to original.
- Warning bar disappears.
- Log shows `discarded pending edits …`.

- [ ] **Step 3: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): wire Discard changes button"
```

---

## Task 17: JS — Setup & Start workflow handler **(hardware test)**

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Add the workflow runner**

Add before the event-handler wirings:

```js
async function runWorkflow(label, workflow, opts = {}) {
  if (!device) { log('not connected', 'warn'); return; }
  if (busy) { log('command in flight, wait', 'warn'); return; }
  if (!lastConfig?.raw) { log('load config first — need a baseline block', 'warn'); return; }
  log(`── ${label.toUpperCase()} ──`, 'cmd');
  setBusy(true);
  try {
    if (opts.preDownload) {
      // Inline the relevant parts of downloadSamples — it sets busy itself,
      // so call its core via withCommandEnvelope here.
      log('  pre-step: download samples + CSV export', 'info');
      await withCommandEnvelope('Download Samples', async () => {
        await sendCmd(new Uint8Array([0x03, 0xFF, 0xFF]));
        const buf = await readFramed();
        lastSampleBytes = buf;
        renderHexDump(buf);
        decodeAndRender();
      });
      exportCsv();
    }
    const edits = getCurrentEditState();
    const payload = buildEditedConfig(lastConfig.raw, edits);
    applyWorkflowDeltas(payload, workflow, new Date());
    await saveConfig(payload);
    log(`✓ ${label} saved · re-loading config to verify`, 'ok');
    await loadConfig();  // re-baselines the form
  } catch (err) {
    log(`${label} failed: ${err.message}`, 'error');
    log('  device state may be uncertain — running Load Config to surface what is actually on the device', 'warn');
    try { await loadConfig(); } catch (e) { /* already logged */ }
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 2: Wire `Setup & Start`**

Add to the event-handler section:

```js
document.getElementById('btn-setup-start').addEventListener('click', () =>
  runWorkflow('Setup & Start', 'setup-and-start'));
```

- [ ] **Step 3: Hardware verification**

On the Jetson with a real EL-USB-TC plugged in:

1. Disconnect → reconnect → Load Config. Note current device name, interval, alarm thresholds.
2. Edit only the device name (e.g., add a digit). Click `Setup & Start`.
3. Wait for the success log line and the automatic Load Config.
4. Verify: name updated, `sampleCount` shown in the panel went to 0, last start timestamp is ~now, status flags shows `logging=on`.
5. Disconnect → reconnect → Load Config. Verify: name still updated, interval / alarms / firmware unchanged.
6. Cross-check with EasyLog Win32 if available.

If verification reveals corruption: revert this commit, investigate before continuing to Task 18 / 19.

- [ ] **Step 4: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): Setup & Start workflow — save edits, zero count, set timestamp, start logging"
```

---

## Task 18: JS — Download & Resume workflow handler **(hardware test)**

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Wire the button using the same runner**

Add to the event-handler section:

```js
document.getElementById('btn-download-resume').addEventListener('click', () =>
  runWorkflow('Download & Resume', 'download-and-resume', { preDownload: true }));
```

- [ ] **Step 2: Hardware verification**

On the Jetson:

1. Reconnect → Load Config → Setup & Start (from Task 17) so the device has fresh logging state and at least a few samples accumulate.
2. Wait ~30 seconds with the device-side at a reasonable temperature so a handful of samples are captured.
3. Click `Download & Resume`.
4. Verify: a CSV download fires, the warning-bar disappears (form re-baselined), the panel shows `sampleCount = 0` and a new start timestamp.
5. Disconnect → reconnect → Load Config. Verify metadata intact.

- [ ] **Step 3: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): Download & Resume workflow — download samples, CSV export, restart logging"
```

---

## Task 19: JS — Stop Logging workflow handler **(hardware test)**

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Wire the button**

Add to the event-handler section:

```js
document.getElementById('btn-stop-logging').addEventListener('click', () =>
  runWorkflow('Stop Logging', 'stop-logging'));
```

- [ ] **Step 2: Hardware verification**

On the Jetson:

1. Reconnect → Load Config. Confirm `logging=on`.
2. Click `Stop Logging`.
3. Verify: panel re-loads with `logging=off`, `sampleCount` and `last start timestamp` UNCHANGED.
4. Disconnect → reconnect → Load Config → still `logging=off`, samples preserved.

- [ ] **Step 3: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "feat(monitor): Stop Logging workflow — clear statusFlags bit 0, preserve samples and timestamp"
```

---

## Task 20: Remove dead code — old restartLogging and atomicRead-restart path

**Files:**
- Modify: `website/templates/pages/monitor.html`

- [ ] **Step 1: Delete the old `restartLogging` function**

Remove the entire `async function restartLogging() { ... }` block (currently around lines 920-956). The functionality is replaced by `runWorkflow(...)`.

- [ ] **Step 2: Simplify `atomicRead`**

The `atomicRead({ andRestart })` function in the existing code branches on `andRestart`. With the workflow buttons, the `andRestart: true` branch is dead. Replace `atomicRead` with a read-only version:

```js
async function atomicReadOnly() {
  // load → download → CSV. No write. Used by the "Read sensor → CSV" button.
  if (!device) { log('not connected', 'warn'); return; }
  if (busy) { log('command in flight, wait', 'warn'); return; }
  log('── READ SENSOR (atomic) ──', 'cmd');
  try {
    await loadConfig();
    if (!lastConfig) throw new Error('Load Config did not return data');
    await downloadSamples();
    if (!lastSampleBytes) throw new Error('Download Samples did not return data');
    exportCsv();
    log(`✓ sensor "${lastConfig.deviceName}" (sn ${lastConfig.serialNumber}) · ${lastConfig.sampleCount} samples · CSV exported`, 'ok');
  } catch (err) {
    log(`atomic flow failed: ${err.message}`, 'error');
  }
}

document.getElementById('btn-read-sensor').addEventListener('click', atomicReadOnly);
```

Delete the now-unused `atomicRead` function and the existing `btn-read-and-restart` / `btn-restart-logging` event handlers (those buttons no longer exist after Task 13 anyway).

- [ ] **Step 3: Visual + smoke check**

Reload `/monitor/`. Confirm:
- `Read sensor → CSV` still works (read-only).
- No JS console errors about missing buttons or undefined functions.
- `grep -n "restartLogging\|atomicRead\b" monitor.html` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add website/templates/pages/monitor.html
git commit -m "refactor(monitor): remove dead restartLogging and atomicRead-restart code paths"
```

---

## Final hardware verification (all workflows together)

After Task 20, run the full sequence on the Jetson once to confirm nothing regressed:

1. Connect → Load Config → metadata baseline noted.
2. Edit device name + interval. Click `Setup & Start`. Verify name and interval changed, sampleCount=0, fresh timestamp, logging=on.
3. Wait ~30s. Click `Download & Resume`. Verify CSV downloaded, sampleCount=0, fresh timestamp.
4. Click `Stop Logging`. Verify logging=off, samples still present.
5. Click `Setup & Start` again. Verify back to logging=on with the new fresh timestamp.
6. Disconnect → reconnect → Load Config one final time → verify the device has the metadata you expect (and not the old corrupted-looking blanks).

If anything fails, paste the session log and the failing step's expected vs actual into a follow-up.
