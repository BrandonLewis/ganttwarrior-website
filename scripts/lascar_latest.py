#!/usr/bin/env python3
"""Quick check: download samples and print only the very latest decoded value.

Run this after pinching the probe in your fingers for 60+ seconds. If the
decoder formula is correct, the latest reading should jump toward ~98 °F
(body temp). If it barely budges, the decoder math is wrong.
"""
import struct
import time
import usb.core
import usb.util

VID, PID = 0x10C4, 0x0002
EP_OUT, EP_IN = 0x02, 0x82
PACKET = 64


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        raise SystemExit("device not found")
    if dev.is_kernel_driver_active(0):
        dev.detach_kernel_driver(0)
    dev.set_configuration(1)
    intf = dev.get_active_configuration()[(0, 0)]
    usb.util.claim_interface(dev, intf)
    try: dev.clear_halt(EP_OUT); dev.clear_halt(EP_IN)
    except Exception: pass

    for bReq, wVal in [(0x00, 0xFFFF), (0x02, 0x0002), (0x02, 0x0001)]:
        try: dev.ctrl_transfer(0x40, bReq, wVal, 0, None, timeout=50)
        except Exception: pass

    def read_framed():
        chunks, total, got = [], None, 0
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            try:
                data = bytes(dev.read(EP_IN, PACKET, timeout=1500))
            except usb.core.USBTimeoutError:
                break
            if not data: continue
            if total is None:
                if data[0] != 0x02: return None
                total = data[1] | (data[2] << 8)
                chunks.append(data[3:]); got += len(data) - 3
            else:
                chunks.append(data); got += len(data)
            if got >= total: break
        out = b''.join(chunks)
        return out[:total] if total else None

    dev.write(EP_OUT, bytes([0x00, 0xFF, 0xFF]))
    cfg = read_framed()
    if not cfg: raise SystemExit("no config")
    cal1 = struct.unpack_from('<f', cfg, 0x24)[0]
    cal2 = struct.unpack_from('<f', cfg, 0x28)[0]
    n    = struct.unpack_from('<H', cfg, 0x1e)[0]
    unit = 'C' if struct.unpack_from('<H', cfg, 0x2e)[0] == 0 else 'F'

    dev.write(EP_OUT, bytes([0x03, 0xFF, 0xFF]))
    samples = read_framed()
    if not samples: raise SystemExit("no samples")

    # decode last few samples three different ways for comparison
    print(f"sample_count={n}  cal1={cal1!r}  cal2={cal2!r}  unit={unit}")
    print(f"\nlast 5 samples — three candidate decoders:")
    print(f"{'idx':>5} {'raw_BE':>7} {'BE×cal2':>10} {'BE×cal2+cal1':>14} {'(BE-624)×cal2':>15}")
    for i in range(max(0, n - 5), n):
        hi, lo = samples[i*2], samples[i*2+1]
        raw_be = (hi << 8) | lo
        if raw_be > 0x7FFF: raw_be -= 0x10000
        a = raw_be * cal2
        b = raw_be * cal2 + cal1
        c = (raw_be - 624) * cal2
        print(f"{i:>5} {raw_be:>7} {a:>9.2f}° {b:>13.2f}° {c:>14.2f}°")

    usb.util.release_interface(dev, intf)
    usb.util.dispose_resources(dev)


if __name__ == "__main__":
    main()
