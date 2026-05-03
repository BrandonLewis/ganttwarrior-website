#!/usr/bin/env python3
"""Pyusb replay of cap 2's Download & Resume wire pattern.

Usage:
  1. In the browser, run Setup & Start so the device is logging (0x21 = 0x03).
  2. Close the browser tab (release the WebUSB claim).
  3. Run this script. It will:
       - claim the device via libusb
       - pre-flight Load to confirm 0x21 == 0x03 (refuse otherwise)
       - replay cap 2 frames 371-447 byte-for-byte:
           Download (with envelope) → Load → SV-stop → 18.6s silence →
           Load → SV-setup (delay = 60s) → verify
       - print 0x21 immediately after save (expect 0x01) and again after
         delay + 10s (expect 0x03 with sampleCount climbing)

If the device transitions to logging, our JS code is putting different bytes
on the wire than this script. If it also stays stuck, the firmware quirk is
not reachable from software and we drop the combined Download & Resume flow.
"""
import sys
import time
from datetime import datetime, timedelta

import usb.core
import usb.util

VID, PID = 0x10C4, 0x0002
EP_OUT, EP_IN = 0x02, 0x82
PACKET = 64
SETTLING_PAUSE_S = 18.6
DELAYED_START_S = 60


def vendor_setup(dev):
    # libsigrok comment on this exact sequence: "Some of these fail, but it
    # needs doing." Cap 2 shows all 3 succeeding under SiLabs USBXpress on
    # Windows; under libusb on Linux a STALL on one or more is normal and
    # benign — bulk transfers still work after. Match the probe and continue
    # past STALLs, but log them so wire-level divergence is visible.
    stalls = []
    for req, val in [(0x00, 0xFFFF), (0x02, 0x0002), (0x02, 0x0001)]:
        try:
            dev.ctrl_transfer(0x40, req, val, 0x0000, None, timeout=200)
        except usb.core.USBError as e:
            stalls.append((req, val, str(e)))
    if stalls:
        for req, val, err in stalls:
            print(f"  ctrl STALL  bReq=0x{req:02x} wVal=0x{val:04x}  ({err})")


def vendor_teardown(dev):
    dev.ctrl_transfer(0x40, 0x02, 0x0004, 0x0000, None, timeout=200)


def with_envelope(dev, label, fn):
    print(f"  envelope · setup [{label}]")
    vendor_setup(dev)
    try:
        return fn()
    finally:
        try:
            vendor_teardown(dev)
            print(f"  envelope · teardown [{label}]")
        except usb.core.USBError as e:
            print(f"  teardown WARN [{label}]: {e}")


def read_framed(dev, expected_total=None, deadline_s=10.0):
    """Read [0x02 LL HH ...payload...] off bulk IN. Returns the payload bytes."""
    chunks = []
    total = expected_total
    got = 0
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        try:
            data = bytes(dev.read(EP_IN, max(PACKET, 512), timeout=1500))
        except usb.core.USBTimeoutError:
            break
        if not data:
            continue
        if total is None or (chunks == [] and expected_total is None):
            if data[0] != 0x02:
                raise RuntimeError(f"bad header byte 0x{data[0]:02x}; first chunk: {data[:16].hex(' ')}")
            total = data[1] | (data[2] << 8)
            chunks.append(data[3:])
            got += len(data) - 3
        else:
            chunks.append(data)
            got += len(data)
        if total is not None and got >= total:
            break
    if total is None:
        raise RuntimeError("no header received before deadline")
    out = b''.join(chunks)[:total]
    if len(out) < total:
        raise RuntimeError(f"short read: got {len(out)} of {total}")
    return out


def load_config(dev):
    def inner():
        print("  → bulk OUT  00 FF FF  (Load Config cmd)")
        dev.write(EP_OUT, b'\x00\xff\xff', timeout=500)
        time.sleep(0.06)
        return read_framed(dev)
    return with_envelope(dev, "Load Config", inner)


def download_samples(dev):
    def inner():
        print("  → bulk OUT  03 FF FF  (Download cmd)")
        dev.write(EP_OUT, b'\x03\xff\xff', timeout=500)
        time.sleep(0.06)
        # Header arrives in the first read; payload is 65024 bytes, we just
        # consume and discard.
        deadline = time.monotonic() + 30.0
        total = None
        got = 0
        while time.monotonic() < deadline:
            try:
                data = bytes(dev.read(EP_IN, 512, timeout=2000))
            except usb.core.USBTimeoutError:
                break
            if not data:
                continue
            if total is None:
                if data[0] != 0x02:
                    raise RuntimeError(f"download bad header 0x{data[0]:02x}")
                total = data[1] | (data[2] << 8)
                got += len(data) - 3
                print(f"  download header: payload length = {total}")
            else:
                got += len(data)
            if total is not None and got >= total:
                break
        print(f"  download received {got}/{total} bytes")
    return with_envelope(dev, "Download Samples", inner)


def save_config(dev, payload_256, label):
    if len(payload_256) != 256:
        raise ValueError(f"save_config: expected 256 bytes, got {len(payload_256)}")
    def inner():
        print(f"  → bulk OUT  01 00 01  (Save Config cmd, {label})")
        dev.write(EP_OUT, b'\x01\x00\x01', timeout=500)
        time.sleep(0.06)
        print(f"  → bulk OUT  256-byte payload ({label})")
        dev.write(EP_OUT, payload_256, timeout=2000)
        # Poll for ACK 0xFF (firmware may return ZLP first).
        deadline = time.monotonic() + 3.0
        attempts = 0
        while time.monotonic() < deadline:
            attempts += 1
            try:
                ack = bytes(dev.read(EP_IN, 64, timeout=500))
            except usb.core.USBTimeoutError:
                continue
            if not ack:
                time.sleep(0.15)
                continue
            if 0xFF in ack:
                print(f"  save ACK = {ack.hex(' ')} (0xFF present, attempt {attempts})")
                return
            raise RuntimeError(f"save unexpected response: {ack.hex(' ')}")
        raise RuntimeError(f"save: no ACK after {attempts} polls in 3s")
    return with_envelope(dev, f"Save Config ({label})", inner)


def encode_timestamp(when):
    yy = when.year - 2000
    return bytes([when.hour, when.minute, when.second, when.day, when.month, yy])


def describe(label, cfg):
    sf = cfg[0x21]
    sample_count = cfg[0x1e] | (cfg[0x1f] << 8)
    delay = int.from_bytes(cfg[0x18:0x1c], 'little')
    print(f"  [{label}]  status=0x{sf:02x}  sampleCount={sample_count}  delayedStart={delay}s")
    return sf, sample_count


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        sys.exit(f"device {VID:04x}:{PID:04x} not found")
    print(f"found {dev.idVendor:04x}:{dev.idProduct:04x}  bus {dev.bus} addr {dev.address}")

    if dev.is_kernel_driver_active(0):
        print("detaching kernel driver from interface 0")
        dev.detach_kernel_driver(0)

    # set_configuration unconditionally — the SiLabs F32x firmware needs it
    # to wake the vendor command interpreter, even when the device is already
    # configured. lascar_probe.py does this and is known to work; skipping it
    # makes the very first vendor ctrl transfer STALL.
    print("set_configuration(1)")
    dev.set_configuration(1)
    cfg = dev.get_active_configuration()
    intf = cfg[(0, 0)]
    usb.util.claim_interface(dev, intf)
    print(f"claimed interface 0  endpoints: {[hex(e.bEndpointAddress) for e in intf]}")

    # Match the WebUSB connect path: clear endpoint halts once. Catch and
    # report — these can fail on a freshly-claimed device with no impact.
    for ep in (EP_OUT, EP_IN):
        try:
            dev.clear_halt(ep)
            print(f"  clear_halt(0x{ep:02x}) OK")
        except usb.core.USBError as e:
            print(f"  clear_halt(0x{ep:02x}) WARN: {e}")

    print("\n=== pre-flight: device should be at 0x00 (post-SV-stop) ===")
    baseline = load_config(dev)
    sf_pre, sc_pre = describe("pre-flight", baseline)
    if sf_pre != 0x00:
        print(f"\nABORT: pre-flight status=0x{sf_pre:02x}, expected 0x00.")
        print("Run the previous SV-stop test first to put device into 0x00.")
        usb.util.release_interface(dev, intf)
        sys.exit(2)

    print("\n=== step 1: Download from 0x00 — is it safe? ===")
    download_samples(dev)

    print("\n=== step 2: Load post-Download — status check ===")
    post_dl = load_config(dev)
    sf_post_dl, sc_post_dl = describe("post-DL", post_dl)
    if sf_post_dl == 0x01:
        print("  ✗ Download from 0x00 ALSO triggered 0x01 stuck state.")
        print("→ Download is unconditionally destructive on this firmware. Battery pull required.")
        usb.util.release_interface(dev, intf)
        sys.exit(0)
    print(f"  ✓ Download from 0x00 left device at 0x{sf_post_dl:02x} (NOT stuck 0x01).")

    print("\n=== step 3: SV-setup from this state, delay=10s ===")
    DELAY = 10
    setup_payload = bytearray(post_dl)
    target = datetime.now() + timedelta(seconds=DELAY)
    setup_payload[0x12:0x18] = encode_timestamp(target)
    setup_payload[0x18:0x1c] = DELAY.to_bytes(4, 'little')
    setup_payload[0x1e:0x20] = b'\x00\x00'
    setup_payload[0x21] = 0x01
    save_config(dev, bytes(setup_payload), "setup-and-start")

    print(f"\n=== step 4: poll Load every 3s for {DELAY + 15}s — does device reach 0x03? ===")
    deadline = time.monotonic() + (DELAY + 15)
    final_sf = None
    final_sc = None
    while time.monotonic() < deadline:
        cfg_now = load_config(dev)
        sf, sc = describe(f"poll t+{int((DELAY + 15) - (deadline - time.monotonic()))}s", cfg_now)
        final_sf, final_sc = sf, sc
        if sf == 0x03 and sc != sc_post_dl:
            print(f"\nLOGGING — sampleCount climbed from {sc_post_dl} → {sc}.")
            break
        time.sleep(3)

    print()
    if final_sf == 0x03:
        print("FULL SUCCESS — clean software path: SV-stop → Download → SV-setup. No battery pull.")
        print("→ JS fix: replace 'Download Samples' button on logging device with combined")
        print("  'Stop, Download, Resume' that wraps these three saves.")
    elif final_sf == 0x01:
        print(f"PARTIAL — Download from 0x00 was safe but SV-setup got stuck at 0x01.")
        print("→ Need a different post-Download save sequence. Iterate.")
    else:
        print(f"UNEXPECTED — final status=0x{final_sf:02x}, sampleCount={final_sc}.")

    print()
    if sf == 0x03 and sc > 0:
        print(f"SUCCESS — device transitioned to logging (0x03), sampleCount={sc}")
        print("→ Conclusion: pyusb-replay works. Our JS Chrome WebUSB output diverges.")
    elif sf == 0x01:
        print("FAILURE — device stuck at armed (0x01) after delay elapsed.")
        print("→ Conclusion: firmware quirk not reachable from software. Drop combined flow.")
    else:
        print(f"UNEXPECTED — status=0x{sf:02x}, sampleCount={sc}")

    usb.util.release_interface(dev, intf)


if __name__ == "__main__":
    main()
