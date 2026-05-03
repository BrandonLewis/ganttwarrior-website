# Monitor — edit & update user-writable EL-USB-TC config

**Date:** 2026-05-02
**File touched:** `website/templates/pages/monitor.html` (single-file change)
**Predecessor:** commit `4bd81fa` (per-command vendor envelope around Load / Download / Save Config)

## Problem

The `/monitor/` page can read the EL-USB-TC's 256-byte config block and (as of `4bd81fa`) write it back without corrupting metadata, but it has no UI for editing user-writable fields. To use the page in the field — set up a sensor for a pour, download samples and resume logging, stop logging — the user has to drop into EasyLog Win32 to change anything. The goal of this spec is to add an inline edit form on the existing config panel and three workflow buttons that cover the field-use cases end-to-end.

PWA packaging (manifest, service worker, install prompt) is **out of scope** here and gets its own spec once this design is verified on hardware.

## Architecture & UI shape

Single-file change to `website/templates/pages/monitor.html`. The existing **device configuration** panel becomes editable in place. Read-only fields keep rendering as dim text; editable fields render as inputs / selects / radios using EasyLog-style controls.

A "changes pending" indicator appears in the panel header, and a warning bar at the bottom of the panel becomes visible when any field is dirty. The bar shows a plain-language diff of pending changes ("name → 'Walk-in cooler #2', interval → 1 min, …") and the four action controls:

- `Setup & Start`
- `Download & Resume`
- `Stop Logging`
- `Discard changes`

Existing diagnostic / read-only buttons (`Connect`, `Disconnect`, `Load Config`, `Download Samples`, `Read sensor → CSV`, `Export CSV`, `Clear Log`) stay where they are. The current `Save Config` / `Save + Restart Logging` / `Restart Logging` buttons in the DANGER zone are **replaced** by the workflow buttons in the new warning bar.

The save-confirm step is the warning bar itself (no separate modal). The bar is a deliberate visual stop with the diff in plain language; clicking a workflow button commits to the wire. `Discard changes` is one click away.

### EasyLog-style controls

| Field | Control |
|---|---|
| device name | text input, `maxlength="16"`, with a `N/16` counter |
| unit | `<select>` with `°F` / `°C` |
| sample interval | `<select>` of presets, each label includes the fill duration: `1 sec (9h 1m)`, `10 sec (3d 18h)`, `30 sec (11d 7h)`, `1 min (22d 14h)`, `5 min (112d 21h)`, `10 min (225d 18h)`, `30 min (677d 7h)`, `1 hr (1354d 14h)`, `6 hr (8127d 12h)`, `12 hr (16255d)` |
| delayed start | radio `Immediate start` / `Delay the start of the logger`; when delayed, native `<input type="date">` (calendar picker) + `<input type="time">` + `<select>` AM/PM, with a "in 1d 21h 33m" hint |
| temp alarm hi | "alarm on hi" `<input type="checkbox">` + numeric `<input>` |
| temp alarm lo | "alarm on lo" `<input type="checkbox">` + numeric `<input>` |

A field is "dirty" if its rendered value differs from the value in the last-loaded config block. The warning bar's change count and diff text are derived from this comparison. Discard sets every field back to its last-loaded value.

## Editable fields & wire mapping

Each editable UI control maps to a specific byte range in the 256-byte config block. On Save, the workflow takes the last-loaded block as a baseline, splices in edits per this table (and the workflow-specific deltas in the next section), and writes the result.

| UI control | Wire offset | Encoding |
|---|---|---|
| device name | `0x02–0x11` (16 B) | ASCII; right-pad with `0x00` |
| unit °C/°F | `0x2E` (uint16 LE) | flip bit 0 only; preserve other bits from last-loaded value (capture shows non-trivial bits here) |
| sample interval | `0x1C–0x1D` (uint16 LE) | preset → seconds (1, 10, 30, 60, 300, 600, 1800, 3600, 21600, 43200) |
| delayed start | `0x18–0x1B` (uint32 LE) | `0` if Immediate; else `max(0, target_epoch − now_epoch)` in seconds at save time |
| temp alarm hi | `0x70–0x77` (8 B ASCII) | numeric → ASCII float, right-pad with `0x00` |
| temp alarm lo | `0x78–0x7F` (8 B ASCII) | same as hi |
| `alarmFlags` | `0x20` (uint8) | derived from the two alarm checkboxes; preserve other bits from last-loaded value |

**Read-only and never modified by the form:** `0x00` (device type), `0x24` (cal1), `0x28` (cal2), `0x30–0x33` (firmware), `0x34–0x35` (serial number), and any byte at an offset whose purpose is not yet documented (e.g. `0x22–0x23`, `0x2C–0x2D`, parts of `0x36+`). These are copied verbatim from the last-loaded baseline.

`sampleCount` (`0x1E–0x1F`), `startTimestamp` (`0x12–0x17`), and `statusFlags` bit 0 (`0x21`) are touched by the workflow buttons, not by the form fields.

## Workflow buttons & wire-level behavior

All three workflow buttons:

1. Take the last-loaded 256-byte config block as a baseline copy.
2. Splice in the edited form fields per the table above.
3. Apply the workflow-specific deltas below.
4. Send Save Config (wrapped in `withCommandEnvelope` exactly the way the current `saveConfig` does).
5. After ACK, run Load Config so the user sees the device's new state and the form re-baselines to non-dirty.

| Button | Pre-step | Save Config payload deltas | Post-step |
|---|---|---|---|
| **Setup & Start** | — | `sampleCount = 0`; `startTimestamp = now` (host wall-clock); `statusFlags` bit 0 = 1 | Load Config |
| **Download & Resume** | Bulk Download Samples → CSV export | same as Setup & Start | Load Config |
| **Stop Logging** | — | `statusFlags` bit 0 = 0; `sampleCount`, `startTimestamp` left as-loaded | Load Config |
| **Discard changes** | — | (no USB) | revert form to last-loaded values |

### Notes

- **Delayed start in workflows 1 and 2:** if `Immediate` is selected, `delayedStartSec = 0`. If `Delay` is selected, `delayedStartSec = max(0, target_epoch − now_epoch)` and `startTimestamp = now`. The device counts `delayedStartSec` down from the save and begins sampling at `startTimestamp + delayedStartSec`. (If hardware test reveals the firmware expects `startTimestamp = target` instead, this changes — see Risks.)
- **Transport:** every USB exchange (Download Samples, Save Config, the trailing Load Config) goes through the existing `withCommandEnvelope`. No new transport code.
- **Concurrency:** all three workflow buttons are disabled while `busy === true`, and only enabled when `lastConfig !== null` (we need a baseline block to splice into, which means at least one Load Config must have run this session).
- **Failure handling:** errors are caught at the workflow level. On failure: log the error, leave the form dirty (don't re-baseline), and run a final Load Config so the user sees what the device actually has now. The user can retry or Discard.
- **`Save edits without restart`** — not a button. Not in any of the three workflows. If the user wants to change settings without affecting logging state, they pick the workflow that matches their actual intent (`Setup & Start`, `Download & Resume`, or `Stop Logging`) and the edits ride along.

## Risks & follow-ups

### Hardware-test items (verify on first run)

1. **Save Config with the new envelope hasn't been hardware-verified yet.** Commit `4bd81fa` added `withCommandEnvelope` but no save has been written to a real device since. The whole spec rests on Save Config not corrupting metadata. Verification order from the previous turn:
   - Connect → Load Config → Disconnect; reconnect → Load Config → metadata unchanged.
   - Connect → Load Config → Download Samples → Disconnect; reconnect → Load Config → metadata unchanged.
   - Cross-check with EasyLog Win32 (or equivalent).
   - Connect → Load Config → write a known-safe edit (e.g., name change only) → Save Config → reconnect → Load Config → confirm name changed and everything else unchanged.
2. **Alarm threshold byte format** at `0x70` / `0x78`. Reference capture had no alarms set, so those bytes were zero. First test: set hi/lo to known values, save, reload, confirm round-trip.
3. **`unit` byte at `0x2E`.** Captured value was `0x0021`, not the expected `0x0000` / `0x0001`. We flip bit 0 and preserve the rest. First test: toggle °F → °C, save, reload, confirm.
4. **Delayed start interpretation.** Spec says `startTimestamp = now`, `delayedStartSec = countdown`. First test: set delay to ~60 sec, save, watch the device actually begin logging at the right time.
5. **Bytes at unknown offsets** (`0x22-0x23`, `0x2C-0x2D`, parts of `0x36+`). Spec rule: copy verbatim from last-loaded baseline; never touch what we don't understand. Worth noting in code so future contributors keep it that way.

### Out of scope (deferred)

- **PWA shell** (`manifest.json`, icons, service worker, install prompt) — own spec once this is solid.
- **Workflow 2 option b** (preserve previous samples on resume — `sampleCount` left non-zero). Defer until we've confirmed the firmware supports it.
- **Mobile / tablet layout** for the dense `/monitor/` page — only matters once we're packaging as a PWA.
- **Custom sample interval** outside the preset list — preset-only matches EasyLog and keeps the UX simple.
- **Editing alarm-trigger semantics** beyond the two on/off bits we expose. If `alarmFlags` has more bits with meaning, we deal with them when we know what they do.
