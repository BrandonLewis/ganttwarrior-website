// Pure encoding / parsing / diff helpers for the EL-USB-TC config block.
// No DOM, no USB — everything in here is unit-testable with node:test.

export const MAX_SAMPLES = 32510;

export const SAMPLE_INTERVAL_PRESETS = Object.freeze([
  Object.freeze({ seconds: 1,     label: '1 sec' }),
  Object.freeze({ seconds: 10,    label: '10 sec' }),
  Object.freeze({ seconds: 30,    label: '30 sec' }),
  Object.freeze({ seconds: 60,    label: '1 min' }),
  Object.freeze({ seconds: 300,   label: '5 min' }),
  Object.freeze({ seconds: 600,   label: '10 min' }),
  Object.freeze({ seconds: 1800,  label: '30 min' }),
  Object.freeze({ seconds: 3600,  label: '1 hr' }),
  Object.freeze({ seconds: 21600, label: '6 hr' }),
  Object.freeze({ seconds: 43200, label: '12 hr' }),
]);

export function encodeDeviceName(name) {
  const out = new Uint8Array(16);
  const truncated = (name ?? '').slice(0, 16);
  for (let i = 0; i < truncated.length; i++) {
    const code = truncated.charCodeAt(i);
    out[i] = code < 0x20 || code > 0x7e ? 0x3f : code;
  }
  return out;
}

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

export function encodeStartTimestamp(date) {
  const year = date.getFullYear();
  if (year < 2000 || year > 2099) {
    throw new RangeError(`encodeStartTimestamp: year must be in [2000, 2099], got ${year}`);
  }
  return new Uint8Array([
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getDate(),
    date.getMonth() + 1,
    year - 2000,
  ]);
}

export function encodeAsciiFloat(value) {
  // The EL-USB-TC stores alarm thresholds as ASCII floats in 8-byte fields,
  // right-padded with NUL. The exact format EasyLog writes is unverified
  // (the reference capture had no alarms set) — we trim trailing zeros to
  // keep things compact and let the firmware parse a standard decimal.
  if (!Number.isFinite(value)) {
    throw new RangeError(`encodeAsciiFloat: value must be finite, got ${value}`);
  }
  const str = String(value);
  if (str.length > 8) {
    throw new RangeError(`encodeAsciiFloat: "${str}" exceeds 8 bytes`);
  }
  const out = new Uint8Array(8);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

export function setBit(byte, index, on) {
  if (!Number.isInteger(index) || index < 0 || index > 7) {
    throw new RangeError(`setBit: index ${index} out of [0, 7]`);
  }
  const mask = 1 << index;
  return on ? (byte | mask) & 0xff : (byte & ~mask) & 0xff;
}

const TD = new TextDecoder('latin1');

export function parseEditState(buf) {
  if (buf.length < 256) {
    throw new RangeError(`parseEditState: buffer must be ≥ 256 bytes, got ${buf.length}`);
  }
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

  // alarm thresholds → 0x70-0x77 (hi), 0x78-0x7F (lo).
  // When an alarm is enabled, always write a canonical ASCII representation
  // of its value to the threshold offset. We used to skip the write when the
  // value was 0, but that left whatever stale bytes happened to be in flash
  // at 0x70 / 0x78 as the live threshold even though the form showed "0".
  // Writing unconditionally on enable means enabling an alarm at 0 produces
  // a deterministic '0\0\0\0\0\0\0\0' on the wire, matching what the user
  // sees in the form. Disabled alarms still leave the bytes untouched.
  if (edits.alarmHi.enabled) out.set(encodeAsciiFloat(edits.alarmHi.value), 0x70);
  if (edits.alarmLo.enabled) out.set(encodeAsciiFloat(edits.alarmLo.value), 0x78);

  // alarmFlags → bits 0 (hi) and 1 (lo); preserve others
  let flags = out[0x20];
  flags = setBit(flags, 0, edits.alarmHi.enabled);
  flags = setBit(flags, 1, edits.alarmLo.enabled);
  out[0x20] = flags;

  return out;
}

export function applyWorkflowDeltas(payload, workflow, now) {
  if (payload.length !== 256) {
    throw new RangeError(`applyWorkflowDeltas: payload must be 256 bytes, got ${payload.length}`);
  }
  switch (workflow) {
    case 'setup-and-start':
    case 'download-and-resume': {
      // EasyLog (per the second pcap reference) writes startTimestamp = the
      // TARGET wall-clock when logging will begin (= now + delayedStartSec),
      // not the save-time. delayedStartSec was already spliced into the
      // payload by buildEditedConfig — read it back to derive the target.
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const delaySec = dv.getUint32(0x18, true);
      const target = new Date(now.getTime() + delaySec * 1000);
      payload.set(encodeStartTimestamp(target), 0x12);
      payload[0x1e] = 0; payload[0x1f] = 0;
      payload[0x21] = setBit(payload[0x21], 0, true);
      break;
    }
    case 'stop-logging':
      // The firmware appears to ignore writes to bit 0 of 0x21 — every Load
      // after a 0x00 write reads back 0x01. EasyLog also writes 0x00 here
      // (twice in the reference capture) without effect. We mirror that
      // behavior; actually stopping the device requires the physical button.
      payload[0x21] = setBit(payload[0x21], 0, false);
      break;
    default:
      throw new Error(`applyWorkflowDeltas: unknown workflow ${workflow}`);
  }
}

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
