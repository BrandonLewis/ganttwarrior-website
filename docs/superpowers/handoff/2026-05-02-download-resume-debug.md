# Download & Resume debug — handoff to Jetson session

**Date:** 2026-05-02
**Branch:** `feat/monitor-edit-update`
**Latest commit on the branch:** `75f46ab` (Download & Resume — no envelope traffic during the settling pause)
**Hardware:** Lascar EL-USB-TC, VID `0x10C4`, PID `0x0002`, full-speed bulk EP 2 IN/OUT, 64-byte packet.

## TL;DR

Most of the monitor edit-and-update feature works. The one path still failing on real hardware is **Download & Resume**: it leaves the EL-USB-TC stuck at `0x21 = 0x01` (armed) instead of transitioning to `0x03` (logging) after the post-Download setup-and-start save. We've matched the byte-level wire pattern and timing of EasyLog's reference capture (`easylog-reference-2.pcapng`) as closely as we can see from the JS side, but it still fails. Remaining diagnostic options needed to break the deadlock:

1. **Capture our actual JS-driven USB output** and diff byte-for-byte against EasyLog's pcap. Jetson kernel doesn't have `usbmon`, and Windows requires Zadig (which kills EasyLog with this device temporarily).
2. **Replay EasyLog's exact wire pattern via `pyusb`** on the Jetson (no driver swaps, no kernel hacking). If pyusb-replay puts the device into `logging`, we know our JS is putting different bytes on the wire — and we can adjust. If pyusb-replay also fails, the firmware itself is the limit and we drop the combined flow.

The handoff session should write and run option 2.

## Status of all the workflows

| Workflow | Status |
|---|---|
| Connect / Disconnect | ✅ works |
| Load Config (`00 FF FF`) | ✅ works |
| Download Samples (`03 FF FF` → 65024-byte read) | ✅ works |
| Read sensor → CSV (Load + Download + CSV, no save) | ✅ works |
| Setup & Start (immediate or delayed) | ✅ works — device transitions `idle (0x02)` or `armed (0x01)` → `logging (0x03)` |
| Stop Logging | ⚠ no-op on this firmware (writes ACK, but firmware ignores writes that clear bit 0 of `0x21`). Capture 1 and 2 confirm EasyLog's stop save also doesn't actually stop the device. |
| Download & Resume (combined) | ❌ leaves device stuck at `armed (0x01)`. Battery pull required to recover. |
| In-place form editing (name, unit, interval, delayed start, alarms) | ✅ works for Setup & Start path |

## Status byte (`0x21`) state map

Empirically observed across all three pcaps + hardware testing:

| Value | State | How you reach it |
|---|---|---|
| `0x00` | transient | Just after Download (firmware clears flags briefly) |
| `0x01` | armed | Host wrote it via Setup & Start; device hasn't begun recording yet (delayed countdown, OR stuck) |
| `0x02` | idle | Power cycle (battery pull); session ended without a new setup |
| `0x03` | logging | Armed + recording (sensor sets bit 1 once sample collection actually begins) |

## Key files

- **`website/templates/pages/monitor.html`** — single-page Django template, all the WebUSB code. The `runWorkflow` function (~line 1280 onwards) is where Download & Resume lives.
- **`website/static/js/monitor-encoding.mjs`** — pure-function ES module: encoding, parsing, diff, workflow deltas. 47 unit tests passing (`node --test website/static/js/monitor-encoding.test.mjs`).
- **`website/static/js/monitor-encoding.test.mjs`** — `node:test` unit tests. Run with `node --test`.
- **`docs/superpowers/specs/2026-05-02-monitor-edit-update-design.md`** — original spec.
- **`docs/superpowers/plans/2026-05-02-monitor-edit-update.md`** — original 20-task TDD plan.

## Wire protocol summary

### USB endpoints
- Bulk EP 2 OUT — host → device commands and Save Config payloads
- Bulk EP 2 IN — device → host responses

### Per-command vendor envelope
EasyLog wraps **every** command (Load, Download, Save) in this envelope. Our code does the same via `withCommandEnvelope()` and `vendorSetup()` / `vendorTeardown()`:

```
Setup (3 OUTs):   bmReqType=0x40  bRequest=0x00  wValue=0xFFFF
                  bmReqType=0x40  bRequest=0x02  wValue=0x0002
                  bmReqType=0x40  bRequest=0x02  wValue=0x0001
[bulk exchange — Load / Download / Save Config]
Teardown (1 OUT): bmReqType=0x40  bRequest=0x02  wValue=0x0004
```

### Commands
- **Load Config** — `bulk OUT 0x00 0xFF 0xFF` → `bulk IN 3-byte header [0x02 LL HH]` + `bulk IN 256-byte payload`
- **Download Samples** — `bulk OUT 0x03 0xFF 0xFF` → `bulk IN 3-byte header [0x02 0x00 0xFE]` (length 0xFE00 = 65024) + `bulk IN 65024 bytes`
- **Save Config** — `bulk OUT 0x01 0x00 0x01` (length 256 LE) + `bulk OUT 256-byte payload` → `bulk IN 1-byte ACK 0xFF` (poll up to 3s, may return ZLP first)

### 256-byte config block layout

| Offset | Length | Field | Notes |
|---|---|---|---|
| `0x00` | 1 | deviceType | `0x0a` = EL-USB-TC, read-only |
| `0x02-0x11` | 16 | deviceName | ASCII, NUL-padded right |
| `0x12-0x17` | 6 | startTimestamp | `HH MI SS DD MO YY` (YY is year - 2000), wall-clock when logging will begin |
| `0x18-0x1B` | 4 | delayedStartSec | uint32 LE, seconds from save time to start |
| `0x1C-0x1D` | 2 | sampleIntervalSec | uint16 LE seconds |
| `0x1E-0x1F` | 2 | sampleCount | uint16 LE, current count of samples logged |
| `0x20` | 1 | alarmFlags | bit 0 = high alarm enable, bit 1 = low alarm enable, bits 2-7 = unknown firmware-set indicators |
| `0x21` | 1 | statusFlags | see state map above |
| `0x22-0x23` | 2 | unknown | always `10 13` in observed devices, copied verbatim |
| `0x24-0x27` | 4 | cal1 | float32 LE, factory ADC calibration |
| `0x28-0x2B` | 4 | cal2 | float32 LE, factory ADC calibration |
| `0x2C-0x2D` | 2 | unknown | observed `00 00`, copied verbatim |
| `0x2E-0x2F` | 2 | unit | uint16 LE; bit 0 = °F flag (1 = F, 0 = C); other bits non-zero in real devices, must preserve |
| `0x30-0x33` | 4 | firmware | ASCII (often empty in this device family) |
| `0x34-0x35` | 2 | serialNumber | uint16 LE |
| `0x70-0x77` | 8 | tempAlarmHi | ASCII float, NUL-padded — only written when alarm enabled |
| `0x78-0x7F` | 8 | tempAlarmLo | ASCII float, NUL-padded — only written when alarm enabled |
| (everything else) | | unknown | preserved verbatim from baseline |

## The three reference captures

All in `C:\Users\brand\OneDrive\Documents\` on Brandon's Windows box. Copy to the Jetson if needed.

| File | Starting state | Flow | Outcome |
|---|---|---|---|
| `easylog-reference.pcapng` | `0x21 = 0x01` (logging, sampleCount=446) | Multiple Loads, multiple Save-stops, one Download, multiple Save-setups | Worked (cap 1) |
| `easylog-reference-2.pcapng` | `0x21 = 0x01` (logging, sampleCount=76) | Connect → Load → SV-stop → Load → Load → Download → Load → SV-stop → **18.6s gap** → Load → SV-setup (delayed start) | **Worked, no battery pull** (cap 2) |
| `easylog-reference-3.pcapng` | `0x21 = 0x02` (idle, post-battery-pull, sampleCount=64) | Load → Load → Load → Download → Load → **22.5s gap** → Load → SV-setup (delayed start) | Worked, but device was already idle |

**Cap 2 is our gold standard** for "download + restart from a logging device, no battery pull". We're trying to match its wire output.

### Cap 2 byte-level reference data

Frame 375 (Load post-Download — read from device):
```
0a00 5365 6e73 6f72 2031 3200 0000 0000
0000 0d30 3202 051a 0000 0000 0a00 4c00
0f01 1013 1d26 5038 a751 b23c 0000 2100
0000 0000 1906 0000 100e 0000 ffff ffff
0000 ... [zeros to byte 0x6F]
3136 3000 0000 0000 3332 0000 0000 0000  ← bytes 0x70/0x78 ASCII alarm thresholds "160" and "32" — present in cap 2 device, NOT in our user's device
... [zeros to byte 0xCF]
3a02 ffff ffff ffff ffff 7a19 0e37 0000
0080 ffff ffff ffff ffff ffff ffff ffff
ffff ffff ffff ffff
```

Frame 387 (SV-stop — host writes back to device):
- Identical to frame 375 EXCEPT byte `0x21` is `0x00` (was `0x01`).

Frame 443 (SV-setup — the actual setup-and-start save):
- Same as frame 375 EXCEPT:
  - `0x12-0x17`: `0d 38 00 02 05 1a` (target time 13:56:00 — 57s after save_time)
  - `0x18-0x1B`: `39 00 00 00` (delayedStartSec=57)
  - `0x1E-0x1F`: `00 00` (sampleCount=0)
  - `0x21`: `0x01`
  - alarmFlags `0x20`: `0x0F` (preserved — NOT cleared)
  - All other bytes including `0x22-0x23 = 10 13` and the alarm threshold ASCII strings: preserved verbatim from baseline.

### Cap 2 timing

```
Frame 49  t=13.490s  LD #1 cmd
Frame 53  t=13.491s  LD #1 response
Frame 63  t=15.276s  SV #1 cmd (stop)
Frame 65  t=15.312s  SV #1 payload
Frame 67  t=15.375s  SV #1 ACK
Frame 77  t=15.450s  LD #2 cmd
Frame 81  t=15.451s  LD #2 response
Frame 91  t=15.518s  LD #3 cmd
Frame 95  t=15.519s  LD #3 response
Frame 105 t=19.614s  Download cmd
Frame 107 t=19.614s  Download header (length 0xFE00 = 65024)
[~9.8s of bulk IN reads streaming back samples]
Frame 371 t=29.450s  LD #4 cmd (post-Download)
Frame 375 t=29.451s  LD #4 response (sf=01, sampleCount=76 preserved)
Frame 385 t=32.100s  SV #2 cmd (stop)        ← 2.6s after LD #4
Frame 387 t=32.128s  SV #2 payload (sf=00)
Frame 389 t=32.191s  SV #2 ACK
[18.5s of total USB silence]
Frame 427 t=50.691s  LD #5 cmd               ← 18.5s after SV #2 ACK
Frame 431 t=50.692s  LD #5 response
Frame 441 t=50.759s  SV #3 cmd (setup-and-start)  ← 67ms after LD #5
Frame 443 t=50.799s  SV #3 payload (sf=01, sampleCount=0, target ts, delay=57s)
Frame 445 t=50.862s  SV #3 ACK
```

The **18.5-second silent gap between SV-stop ACK and the next Load** is the critical timing element. EasyLog's wizard naturally creates that pause (the user is typing a target time). Our automated flow rushes through in milliseconds — initial attempts skipped the pause entirely, and even with a 20s sleep added the device still gets stuck.

## What we've tried in `runWorkflow` (Download & Resume) — all failed on real hardware

(Each iteration was tested on the user's actual device; the device gets stuck at `armed` after every variant.)

1. Download → Save (setup-and-start) — single-shot. Stuck.
2. Download → Load → Save. Stuck.
3. Download → Load → SV-stop → Load → Save. Stuck.
4. Download → Load → SV-stop → Load → SV-setup (with `0x21 = 0x01` hard-set, not via setBit). Stuck.
5. Download → Load → SV-stop → Load → SV-setup (with alarmFlags bits 2-7 cleared, matching cap 3's setup save). Stuck.
6. Download → Load → SV-stop → Load → 20s pause → Load → Save. Stuck.
7. Download → Load → 20s pause → Load → Save. (Removed SV-stop, kept pause.) Stuck.
8. Download → Load → SV-stop → 20s pause → Load → Save. (Cap 2 wire pattern + cap 2 timing, no extra envelope between SV-stop and pause.) **This is the current state in commit `75f46ab`. Still stuck.**

We've matched cap 2's byte payloads and envelope sequence as closely as we can see from the JS layer. Something on the wire — or in the firmware's response to wire timing nuances — is still different.

## What works reliably

**Setup & Start** (no Download involved): the device transitions cleanly from `idle (0x02)` or whatever post-power state to `armed (0x01)` and then to `logging (0x03)` once the start time elapses. Tested with both Immediate and Delayed start. Reliable.

**Read sensor → CSV**: Load + Download + CSV export, no save. Returns the data; leaves the device in post-Download `transient (0x00)` state. From there a separate Setup & Start might work (untested as a discrete two-step flow — see below).

## Recommended next experiment: pyusb replay on Jetson

Goal: replicate cap 2's exact byte/timing pattern via Python+libusb, bypass Chrome and WebUSB entirely, see if the device transitions to `logging`.

### What the script needs to do

1. Find the device (VID `0x10C4` / PID `0x0002`).
2. Open it via `pyusb` / `libusb` (the project's existing `99-lascar.rules` udev rule should give libusb access; otherwise run as root).
3. Run vendor envelope helpers:
   ```python
   def vendor_setup(dev):
       for req, val in [(0x00, 0xFFFF), (0x02, 0x0002), (0x02, 0x0001)]:
           dev.ctrl_transfer(0x40, req, val, 0x0000, [], 100)

   def vendor_teardown(dev):
       dev.ctrl_transfer(0x40, 0x02, 0x0004, 0x0000, [], 100)
   ```
4. Implement `load_config()`, `download_samples()`, `save_config(payload_256)` using the wire protocol above. Each wraps a `vendor_setup` ... `vendor_teardown` envelope.
5. **Pre-flight**: confirm device is in `logging` state (`status_flags == 0x03`). If not, the user needs to run Setup & Start in the browser first. The script should refuse to proceed otherwise.
6. **Replay sequence** (cap 2's post-Download pattern, exact):
   ```python
   download_samples()                    # discard the bytes for now
   buf = load_config()
   stop = bytearray(buf)
   stop[0x21] = 0x00
   save_config(bytes(stop))              # SV-stop
   time.sleep(18.6)                      # cap 2's exact gap
   buf = load_config()                   # final pre-save read
   setup = bytearray(buf)
   setup[0x12:0x18] = encode_timestamp(now + timedelta(seconds=60))
   setup[0x18:0x1C] = (60).to_bytes(4, 'little')   # 60s delay
   setup[0x1E:0x20] = b'\x00\x00'                  # sampleCount = 0
   setup[0x21] = 0x01                              # armed
   save_config(bytes(setup))             # SV-setup with 60s delayed start
   ```
7. **Verify**: wait 5 seconds after the setup save, then `load_config()` and print the `0x21` byte. Wait the delay (60s), Load again, print byte and sampleCount.
8. **Print result**: did the device transition `armed → logging`? Did sampleCount climb?

### What success/failure tells us

- **Success** (device transitions to logging, sampleCount climbs): our JS code is putting different bytes on the wire than this script. Something Chrome's WebUSB stack does that pyusb doesn't — could be control transfer timing, packet boundaries, or USB state on disconnect. Investigate Chrome WebUSB's behavior or rewrite the JS to be byte-identical via tighter control of timing. Consider doing the Save Config bulk OUTs as a single combined transfer rather than two separate ones.
- **Failure** (device still stuck at armed): the firmware has a hardware-level constraint we cannot satisfy from software. Drop the combined flow, keep the manual two-step (`Read sensor → CSV` then `Setup & Start`), document the limitation in the UI.

### One more variant worth trying if (8) above fails

EasyLog cap 2 actually has **two** SV-stops separated by Loads — frame 65 (pre-Download) and frame 387 (post-Download). Our code only does the post-Download SV-stop. Try adding a pre-Download SV-stop:

```python
buf = load_config()
stop1 = bytearray(buf); stop1[0x21] = 0x00
save_config(bytes(stop1))                # extra pre-Download SV-stop
time.sleep(0.1)                          # cap 2 had a small gap before next Load
load_config()                            # cap 2 had 2 Loads before Download
load_config()
download_samples()
# ... rest as above
```

If pre-Download SV-stop matters, we'd add it to the JS too.

## Pcap analysis tooling on the Jetson

If you do want to capture our actual JS traffic, the Jetson kernel doesn't have `usbmon` (Brandon confirmed), so the alternatives are:
- Build `usbmon` as a kernel module if Jetson kernel sources are available (`make modules SUBDIRS=drivers/usb/mon`)
- Use a different Linux box that has usbmon
- Use Wireshark/USBPcap on the Windows machine after Zadig-swapping the device to WinUSB. **Brandon prefers to avoid Zadig** because it kills EasyLog's ability to use the device until the original driver is restored via Device Manager. Only fall back to this if pyusb-replay fails AND we genuinely need to see Chrome's exact wire output.

## Tracker tasks (recreate in new session)

The original session had these tracker tasks; recreate them in the new session if useful:
1. ✅ Encoding module (plan tasks 1-11)
2. ✅ HTML changes (plan tasks 12-13)
3. ✅ JS form wiring (plan tasks 14-16)
4. ✅ Setup & Start workflow (plan task 17)
5. 🔧 Download & Resume workflow (plan task 18) — **this is what's blocked**
6. ⏳ Stop Logging workflow (plan task 19) — implemented but firmware ignores; decide remove vs leave
7. ✅ Dead code cleanup (plan task 20)

## How to verify the new session is making progress

The success criterion is unchanged: with a freshly-Setup-and-Started device that's actively logging (`0x21 = 0x03`), running Download & Resume (or its pyusb replay) leaves the device with `0x21 = 0x01` (armed) immediately after, transitions to `0x21 = 0x03` (logging) within seconds, and `sample count` starts climbing again — all without a battery pull.

Confirm with: Disconnect → reconnect → Load Config → check `status flags`. If `logging` and `sample count` climbing, success.
