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
