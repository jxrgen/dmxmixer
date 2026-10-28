# -*- coding: utf-8 -*-
"""
Driver til NewTek LiveControl LC-11 (USB-navn "NewTek Control Surface").

Bygger på Jørgens lc11_decode.py og LC11_MAPPING.md (kortlagt 2026-10-27).
Oversætter panelets egne banker og bits til de logiske navne, lc11.py
bruger, og tænder lamperne i tasterne. Al styringen ligger i lc11.py.

Forbindelse
    FTDI FT232 (0403:6001), serienummer FTRHBAHV, 9600 baud 8N1, DTR+RTS.
    Panelet genstarter, når porten åbnes, og er tavst i ca. 6 s - lamperne
    sendes først derefter. Det sender kun noget, når en kontrol røres.
    Enttec-donglen er også en FTDI 0403:6001, så panelet findes på sit
    serienummer eller sit USB-navn - aldrig bare på chippen.

Protokol
    Record = START ('~' eller '^') + BANK (ét hex-tegn) + DATA (hex-nibbles),
    afsluttet af næste START. CR inde i en record er feltadskiller.
    3 nibbles = 12 knapper (bit 0 = trykket), 2 nibbles = 8 knapper eller
    8-bit analog, 4 nibbles = joystick (høj byte X, lav byte Y).
    Lamperne sendes i samme format tilbage: bit 0 = tændt.

Kræver pyserial (pip3 install pyserial).
"""

import os
import threading
import time

try:
    import serial
    from serial.tools import list_ports as _list_ports
    SERIAL_ERR = ""
except Exception as _e:                       # pragma: no cover
    serial = None
    _list_ports = None
    SERIAL_ERR = str(_e)

BAUD = 9600
LC11_SERIAL = "FTRHBAHV"
LC11_NAMES = ("newtek", "control surface")
BOOT_S = float(os.environ.get("LC11_BOOT_S", "6"))   # panelet starter op efter åbning
STARTS = {0x7E: "~", 0x5E: "^"}

# ---------------------------------------------------------------- input
# (bank, bit) -> logisk navn. Rækkerne: bit 11 = knap 1 (venstre) ... bit 1 = knap 11.
BUTTONS = {}
for _bank, _row in (("~F", "e"), ("~2", "p"), ("~1", "v")):
    for _col in range(1, 12):
        BUTTONS[(_bank, 12 - _col)] = "%s%d" % (_row, _col)
BUTTONS.update({
    ("~3", 3): "auto", ("~3", 1): "take",          # de to under række 3 (ingen lampe)
    ("^F", 7): "tap", ("^F", 6): "styr",           # Transition, par 1
    ("^1", 7): "ftb", ("^1", 6): "frys",           # Transition, par 3
    ("~3", 5): "side_prev", ("~3", 4): "side_next",  # Transition, par 4
    ("^1", 5): "m_scener", ("^1", 4): "m_afvikling",  # Overlay, 4-knap-rækken
    ("^1", 3): "m_enkel", ("^1", 2): "m_pult",
    ("~3", 7): "gem", ("~3", 6): "mork",           # Overlay, de to brede
    ("^2", 7): "push_grand", ("^2", 6): "push_tempo",  # tryk på drejeknapperne
    ("^2", 5): "push_k1", ("^2", 4): "push_k2", ("^2", 3): "push_k3",
})
ANALOG = {
    "~4": ("tbar", "fader"),
    "~8": ("grand", "enc"), "~9": ("tempo", "enc"),           # Transition
    "~5": ("k1", "enc"), "~6": ("k2", "enc"), "~7": ("k3", "enc"),  # Overlay
    "^5": ("joy1", "joy"), "^7": ("joy2", "joy"),
}

# Længden af DATA (bank-tegn + nibbles) for de kendte banker. Panelet afslutter
# ikke en record - den sidste afsluttes først af den næste START. Er linjen
# stille, og har den ventende record netop sin rigtige længde, afkodes den
# med det samme, så fx T-barens sidste stilling ikke hænger.
EXPECT = {"~F": 4, "~2": 4, "~1": 4, "~3": 3, "^F": 3, "^2": 3, "^1": 3,
          "~4": 3, "~8": 3, "~9": 3, "~5": 3, "~6": 3, "~7": 3, "^5": 5, "^7": 5}

# ---------------------------------------------------------------- lamper
LED_BANKS = {"~F": 12, "~2": 12, "~1": 12, "~3": 8, "^F": 8, "^1": 8}
LED_MAP = {}
for (_bank, _bit), _cid in BUTTONS.items():
    if _bank in LED_BANKS and _cid not in ("auto", "take"):
        LED_MAP[_cid] = (_bank, _bit)
LED_MAP["tbar_led"] = ("~3", 0)                     # den runde ved T-baren


def _is_lc11(p):
    if (getattr(p, "serial_number", None) or "").upper() == LC11_SERIAL:
        return True
    for t in (getattr(p, "product", None), getattr(p, "description", None),
              getattr(p, "manufacturer", None)):
        if t and any(n in t.lower() for n in LC11_NAMES):
            return True
    return False


def list_ports():
    """Serieporte til valg i fladen."""
    if _list_ports is None:
        return []
    out = []
    for p in _list_ports.comports():
        out.append({"dev": p.device, "desc": p.description or "", "lc11": _is_lc11(p)})
    return out


def find_port():
    if _list_ports is None:
        return None
    for p in _list_ports.comports():
        if _is_lc11(p):
            return p.device
    return None


class Panel:
    def __init__(self, on_event, port=""):
        self.on_event = on_event
        self.port = port or ""
        self.dev = ""
        self.s = None
        self.run = False
        self.ok = True
        self.lock = threading.Lock()
        self.want = {}
        self.dirty = set()
        self.t_open = 0.0
        self.booted = False
        self.last_full = 0.0
        self.thread = None
        # T-baren er elektrisk støjende: median af 9, snap til enderne, EMA
        self.fbuf, self.fmed, self.fema, self.fsent, self.ftick = [], None, None, None, 0.0
        self.ff_run = 0

    # -- forbindelse ---------------------------------------------------
    def open(self):
        if serial is None:
            raise RuntimeError("pyserial mangler - kør: pip3 install pyserial (%s)" % SERIAL_ERR)
        dev = self.port or find_port()
        if not dev:
            return False
        try:
            s = serial.Serial(dev, BAUD, bytesize=8, parity="N", stopbits=1,
                              timeout=0.03, write_timeout=1.0)
        except Exception as e:
            txt = str(e)
            if "ermission" in txt or "denied" in txt:
                raise RuntimeError("ingen adgang til %s. På Linux: sudo usermod -aG dialout $USER "
                                   "og log ud og ind igen" % dev)
            if "busy" in txt.lower() or "resource" in txt.lower():
                raise RuntimeError("%s er optaget - luk lc11_gui.py/lc11_decode.py" % dev)
            raise
        for attr in ("dtr", "rts"):
            try:
                setattr(s, attr, True)
            except Exception:
                pass
        try:
            s.reset_input_buffer()
        except Exception:
            pass
        self.s, self.dev = s, dev
        self.t_open = time.monotonic()
        self.run, self.ok = True, True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        return True

    def alive(self):
        return self.ok and self.run

    def status(self):
        if time.monotonic() - self.t_open < BOOT_S:
            return "starter", "Panelet starter op (%s) …" % self.dev
        return "ok", "Panelet er tilsluttet (%s)" % self.dev

    def close(self):
        if self.s is not None and self.booted:
            try:
                with self.lock:
                    data = b"".join(self._frame(b) for b in LED_BANKS)
                self.s.write(data)
                self.s.flush()
            except Exception:
                pass
        self.run = False
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(0.5)
        if self.s is not None:
            try:
                self.s.close()
            except Exception:
                pass
        self.s = None

    # -- lamper --------------------------------------------------------
    def set_led(self, cid, on):
        if cid not in LED_MAP:
            return
        on = bool(on)
        with self.lock:
            if self.want.get(cid) != on:
                self.want[cid] = on
                self.dirty.add(LED_MAP[cid][0])

    def _frame(self, bank):
        width = LED_BANKS[bank]
        val = (1 << width) - 1                         # alt slukket
        for cid, (bk, bit) in LED_MAP.items():
            if bk == bank and self.want.get(cid):
                val &= ~(1 << bit)                     # bit 0 = tændt
        return ("%s%s%0*X\r" % (bank[0], bank[1], width // 4, val)).encode("ascii")

    def _write_leds(self):
        now = time.monotonic()
        if now - self.t_open < BOOT_S:
            return                                     # panelet starter stadig op
        with self.lock:
            if not self.booted or now - self.last_full > 2.0:
                # første gang efter opstart, og hvert 2. sekund for en sikkerheds skyld
                self.booted = True
                self.last_full = now
                self.dirty = set(LED_BANKS)
            banks = sorted(self.dirty)
            self.dirty = set()
            data = b"".join(self._frame(b) for b in banks)
        if data:
            self.s.write(data)

    # -- input ---------------------------------------------------------
    def _loop(self):
        rec, have = bytearray(), False
        btn, enc, joy = {}, {}, {}
        while self.run:
            try:
                chunk = self.s.read(64)
                evs = []
                if not chunk and have and len(rec) > 1:
                    key = STARTS[rec[0]] + chr(rec[1])
                    if EXPECT.get(key) == len(rec) - 1:
                        self._decode(STARTS[rec[0]], bytes(rec[1:]), btn, enc, joy, evs)
                        rec, have = bytearray(), False
                for b in chunk:
                    if b in STARTS:
                        if have and len(rec) > 1:
                            self._decode(STARTS[rec[0]], bytes(rec[1:]), btn, enc, joy, evs)
                        rec, have = bytearray([b]), True
                    elif b == 0x0D:
                        continue
                    elif have and len(rec) < 16:
                        rec.append(b)
                self._fader_tick(evs)
                for ev in evs:
                    try:
                        self.on_event(*ev)
                    except Exception:
                        pass
                self._write_leds()
            except Exception:
                self.ok = False
                break

    def _decode(self, start, data, btn, enc, joy, evs):
        if len(data) < 2:
            return
        key = start + chr(data[0])
        payload = data[1:].decode("latin1", "replace")
        try:
            v = int(payload, 16)
        except ValueError:
            return
        nn = len(payload)
        if key in ANALOG:
            cid, kind = ANALOG[key]
            if kind == "fader":
                v &= 0xFF
                # 0xFF er både "helt i bund" og panelets hyppige udfald. Et
                # enkelt 0xFF midt på skalaen er et udfald og springes over;
                # står T-baren i bund, kommer der flere i træk.
                if v == 0xFF:
                    self.ff_run += 1
                    if self.ff_run < 3 and self.fmed is not None and self.fmed < 200:
                        return
                else:
                    self.ff_run = 0
                self.fbuf.append(v)
                if len(self.fbuf) > 9:
                    self.fbuf.pop(0)
                med = sorted(self.fbuf)[len(self.fbuf) // 2]
                self.fmed = 0 if med <= 6 else (255 if med >= 249 else med)
            elif kind == "enc":
                prev = enc.get(key)
                enc[key] = v & 0xFF
                if prev is not None:
                    d = (v & 0xFF) - prev
                    if d > 128:
                        d -= 256
                    elif d < -128:
                        d += 256
                    if d:
                        evs.append(("turn", cid, d))
            elif kind == "joy" and nn == 4:
                x, y = (v >> 8) & 0xFF, v & 0xFF
                px, py = joy.get(key, (None, None))
                if px is None or abs(x - px) >= 3 or abs(y - py) >= 3:
                    joy[key] = (x, y)
                    evs.append(("joy", cid, [round((x - 128) / 127.0, 3),
                                             round((y - 128) / 127.0, 3)]))
            return
        if nn not in (2, 3):
            return
        width = 4 * nn
        allones = (1 << width) - 1
        prev = btn.get(key, allones)
        btn[key] = v
        changed = (prev ^ v) & allones
        for bit in range(width - 1, -1, -1):
            if not changed & (1 << bit):
                continue
            cid = BUTTONS.get((key, bit))
            if cid is None:
                continue                               # ubrugt bit (fx ^F bit 3)
            evs.append(("press" if not v & (1 << bit) else "release", cid, None))

    def _fader_tick(self, evs):
        if self.fmed is None:
            return
        now = time.monotonic()
        if now - self.ftick < 0.02:
            return
        self.ftick = now
        if self.fema is None:
            self.fema = float(self.fmed)
        else:
            self.fema += 0.4 * (self.fmed - self.fema)
            if abs(self.fmed - self.fema) < 0.6:
                self.fema = float(self.fmed)
        out = int(round(self.fema))
        if out != self.fsent:
            self.fsent = out
            # fysisk op = lav værdi; lc11.py vil have 1.0 = helt oppe
            evs.append(("abs", "tbar", round(1.0 - out / 255.0, 4)))
