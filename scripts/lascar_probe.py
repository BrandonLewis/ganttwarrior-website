#!/usr/bin/env python3
"""Standalone probe for Lascar EL-USB-TC. Mirrors the WebUSB page's protocol.

Sends [00 FF FF] to bulk OUT EP 0x02 and reads bulk IN EP 0x82, expecting a
[0x02 LL HH ...payload...] framed response. Times out per-read so we never hang.
"""
import sys
import time
import usb.core
import usb.util

VID, PID = 0x10C4, 0x0002
EP_OUT, EP_IN = 0x02, 0x82
PACKET = 64
READ_TIMEOUT_MS = 2000


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        sys.exit(f"device {VID:04x}:{PID:04x} not found")
    print(f"found {dev.idVendor:04x}:{dev.idProduct:04x}  bus {dev.bus} addr {dev.address}")

    if dev.is_kernel_driver_active(0):
        print("detaching kernel driver from interface 0")
        dev.detach_kernel_driver(0)

    print("set_configuration(1)")
    dev.set_configuration(1)
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]
    usb.util.claim_interface(dev, intf)
    print(f"claimed interface 0  endpoints: {[hex(e.bEndpointAddress) for e in intf]}")

    try:
        dev.clear_halt(EP_OUT)
        dev.clear_halt(EP_IN)
        print("cleared halts on EP 0x02 / 0x82")
    except usb.core.USBError as e:
        print(f"clear_halt warning: {e}")

    # Undocumented init: SiLabs F32x mode setup. Per libsigrok comment:
    # "Some of these fail, but it needs doing".  bmRequestType=0x40 is
    # host-to-device, vendor-defined, device recipient.
    print("\n=== vendor control transfer init (libsigrok sequence) ===")
    for (bReq, wVal, wIdx) in [(0x00, 0xFFFF, 0x0000),
                                (0x02, 0x0002, 0x0000),
                                (0x02, 0x0001, 0x0000)]:
        try:
            dev.ctrl_transfer(0x40, bReq, wVal, wIdx, None, timeout=50)
            print(f"  ctrl OK   bReq=0x{bReq:02x} wVal=0x{wVal:04x} wIdx=0x{wIdx:04x}")
        except usb.core.USBError as e:
            print(f"  ctrl fail bReq=0x{bReq:02x} wVal=0x{wVal:04x} wIdx=0x{wIdx:04x}  ({e})")

    # Flush any stale IN data from earlier sessions (libsigrok does this).
    print("flushing stale IN data…")
    drained = 0
    while True:
        try:
            stale = bytes(dev.read(EP_IN, PACKET, timeout=5))
            if not stale:
                break
            drained += len(stale)
        except usb.core.USBTimeoutError:
            break
    print(f"  drained {drained} stale bytes")

    def read_framed(label):
        print(f"\n→ {label}")
        chunks = []
        total = None
        got = 0
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                data = bytes(dev.read(EP_IN, PACKET, timeout=1500))
            except usb.core.USBTimeoutError:
                print(f"   read timeout (have {got}/{total})")
                break
            if not data:
                continue
            if total is None:
                if data[0] != 0x02:
                    print(f"   bad header 0x{data[0]:02x} ; first chunk: {data[:16].hex(' ')}")
                    return None
                total = data[1] | (data[2] << 8)
                payload = data[3:]
                chunks.append(payload)
                got += len(payload)
                print(f"   header: payload length = {total}  (first chunk has {len(payload)} of payload)")
            else:
                chunks.append(data)
                got += len(data)
            if total is not None and got >= total:
                break
        out = b''.join(chunks)
        if total is not None:
            out = out[:total]
            print(f"   received {len(out)} bytes")
        return out

    def parse_config(buf):
        """Mirror the page's parseConfig."""
        import struct
        if len(buf) < 0x36:
            return {"_raw_len": len(buf)}
        return {
            "deviceType":     buf[0x00],
            "deviceName":     buf[0x02:0x12].split(b'\x00')[0].decode('latin1', 'replace').strip(),
            "startTimestamp": tuple(buf[0x12:0x18]),
            "delayedStartSec": struct.unpack_from('<I', buf, 0x18)[0],
            "sampleIntervalSec": struct.unpack_from('<H', buf, 0x1c)[0],
            "sampleCount":    struct.unpack_from('<H', buf, 0x1e)[0],
            "alarmFlags":     buf[0x20],
            "statusFlags":    buf[0x21],
            "tempAlarmHi":    buf[0x22],
            "tempAlarmLo":    buf[0x23],
            "cal1":           struct.unpack_from('<f', buf, 0x24)[0],
            "cal2":           struct.unpack_from('<f', buf, 0x28)[0],
            "unit":           'C' if struct.unpack_from('<H', buf, 0x2e)[0] == 0 else 'F',
            "firmware":       buf[0x30:0x34].decode('latin1', 'replace').strip('\x00').strip(),
            "serialNumber":   struct.unpack_from('<H', buf, 0x34)[0],
        }

    # ── load config ─────────────────────────────────────────
    print(f"\n→ TX  00 FF FF  (load config)")
    dev.write(EP_OUT, bytes([0x00, 0xFF, 0xFF]), timeout=1000)
    cfg = read_framed("read config response")
    if cfg:
        info = parse_config(cfg)
        print("\n  device config:")
        for k, v in info.items():
            print(f"    {k:22s} {v!r}")
        print(f"\n  raw config bytes (full {len(cfg)} bytes):")
        for i in range(0, len(cfg), 16):
            row = cfg[i:i+16]
            print(f"    {i:04x}  {row.hex(' '):<48s}  |{''.join(chr(b) if 32 <= b < 127 else '.' for b in row)}|")
        import struct
        print("\n  exhaustive scan of config block — every plausible offset, every type")
        print("  (looking for a constant ≈ 621 [needed offset to fix decoder] or ≈ 13.6 [°F to subtract])")
        target_offset = 621  # raw counts to subtract
        target_temp_diff = 13.6
        for off in range(0, min(len(cfg), 96)):
            for fmt, label, size in [('<H', 'u16LE', 2), ('>H', 'u16BE', 2),
                                      ('<h', 'i16LE', 2), ('<I', 'u32LE', 4),
                                      ('<i', 'i32LE', 4), ('<f', 'f32LE', 4),
                                      ('>f', 'f32BE', 4)]:
                if off + size > len(cfg): continue
                v = struct.unpack_from(fmt, cfg, off)[0]
                if isinstance(v, float):
                    if abs(v) < 1e-8 or abs(v) > 1e6: continue
                    if abs(v - target_offset) < 5 or abs(v - target_temp_diff) < 0.5:
                        print(f"    offset 0x{off:02x} ({label}) = {v!r}  [matches]")
                else:
                    if 615 <= v <= 627:
                        print(f"    offset 0x{off:02x} ({label}) = {v}  [matches ~621]")

    # ── download samples ────────────────────────────────────
    print(f"\n→ TX  03 FF FF  (download samples)")
    dev.write(EP_OUT, bytes([0x03, 0xFF, 0xFF]), timeout=1000)
    samples = read_framed("read sample response")
    if samples:
        n = info.get("sampleCount", 0) if cfg else 0
        print(f"\n  first 64 sample bytes:")
        print(f"    {samples[:64].hex(' ')}")
        if n:
            cal1 = info.get("cal1", 0.0)
            cal2 = info.get("cal2", 1.0)
            unit = info.get("unit", "?")
            print(f"\n  decoding {n} samples as: int16_BE × cal2 + cal1   (cal2={cal2}, cal1={cal1})")
            decoded = []
            for i in range(n):
                hi, lo = samples[i*2], samples[i*2+1]   # BE: hi byte first
                v = (hi << 8) | lo
                if v > 0x7FFF: v -= 0x10000
                t = v * cal2 + cal1
                decoded.append(t)
            print(f"  first 10 samples: {[f'{t:.2f}' for t in decoded[:10]]} °{unit}")
            print(f"  last  10 samples: {[f'{t:.2f}' for t in decoded[-10:]]} °{unit}")
            print(f"  min/max/mean: {min(decoded):.2f} / {max(decoded):.2f} / {sum(decoded)/len(decoded):.2f} °{unit}")

    print()
    usb.util.release_interface(dev, intf)
    usb.util.dispose_resources(dev)


if __name__ == "__main__":
    main()
