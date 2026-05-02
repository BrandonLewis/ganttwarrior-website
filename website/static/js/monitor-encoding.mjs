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
  return new Uint8Array([
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getDate(),
    date.getMonth() + 1,
    date.getFullYear() - 2000,
  ]);
}

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

export function setBit(byte, index, on) {
  if (!Number.isInteger(index) || index < 0 || index > 7) {
    throw new RangeError(`setBit: index ${index} out of [0, 7]`);
  }
  const mask = 1 << index;
  return on ? (byte | mask) & 0xff : (byte & ~mask) & 0xff;
}
