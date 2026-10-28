# -*- coding: utf-8 -*-
"""
NewTek LiveControl LC-11 som fysisk styring af Lyspult.

Panelet skifter tilstand efter hvilken del af pulten man arbejder i
(Scener, Afvikling, Enkel, Pult). Paa venstre side er hver lodret soejle
én ting - en scene, en gruppe, en lampe eller et lag - og de tre raekker
betyder det samme i alle tilstande:

    Effects  = hvad det skal goere (moenster eller farve)
    Program  = det der lyser; tryk taender/slukker      (roed = lyser)
    Preview  = vaelg                                      (groen = valgt)

Hoejre side er altid den samme: Grand, Blackout (FTB), Frys, Tap,
Side, Auto/Take og tilstandstasterne.

Filen er delt i to:

  Controller    - al logikken: tilstande, taster, drejeknapper, T-bar og
                  hvad hver tast skal lyse. Den kender kun panelets
                  LOGISKE navne (se CONTROLS) - aldrig panelets egne numre.
  HardwareLink  - forbindelsen til det fysiske panel gennem en driverfil,
                  lc11_driver.py, der ligger ved siden af dmxmixer.py.

Panelet paa skaermen (Indstillinger -> LC-11) bruger de samme logiske navne
og sender sine tryk ind gennem /api (op "lc11_input"), saa alt kan proeves
uden panelet.

Driveren (lc11_driver.py) taler med det rigtige panel og har en klasse Panel:

    class Panel:
        def __init__(self, on_event, port=""):
            # on_event(kind, cid, value) kaldes for hvert input:
            #   ("press", cid, None) og ("release", cid, None) - taster
            #   ("turn", cid, trin)       - endeloese drejeknapper (+1/-1 ...)
            #   ("abs", cid, 0.0 .. 1.0)  - T-baren (1.0 = helt oppe)
            #   ("joy", cid, [x, y])      - joysticks (-1.0 .. 1.0)
            # port = "" finder selv panelet
        def open(self):
            # True naar panelet er fundet og aabnet, ellers False
        def set_led(self, cid, on):
            # taend/sluk tastens lampe. Panelets lamper har én fast farve
            # hver og kan kun vaere taendt eller slukket - blink klarer vi her.
        def close(self): ...
        # valgfri: alive() -> False naar panelet er trukket ud
        #          status() -> (tilstand, tekst), fx mens panelet starter op
    list_ports() -> [{"dev", "desc", "lc11"}]  (til valg af port)

Lamperne i tasterne betyder:
    Program-raekken (roed)   taendt = lyser nu / koerer
    Preview-raekken (groen)  taendt = valgt / staar klar
    Effects-raekken (rav)    taendt = det aktive moenster, faneblad eller farve
    de blaa taster           taendt = slaaet til / den tilstand man staar i
    blink                    tryk her, eller noget venter (takt, blackout ...)
"""

import colorsys
import json
import os
import threading
import time

# ----------------------------------------------------------------------
#  Panelets logiske kontroller
# ----------------------------------------------------------------------
COLS = 8                                   # ting pr. side (soejle 1-8)
EFF = ["e%d" % i for i in range(1, 12)]    # Effects-raekken (raekke 1)
PROG = ["p%d" % i for i in range(1, 12)]   # Program-raekken (raekke 2)
PREV = ["v%d" % i for i in range(1, 12)]   # Preview-raekken (raekke 3)
TRANS_KEYS = ["tap", "styr", "ftb", "frys", "side_prev", "side_next"]
MODE_KEYS = ["m_scener", "m_afvikling", "m_enkel", "m_pult"]
OTHER_KEYS = ["auto", "take", "gem", "mork"]
KNOBS = ["grand", "tempo", "k1", "k2", "k3"]
PUSH_KEYS = ["push_" + k for k in KNOBS]   # tryk paa drejeknapperne
KEYS = EFF + PROG + PREV + OTHER_KEYS + TRANS_KEYS + MODE_KEYS + PUSH_KEYS
FADERS = ["tbar"]
JOYS = ["joy1", "joy2"]                    # ikke i brug endnu
CONTROLS = KEYS + KNOBS + FADERS + JOYS
NO_LED = set(["auto", "take"] + PUSH_KEYS)  # taster uden lampe
LEDS = [k for k in KEYS if k not in NO_LED] + ["tbar_led"]   # tbar_led = den runde ved T-baren

MODES = ("scener", "afvikling", "enkel", "pult")
MODE_NAME = {"scener": "Scener", "afvikling": "Afvikling", "enkel": "Enkel", "pult": "Pult"}
CONTROLLERS = ("pult", "afvikling", "enkel")

# Moenstrene paa Effects-raekken i Pult og Afvikling (resten vaelges paa skaermen)
EFF_PATTERNS = [("fyldt", "Fyldt"), ("chase", "Chase"), ("teater", "Teater"),
                ("boelge", "Bølge"), ("puls", "Puls"), ("scanner", "Scanner"),
                ("gnister", "Gnister"), ("blink", "Blink"), ("komet", "Komet"),
                ("alternating", "Skiftevis"), ("random_flash", "Flash")]

# Lampernes faste farve i panelet (til tegningen paa skaermen)
LED_HEX = {"e": "#f6b228", "p": "#ec3024", "v": "#3fd06b", "*": "#3e9bf5"}


def led_hex(cid):
    if cid[0] in "epv" and cid[1:].isdigit():
        return LED_HEX[cid[0]]
    return LED_HEX["*"]


DEFAULTS = {
    "on": False,             # LC-11 i brug
    "start": "styrer",       # starttilstand: "styrer" = den der styrer lyset
    "pickup": True,          # blød overtagelse for T-baren
    "tbar_invert": False,    # T-baren vendt om
    "enc_invert": False,     # drejeknapperne drejer den forkerte vej
    "sens": 5,               # følsomhed for drejeknapperne, 1-10
    "port": "",              # serieport til panelet, "" = find det selv
}


def clean_settings(src):
    out = dict(DEFAULTS)
    if not isinstance(src, dict):
        return out
    for k in ("on", "pickup", "tbar_invert", "enc_invert"):
        if k in src:
            out[k] = bool(src[k])
    if src.get("start") in ("styrer",) + MODES:
        out["start"] = src["start"]
    try:
        out["sens"] = int(max(1, min(10, int(src.get("sens", out["sens"])))))
    except (TypeError, ValueError):
        pass
    if isinstance(src.get("port"), str):
        out["port"] = src["port"].strip()[:200]
    return out


def _clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _rgb_hsv(c):
    try:
        return colorsys.rgb_to_hsv(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0)
    except Exception:
        return 0.0, 0.0, 1.0


def _hsv_rgb(h, s, v):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, _clamp(s, 0.0, 1.0), _clamp(v, 0.0, 1.0))
    return [int(round(r * 255)), int(round(g * 255)), int(round(b * 255))]


def _hex(rgb):
    return "#%02x%02x%02x" % (int(rgb[0]), int(rgb[1]), int(rgb[2]))


def _pct255(v):
    return "%d %%" % int(round(v * 100 / 255.0))


def _short(s, n=14):
    s = str(s or "")
    return s if len(s) <= n else s[:n - 1] + "…"


# ----------------------------------------------------------------------
#  Forbindelsen til det fysiske panel
# ----------------------------------------------------------------------
try:
    import lc11_driver as _DRIVER          # skrives ud fra Jørgens script
    _DRIVER_ERR = ""
except ImportError as _e:
    _DRIVER = None
    _DRIVER_ERR = "" if "lc11_driver" in str(_e) else str(_e)
except Exception as _e:                    # driveren findes, men fejler
    _DRIVER = None
    _DRIVER_ERR = "%s: %s" % (type(_e).__name__, _e)


class HardwareLink:
    RETRY = 3.0

    def __init__(self, ctl):
        self.ctl = ctl
        self.dev = None
        self.sent = {}
        self.next_try = 0.0
        self.port = None
        self.ports = []
        self.state = "fra"
        self.text = "LC-11 er slået fra"

    def info(self):
        return {"state": self.state, "text": self.text,
                "driver": _DRIVER is not None, "ports": self.ports}

    def _close(self):
        if self.dev is not None:
            try:
                self.dev.close()
            except Exception:
                pass
        self.dev = None
        self.sent = {}

    def _scan(self):
        try:
            self.ports = list(_DRIVER.list_ports())[:20]
        except Exception:
            self.ports = []

    def poll(self, enabled, leds, port=""):
        if not enabled:
            if self.dev is not None:
                try:
                    for cid in list(self.sent):
                        self.dev.set_led(cid, False)
                    time.sleep(0.1)            # lad driveren sende slukket, foer porten lukkes
                except Exception:
                    pass
            self._close()
            self.state, self.text = "fra", "LC-11 er slået fra"
            self.port = None
            return
        if _DRIVER is None:
            self.state = "fejl" if _DRIVER_ERR else "mangler"
            self.text = ("Driveren til panelet fejler: " + _DRIVER_ERR) if _DRIVER_ERR else \
                "Driveren til det fysiske panel mangler (lc11_driver.py) - brug panelet her på skærmen"
            return
        if self.dev is not None and port != self.port:
            self._close()                      # en anden port er valgt
            self.next_try = 0.0
        now = time.monotonic()
        if self.dev is None:
            if now < self.next_try:
                return
            self.next_try = now + self.RETRY
            self._scan()
            try:
                dev = _DRIVER.Panel(self.ctl.event, port)
                if dev.open():
                    self.dev = dev
                    self.port = port
                    self.sent = {}
                    self.state, self.text = "ok", "Panelet er tilsluttet"
                else:
                    self.state = "søger"
                    self.text = ("Panelet er ikke fundet - sæt det i, så findes det af sig selv"
                                 if not port else "Fandt ikke porten %s" % port)
                    try:
                        dev.close()
                    except Exception:
                        pass
                    return
            except Exception as e:
                self.state, self.text = "fejl", "Kunne ikke åbne panelet: %s" % e
                return
        try:
            alive = getattr(self.dev, "alive", None)
            if alive is not None and not alive():
                raise IOError("panelet blev trukket ud")
            stf = getattr(self.dev, "status", None)
            if stf is not None:
                self.state, self.text = stf()
            for cid, on in (leds or {}).items():
                if self.sent.get(cid) != on:
                    self.dev.set_led(cid, on)
                    self.sent[cid] = on
        except Exception as e:
            self._close()
            self.next_try = time.monotonic() + self.RETRY
            self.state, self.text = "søger", "Forbindelsen til panelet røg (%s) - prøver igen" % e


# ----------------------------------------------------------------------
#  Logikken
# ----------------------------------------------------------------------
class Controller:
    def __init__(self, eng, api, mx, settings_path):
        """eng = pultens motor, api(msg) = samme kald som fladen bruger,
        mx = dmxmixer-modulet (hjælpefunktionerne), settings_path = lc11.json"""
        self.eng, self._api_fn, self.mx = eng, api, mx
        self.path = settings_path
        self.settings = clean_settings(self._load())
        self.mode = None
        self.page = dict((m, 0) for m in MODES)
        self.edit_layer = 0
        self.sel_lamps = []
        self.sel_groups = []
        self.scene_tab = None
        self.armed = None            # scene-id der står klar (Preview)
        self.armed_fade = None       # fadetid fra cuelisten, hvis den blev lagt klar derfra
        self.fade_override = None    # Scener: drejeknap 1, None = scenens egen
        self.tb = {"p0": None, "active": False}
        self.tbar_pos = None         # T-barens sidste kendte stilling (0..1)
        self.pick = {}               # blød overtagelse pr. kontrol
        self.taps = []
        self.msg, self.msg_t = "", 0.0
        self.last, self.last_t = "", 0.0
        self.seq = 0                 # tæller op ved hvert tilstandsskift
        self.test_until = 0.0
        self.flash_until = 0.0        # Gem som scene lyser kort efter et tryk
        self.hw = HardwareLink(self)
        threading.Thread(target=self._run, daemon=True).start()

    # -- indstillinger -------------------------------------------------
    def _load(self):
        try:
            with open(self.path) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save(self):
        try:
            d = os.path.dirname(self.path)
            if d:
                os.makedirs(d, exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.settings, f, indent=1)
            os.replace(tmp, self.path)
        except OSError:
            pass

    def set_settings(self, values):
        with self.eng.lock:
            was_on = self.settings["on"]
            new = dict(self.settings)
            new.update(values or {})
            self.settings = clean_settings(new)
            self._save()
            if self.settings["on"] and not was_on:
                self.mode = None
                self.pick = {}
                self._ensure_mode()
            return dict(self.settings)

    def forget(self):
        """Et andet show hentes: glem valg, klar scene og en halv overtoning."""
        with self.eng.lock:
            if self.tb["active"] and self.eng.fade is self.tb.get("fade"):
                self.eng.fade = None
                self.eng.fade_k = 1.0
            self.tb = {"p0": None, "active": False}
            self.sel_lamps, self.sel_groups = [], []
            self.armed, self.armed_fade = None, None
            self.edit_layer = 0
            self.scene_tab = None
            self.pick = {}
            self.page = dict((m, 0) for m in MODES)
            self.eng.scene_live = None

    def test_leds(self, seconds=4.0):
        with self.eng.lock:
            self.test_until = time.monotonic() + float(seconds)

    # -- hjælpere ------------------------------------------------------
    @property
    def show(self):
        return self.eng.show

    def _api(self, msg):
        return self._api_fn(msg)

    def _say(self, txt):
        self.msg, self.msg_t = txt, time.monotonic()

    def _ctl(self):
        return self.mx.control_of(self.show)

    def _palette(self):
        pals = self.show.get("palettes") or []
        i = self.show.get("active_palette", 0)
        if not pals:
            return [[255, 255, 255]] * 14
        if not isinstance(i, int) or not (0 <= i < len(pals)):
            i = 0
        cols = list(pals[i].get("colours") or [])
        while len(cols) < 14:
            cols.append([255, 255, 255])
        return cols

    def _fade(self):
        try:
            return float((self.show.get("live") or {}).get("fade", 1.0) or 0)
        except (TypeError, ValueError):
            return 0.0

    def _tabs(self):
        return self.show.get("scene_tabs") or [{"id": "main", "name": "Scener"}]

    def _tab(self):
        tabs = self._tabs()
        if not any(t.get("id") == self.scene_tab for t in tabs):
            self.scene_tab = tabs[0].get("id")
        return self.scene_tab

    def _scene(self, sid):
        if not sid:
            return None
        for sc in self.show.get("scenes", []):
            if sc.get("id") == sid:
                return sc
        return None

    def _live_scene(self):
        return getattr(self.eng, "scene_live", None)

    def _ek(self, i):
        return self.mx.find_look(self.show, "e:%d" % i)

    def _ek_lit(self, i):
        lk = self._ek(i)
        return bool(lk and lk.get("on", True) is not False and lk.get("level", 255) > 0)

    def _grp_look(self, gid):
        return self.mx.find_look(self.show, "g:%s" % gid)

    def _grp_lit(self, gid):
        lk = self._grp_look(gid)
        return bool(lk and lk.get("on", True) is not False and lk.get("level", 255) > 0)

    def _edit(self):
        n = len(self.show["layers"])
        if n == 0:
            return None
        self.edit_layer = int(_clamp(self.edit_layer, 0, n - 1))
        return self.show["layers"][self.edit_layer]

    def _clean(self):
        nm = len(self.show["modules"])
        self.sel_lamps = [i for i in self.sel_lamps if 0 <= i < nm]
        gids = set(g.get("id") for g in self.show.get("group_labels") or [])
        self.sel_groups = [g for g in self.sel_groups if g in gids]
        if self.armed and not self._scene(self.armed):
            self.armed, self.armed_fade = None, None
        self._edit()
        self._tab()

    def _ensure_mode(self):
        if self.mode in MODES:
            return
        st = self.settings.get("start", "styrer")
        if st in MODES:
            self.mode = st
        else:
            self.mode = self._ctl()[0]
        self.seq += 1

    # -- tingene på siden ----------------------------------------------
    def _items(self, mode=None):
        mode = mode or self.mode
        show = self.show
        if mode == "pult":
            return [("layer", i, L.get("name") or "Lag %d" % (i + 1))
                    for i, L in enumerate(show["layers"])]
        if mode == "enkel":
            return [("lamp", i, m.get("name") or "Lampe %d" % (i + 1))
                    for i, m in enumerate(show["modules"])]
        if mode == "afvikling":
            return [("group", g.get("id"), g.get("name") or "Gruppe")
                    for g in show.get("group_labels") or []]
        tab = self._tab()
        first = self._tabs()[0].get("id")
        return [("scene", sc.get("id"), sc.get("name") or "Scene")
                for sc in show.get("scenes", []) if (sc.get("tab") or first) == tab]

    def _label(self, it):
        """Teksten på en tast. En lampe får sit nummer øverst, så det ikke
        forsvinder, når navnet er for langt til tasten."""
        if it[0] == "lamp":
            m = self.show["modules"][it[1]]
            num = m.get("num")
            num = str(num) if num not in (None, "") else str(it[1] + 1)
            return num + "\n" + _short(it[2])
        return _short(it[2])

    def _page_items(self):
        its = self._items()
        pages = max(1, (len(its) + COLS - 1) // COLS)
        p = int(_clamp(self.page.get(self.mode, 0), 0, pages - 1))
        self.page[self.mode] = p
        return its[p * COLS:(p + 1) * COLS], p, pages

    def _col_item(self, n):
        if not (1 <= n <= COLS):
            return None
        items = self._page_items()[0]
        return items[n - 1] if n - 1 < len(items) else None

    # -- input ---------------------------------------------------------
    def event(self, kind, cid, value=None):
        """Ét input fra panelet (eller panelet på skærmen)."""
        with self.eng.lock:
            cid = str(cid)
            try:
                if kind == "turn":
                    value = int(value or 0)
                    self.last = "%s drejet %+d" % (cid, value)
                elif kind == "abs":
                    value = float(value or 0.0)
                    self.last = "%s står på %d %%" % (cid, int(round(value * 100)))
                elif kind == "press":
                    self.last = "%s trykket" % cid
                elif kind == "joy":
                    x, y = float(value[0]), float(value[1])
                    self.last = "%s X %+.2f  Y %+.2f (ikke i brug)" % (cid, x, y)
                else:
                    value = None
            except (TypeError, ValueError, IndexError):
                return False
            if kind in ("press", "turn", "abs", "joy"):
                self.last_t = time.monotonic()
            if not self.settings["on"] or cid not in CONTROLS:
                return False
            self._ensure_mode()
            self._clean()
            try:
                if kind == "press":
                    self._press(cid)
                elif kind == "turn":
                    self._turn(cid, -value if self.settings["enc_invert"] else value)
                elif kind == "abs":
                    self._abs(cid, value)
            except Exception as e:
                self._say("Fejl: %s" % e)
            return True

    def _press(self, cid):
        show = self.show
        if cid in MODE_KEYS:
            return self._set_mode(cid[2:])
        if cid in ("side_prev", "side_next"):
            pages = self._page_items()[2]
            p = self.page.get(self.mode, 0) + (1 if cid == "side_next" else -1)
            self.page[self.mode] = int(_clamp(p, 0, pages - 1))
            return
        if cid == "tap":
            return self._tap()
        if cid == "ftb":
            return self._api({"op": "set", "path": ["master", "blackout"],
                              "value": not show["master"].get("blackout")})
        if cid == "frys":
            return self._api({"op": "set", "path": ["master", "freeze"],
                              "value": not show["master"].get("freeze")})
        if cid == "styr":
            return self._take_control()
        if cid in ("auto", "take"):
            return self._fire(cid == "take")
        if cid == "gem":
            return self._store()
        if cid == "mork":
            return self._dark()
        if cid in PUSH_KEYS:
            return self._push(cid[5:])
        row = {"e": "eff", "p": "prog", "v": "prev"}.get(cid[0])
        if row and cid in EFF + PROG + PREV:
            getattr(self, "_%s_%s" % (self.mode, row))(int(cid[1:]))

    def _set_mode(self, m):
        if m not in MODES:
            return
        if self.tb["active"]:
            self._tb_finish()
        if m != self.mode:
            self.mode = m
            self.seq += 1
        self.pick = {}
        if m == "scener":
            p = self.tbar_pos
            if p is None or p <= 0.05 or p >= 0.95:
                self.tb["p0"] = 0.0 if p is None else float(round(p))
            else:
                self.tb["p0"] = None

    def _tap(self):
        now = time.monotonic()
        t = self.taps
        if t and now - t[-1] > 2.0:
            t[:] = []
        if len(t) >= 2:
            avg0 = (t[-1] - t[0]) / (len(t) - 1)
            if abs((now - t[-1]) - avg0) > avg0 * 0.4:
                t[:] = [t[-1]]
        t.append(now)
        if len(t) > 8:
            t.pop(0)
        if len(t) >= 2:
            avg = (t[-1] - t[0]) / (len(t) - 1)
            if avg > 0:
                bpm = int(round(60.0 / avg))
                if 40 <= bpm <= 220:
                    self._api({"op": "set", "path": ["master", "bpm"], "value": bpm})

    def _take_control(self):
        if self.mode not in CONTROLLERS:
            return
        if self.mode in self._ctl():
            self._say("%s styrer allerede lyset" % MODE_NAME[self.mode])
            return
        self._api({"op": "control_set", "control": [self.mode]})

    def _ctl_hint(self, mode):
        # At tilstanden ikke styrer lyset, står allerede i bjælken på skærmen,
        # og Lad styre blinker på panelet - derfor ingen ekstra besked.
        return

    def _fire(self, cut):
        if self.tb["active"]:
            self._say("T-baren er midt i en overtoning")
            return
        sc = self._scene(self.armed)
        if not sc:
            self.armed, self.armed_fade = None, None
            self._say("Ingen scene står klar - vælg en på Preview i Scener")
            return
        if cut:
            fade = 0.0
        elif self.fade_override is not None:
            fade = self.fade_override
        elif self.armed_fade is not None:
            fade = self.armed_fade
        else:
            fade = sc.get("fade", 0) or 0
        self._api({"op": "scene_recall", "id": sc["id"], "fade": float(fade)})
        self.armed, self.armed_fade = None, None

    def _store(self):
        n = len(self.show.get("scenes", [])) + 1
        names = set(sc.get("name") for sc in self.show.get("scenes", []))
        while "Scene %d" % n in names:
            n += 1
        name = "Scene %d" % n
        self._api({"op": "scene_store", "name": name, "tab": self._tab()})
        self._say("Gemt som %s" % name)
        self.flash_until = time.monotonic() + 1.0

    def _dark(self):
        if self.mode == "pult":
            items = []
            for i in range(len(self.show["layers"])):
                items.append({"path": ["layers", i, "on"], "value": False})
                items.append({"path": ["layers", i, "solo"], "value": False})
            if items:
                self._api({"op": "patch", "items": items})
        elif self.mode == "enkel":
            self._api({"op": "live_dark"})
        elif self.mode == "afvikling":
            self._api({"op": "live_clear"})

    # -- Pult -------------------------------------------------------------
    def _pult_eff(self, n):
        L = self._edit()
        if L is None or n > len(EFF_PATTERNS):
            return
        self._api({"op": "set", "path": ["layers", self.edit_layer, "pattern"],
                   "value": EFF_PATTERNS[n - 1][0]})

    def _pult_prog(self, n):
        it = self._col_item(n)
        if not it:
            return
        L = self.show["layers"][it[1]]
        self._api({"op": "set", "path": ["layers", it[1], "on"], "value": not L.get("on")})

    def _pult_prev(self, n):
        if n == 9:
            L = self._edit()
            if L is not None:
                self._api({"op": "set", "path": ["layers", self.edit_layer, "solo"],
                           "value": not L.get("solo")})
            return
        it = self._col_item(n)
        if it:
            self.edit_layer = it[1]

    # -- Enkel ------------------------------------------------------------
    def _ek_send(self, lamps, values, fade):
        if lamps:
            self._api({"op": "live_lamps", "lamps": list(lamps), "values": values,
                       "fade": float(fade or 0)})

    def _ek_colour(self, c):
        if not self.sel_lamps:
            self._say("Vælg lamper på Preview-rækken først")
            return
        lit, zero = [], []
        for i in self.sel_lamps:
            lk = self._ek(i)
            (zero if (lk and lk.get("level", 255) == 0) else lit).append(i)
        v = {"colour": [int(c[0]), int(c[1]), int(c[2])], "on": True,
             "pattern": "fyldt", "colour_mode": "fast"}
        self._ek_send(lit, v, self._fade())
        if zero:
            v2 = dict(v)
            v2["level"] = 255
            self._ek_send(zero, v2, self._fade())
        self._ctl_hint("enkel")

    def _enkel_eff(self, n):
        self._ek_colour(self._palette()[n - 1])

    def _enkel_prog(self, n):
        if n > COLS:
            self._ek_colour(self._palette()[11 + (n - COLS - 1)])
            return
        it = self._col_item(n)
        if not it:
            return
        i = it[1]
        lk = self._ek(i)
        if self._ek_lit(i):
            self._ek_send([i], {"on": False}, 0)
        elif lk:
            v = {"on": True}
            if lk.get("level", 255) <= 0:
                v["level"] = 255
            self._ek_send([i], v, self._fade())
        else:
            self._ek_send([i], {"on": True, "level": 255, "colour": [255, 255, 255],
                                "pattern": "fyldt", "colour_mode": "fast"}, self._fade())
        self._ctl_hint("enkel")

    def _enkel_prev(self, n):
        if n == 9:
            if self.sel_lamps:
                self.sel_lamps = []
            else:
                self.sel_lamps = [it[1] for it in self._page_items()[0]]
            return
        it = self._col_item(n)
        if not it:
            return
        if it[1] in self.sel_lamps:
            self.sel_lamps.remove(it[1])
        else:
            self.sel_lamps.append(it[1])

    # -- Afvikling ----------------------------------------------------------
    def _grp_set(self, gid, values, fade=0):
        self._api({"op": "live_set", "target": {"group": gid}, "values": values,
                   "fade": float(fade or 0)})

    def _afvikling_eff(self, n):
        if n > len(EFF_PATTERNS):
            return
        if not self.sel_groups:
            self._say("Vælg grupper på Preview-rækken først")
            return
        for gid in self.sel_groups:
            self._grp_set(gid, {"pattern": EFF_PATTERNS[n - 1][0]})
        self._ctl_hint("afvikling")

    def _afvikling_prog(self, n):
        it = self._col_item(n)
        if not it:
            return
        gid = it[1]
        lk = self._grp_look(gid)
        if self._grp_lit(gid):
            self._api({"op": "live_on", "key": lk.get("key"), "on": False})
        else:
            v = {"on": True}
            if lk and lk.get("level", 255) <= 0:
                v["level"] = 255
            self._grp_set(gid, v, self._fade())
        self._ctl_hint("afvikling")

    def _afvikling_prev(self, n):
        if n == 9:
            self.sel_groups = []
            return
        it = self._col_item(n)
        if not it:
            return
        if it[1] in self.sel_groups:
            self.sel_groups.remove(it[1])
        else:
            self.sel_groups.append(it[1])

    # -- Scener -----------------------------------------------------------
    def _scener_eff(self, n):
        tabs = self._tabs()
        if n - 1 < len(tabs):
            self.scene_tab = tabs[n - 1].get("id")
            self.page["scener"] = 0

    def _scener_prog(self, n):
        it = self._col_item(n)
        if not it:
            return
        if self.tb["active"]:
            self._say("T-baren er midt i en overtoning")
            return
        self._api({"op": "scene_recall", "id": it[1], "fade": 0})
        if self.armed == it[1]:
            self.armed, self.armed_fade = None, None

    def _scener_prev(self, n):
        if n == 9:
            return self._next_cue()
        it = self._col_item(n)
        if not it or self.tb["active"]:
            return
        if self.armed == it[1]:
            self.armed, self.armed_fade = None, None
        else:
            self.armed, self.armed_fade = it[1], None

    def _next_cue(self):
        cl = self.show.get("cuelist") or []
        if not cl:
            self._say("Cuelisten er tom - læg scener i den under Scener")
            return
        if self.tb["active"]:
            return
        live = self._live_scene()
        idx = next((k for k, c in enumerate(cl) if c.get("scene_id") == live), -1)
        for step in range(1, len(cl) + 1):
            c = cl[(idx + step) % len(cl)]
            sc = self._scene(c.get("scene_id"))
            if sc:
                self.armed = sc["id"]
                try:
                    self.armed_fade = float(c.get("fade", sc.get("fade", 0)))
                except (TypeError, ValueError):
                    self.armed_fade = None
                return

    # -- T-bar i Scener: manuel overtoning --------------------------------
    def _tbar_scener(self, p):
        tb, eng = self.tb, self.eng
        if tb["active"] and eng.fade is not tb.get("fade"):
            tb["active"] = False          # noget andet tog over (fx et scenekald)
            tb["p0"] = None
        if not tb["active"]:
            if tb["p0"] is None:
                if p <= 0.05:
                    tb["p0"] = 0.0
                elif p >= 0.95:
                    tb["p0"] = 1.0
                else:
                    self._say("Før T-baren helt til en ende for at starte en overtoning")
                    return
            k = abs(p - tb["p0"])
            if k < 0.03:
                return
            sc = self._scene(self.armed)
            if not sc:
                self._say("Vælg næste scene på Preview først")
                return
            if not eng.pixels or self.show["master"].get("freeze"):
                self._api({"op": "scene_recall", "id": sc["id"], "fade": 0})
                self.armed, self.armed_fade = None, None
                tb["p0"] = None
                return
            frm = [[list(px) for px in row] for row in eng.pixels]
            prev = self.mx.snapshot(self.show, "lc11", tab=self._tab())
            fade = {"from": frm, "manual": True, "k": k, "t0": time.monotonic(), "dur": 1.0}
            tb.update({"active": True, "prev": prev, "prev_live": self._live_scene(),
                       "fade": fade, "sid": sc["id"]})
            self.mx.apply_scene(self.show, sc)
            eng.touch()
            eng.scene_live = sc["id"]
            eng.fade = fade
        k = abs(p - tb["p0"])
        tb["fade"]["k"] = k
        eng.fade_k = k
        if k >= 0.97:
            self._tb_finish()
        elif k <= 0.01:
            self._tb_abort()

    def _tb_finish(self):
        tb, eng = self.tb, self.eng
        if eng.fade is tb.get("fade"):
            eng.fade = None
            eng.fade_k = 1.0
        if tb["p0"] is not None and self.tbar_pos is not None and abs(self.tbar_pos - tb["p0"]) >= 0.97:
            tb["p0"] = 1.0 - tb["p0"]
        else:
            tb["p0"] = None
        tb["active"] = False
        if self.armed == tb.get("sid"):
            self.armed, self.armed_fade = None, None
        tb["prev"] = None
        eng.rev += 1

    def _tb_abort(self):
        tb, eng = self.tb, self.eng
        if tb.get("prev"):
            self.mx.apply_scene(self.show, tb["prev"])
            eng.touch()
        eng.scene_live = tb.get("prev_live")
        if eng.fade is tb.get("fade"):
            eng.fade = None
            eng.fade_k = 1.0
        tb["active"] = False
        tb["prev"] = None

    # -- drejeknapper og T-bar -------------------------------------------
    def _P(self, label, lo, hi, step, get, put, fmt, key, wrap=False, off=False):
        return {"label": label, "min": lo, "max": hi, "step": step, "get": get,
                "set": put, "fmt": fmt, "key": key, "wrap": wrap, "off": off}

    def _no_sel(self, label, what):
        def put(v):
            self._say("Vælg %s på Preview-rækken først" % what)
        return self._P(label, 0, 1, 0.02, lambda: 0.0, put, lambda v: "vælg " + what,
                       "nosel:" + label, off=True)

    def _param(self, cid):
        show = self.show
        mode = self.mode
        if cid == "tempo":
            return self._P("Tempo", 40, 220, 1,
                           lambda: float(show["master"].get("bpm", 120)),
                           lambda v: self._api({"op": "set", "path": ["master", "bpm"],
                                                "value": int(round(v))}),
                           lambda v: "%d BPM" % int(round(v)), "tempo")
        if cid == "grand":
            return self._P("Grand", 0, 255, 5,
                           lambda: float(show["master"].get("grand", 255)),
                           lambda v: self._api({"op": "set", "path": ["master", "grand"],
                                                "value": int(round(v))}),
                           _pct255, "grand")
        if mode == "pult":
            L = self._edit()
            if L is None:
                return None
            li = self.edit_layer
            nm = L.get("name") or "Lag %d" % (li + 1)

            def lset(field, conv):
                return lambda v: self._api({"op": "set", "path": ["layers", li, field],
                                            "value": conv(v)})
            if cid == "tbar":
                return self._P("Styrke · " + nm, 0, 255, 5,
                               lambda: float(L.get("opacity", 255)),
                               lset("opacity", lambda v: int(round(v))), _pct255,
                               "pult:%d:opacity" % li)
            if cid == "k1":
                return self._P("Fart", 0, 200, 2, lambda: float(L.get("speed", 30)),
                               lset("speed", lambda v: int(round(v))),
                               lambda v: str(int(round(v))), "pult:%d:speed" % li)
            if cid == "k2":
                return self._P("Størrelse", 0, 100, 1, lambda: float(L.get("size", 30)),
                               lset("size", lambda v: int(round(v))),
                               lambda v: str(int(round(v))), "pult:%d:size" % li)
            if cid == "k3":
                def gh():
                    return _rgb_hsv(L.get("colour") or [255, 255, 255])[0] * 360.0

                def ph(v):
                    h, s, vv = _rgb_hsv(L.get("colour") or [255, 255, 255])
                    self._api({"op": "set", "path": ["layers", li, "colour"],
                               "value": _hsv_rgb(v / 360.0, s if s > 0.05 else 1.0,
                                                 vv if vv > 0.05 else 1.0)})
                return self._P("Farvetone", 0, 360, 4, gh, ph,
                               lambda v: "%d°" % (int(round(v)) % 360), "pult:%d:hue" % li,
                               wrap=True)
            return None

        if mode == "enkel":
            sel = list(self.sel_lamps)
            if cid == "k3":
                return self._P("Overgang", 0, 10, 0.1, self._fade,
                               lambda v: self._api({"op": "set", "path": ["live", "fade"],
                                                    "value": round(float(v), 1)}),
                               lambda v: ("%.1f s" % v).replace(".", ","), "enkel:fade")
            if cid not in ("k1", "k2", "tbar"):
                return None
            if not sel:
                return self._no_sel({"k1": "Farvetone", "k2": "Mætning",
                                     "tbar": "Lysstyrke"}[cid], "lamper")
            key = "enkel:%s:%s" % (cid, ",".join(str(i) for i in sel))
            first = self._ek(sel[0])

            def col_of(i):
                lk = self._ek(i)
                return (lk.get("colour") if lk else None) or [255, 255, 255]

            def put_col(fn):
                def put(v):
                    for i in sel:
                        h, s, vv = _rgb_hsv(col_of(i))
                        new = fn(v, h, s, vv)
                        if self._ek(i):
                            self._ek_send([i], {"colour": new}, 0)
                        else:
                            self._ek_send([i], {"colour": new, "on": True, "level": 255,
                                                "pattern": "fyldt", "colour_mode": "fast"}, 0)
                return put
            if cid == "k1":
                return self._P("Farvetone", 0, 360, 4,
                               lambda: _rgb_hsv(col_of(sel[0]))[0] * 360.0,
                               put_col(lambda v, h, s, vv: _hsv_rgb(v / 360.0, s if s > 0.05 else 1.0,
                                                                    vv if vv > 0.05 else 1.0)),
                               lambda v: "%d°" % (int(round(v)) % 360), key, wrap=True)
            if cid == "k2":
                return self._P("Mætning", 0, 100, 2,
                               lambda: _rgb_hsv(col_of(sel[0]))[1] * 100.0,
                               put_col(lambda v, h, s, vv: _hsv_rgb(h, v / 100.0,
                                                                    vv if vv > 0.05 else 1.0)),
                               lambda v: "%d %%" % int(round(v)), key)

            def glev():
                if not first:
                    return 255.0
                return 0.0 if first.get("on", True) is False else float(first.get("level", 255))

            def plev(v):
                v = int(round(v))
                has = [i for i in sel if self._ek(i)]
                none = [i for i in sel if not self._ek(i)]
                if has:
                    self._ek_send(has, {"level": v, "on": True} if v > 0 else {"level": v}, 0)
                if none:
                    self._ek_send(none, {"level": v, "on": v > 0, "colour": [255, 255, 255],
                                         "pattern": "fyldt", "colour_mode": "fast"}, 0)
            return self._P("Lysstyrke", 0, 255, 5, glev, plev, _pct255, key)

        if mode == "afvikling":
            sel = list(self.sel_groups)
            if cid not in ("k1", "k2", "k3", "tbar"):
                return None
            if not sel:
                return self._no_sel({"k1": "Fart", "k2": "Forskydning", "k3": "Farvetone",
                                     "tbar": "Lysstyrke"}[cid], "grupper")
            key = "afv:%s:%s" % (cid, ",".join(sel))
            lk0 = self._grp_look(sel[0]) or self.mx.default_look({"group": sel[0]})

            def pset(field, conv):
                def put(v):
                    for gid in sel:
                        self._grp_set(gid, {field: conv(v)})
                return put
            if cid == "k1":
                return self._P("Fart", 0, 200, 2, lambda: float(lk0.get("speed", 30)),
                               pset("speed", lambda v: int(round(v))),
                               lambda v: str(int(round(v))), key)
            if cid == "k2":
                return self._P("Forskydning", 0, 100, 2, lambda: float(lk0.get("spread", 0)),
                               pset("spread", lambda v: int(round(v))),
                               lambda v: str(int(round(v))), key)
            if cid == "k3":
                def ph(v):
                    for gid in sel:
                        lk = self._grp_look(gid)
                        h, s, vv = _rgb_hsv((lk or lk0).get("colour") or [255, 120, 40])
                        self._grp_set(gid, {"colour": _hsv_rgb(v / 360.0, s if s > 0.05 else 1.0,
                                                               vv if vv > 0.05 else 1.0)})
                return self._P("Farvetone", 0, 360, 4,
                               lambda: _rgb_hsv(lk0.get("colour") or [255, 120, 40])[0] * 360.0,
                               ph, lambda v: "%d°" % (int(round(v)) % 360), key, wrap=True)

            def plev(v):
                v = int(round(v))
                for gid in sel:
                    self._grp_set(gid, {"level": v, "on": True} if v > 0 else {"level": v})
            return self._P("Lysstyrke", 0, 255, 5,
                           lambda: 0.0 if lk0.get("on", True) is False else float(lk0.get("level", 255)),
                           plev, _pct255, key)

        if mode == "scener":
            if cid == "k1":
                def pf(v):
                    self.fade_override = None if v < 0 else round(float(v), 1)
                return self._P("Fadetid", -0.1, 20, 0.1,
                               lambda: -0.1 if self.fade_override is None else self.fade_override,
                               pf, lambda v: "scenens egen" if v < 0 else ("%.1f s" % v).replace(".", ","),
                               "scener:fade")
            if cid == "k2":
                n = len(self._items())

                def gsel():
                    ids = [it[1] for it in self._items()]
                    return float(ids.index(self.armed)) if self.armed in ids else -1.0
                return self._P("Næste scene", -1, max(0, n - 1), 1, gsel, self._arm_index,
                               lambda v: (self._scene(self.armed) or {}).get("name", "") or "ingen",
                               "scener:pick", off=(n == 0))
        return None

    def _arm_index(self, v):
        """Scener, knap 2: læg scene nr. v (i det viste faneblad) klar."""
        its = self._items()
        if not its or self.tb["active"]:
            return
        i = int(round(_clamp(v, 0, len(its) - 1)))
        self.armed, self.armed_fade = its[i][1], None
        self.page["scener"] = i // COLS        # vis siden, scenen ligger på

    # Hvad et tryk på en drejeknap gør: sætter værdien tilbage til standard
    PUSH_DEFAULT = {"grand": 255, "pult:k1": 30, "pult:k2": 30,
                    "enkel:k2": 100, "enkel:k3": 1.0,
                    "afvikling:k1": 30, "afvikling:k2": 0, "scener:k1": -0.1}

    def _push(self, knob):
        if knob == "tempo":
            return self._tap()                 # tryk på tempoknappen = tap
        if self.mode == "scener" and knob == "k2":
            return self._next_cue()
        d = self.PUSH_DEFAULT.get(knob, self.PUSH_DEFAULT.get("%s:%s" % (self.mode, knob)))
        P = self._param(knob)
        if d is None or not P:
            return
        if P["off"]:
            P["set"](0)
            return
        P["set"](d)
        self.pick.pop(knob, None)

    def _turn(self, cid, delta):
        if cid == "tbar" or not delta:
            return
        P = self._param(cid)
        if not P:
            return
        if P["off"]:
            P["set"](0)
            return
        if P["key"] == "scener:pick":
            step = float(delta)                # én scene pr. trin, uanset følsomhed
        else:
            step = P["step"] * self.settings["sens"] / 5.0 * delta
        v = P["get"]() + step
        if P["key"] == "scener:pick" and P["get"]() < 0 and delta > 0:
            v = 0                              # første drej frem: den første scene
        if P["wrap"]:
            span = P["max"] - P["min"]
            v = P["min"] + (v - P["min"]) % span
        else:
            v = _clamp(v, P["min"], P["max"])
        P["set"](v)
        self.pick.pop(cid, None)

    def _abs(self, cid, pos):
        pos = _clamp(pos, 0.0, 1.0)
        if cid == "tbar":
            if self.settings["tbar_invert"]:
                pos = 1.0 - pos
            self.tbar_pos = pos
            if self.mode == "scener":
                return self._tbar_scener(pos)
        P = self._param(cid)
        if not P:
            return
        if P["off"]:
            P["set"](0)
            return
        lo, hi = P["min"], P["max"]
        span = float(hi - lo) or 1.0
        cur_pos = (P["get"]() - lo) / span
        st = self.pick.get(cid)
        if st is None or st["key"] != P["key"]:
            st = {"key": P["key"], "ok": not self.settings["pickup"], "last": None, "sent": None}
            self.pick[cid] = st
        if not self.settings["pickup"]:
            st["ok"] = True
        else:
            if st["ok"] and st["sent"] is not None and abs(cur_pos - st["sent"]) > 0.04:
                st["ok"] = False          # ændret et andet sted - grib først fat igen
            if not st["ok"]:
                if abs(pos - cur_pos) <= 0.03 or \
                        (st["last"] is not None and (st["last"] - cur_pos) * (pos - cur_pos) <= 0):
                    st["ok"] = True
        st["last"] = pos
        if st["ok"]:
            P["set"](lo + pos * span)
            st["sent"] = pos

    # -- hvad tasterne skal lyse -----------------------------------------
    def _keys(self):
        """{cid: (tekst, tændt, blink, farvechip, hint)}
        tændt = lampen i tasten; blink = None, "slow" eller "beat";
        farvechip = palettefarven en tast giver (kun til skærmen);
        hint = "ready" på Auto/Take, når en scene står klar (de har ingen lampe)."""
        show = self.show
        mode = self.mode
        K = dict((c, ["", False, None, None, ""]) for c in KEYS + ["tbar_led"])

        def put(cid, lbl, on=False, blink=None, chip=None):
            K[cid] = [lbl, bool(on), blink, chip, ""]

        items, page, pages = self._page_items()
        ctl = self._ctl()
        m = show["master"]
        put("tap", "Tap", True, "beat")
        put("ftb", "Blackout", bool(m.get("blackout")), "slow")
        put("frys", "Frys", bool(m.get("freeze")))
        put("side_prev", "Side ◀", page > 0)
        put("side_next", "Side ▶", page < pages - 1)
        for md in MODES:
            put("m_" + md, MODE_NAME[md], md == mode)
        if mode in CONTROLLERS:
            if mode in ctl:
                put("styr", "Lad styre", True)
            else:
                put("styr", "Lad styre", True, "slow")
        else:
            put("styr", "Lad styre")
        put("gem", "Gem som scene", time.monotonic() < self.flash_until)
        put("mork", "Alt mørkt" if mode != "scener" else "")
        ready = self._scene(self.armed) is not None and not self.tb["active"]
        for c in ("auto", "take"):
            put(c, "Auto" if c == "auto" else "Take")
            K[c][4] = "ready" if ready else ""
        for kn in KNOBS:
            put("push_" + kn, "")

        if mode == "pult":
            L = self._edit()
            for n, (pat, lbl) in enumerate(EFF_PATTERNS, 1):
                put("e%d" % n, lbl, bool(L and L.get("pattern") == pat))
            for n, it in enumerate(items, 1):
                La = show["layers"][it[1]]
                put("p%d" % n, _short(it[2]), La.get("on"))
                put("v%d" % n, _short(it[2]), it[1] == self.edit_layer)
            if L is not None:
                put("v9", "Solo", L.get("solo"))
        elif mode == "enkel":
            pal = self._palette()
            cur = None                      # farven ALLE valgte lamper har lige nu
            for i in self.sel_lamps:
                lk = self._ek(i)
                c = list(lk.get("colour") or []) if (lk and self._ek_lit(i)) else None
                if c is None or (cur is not None and c != cur):
                    cur = None
                    break
                cur = c
            for n in range(1, 12):
                c = [int(x) for x in pal[n - 1]]
                put("e%d" % n, "", cur == c, None, c)
            for n in range(9, 12):
                c = [int(x) for x in pal[11 + n - 9]]
                put("p%d" % n, "", cur == c, None, c)
            for n, it in enumerate(items, 1):
                put("p%d" % n, self._label(it), self._ek_lit(it[1]))
                put("v%d" % n, self._label(it), it[1] in self.sel_lamps)
            if items:
                put("v9", "Alle / ingen", bool(self.sel_lamps))
        elif mode == "afvikling":
            lk0 = self._grp_look(self.sel_groups[0]) if self.sel_groups else None
            for n, (pat, lbl) in enumerate(EFF_PATTERNS, 1):
                put("e%d" % n, lbl, bool(lk0 and lk0.get("pattern", "fyldt") == pat))
            for n, it in enumerate(items, 1):
                put("p%d" % n, _short(it[2]), self._grp_lit(it[1]))
                put("v%d" % n, _short(it[2]), it[1] in self.sel_groups)
            put("v9", "Ryd valg", bool(self.sel_groups))
        else:
            tab = self._tab()
            for n, t in enumerate(self._tabs()[:11], 1):
                put("e%d" % n, _short(t.get("name")), t.get("id") == tab)
            live = self._live_scene()
            for n, it in enumerate(items, 1):
                put("p%d" % n, _short(it[2]), it[1] == live)
                put("v%d" % n, _short(it[2]), it[1] == self.armed)
            if show.get("cuelist"):
                put("v9", "Næste cue")

        # den runde lampe ved T-baren: tændt = T-baren styrer noget,
        # blink = før den hen til værdien (eller til en ende) først
        if mode == "scener":
            if self.tb["active"] or (self.armed and self.tb["p0"] is not None):
                K["tbar_led"][1] = True
            elif self.armed:
                K["tbar_led"][1:3] = [True, "slow"]
        else:
            P = self._param("tbar")
            if P and not P["off"]:
                pk = self.pick.get("tbar")
                if pk and not pk["ok"] and pk["last"] is not None and pk["key"] == P["key"]:
                    K["tbar_led"][1:3] = [True, "slow"]
                else:
                    K["tbar_led"][1] = True

        now = time.monotonic()
        if now < self.test_until:           # lystest: alt blinker i takt
            on = int(now * 2.5) % 2 == 0
            for c in K:
                K[c][1], K[c][2] = (c not in NO_LED) and on, None
        return K

    def _resolve(self, K):
        """Lampen lige nu, med blink regnet ind: {cid: True/False}"""
        now = time.monotonic()
        slow_on = (now % 0.8) < 0.45
        beat_on = (self.eng.beats % 1.0) < 0.2
        out = {}
        for cid, k in K.items():
            on, blink = k[1], k[2]
            if blink == "slow":
                on = on and slow_on
            elif blink == "beat":
                on = on and beat_on
            out[cid] = bool(on) and cid not in NO_LED
        return out

    # -- tråd: lys i tasterne på det fysiske panel ---------------------
    def _run(self):
        while getattr(self.eng, "running", True):
            leds = None
            port = ""
            try:
                with self.eng.lock:
                    on = self.settings["on"]
                    port = self.settings.get("port", "")
                    if on:
                        self._ensure_mode()
                        self._clean()
                        if self.tb["active"] and self.eng.fade is not self.tb.get("fade"):
                            self.tb["active"] = False
                            self.tb["p0"] = None
                        res = self._resolve(self._keys())
                        leds = dict((c, res[c]) for c in LEDS)
                self.hw.poll(on, leds, port)
            except Exception:
                pass
            time.sleep(0.04)

    # -- til skærmen -----------------------------------------------------
    def frame(self):
        """Status til fladen (lægges i /frame)."""
        now = time.monotonic()
        st = {"on": self.settings["on"], "settings": dict(self.settings),
              "hw": self.hw.info(),
              "last": self.last if now - self.last_t < 20 else "",
              "cols": COLS}
        if not self.settings["on"]:
            return st
        self._ensure_mode()
        self._clean()
        K = self._keys()
        lit = self._resolve(K)
        keys = {}
        for cid, k in K.items():
            keys[cid] = [k[0], led_hex(cid) if lit[cid] else "",
                         _hex(k[3]) if k[3] else "", k[4]]
        items, page, pages = self._page_items()
        ctl = self._ctl()
        marks = []
        for n, it in enumerate(items, 1):
            kind, ref = it[0], it[1]
            if kind == "layer":
                sel, lit = ref == self.edit_layer, bool(self.show["layers"][ref].get("on"))
            elif kind == "lamp":
                sel, lit = ref in self.sel_lamps, self._ek_lit(ref)
            elif kind == "group":
                sel, lit = ref in self.sel_groups, self._grp_lit(ref)
            else:
                sel, lit = ref == self.armed, ref == self._live_scene()
            marks.append({"col": n, "kind": kind, "ref": ref, "name": it[2],
                          "sel": bool(sel), "on": bool(lit)})

        def ctrl_txt(cid):
            if cid == "tbar" and self.mode == "scener":
                sc = self._scene(self.armed)
                if self.tb["active"]:
                    k = self.tb.get("fade", {}).get("k", 0)
                    return {"label": "Overtoning", "txt": "%d %%" % int(round(k * 100)), "need": ""}
                if self.tb["p0"] is None:
                    return {"label": "Overtoning", "txt": "før T-baren til en ende", "need": ""}
                return {"label": "Overtoning", "txt": ("til " + sc.get("name", "")) if sc else "vælg næste scene",
                        "need": ""}
            P = self._param(cid)
            if not P:
                return {"label": "", "txt": "", "need": ""}
            v = P["get"]()
            need = ""
            pk = self.pick.get(cid)
            if pk and not pk["ok"] and pk["last"] is not None and pk["key"] == P["key"] and not P["off"]:
                cur = (v - P["min"]) / (float(P["max"] - P["min"]) or 1.0)
                need = ("↑ " if pk["last"] < cur else "↓ ") + P["fmt"](v)
            return {"label": P["label"], "txt": P["fmt"](v), "need": need}

        empty = ""
        if not items:
            empty = {"pult": "Showet har ingen lag",
                     "enkel": "Ingen lamper endnu - tilføj dem under Patch",
                     "afvikling": "Ingen grupper endnu - lav dem under Layout",
                     "scener": "Ingen scener i dette faneblad - gem en med Gem som scene"}[self.mode]
        st.update({
            "mode": self.mode, "mode_name": MODE_NAME[self.mode],
            "page": page + 1, "pages": pages, "seq": self.seq,
            "ctl": (self.mode in ctl) if self.mode in CONTROLLERS else None,
            "ctl_names": [MODE_NAME[c] for c in ctl],
            "keys": keys, "marks": marks, "edit_layer": self.edit_layer,
            "knobs": dict((c, ctrl_txt(c)) for c in KNOBS),
            "tbar": ctrl_txt("tbar"),
            "armed": (self._scene(self.armed) or {}).get("name", ""),
            "msg": self.msg if now - self.msg_t < 4 else "",
            "empty": empty, "test": now < self.test_until,
        })
        return st
