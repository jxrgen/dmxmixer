#!/usr/bin/env python3
"""
Lyspult - DMX-mixer til rigtige lamper
======================================

Samme lagpult-motor som Pixelpulten, men til et fast rig af lamper
(Cameo Root Par 6, Thunder Wash 600, hvide spots m.fl.) i stedet for
36-px-moduler. Hver lampe er internt én celle med en profil, der siger
hvilke DMX-kanaler den fylder.

Backend: effektmotor, outputdrivere, showlagring og HTTP-API.
Brugerfladen ligger i ui.html / ui.css / ui.js ved siden af.

    python3 dmxmixer.py

Aabn http://127.0.0.1:8080 - ogsaa fra en iPad paa samme netvaerk,
brug da maskinens LAN-adresse.

Output:
  * Simulator            altid taendt, det du ser paa skaermen
  * Art-Net              UDP 6454, unicast eller broadcast
  * sACN / E1.31         UDP 5568, multicast eller unicast
  * Enttec Open DMX USB  raa FTDI-serie, 250 kbit/s (kraever pyftdi + pyusb)

Lampens DMX-kanaler bestemmes af dens profil (se FIXTURE_PROFILES):
farve r/g/b kommer fra pultens farvemotor, dimmer fra niveauet, og
w/a/uv/strobe/makro ligger paa manuelle "faste kanaler" pr. lampe.
"""

import argparse
import base64
import json
import math
import os
import random
import socket
import struct
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
# PyInstaller pakker filer ind i _MEIPASS; falder tilbage til __file__ naar
# man koerer scriptet normalt.
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    HERE = sys._MEIPASS


def user_data_dir():
    """En mappe brugeren altid maa skrive i - til shows og egne temaer.
    Program Files og indersiden af en .app er skrivebeskyttet, saa en
    installeret app kan ikke gemme ved siden af sig selv."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "Lyspult")


if getattr(sys, "frozen", False):
    # Installeret app: gem i brugerens egen datamappe.
    SHOW_DIR = os.path.join(user_data_dir(), "shows")
else:
    # Koert som almindeligt script: gem ved siden af scriptet (nemt i udvikling).
    SHOW_DIR = os.path.join(HERE, "shows")

OFS_DIM, OFS_STROBE, OFS_R, OFS_G, OFS_B, OFS_PIX = 0, 1, 2, 3, 4, 5
DMX_SLOTS = 5 + 36 * 3     # kun tilbage af hensyn til gammel kode

# ---------------------------------------------------------------------
#  Lampeprofiler (kanalkort)
#  Hver kanal har en 'k' (nøgle) og et 'n' (navn til fladen).
#  Nøgler pulten selv styrer:  dimmer, dimmer_fine, r, g, b
#  Nøgler paa "faste kanaler" (manuelle pr. lampe): w, a, uv, strobe,
#  duration, macro, generic  - defaulter til 0.
#  Lampens egne programmer (preset, sound, delay) holdes paa 0, saa
#  pulten styrer farverne direkte.
#  Root Par 6 koerer i mode D12ch, Thunder Wash 600 RGBW i mode 7ch2 -
#  kanalkortene foelger Cameos manualer (samme som QLC+'s definitioner).
# ---------------------------------------------------------------------
def _ch(k, n):
    return {"k": k, "n": n}

FIXTURE_PROFILES = {
    "root_par_6": {
        # Mode D12ch: 12 kanaler med DMX-forsinkelse
        "name": "Cameo Root Par 6 (D12ch)", "shape": "par",
        "channels": [_ch("dimmer", "Dimmer"), _ch("dimmer_fine", "Dimmer fin"),
                     _ch("strobe", "Strobe"),
                     _ch("r", "Rød"), _ch("g", "Grøn"), _ch("b", "Blå"),
                     _ch("w", "Hvid"), _ch("a", "Ravgul"), _ch("uv", "UV"),
                     _ch("preset", "Farvepreset"), _ch("sound", "Lyd"),
                     _ch("delay", "DMX-forsinkelse")],
    },
    "thunder_wash_600": {
        # Mode 7ch2: dimmer, strobe, blinkvarighed, R, G, B, W
        "name": "Cameo Thunder Wash 600 RGBW (7ch2)", "shape": "wash",
        "channels": [_ch("dimmer", "Dimmer"), _ch("strobe", "Strobe"),
                     _ch("duration", "Blinkvarighed"),
                     _ch("r", "Rød"), _ch("g", "Grøn"), _ch("b", "Blå"),
                     _ch("w", "Hvid")],
    },
    "white_spot": {
        "name": "Hvid spot", "shape": "spot",
        "channels": [_ch("dimmer", "Dimmer")],
    },
    # Cameo TS 100 WW - varmhvid teaterspot (fresnel). Tre modes.
    "cameo_ts100ww": {
        "name": "Cameo TS 100 WW (3ch)", "shape": "spot",
        "channels": [_ch("dimmer", "Dimmer"), _ch("dimmer_fine", "Dimmer fin"),
                     _ch("strobe", "Strobe")],
    },
    "cameo_ts100ww_1": {
        "name": "Cameo TS 100 WW (1ch)", "shape": "spot",
        "channels": [_ch("dimmer", "Dimmer")],
    },
    "cameo_ts100ww_5": {
        "name": "Cameo TS 100 WW (5ch)", "shape": "spot",
        "channels": [_ch("dimmer", "Dimmer"), _ch("dimmer_fine", "Dimmer fin"),
                     _ch("strobe", "Strobe"),
                     {"k": "fixed", "n": "Dimmerkurve", "def": 0},
                     {"k": "fixed", "n": "Enhedsindstillinger", "def": 0}],
    },
    "alkalite_op75": {
        "name": "Alkalite OP-75", "shape": "par",
        "channels": [_ch("r", "Rød"), _ch("g", "Grøn"), _ch("b", "Blå"),
                     {"k": "dimmer", "n": "Dimmer/Strobe", "max": 159}],
    },
}
# kanaler man kan bygge en egen profil af
CHANNEL_PALETTE = [
    ["dimmer", "Dimmer"], ["dimmer_fine", "Dimmer fin"], ["r", "Rød"], ["g", "Grøn"], ["b", "Blå"],
    ["w", "Hvid"], ["a", "Ravgul"], ["uv", "UV"], ["strobe", "Strobe"],
    ["duration", "Blinkvarighed"], ["macro", "Makro/funktion"],
    ["generic", "Ekstra kanal"], ["fixed", "Fast værdi"],
    ["preset", "Farvepreset (holdes på 0)"], ["sound", "Lyd (holdes på 0)"],
    ["delay", "DMX-forsinkelse (holdes på 0)"],
]
CHANNEL_KEYS = set(k for k, _ in CHANNEL_PALETTE)
# nøgler der styres automatisk af pulten (resten er manuelle)
ENGINE_KEYS = ("dimmer", "dimmer_fine", "r", "g", "b")


def _chs(pairs):
    return [{"k": k, "n": n} for k, n in pairs]


# ---------------------------------------------------------------------
#  Generiske standardopsaetninger - rigtige typer man kan vaelge og
#  blade igennem i Lampe-editoren, naar man er i tvivl om en lampes mode.
# ---------------------------------------------------------------------
GENERIC_PROFILES = {
    "gen_dim1":     {"name": "Generisk · Dæmper (1)", "shape": "spot",
                     "channels": _chs([("dimmer", "Dimmer")])},
    "gen_rgb3":     {"name": "Generisk · RGB (3)", "shape": "par",
                     "channels": _chs([("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])},
    "gen_rgbd4":    {"name": "Generisk · Dæmper+RGB (4)", "shape": "par",
                     "channels": _chs([("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])},
    "gen_rgbds5":   {"name": "Generisk · Dæmper+RGB+strobe (5)", "shape": "par",
                     "channels": _chs([("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("strobe", "Strobe")])},
    "gen_rgbw4":    {"name": "Generisk · RGBW (4)", "shape": "par",
                     "channels": _chs([("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])},
    "gen_rgbwd5":   {"name": "Generisk · Dæmper+RGBW (5)", "shape": "par",
                     "channels": _chs([("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])},
    "gen_rgbwds6":  {"name": "Generisk · Dæmper+RGBW+strobe (6)", "shape": "par",
                     "channels": _chs([("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid"), ("strobe", "Strobe")])},
    "gen_rgba4":    {"name": "Generisk · RGBA (4)", "shape": "par",
                     "channels": _chs([("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul")])},
    "gen_rgbaw5":   {"name": "Generisk · RGBAW (5)", "shape": "par",
                     "channels": _chs([("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul"), ("w", "Hvid")])},
    "gen_rgbawuv6": {"name": "Generisk · RGBAW+UV (6)", "shape": "par",
                     "channels": _chs([("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul"), ("w", "Hvid"), ("uv", "UV")])},
    "gen_hex8":     {"name": "Generisk · Dæmper+strobe+RGBWA+UV (8)", "shape": "par",
                     "channels": _chs([("dimmer", "Dimmer"), ("strobe", "Strobe"), ("r", "Rød"), ("g", "Grøn"),
                                       ("b", "Blå"), ("w", "Hvid"), ("a", "Ravgul"), ("uv", "UV")])},
}
GENERIC_ORDER = ["gen_dim1", "gen_rgb3", "gen_rgbd4", "gen_rgbds5", "gen_rgbw4",
                 "gen_rgbwd5", "gen_rgbwds6", "gen_rgba4", "gen_rgbaw5",
                 "gen_rgbawuv6", "gen_hex8"]
FIXTURE_PROFILES.update(GENERIC_PROFILES)


# ---------------------------------------------------------------------
#  Fixture-bibliotek: generiske skabeloner + et udvalg af almindelige
#  lamper. Kan bladres/soeges i Patch og tilfoejes som lampetype.
#  For alt andet: importér en QLC+ .qxf-fil (tusindvis findes gratis).
#  cat: kategori · shape: par|wash|spot|bar · modes: navngivne kanalkort
# ---------------------------------------------------------------------
def _lib(id, name, brand, cat, shape, modes):
    return {"id": id, "name": name, "brand": brand, "cat": cat,
            "shape": shape, "modes": [{"name": mn, "channels": _chs(mc)}
                                      for mn, mc in modes]}

FIXTURE_LIBRARY = [
    # ---- generiske ----
    _lib("gen_dim", "Dæmper (1 kanal)", "Generisk", "Generisk", "spot",
         [("1 kanal", [("dimmer", "Dimmer")])]),
    _lib("gen_rgb", "RGB", "Generisk", "Generisk", "par",
         [("3 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])]),
    _lib("gen_rgb_d", "RGB + dæmper", "Generisk", "Generisk", "par",
         [("4 kanaler", [("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])]),
    _lib("gen_rgb_ds", "RGB + dæmper + strobe", "Generisk", "Generisk", "par",
         [("5 kanaler", [("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("strobe", "Strobe")])]),
    _lib("gen_rgbw", "RGBW", "Generisk", "Generisk", "par",
         [("4 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])]),
    _lib("gen_rgbw_d", "RGBW + dæmper", "Generisk", "Generisk", "par",
         [("5 kanaler", [("dimmer", "Dimmer"), ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])]),
    _lib("gen_rgba", "RGBA", "Generisk", "Generisk", "par",
         [("4 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul")])]),
    _lib("gen_rgbaw", "RGBAW", "Generisk", "Generisk", "par",
         [("5 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul"), ("w", "Hvid")])]),
    _lib("gen_rgbawuv", "RGBAW+UV", "Generisk", "Generisk", "par",
         [("6 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul"), ("w", "Hvid"), ("uv", "UV")])]),
    _lib("gen_hex_full", "Hex-PAR fuld (dæmper+strobe+RGBAW+UV)", "Generisk", "Generisk", "par",
         [("8 kanaler", [("dimmer", "Dimmer"), ("strobe", "Strobe"), ("r", "Rød"), ("g", "Grøn"),
                         ("b", "Blå"), ("w", "Hvid"), ("a", "Ravgul"), ("uv", "UV")])]),
    _lib("gen_mover_rgbw", "Simpel mover RGBW", "Generisk", "Generisk", "spot",
         [("8 kanaler", [("generic", "Pan"), ("generic", "Tilt"), ("dimmer", "Dimmer"),
                         ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid"), ("strobe", "Strobe")])]),
    _lib("gen_bar_rgb", "LED-bar RGB (3 zoner)", "Generisk", "Generisk", "bar",
         [("9 kanaler", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"),
                         ("generic", "Zone 2 R"), ("generic", "Zone 2 G"), ("generic", "Zone 2 B"),
                         ("generic", "Zone 3 R"), ("generic", "Zone 3 G"), ("generic", "Zone 3 B")])]),

    # ---- almindelige, verificerede/typiske ----
    _lib("cameo_rootpar6", "Root Par 6", "Cameo", "PAR / wash", "par",
         [("D12ch (12 kan. med DMX-forsinkelse)",
           [("dimmer", "Dimmer"), ("dimmer_fine", "Dimmer fin"), ("strobe", "Strobe"),
            ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid"), ("a", "Ravgul"),
            ("uv", "UV"), ("preset", "Farvepreset"), ("sound", "Lyd"),
            ("delay", "DMX-forsinkelse")]),
          ("8 kan. (dæmper+strobe+RGBWA+UV)",
           [("dimmer", "Dimmer"), ("strobe", "Strobe"), ("r", "Rød"), ("g", "Grøn"),
            ("b", "Blå"), ("w", "Hvid"), ("a", "Ravgul"), ("uv", "UV")]),
          ("6 kan. (direkte RGBWA+UV)",
           [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid"), ("a", "Ravgul"), ("uv", "UV")])]),
    _lib("cameo_tw600", "Thunder Wash 600 RGBW", "Cameo", "Strobe / blinder", "wash",
         [("7ch2 (dæmper+strobe+varighed+RGBW)",
           [("dimmer", "Dimmer"), ("strobe", "Strobe"), ("duration", "Blinkvarighed"),
            ("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")]),
          ("7ch1 (dæmper+strobe+RGBW+lyd)",
           [("dimmer", "Dimmer"), ("strobe", "Strobe"), ("r", "Rød"), ("g", "Grøn"),
            ("b", "Blå"), ("w", "Hvid"), ("sound", "Lyd")]),
          ("4ch1 (direkte RGBW)",
           [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])]),
    _lib("cameo_ts100ww", "TS 100 WW", "Cameo", "Spot / front", "spot",
         [("3ch (dæmper+fin+strobe)",
           [("dimmer", "Dimmer"), ("dimmer_fine", "Dimmer fin"), ("strobe", "Strobe")]),
          ("1ch (dæmper)", [("dimmer", "Dimmer")]),
          ("5ch (dæmper+fin+strobe+kurve+indstillinger)",
           [("dimmer", "Dimmer"), ("dimmer_fine", "Dimmer fin"), ("strobe", "Strobe"),
            ("fixed", "Dimmerkurve"), ("fixed", "Enhedsindstillinger")])]),
    _lib("chauvet_slimpar_proh", "SlimPAR Pro H", "Chauvet DJ", "PAR / wash", "par",
         [("6 kan. (direkte RGBAW+UV)",
           [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul"), ("w", "Hvid"), ("uv", "UV")])]),
    _lib("chauvet_slimpar_proq", "SlimPAR Pro Q / Q12", "Chauvet DJ", "PAR / wash", "par",
         [("4 kan. (direkte RGBA)",
           [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul")])]),
    _lib("chauvet_slimpar_t12", "SlimPAR T12 / Q12 BT (RGB)", "Chauvet DJ", "PAR / wash", "par",
         [("3 kan. (direkte RGB)", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])]),
    _lib("adj_megapar", "Mega Par Profile / Tri", "ADJ", "PAR / wash", "par",
         [("RGBA direkte", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("a", "Ravgul")]),
          ("RGB direkte", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])]),
    _lib("stairville_par56", "LED PAR 56/64 (RGB)", "Stairville", "PAR / wash", "par",
         [("3 kan. (direkte RGB)", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå")])]),
    _lib("eurolite_led_rgbw", "LED PAR RGBW", "Eurolite", "PAR / wash", "par",
         [("4 kan. (direkte RGBW)", [("r", "Rød"), ("g", "Grøn"), ("b", "Blå"), ("w", "Hvid")])]),
    _lib("generic_white_spot", "Hvid spot / dæmper", "Generisk", "Generisk", "spot",
         [("1 kanal", [("dimmer", "Dimmer")])]),
]


def profile_for(show, typ):
    p = FIXTURE_PROFILES.get(typ)
    if p:
        return p
    cp = (show.get("profiles") or {}).get(typ)
    if cp:
        return cp
    return {"name": typ, "shape": "par", "channels": [_ch("dimmer", "Dimmer")]}


def clean_channels(chans):
    """Kanaler fra fladen eller en kopi: kendte noegler, korte navne og
    vaerdier inden for 0-255. Tomme felter udelades, saa profilen holdes ren."""
    out = []
    for c in (chans or [])[:64]:
        if not isinstance(c, dict):
            continue
        k = str(c.get("k") or "generic")
        if k not in CHANNEL_KEYS:
            k = "generic"
        d = {"k": k, "n": (str(c.get("n") or k).strip() or k)[:40]}
        for f in ("def", "max"):
            v = c.get(f)
            if v is not None and v != "":
                try:
                    d[f] = int(clamp(int(v), 0, 255))
                except (TypeError, ValueError):
                    pass
        if d.get("max") == 255:
            d.pop("max")
        if d.get("def") == 0 and k != "fixed":
            d.pop("def")
        if c.get("inv"):
            d["inv"] = True
        out.append(d)
    return out


def profile_span(show, typ):
    return len(profile_for(show, typ)["channels"])

GAMMA_LUT = [round(255 * ((i / 255) ** 2.2)) for i in range(256)]
DUTY_TO_SRGB = [round(255 * ((i / 255) ** (1 / 2.2))) for i in range(256)]

PATTERNS = [
    ("fyldt", "Fyldt"), ("chase", "Chase"), ("teater", "Teaterchase"),
    ("boelge", "Bølge"), ("puls", "Puls"), ("scanner", "Scanner"),
    ("gnister", "Gnister"), ("blink", "Blink"), ("plasma", "Plasma"),
    ("komet", "Komet"), ("trappe", "Trappe"), ("bump", "Vandrende plet"),
    ("segmenter", "Segmenter"),
    ("fade", "Fade ind/ud"), ("random_flash", "Tilfældig flash"),
    ("buildup", "Opbygning"), ("dim_wave", "Dæmpbølge"),
    ("alternating", "Skiftevis"),
    ("egen", "Eget mønster"),
]
COLOUR_MODES = [("fast", "Fast"), ("gradient", "Gradient"),
                ("regnbue", "Regnbue"), ("cyklus", "Paletcyklus")]
BLENDS = [("max", "HTP / max"), ("add", "Additiv"), ("mult", "Multiplicer"),
          ("screen", "Screen"), ("replace", "Erstat")]
SPREADS = [("ingen", "Ingen"), ("index", "Modulnummer"), ("x", "X-position"),
           ("y", "Y-position"), ("midte", "Fra midten"),
           ("tilfaeldig", "Tilfældig"), ("gruppe", "Gruppe")]


# ======================================================================
#  Hjaelpefunktioner
# ======================================================================
def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def scale8(v, s):
    return (v * s + 255) >> 8


def hsv_rgb(h, s, v):
    h = (h % 1.0) * 6.0
    i = int(h)
    f = h - i
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r, g, b = [(v, t, p), (q, v, p), (p, v, t),
               (p, q, v), (t, p, v), (v, p, q)][i % 6]
    return r * 255.0, g * 255.0, b * 255.0


def lerp(a, b, k):
    return a + (b - a) * k


def _hash01(n):
    """Deterministisk pseudotilfaeldig 0..1 - samme moduler faar samme offset
    hver gang, saa et show ser ens ud fra gang til gang."""
    n = (n * 2654435761) & 0xFFFFFFFF
    n ^= n >> 15
    n = (n * 2246822519) & 0xFFFFFFFF
    n ^= n >> 13
    return (n & 0xFFFF) / 65535.0


# ======================================================================
#  Moenstre - hver returnerer en intensitet 0..1
#  u     = position 0..1 (langs modulet eller hen over scenen)
#  ph    = fase i "omgange", vokser med tiden
# ======================================================================
def pat_fyldt(u, ph, p, ctx):
    return 1.0


def pat_chase(u, ph, p, ctx):
    width = max(0.01, p["size"] / 100.0 * 0.6)
    tail = max(0.01, p["tail"] / 100.0)
    d = (u - (ph % 1.0)) % 1.0
    if d < width:
        return 1.0
    d -= width
    k = 1.0 - d / (tail + 1e-6)
    return k if k > 0 else 0.0


def pat_teater(u, ph, p, ctx):
    n = max(2, int(2 + p["steps"]))
    base = ctx["ord"] if "ord" in ctx else u * ctx["count"]
    idx = int(base + ph * n) % n
    return 1.0 if idx == 0 else 0.0


def pat_boelge(u, ph, p, ctx):
    cycles = 0.25 + p["size"] / 100.0 * 4.0
    v = (math.sin(2 * math.pi * (u * cycles - ph)) + 1.0) * 0.5
    g = 0.4 + p["density"] / 100.0 * 3.0
    return v ** g


def pat_puls(u, ph, p, ctx):
    v = (math.sin(2 * math.pi * ph) + 1.0) * 0.5
    floor = p["density"] / 100.0 * 0.6
    return floor + (1.0 - floor) * v


def pat_scanner(u, ph, p, ctx):
    width = max(0.02, p["size"] / 100.0 * 0.5)
    tri = abs(((ph * 2.0) % 2.0) - 1.0)
    pos = tri * (1.0 - width) + width * 0.5
    d = abs(u - pos)
    k = 1.0 - d / width
    return k if k > 0 else 0.0


def pat_gnister(u, ph, p, ctx):
    buf = ctx["sparkle"]
    i = ctx["i"]
    if ctx["first"]:
        decay = 0.97 - p["speed"] / 100.0 * 0.35
        chance = 0.002 + p["density"] / 100.0 * 0.09
        for k in range(len(buf)):
            buf[k] *= decay
            if random.random() < chance:
                buf[k] = 1.0
    return buf[i] if i < len(buf) else 0.0


def pat_blink(u, ph, p, ctx):
    duty = 0.05 + p["density"] / 100.0 * 0.9
    return 1.0 if (ph % 1.0) < duty else 0.0


# -- nye moenstre til lampe-rig ------------------------------------------
def pat_fade(u, ph, p, ctx):
    """Bloed fade ind/ud — alle lamper aander sammen. Density saetter
    bundniveauet saa det aldrig gaar helt i sort (nyttigt til langsom
    stemning). Med spread vandrer fasen hen over riggen."""
    floor = p["density"] / 100.0 * 0.7
    v = (math.sin(2 * math.pi * ph) + 1.0) * 0.5
    return floor + (1.0 - floor) * v


def pat_random_flash(u, ph, p, ctx):
    """Tilfaeldige lamper blinker uafhaengigt — binaert (fuldt taendt eller
    slukket), ikke med fade som gnister. Density styrer hyppigheden: lav
    = sjaeldne blink, hoej = mange paa samme tid. Seed pr. ramme + lampe
    index, saa det er deterministisk inden for samme frame."""
    buf = ctx["sparkle"]
    i = ctx["i"]
    if ctx["first"]:
        chance = 0.01 + p["density"] / 100.0 * 0.35
        dur = 0.4 + (1.0 - p["speed"] / 100.0) * 2.5
        for k in range(len(buf)):
            if buf[k] > 0:
                buf[k] = max(0.0, buf[k] - 1.0 / max(1, dur * 40))
            elif random.random() < chance:
                buf[k] = 1.0
    return 1.0 if (i < len(buf) and buf[i] > 0.5) else 0.0


def pat_buildup(u, ph, p, ctx):
    """Opbygning: lamper taender en ad gangen fra venstre mod hoejre,
    holder kort naar alle er taendt, saa slukker alle og det starter forfra.
    Klassisk spaendingsopbygger. Density styrer holdetiden i toppen."""
    hold = 0.08 + p["density"] / 100.0 * 0.35
    cycle = ph % 1.0
    fill_end = 1.0 - hold
    if cycle >= fill_end:
        return 1.0      # alle taendt i holdefasen
    frac = cycle / max(1e-6, fill_end)
    return 1.0 if u <= frac else 0.0


def pat_dim_wave(u, ph, p, ctx):
    """Daempboelge: alle lamper er taendt, men en bloed daempning vandrer
    hen over riggen. Meget mere subtil end boelge — velegnet til levende
    stemning paa et lille spillested, hvor man ikke vil have piskende
    sort/hvid kontrast. Size styrer boelgens bredde, density styrer
    hvor dybt den daemper (hoej density = naesten ingen dip)."""
    cycles = 0.25 + p["size"] / 100.0 * 3.0
    dip = 1.0 - p["density"] / 100.0 * 0.7
    v = (math.sin(2 * math.pi * (u * cycles - ph)) + 1.0) * 0.5
    return 1.0 - dip * (1.0 - v)


def pat_alternating(u, ph, p, ctx):
    """Skiftevis: lige og ulige lamper skifter paa et beat. Simpelt,
    effektivt, meget brugt live. Steps saetter antal grupper (2 = lige/ulige,
    3 = hver tredje osv). Density styrer overlap: hoej = begge grupper
    dæmpes aldrig helt, lav = haardt skifte."""
    n = max(2, int(2 + p["steps"]))
    active = int(ph * n) % n
    base = ctx["ord"] if "ord" in ctx else u * ctx["count"]
    group = int(base) % n
    floor = p["density"] / 100.0 * 0.5
    return 1.0 if group == active else floor


def pat_egen(u, ph, p, ctx):
    steps = ctx["custom"]
    if not steps:
        return 0.0
    ns = len(steps)
    row = steps[int(ph * ns) % ns]
    if not row:
        return 0.0
    pos = u * (len(row) - 1)
    i = int(pos)
    if not ctx["smooth"] or i >= len(row) - 1:
        return row[min(i, len(row) - 1)]
    return lerp(row[i], row[i + 1], pos - i)


def pat_plasma(u, ph, p, ctx):
    """Tre sinusser med hver sin fart. Aldrig helt det samme to gange."""
    s_ = 1.0 + p["size"] / 100.0 * 6.0
    v = (math.sin(2 * math.pi * (u * s_ + ph))
         + math.sin(2 * math.pi * (u * s_ * 1.7 - ph * 0.63))
         + math.sin(2 * math.pi * (u * s_ * 0.4 + ph * 1.31)))
    v = (v / 3.0 + 1.0) * 0.5
    return v ** (0.4 + p["density"] / 100.0 * 3.0)


def pat_komet(u, ph, p, ctx):
    """Hoved med eksponentiel hale, der vender ved enderne."""
    width = max(0.005, p["size"] / 100.0 * 0.3)
    tail = 0.02 + p["tail"] / 100.0 * 0.8
    head = abs(((ph * 2.0) % 2.0) - 1.0)
    d = abs(u - head)
    if d < width:
        return 1.0
    return math.exp(-(d - width) / max(1e-4, tail * 0.4))


def pat_trappe(u, ph, p, ctx):
    """Trinvis lysstyrke der marcherer. Haard kant, tydelig retning."""
    steps = max(2, int(2 + p["size"] / 100.0 * 10))
    v = (u + ph) % 1.0
    return math.floor(v * steps) / (steps - 1)


def pat_bump(u, ph, p, ctx):
    """Bloed klokkeformet plet der glider rundt og wrapper i enderne."""
    w = 0.015 + p["size"] / 100.0 * 0.35
    d = abs(u - (ph % 1.0))
    d = min(d, 1.0 - d)
    return math.exp(-(d * d) / (2 * w * w))


def pat_segmenter(u, ph, p, ctx):
    """Blokke der lyser i takt, som en gammel udstyringsmaaler."""
    segs = max(2, int(2 + p["size"] / 100.0 * 10))
    seg = math.floor(u * segs) / segs
    return (math.sin(2 * math.pi * (ph + seg * (0.3 + p["density"] / 100.0 * 1.2)))
            + 1.0) * 0.5


PATTERN_FN = {
    "fyldt": pat_fyldt, "chase": pat_chase, "teater": pat_teater,
    "boelge": pat_boelge, "puls": pat_puls, "scanner": pat_scanner,
    "gnister": pat_gnister, "blink": pat_blink, "plasma": pat_plasma,
    "komet": pat_komet, "trappe": pat_trappe, "bump": pat_bump,
    "segmenter": pat_segmenter,
    "fade": pat_fade, "random_flash": pat_random_flash,
    "buildup": pat_buildup, "dim_wave": pat_dim_wave,
    "alternating": pat_alternating,
    "egen": pat_egen,
}


# ======================================================================
#  Farvekilder - returnerer RGB 0..255 som floats
# ======================================================================
def colour_for(layer, u, t, ph):
    mode = layer["colour_mode"]
    if mode == "fast":
        c = layer["colour"]
        return float(c[0]), float(c[1]), float(c[2])

    if mode == "gradient":
        stops = layer["stops"] or [[255, 255, 255]]
        if len(stops) == 1:
            c = stops[0]
            return float(c[0]), float(c[1]), float(c[2])
        pos = clamp(u, 0.0, 0.9999) * (len(stops) - 1)
        i = int(pos)
        k = pos - i
        a, b = stops[i], stops[i + 1]
        return (lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k))

    if mode == "regnbue":
        spread = layer["hue_spread"] / 100.0
        return hsv_rgb(u * spread + t * layer["hue_speed"] / 100.0, 1.0, 1.0)

    if mode == "cyklus":
        stops = layer["stops"] or [[255, 255, 255]]
        pos = (t * layer["hue_speed"] / 100.0) % 1.0 * len(stops)
        i = int(pos)
        k = pos - i
        a, b = stops[i % len(stops)], stops[(i + 1) % len(stops)]
        return (lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k))

    return 255.0, 255.0, 255.0


# ======================================================================
#  Showmodel
# ======================================================================
def default_module(i):
    """Én lampe. Beholder feltnavnet 'module' internt, saa hele
    lagmotoren, scener og layout kan blive staaende - fladen kalder
    dem 'lamper'. 'pixels' er altid 1: en lampe er én celle."""
    return {
        "name": "Lampe %d" % (i + 1),
        "type": "root_par_6",
        "universe": 1, "address": 1 + i * 8,
        "pixels": 1, "len": 0.4,
        "x": -4.5 + i * 1.0, "y": 0.0, "rot": 0.0,
        "reverse": False, "on": True, "level": 255,
        "ovr": {},                  # manuelle kanaler: w/a/uv/strobe/macro
        "num": str(i + 1),          # vist nummer - foelger lampen, ikke listen
        "lbl": True,                # vis navnet for netop denne lampe
        "lx": 0.0, "ly": 0.0,       # navnets forskydning i meter fra lampen
    }


def default_view():
    """Visningsindstillinger delt mellem Layout og scene-simulatoren."""
    return {
        "labels": False,        # vis navne globalt
        "label_color": "#e8ecf4",
        "label_opacity": 85,    # 0-100
        "beams": False,         # vis straaler
        "pool": 15,             # lyspoelens stoerrelse
        "inten": 40,            # lysets maetning paa skaermen
        "beam": 50,             # straalens kraft/laengde
        "bang": 14,             # straalens halve vinkel i grader
        "grid": 4,              # gulvgitterets lysstyrke
    }


def default_layer(i):
    return {
        "name": "Lag %d" % (i + 1),
        "on": i == 0, "opacity": 255, "blend": "max",
        "mask": [], "solo": False,
        "pattern": "fyldt" if i == 0 else "chase", "custom": 0,
        "domain": "module",          # module | world
        "angle": 0,
        "speed": 30, "size": 30, "density": 50, "tail": 40, "steps": 3,
        "dir": 1, "mirror": False, "sync": False,
        "colour_mode": "fast", "colour": [255, 255, 255],
        "stops": [[255, 0, 0], [0, 0, 255]],
        "hue_speed": 10, "hue_spread": 100,
        "spread_mode": "ingen", "spread": 0,
    }


# Fanebladene i fladen, i standardraekkefoelge. Brugeren kan traekke dem
# rundt; raekkefoelgen gemmes i showet som "tab_order".
TAB_IDS = ("v-guide", "v-pult", "v-layout", "v-afvikling", "v-enkel", "v-patch",
           "v-pat", "v-scene", "v-out", "v-show", "v-help")


def fix_tab_order(order):
    """Brugerens raekkefoelge med kun kendte faner. Faner der er kommet til
    siden (fx Enkel) saettes ind efter den fane de stod efter i standarden."""
    if not isinstance(order, list):
        return list(TAB_IDS)
    out = []
    for t in order:
        if t in TAB_IDS and t not in out:
            out.append(t)
    if not out:
        return list(TAB_IDS)
    for i, t in enumerate(TAB_IDS):
        if t in out:
            continue
        prev = TAB_IDS[i - 1] if i > 0 else None
        out.insert(out.index(prev) + 1 if prev in out else 0, t)
    return out


LAMPTEST_KEYS = ("r", "g", "b", "w", "a", "uv")


def lamptest_channels(prof, step):
    """DMX-vaerdierne for ét trin i lampetesten efter en profils kanalkort.
    Farvekanalerne (r g b w a uv) tager trinnets vaerdier; har profilen
    farvekanaler, staar dimmeren fuldt op, ellers baerer den lysstyrken.
    Alt andet (strobe, makro, faste kanaler) faar sin standardvaerdi -
    samme regler som lamperne ellers koerer efter, saa det testen viser
    er det lampen vil goere i drift."""
    chans = prof["channels"]
    has_col = any(c["k"] in LAMPTEST_KEYS for c in chans)
    inten = max([int(step.get(k, 0) or 0) for k in LAMPTEST_KEYS] + [0])
    dim_max = next((c.get("max") for c in chans if c["k"] == "dimmer"), None)
    buf = bytearray(len(chans))
    for off, c in enumerate(chans):
        k = c["k"]
        if k in ("dimmer", "dimmer_fine"):
            v = 255 if has_col else inten
            if k == "dimmer_fine" and dim_max is not None:
                v = min(v, int(dim_max))
        elif k in LAMPTEST_KEYS:
            v = step.get(k, 0)
        else:
            v = c.get("def", 0)
        try:
            v = int(v)
        except (TypeError, ValueError):
            v = 0
        mx = c.get("max")
        if mx is not None:
            v = min(v, int(mx))
        if c.get("inv"):
            v = 255 - v
        buf[off] = clamp(v, 0, 255)
    return bytes(buf)


def default_show(n_modules=20, n_layers=6):
    n_layers = n_layers or 6
    show = {
        "name": "Nyt show",
        "settings": {"fps": 40, "gamma": False, "max_ma": 0, "bright": 255,
                     "glow": True, "perf": False, "artnet_base": 0,
                     "scene_tempo": False},
        "master": {"grand": 255, "blackout": False, "strobe": 0,
                   "freeze": False, "bpm": 120},
        "profiles": {},              # egne lampetyper
        "modules": [default_module(i) for i in range(n_modules)],
        "groups": [{"name": "Ulige", "members": list(range(0, n_modules, 2))},
                   {"name": "Lige", "members": list(range(1, n_modules, 2))}],
        "layers": [default_layer(i) for i in range(n_layers)],
        "patterns": [{"name": "Eget 1", "steps": [[0.0] * 24 for _ in range(8)],
                      "smooth": True}],
        "scenes": [],
        "cuelist": [],
        "stage_objects": [],
        "group_labels": [],          # navngivne grupper til Layout/Afvikling
        "live": {"looks": [], "fade": 1.0},   # Afvikling: looks + standard overgangstid
        "palettes": [
            {"name": "Standard", "colours": [
                [255,0,0],[255,80,0],[255,160,0],[255,230,0],[120,255,0],[0,255,80],
                [0,220,255],[0,80,255],[130,0,255],[230,0,255],[255,0,140],
                [255,255,255],[255,180,110],[180,210,255]]},
        ],
        "active_palette": 0,
        "tab_order": list(TAB_IDS),
        "control": ["pult"],         # hvem der styrer lyset (se CONTROLLERS)
        "view": default_view(),
        "scene_tabs": [{"id": "main", "name": "Scener"}],
        "outputs": {
            "artnet": {"on": True, "host": "127.0.0.1", "broadcast": False},
            "sacn": {"on": False, "host": "", "priority": 100},
            "enttec": {"on": False, "port": "", "baud": 250000, "device": "opendmx"},
        },
    }
    auto_address(show)
    return show


def demo_show():
    """Et typisk lille spillested: 16 Root Par 6, 2 Thunder Wash 600,
    2 hvide spots. PAR i en bue bag scenen, wash i siderne, spots foran."""
    show = default_show(0, 6)
    rig = ([("root_par_6", 16)] + [("thunder_wash_600", 2)]
           + [("cameo_ts100ww", 2)])
    i = 0
    for typ, qty in rig:
        for _ in range(qty):
            m = default_module(i)
            m["type"] = typ
            m["name"] = "%s %d" % (profile_for(show, typ)["name"], i + 1)
            show["modules"].append(m)
            i += 1
    _place_demo(show)
    auto_address(show)
    n = len(show["modules"])
    show["groups"] = [
        {"name": "PAR", "members": [j for j, m in enumerate(show["modules"])
                                    if m["type"] == "root_par_6"]},
        {"name": "Wash", "members": [j for j, m in enumerate(show["modules"])
                                     if m["type"] == "thunder_wash_600"]},
        {"name": "Spots", "members": [j for j, m in enumerate(show["modules"])
                                      if m["type"] in ("white_spot", "cameo_ts100ww")]},
        {"name": "Ulige", "members": list(range(0, n, 2))},
        {"name": "Lige", "members": list(range(1, n, 2))},
    ]
    return show


def _place_demo(show):
    pars = [m for m in show["modules"] if m["type"] == "root_par_6"]
    for k, m in enumerate(pars):
        t = k / max(1, len(pars) - 1)
        m["x"] = -5.0 + 10.0 * t
        m["y"] = 2.4 - 1.2 * math.sin(t * math.pi)
    wash = [m for m in show["modules"] if m["type"] == "thunder_wash_600"]
    for k, m in enumerate(wash):
        m["x"] = -6.2 if k == 0 else 6.2
        m["y"] = 0.4
    spot = [m for m in show["modules"] if m["type"] in ("white_spot", "cameo_ts100ww")]
    for k, m in enumerate(spot):
        m["x"] = -2.0 if k == 0 else 2.0
        m["y"] = -2.6


def auto_address(show):
    """Pakker adresser tæt fra 1 pr. univers, i listens rækkefølge."""
    per = {}
    for m in show["modules"]:
        u = m.get("universe", 1)
        per.setdefault(u, 1)
        m["address"] = per[u]
        per[u] += profile_span(show, m["type"])


# ======================================================================
#  Outputdrivere
# ======================================================================
class ArtNetOut:
    name = "artnet"

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.seq = 1
        self.err = ""

    def send(self, universes, cfg):
        host = cfg.get("host") or "127.0.0.1"
        if cfg.get("broadcast"):
            host = "255.255.255.255"
        for uni, data in universes.items():
            p = bytearray(b"Art-Net\x00")
            p += struct.pack("<H", 0x5000)
            p += bytes([0, 14, self.seq, 0])
            p += bytes([uni & 0xFF, (uni >> 8) & 0xFF, 0x02, 0x00])
            p += bytes(data)
            try:
                self.sock.sendto(bytes(p), (host, 6454))
                self.err = ""
            except OSError as e:
                self.err = str(e)
        self.seq = self.seq % 255 + 1

    def close(self):
        self.sock.close()


class SacnOut:
    name = "sacn"

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 8)
        except OSError:
            pass          # nogle Windows-opsaetninger naegter - unicast virker stadig
        self.seq = 0
        self.cid = bytes(random.randrange(256) for _ in range(16))
        self.err = ""

    def send(self, universes, cfg):
        prio = int(cfg.get("priority", 100))
        for uni, data in universes.items():
            u = uni + 1                      # sACN taeller universer fra 1
            pkt = self._packet(u, data, prio)
            host = cfg.get("host") or "239.255.%d.%d" % ((u >> 8) & 0xFF, u & 0xFF)
            try:
                self.sock.sendto(pkt, (host, 5568))
                self.err = ""
            except OSError as e:
                self.err = str(e)
        self.seq = (self.seq + 1) & 0xFF

    def _packet(self, universe, data, priority):
        dmx = b"\x00" + bytes(data)                       # startkode + 512
        # Root layer
        root = bytearray()
        root += struct.pack(">HH", 0x0010, 0x0000)
        root += b"ASC-E1.17\x00\x00\x00"
        root += struct.pack(">H", 0x7000 | (109 + len(dmx)))
        root += struct.pack(">I", 0x00000004)
        root += self.cid
        # Framing layer
        fr = bytearray()
        fr += struct.pack(">H", 0x7000 | (87 + len(dmx)))
        fr += struct.pack(">I", 0x00000002)
        fr += b"Pixelpult".ljust(64, b"\x00")
        fr += bytes([priority])
        fr += struct.pack(">H", 0)
        fr += bytes([self.seq, 0])
        fr += struct.pack(">H", universe)
        # DMP layer
        dmp = bytearray()
        dmp += struct.pack(">H", 0x7000 | (10 + len(dmx)))
        dmp += bytes([0x02, 0xA1])
        dmp += struct.pack(">HHH", 0x0000, 0x0001, len(dmx))
        dmp += dmx
        return bytes(root + fr + dmp)

    def close(self):
        self.sock.close()


def _spin_us(us):
    """Praecis kort ventetid. time.sleep er for grov til mikrosekunder."""
    if us <= 0:
        return
    end = time.perf_counter() + us / 1e6
    while time.perf_counter() < end:
        pass


class EnttecOut:
    """Fysisk DMX ud via USB: Enttec Open DMX USB.

    En raa FTDI (FT232R) uden egen protokol, drevet direkte via
    pyftdi/libusb - som QLC+ goer det. 250000 baud, 8N2, ingen flow, RTS
    lav. Pr. frame: break -> MAB -> startkode 0x00 + 512 kanaler.
    'port' er en pyftdi-URL, fx ftdi://0x0403:0x6001/1.

    Timing (det er her flimmer opstaar):
      * write_data vender tilbage saa snart bytes er afleveret til chippen.
        FT232R har en 256 bytes sendebuffer, saa op til ~11 ms af framen er
        endnu ikke sendt ud paa kablet naar kaldet returnerer.
      * Saettes naeste break foer den er helt ude, klippes halen af framen,
        og resten sendes efter break som starten paa den naeste - lamperne
        faar forskudte vaerdier i én frame = et kort blink.
      Derfor koerer afsendelsen i sin egen traad, der foer hvert break
      venter til den forrige frame beviseligt er ude: beregnet linjetid
      (11 bit pr. byte ved 250 kbit/s) plus chippens TEMT-bit ("sender
      tom"). Hele framen afleveres i én USB-overfoersel, saa Python (GIL,
      render, webserver) ikke kan lave huller midt i den. Renderingen
      afleverer blot det seneste billede.
    """
    name = "enttec"
    BYTE_S = 11 / 250000.0          # 1 start + 8 data + 2 stop ved 250 kbit/s
    RATE_HZ = 40.0                  # oensket opdatering; begraenses af linjen
    IDLE_S = 0.5                    # stop med at sende naar pulten slaar DMX fra

    def __init__(self):
        self.ftdi = None
        self.opened = ""
        self.err = ""
        self.device = "opendmx"
        self.frames_sent = 0
        self.late_temt = 0          # frames hvor TEMT kom senere end beregnet
        self._lock = threading.Lock()
        self._pending = None        # (url, data, break_us, mab_us)
        self._last_call = 0.0
        self._wake = threading.Event()
        self._thread = None
        self._line_free_at = 0.0
        self._next_start = 0.0

    def send(self, universes, cfg):
        """Kaldes fra engine-tick. Afleverer kun det seneste billede -
        selve afsendelsen sker i DMX-traaden."""
        if not universes:
            return
        self.device = cfg.get("device", "opendmx")
        target = self.clean_port(cfg.get("port"))
        if not target:
            self.err = "vælg en FTDI-enhed"
            return
        if self.err == "vælg en FTDI-enhed":
            self.err = ""          # gyldig enhed valgt - den gamle besked er forældet
        uni = int(cfg.get("universe", min(universes)))
        data = universes.get(uni)
        if data is None:
            data = universes[min(universes)]
        with self._lock:
            self._pending = (target, bytes(data),
                             int(cfg.get("break_us", 110)), int(cfg.get("mab_us", 16)))
            self._last_call = time.perf_counter()
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="dmx-enttec", daemon=True)
            self._thread.start()
        self._wake.set()

    # -- DMX-traaden -----------------------------------------------------
    def _run(self):
        while True:
            self._wake.wait(0.2)
            self._wake.clear()
            while True:
                with self._lock:
                    job = self._pending
                    idle = time.perf_counter() - self._last_call > self.IDLE_S
                if job is None or idle:
                    break                     # DMX slaaet fra: hold op med at sende
                now = time.perf_counter()
                if now < self._next_start:
                    time.sleep(self._next_start - now)
                url, data, brk, mab = job
                self._send_ftdi(url, data, brk, mab)
                if not self.ftdi:
                    time.sleep(0.5)           # fejl: proev igen om lidt, ikke i ring
                self._next_start = max(self._line_free_at,
                                       time.perf_counter() + 0.0005,
                                       self._next_start + 1.0 / self.RATE_HZ)

    def _wait_line_free(self, f):
        """Vent til forrige frame er helt ude paa kablet."""
        now = time.perf_counter()
        if now < self._line_free_at:
            time.sleep(self._line_free_at - now)
        # Bekraeft med chippens egen status (TEMT = sendebuffer og
        # skifteregister tomme). Max ~6 ms; svarer en klon ikke, er den
        # beregnede tid allerede rigelig.
        t_end = time.perf_counter() + 0.006
        first = True
        while True:
            try:
                st = f.poll_modem_status()
            except Exception:
                return
            if st & (1 << 14):
                return
            if first:
                self.late_temt += 1
                first = False
            if time.perf_counter() > t_end:
                return
            time.sleep(0.0005)

    # -- opendmx: direkte FTDI (som QLC+ libftdi) -----------------------
    def _open_ftdi(self, url):
        from pyftdi.ftdi import Ftdi
        self._close()
        f = Ftdi()
        f.open_from_url(url)                 # libusb kobler ftdi_sio af selv
        f.set_baudrate(250000)
        f.set_line_property(8, 2, 'N')       # 8 databit, 2 stopbit, ingen paritet
        for call in (lambda: f.set_flowctrl(''),
                     lambda: f.set_latency_timer(1),
                     lambda: f.set_rts(False),
                     lambda: f.purge_buffers(),
                     # hele framen i én USB-overfoersel
                     lambda: f.write_data_set_chunksize(1024)):
            try:
                call()
            except Exception:
                pass
        self.ftdi = f
        self.opened = url
        self.err = ""
        self.frames_sent = 0
        self._line_free_at = 0.0

    def _send_ftdi(self, url, data512, break_us, mab_us):
        try:
            if self.opened != url or not self.ftdi:
                self._open_ftdi(url)
            f = self.ftdi
            self._wait_line_free(f)
            f.set_break(True)
            _spin_us(break_us)
            f.set_break(False)
            _spin_us(mab_us)
            frame = b"\x00" + data512         # startkode 0x00 + 512 kanaler
            t0 = time.perf_counter()
            f.write_data(frame)
            # sidste byte er ude senest: start + linjetid (+1 ms USB-margin)
            self._line_free_at = t0 + len(frame) * self.BYTE_S + 0.001
            self.err = ""
            self.frames_sent += 1
        except ImportError:
            self.err = "pyftdi mangler - kør: pip3 install pyftdi pyusb"
            self._close()
        except Exception as e:
            self.err = str(e)
            self._close()

    def _close(self):
        for obj in (self.ftdi,):
            try:
                if obj:
                    obj.close()
            except Exception:
                pass
        self.ftdi = None
        self.opened = ""

    def close(self):
        self._close()

    @staticmethod
    def clean_port(port):
        return (port or "").split("  (")[0].strip()

    @staticmethod
    def ports():
        """Serieporte - kun til fejlfinding i fladen."""
        try:
            from serial.tools import list_ports
        except ImportError:
            return []
        return [p.device for p in list_ports.comports()]

    # Hvorfor listen er tom - vises i fladen i stedet for bare "ingen enhed".
    ftdi_error = ""

    @staticmethod
    def ftdi_devices():
        """FTDI-enheder som pyftdi-URL'er - til opendmx."""
        try:
            from pyftdi.ftdi import Ftdi
        except Exception as e:
            EnttecOut.ftdi_error = ("pyftdi mangler - kør:  pip3 install pyftdi pyusb "
                                    "--break-system-packages   (%s)" % e)
            return []
        out = []
        try:
            devs = Ftdi.list_devices()
        except Exception as e:
            EnttecOut.ftdi_error = (
                "libusb kunne ikke lede efter enheder: %s. "
                "Linux: sudo apt install libusb-1.0-0, og laeg en udev-regel "
                "for 0403:6001 (se dongle-vejledningen)." % e)
            return []
        for desc, _ifc in devs:
            if getattr(desc, "sn", None):
                url = "ftdi://0x%04x:0x%04x:%s/1" % (desc.vid, desc.pid, desc.sn)
            else:
                url = "ftdi://0x%04x:0x%04x/1" % (desc.vid, desc.pid)
            label = "%s [%04x:%04x%s]" % (
                desc.description or "FTDI", desc.vid, desc.pid,
                (" " + desc.sn) if getattr(desc, "sn", None) else "")
            out.append({"url": url, "label": label})
        if not out:
            EnttecOut.ftdi_error = (
                "Ingen FTDI-enhed fundet. Sidder donglen i? Er den optaget af et "
                "andet program (QLC+, en anden lyspult)? Paa Linux kraever den "
                "ogsaa en udev-regel for 0403:6001 + medlemskab af plugdev.")
        else:
            EnttecOut.ftdi_error = ""
        return out


# ======================================================================
#  Motoren
# ======================================================================
class Engine:
    def __init__(self, show):
        self.show = show
        self.lock = threading.RLock()
        self.t0 = time.monotonic()
        self.rev = 1                      # stiger hver gang showet aendres
        self.pixels = []                  # [modul][pixel] = [r,g,b] 0..255
        self.dmx = {}                     # univers -> bytearray(512)
        self.sparkle = {}
        self.preview_sparkle = {}
        self.fade = None                  # {"from": frame, "t0":, "dur":}
        self.fade_k = 1.0
        self.render_err = ""              # sidste oversprungne frame, hvis nogen
        # Slag-uret: taeller slag op i takt med master-BPM. Lag med "Foelg
        # tempo" koerer efter det i stedet for efter klokken, saa et nyt
        # tappet tempo kun aendrer farten fremover - chasen hopper ikke.
        self.beats = 0.0
        self.beat_last = time.monotonic()
        self.probe = None                 # kanaltest: {"type","slot","value","until"}
        self.lamptest = None              # lampetest paa en adresse (se lamptest_channels)
        self.lamptest_now = None          # hvad testen sender lige nu - til fladen
        self.fps_real = 0.0
        self.outputs = {"artnet": ArtNetOut(), "sacn": SacnOut(),
                        "enttec": EnttecOut()}
        self.running = True
        self._prep()
        threading.Thread(target=self._loop, daemon=True).start()

    # -- geometri ------------------------------------------------------
    def _prep(self):
        mods = self.show["modules"]
        pts = []
        for m in mods:
            n = m["pixels"]
            a = math.radians(m["rot"])
            for i in range(n):
                f = (i + 0.5) / n - 0.5
                pts.append((m["x"] + math.cos(a) * f * m["len"],
                            m["y"] + math.sin(a) * f * m["len"]))
        xs = [p[0] for p in pts] or [0.0]
        ys = [p[1] for p in pts] or [0.0]
        self.world = pts
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        self.centre = ((self.bbox[0] + self.bbox[2]) / 2,
                       (self.bbox[1] + self.bbox[3]) / 2)
        sig = tuple(m["pixels"] for m in mods)
        if sig != getattr(self, "_sig", None):
            self._sig = sig
            self.sparkle = {}
            self.preview_sparkle = {}

    def touch(self):
        with self.lock:
            self.rev += 1
            self._prep()

    # -- spredning -----------------------------------------------------
    def _spread_offset(self, layer, mi):
        # Gruppe-looks (Afvikling): forskydningen foelger lampens plads i
        # gruppens egen nummerering, ikke dens globale indeks.
        order = layer.get("order")
        if order is not None:
            if not layer["spread"]:
                return 0.0
            n = max(1, layer.get("order_n", 1) - 1)
            return (order.get(mi, 0) / n) * (layer["spread"] / 100.0)
        mode = layer["spread_mode"]
        if mode == "ingen" or not layer["spread"]:
            return 0.0
        mods = self.show["modules"]
        amt = layer["spread"] / 100.0
        if mode == "index":
            k = mi / max(1, len(mods) - 1)
        elif mode == "x":
            x0, _, x1, _ = self.bbox
            k = (mods[mi]["x"] - x0) / max(1e-6, x1 - x0)
        elif mode == "y":
            _, y0, _, y1 = self.bbox
            k = (mods[mi]["y"] - y0) / max(1e-6, y1 - y0)
        elif mode == "midte":
            dx = mods[mi]["x"] - self.centre[0]
            dy = mods[mi]["y"] - self.centre[1]
            span = max(1e-6, math.hypot(self.bbox[2] - self.bbox[0],
                                        self.bbox[3] - self.bbox[1]) / 2)
            k = math.hypot(dx, dy) / span
        elif mode == "tilfaeldig":
            k = _hash01(mi + 7919)
        elif mode == "gruppe":
            gi, gn = 0, 1
            for j, g in enumerate(self.show["groups"]):
                if mi in g["members"]:
                    gi, gn = j, max(1, len(self.show["groups"]))
                    break
            k = gi / gn
        else:
            k = 0.0
        return k * amt

    # -- koordinat -----------------------------------------------------
    def _coord(self, layer, mi, i, n, base):
        # Gruppe-look: u er lampens plads i gruppens nummerering (0..1), saa
        # chase, gradient og regnbue loeber hen over gruppen i raekkefoelge.
        order = layer.get("order")
        if order is not None:
            n_ord = max(1, layer.get("order_n", 1))
            pos = order.get(mi, 0)
            if layer.get("pattern") in SPAN_PATTERNS:
                u = pos / max(1, n_ord - 1)      # fejer: begge ender med
            else:
                u = pos / n_ord                  # cyklisk: ingen dublet
            if layer.get("mirror"):
                u = abs(u * 2.0 - 1.0)
            return clamp(u, 0.0, 1.0)
        if layer["domain"] == "world":
            wx, wy = self.world[base + i]
            a = math.radians(layer["angle"])
            x0, y0, x1, y1 = self.bbox
            span = abs((x1 - x0) * math.cos(a)) + abs((y1 - y0) * math.sin(a))
            proj = ((wx - x0) * math.cos(a) + (wy - y0) * math.sin(a))
            u = proj / max(1e-6, span)
        else:
            u = i / max(1, n - 1)
            if self.show["modules"][mi]["reverse"]:
                u = 1.0 - u
        if layer["mirror"]:
            u = abs(u * 2.0 - 1.0)
        return clamp(u, 0.0, 1.0)

    # -- live-looks (Afvikling) ----------------------------------------
    def live_looks(self, looks=None):
        if looks is not None:
            return looks
        live = self.show.get("live") or {}
        return live.get("looks") or []

    def live_claim(self, looks=None):
        """De lamper Afvikling har taget styringen over. Et look taeller med
        uanset om det er taendt - saa et slukket look giver moerke lamper i
        stedet for at falde tilbage til Pulten."""
        nmods = len(self.show["modules"])
        claim = set()
        for look in self.live_looks(looks):
            for mi in look_targets(self.show, look):
                if 0 <= mi < nmods:
                    claim.add(mi)
        return claim

    def live_layers(self, looks=None):
        """Byg et lag pr. aktivt gruppe-look. Hvert look peger paa en gruppe
        eller en ad-hoc markering; lamperne faar u ud fra deres plads i
        gruppens nummerering, saa moenstre loeber i den raekkefoelge."""
        src = self.live_looks(looks)
        if not src:
            return []
        nmods = len(self.show["modules"])
        now = time.monotonic()
        out = []
        for look in src:
            if not look.get("on", True):
                continue
            order_list = look_targets(self.show, look)
            order_list = [i for i in order_list if 0 <= i < nmods]
            if not order_list:
                continue
            col, lvl = look_eased(look, now)
            if lvl <= 0:
                continue
            L = default_layer(0)
            L.update({
                "name": look.get("name", "Look"),
                "on": True, "opacity": int(clamp(lvl, 0, 255)), "blend": "max",
                "mask": order_list, "order": dict((mi, k) for k, mi in enumerate(order_list)),
                "order_n": len(order_list), "domain": "order",
                "pattern": look.get("pattern", "fyldt"),
                "custom": int(look.get("custom", 0)),
                "speed": look.get("speed", 30), "size": look.get("size", 30),
                "density": look.get("density", 50), "tail": look.get("tail", 40),
                "steps": look.get("steps", 3), "dir": look.get("dir", 1),
                "mirror": bool(look.get("mirror")), "sync": bool(look.get("sync")),
                "colour_mode": look.get("colour_mode", "fast"), "colour": col,
                "stops": look.get("stops") or [[255, 0, 0], [0, 0, 255]],
                "hue_speed": look.get("hue_speed", 10),
                "hue_spread": look.get("hue_spread", 100),
                "spread_mode": "order" if look.get("spread") else "ingen",
                "spread": int(look.get("spread", 0)),
            })
            out.append(L)
        return out

    def _coord_col(self, layer, mi, u):
        """Koordinatet FARVEN laeses ved. En gradient skal spaende hele
        gruppen fra foerste til sidste lampe, ogsaa selv om moensteret
        koerer cyklisk og derfor bruger en anden fordeling."""
        order = layer.get("order")
        if order is None:
            return u
        uc = order.get(mi, 0) / max(1, layer.get("order_n", 1) - 1)
        if layer.get("mirror"):
            uc = abs(uc * 2.0 - 1.0)
        return clamp(uc, 0.0, 1.0)

    # -- én frame ------------------------------------------------------
    def render(self, t, master=None, layers_in=None, levels=None, sparkle=None,
               beats=None, live_in=None, ctl_in=None):
        show = self.show
        mods = show["modules"]
        master = master or show["master"]
        sparkle = self.sparkle if sparkle is None else sparkle
        acc = [[[0.0, 0.0, 0.0] for _ in range(m["pixels"])] for m in mods]

        # Kun de styringer der har kontrollen, kommer med i billedet.
        if layers_in is None:
            ctl = control_of(show)
            looks = [lk for lk in self.live_looks() if look_src(lk) in ctl]
            base_pool = show["layers"] if "pult" in ctl else []
        else:
            ctl = clean_control(ctl_in) or infer_control(layers_in, live_in)
            looks = [lk for lk in (live_in or []) if look_src(lk) in ctl]
            base_pool = layers_in if "pult" in ctl else []
        live_pool = self.live_layers(looks) if looks else []
        claim = self.live_claim(looks) if looks else set()
        solo = [l for l in base_pool if l.get("solo")]
        layers = solo if solo else [l for l in base_pool if l["on"]]

        bpm = max(1.0, master.get("bpm", 120))
        if beats is None:
            beats = t * bpm / 60.0
        base_index = []
        b = 0
        for m in mods:
            base_index.append(b)
            b += m["pixels"]

        self._blend_layers(acc, layers, mods, base_index, t, beats, sparkle, 0)

        # Afvikling ejer de lamper den styrer: er en lampe med i et
        # gruppe-look, er det looket der bestemmer - ikke Pultens lag.
        # Ellers ville Pultens hvide lag 1 (HTP) overdoeve farverne, og
        # det man satte i Afvikling kunne ikke ses. Et look der er
        # slukket holder stadig sine lamper - de bliver bare moerke -
        # saa man selv bestemmer hvornaar Pulten faar dem tilbage
        # (Nulstil paa looket, eller Alt moerkt).
        if claim:
            acc2 = [[[0.0, 0.0, 0.0] for _ in range(m["pixels"])] for m in mods]
            if live_pool:
                self._blend_layers(acc2, live_pool, mods, base_index, t, beats,
                                   sparkle, 1000)
            for mi in claim:
                if 0 <= mi < len(acc):
                    acc[mi] = acc2[mi]

        return self._finish(acc, mods, master, levels, t)

    def _blend_layers(self, acc, layers, mods, base_index, t, beats, sparkle, keyoff):
        """Bland en liste lag ned i acc. keyoff holder gnist-hukommelsen
        adskilt mellem Pultens lag og Afviklings looks."""
        show = self.show
        for li, layer in enumerate(layers):
            mask = layer["mask"]
            op = layer["opacity"] / 255.0
            if op <= 0:
                continue
            fn = PATTERN_FN.get(layer["pattern"], pat_fyldt)
            custom = None
            smooth = True
            if layer["pattern"] == "egen":
                pats = show["patterns"]
                idx = clamp(int(layer["custom"]), 0, max(0, len(pats) - 1))
                if pats:
                    custom = pats[idx]["steps"]
                    smooth = pats[idx].get("smooth", True)

            spd = layer["speed"] / 100.0 * layer["dir"]
            # Foelg tempo: Fart 100 = én omgang pr. slag, maalt paa slag-uret
            clock = beats if layer.get("sync") else t

            for mi, m in enumerate(mods):
                if mask and mi not in mask:
                    continue
                n = m["pixels"]
                ph = clock * spd + self._spread_offset(layer, mi)
                key = (keyoff + li, mi)
                st = sparkle.get(key)
                if st is None or len(st["buf"]) != n:
                    st = {"buf": [0.0] * n, "mem": {}}
                    sparkle[key] = st
                ctx = {"count": n, "sparkle": st["buf"], "mem": st["mem"],
                       "i": 0, "first": True, "custom": custom, "smooth": smooth}
                if layer.get("order") is not None:
                    # gruppens egen nummerering - moenstre der taeller i
                    # trin (teater, skiftevis) skal bruge den, ikke u
                    ctx["ord"] = layer["order"].get(mi, 0)
                    ctx["ordn"] = layer.get("order_n", 1)
                dst = acc[mi]
                bi = base_index[mi]
                for i in range(n):
                    ctx["i"] = i
                    u = self._coord(layer, mi, i, n, bi)
                    v = fn(u, ph, layer, ctx)
                    ctx["first"] = False
                    if v <= 0.0:
                        if layer["blend"] == "mult":
                            dst[i][0] = dst[i][1] = dst[i][2] = 0.0
                        elif layer["blend"] == "replace":
                            dst[i][0] = dst[i][1] = dst[i][2] = 0.0
                        continue
                    cr, cg, cb = colour_for(layer, self._coord_col(layer, mi, u), t, ph)
                    k = v * op
                    src = (cr * k, cg * k, cb * k)
                    bl = layer["blend"]
                    d = dst[i]
                    if bl == "max":
                        for c in range(3):
                            if src[c] > d[c]:
                                d[c] = src[c]
                    elif bl == "add":
                        for c in range(3):
                            d[c] = min(255.0, d[c] + src[c])
                    elif bl == "mult":
                        for c in range(3):
                            d[c] = d[c] * src[c] / 255.0
                    elif bl == "screen":
                        for c in range(3):
                            d[c] = 255.0 - (255.0 - d[c]) * (255.0 - src[c]) / 255.0
                    else:                                    # replace
                        for c in range(3):
                            d[c] = src[c]

    # -- master, dimmere og strobe -------------------------------------
    def _finish(self, acc, mods, master, levels, t):
        grand = 0 if master.get("blackout") else master.get("grand", 255)
        strobe_on = self._strobe(master["strobe"], t)
        out = []
        for mi, m in enumerate(mods):
            if levels is not None and mi < len(levels):
                m_on, m_lvl = levels[mi]["on"], levels[mi]["level"]
            else:
                m_on, m_lvl = m["on"], m["level"]
            lvl = 0 if (not m_on or not strobe_on) else (m_lvl * grand) // 255
            row = []
            for px in acc[mi]:
                if lvl == 0:
                    row.append([0, 0, 0])
                else:
                    row.append([int(clamp(px[c] * lvl / 255.0, 0, 255))
                                for c in range(3)])
            out.append(row)
        return out

    @staticmethod
    def _strobe(v, t):
        if v < 8:
            return True
        hz = 1 + (v - 8) * 24 / 247.0
        period = 1.0 / hz
        return (t % period) < min(period * 0.25, 0.020)

    # -- DMX-pakning ---------------------------------------------------
    def module_channels(self, mi, pixels):
        """DMX-kanalerne for én lampe, efter dens profil. Farven r/g/b
        kommer fra det rendered pixel (som allerede har niveau, grand og
        strobe regnet ind). Har profilen r/g/b, saettes dimmer til 255 og
        dimpningen ligger i farven - ligesom pixelmode. Har den ingen
        farvekanaler (fx en hvid spot), baerer dimmeren lysstyrken.
        w/a/uv/strobe/macro tages fra lampens manuelle 'ovr'."""
        m = self.show["modules"][mi]
        prof = profile_for(self.show, m["type"])
        chans = prof["channels"]
        row = pixels[mi] if mi < len(pixels) else []
        px = row[0] if row else [0, 0, 0]
        r, g, b = int(px[0]), int(px[1]), int(px[2])
        has_rgb = any(c["k"] in ("r", "g", "b") for c in chans)
        inten = max(r, g, b)
        ovr = m.get("ovr", {})
        buf = bytearray(len(chans))
        dim_max = next((c.get("max") for c in chans if c["k"] == "dimmer"), None)
        for off, c in enumerate(chans):
            k = c["k"]
            if k == "dimmer" or k == "dimmer_fine":
                # Fin-kanalen faar samme vaerdi som den grove: v*257 er
                # den 16-bit-vaerdi der svarer til 8-bit v (255 -> 65535).
                # Har dimmeren en maks, gaelder den ogsaa fin-kanalen.
                v = 255 if has_rgb else inten
                if k == "dimmer_fine" and dim_max is not None:
                    v = min(v, int(dim_max))
            elif k == "r":
                v = r
            elif k == "g":
                v = g
            elif k == "b":
                v = b
            elif k == "fixed":
                v = c.get("def", 0)          # altid samme vaerdi (fx en mode-kanal)
            else:
                v = ovr.get(k, c.get("def", 0))
            try:
                v = int(v)
            except (TypeError, ValueError):
                v = 0
            mx = c.get("max")
            if mx is not None:
                v = min(v, int(mx))          # fx Alkalites dimmer: over 159 = strobe
            if c.get("inv"):
                v = 255 - v
            buf[off] = clamp(v, 0, 255)
        # Kanaltest fra Lampetyper: hold én kanal paa en bestemt vaerdi
        pr = self.probe
        if pr and pr.get("type") == m.get("type") and time.monotonic() < pr.get("until", 0):
            slot = int(pr.get("slot", -1))
            if 0 <= slot < len(buf):
                buf[slot] = clamp(int(pr.get("value", 0)), 0, 255)
        return bytes(buf)

    def pack(self, pixels):
        universes = {}
        base = self.show["settings"].get("artnet_base", 0)
        for mi, m in enumerate(self.show["modules"]):
            uni = (m.get("universe", 1) - 1) + base
            buf = universes.setdefault(uni, bytearray(512))
            chans = self.module_channels(mi, pixels)
            a = m["address"] - 1
            if 0 <= a and a + len(chans) <= 512:
                buf[a:a + len(chans)] = chans
        self._apply_lamptest(universes, base)
        return universes

    def _apply_lamptest(self, universes, base):
        """Lampetest fra Patch: send en farvesekvens paa én adresse efter en
        valgt opsaetning - uanset hvad der er patchet der, og uanset
        blackout/grand. Kun testens egne kanaler overskrives."""
        lt = self.lamptest
        if not lt:
            self.lamptest_now = None
            return
        now = time.monotonic()
        if now >= lt["until"]:
            self.lamptest = None
            self.lamptest_now = None
            return
        steps = lt["steps"]
        if lt.get("hold") is not None:
            idx = lt["hold"] % len(steps)
        else:
            idx = int((now - lt["t0"]) / lt["step_s"]) % len(steps)
        prof = profile_for(self.show, lt["type"])
        chans = lamptest_channels(prof, steps[idx])
        a = lt["address"] - 1
        n = max(0, min(len(chans), 512 - a))
        buf = universes.setdefault((lt["universe"] - 1) + base, bytearray(512))
        buf[a:a + n] = chans[:n]
        self.lamptest_now = {"idx": idx, "ch": list(chans[:n]),
                             "left": int(lt["until"] - now),
                             "uni": lt["universe"], "addr": lt["address"],
                             "name": prof.get("name", lt["type"])}

    # -- visning -------------------------------------------------------
    def display(self, pixels):
        """Hvad skaermen skal vise: firmwarens gamma og stroembegraensning,
        derefter tilbage til sRGB saa gammaen ikke rammer to gange."""
        st = self.show["settings"]
        rows, meta = [], []
        for mi, m in enumerate(self.show["modules"]):
            # Lige efter at der er kommet lamper til, kan framen vaere
            # tegnet til faerre lamper - de nye vises sorte til naeste frame.
            row = pixels[mi] if mi < len(pixels) else [[0, 0, 0]] * m["pixels"]
            total = sum(sum(px) for px in row)
            est_ma = (total * 20) // 255 + len(row)
            limit = 255
            if st["max_ma"] and est_ma > st["max_ma"]:
                limit = (st["max_ma"] * 255) // est_ma
            buf = bytearray()
            bright = clamp(int(st.get("bright", 255)), 0, 255)
            for px in row:
                for c in px:
                    # Klem foer opslag: en enkelt vaerdi uden for 0-255 ville
                    # ellers kaste IndexError og afbryde hele /frame-svaret,
                    # saa simulatoren mistede kontakten.
                    v = scale8(clamp(int(c), 0, 255), bright)
                    if limit < 255:
                        v = scale8(v, limit)
                    v = clamp(v, 0, 255)
                    if st["gamma"]:
                        v = GAMMA_LUT[v]
                    buf.append(DUTY_TO_SRGB[v])
            rows.append(buf.hex())
            meta.append({"ma": est_ma, "cap": limit < 255})
        return rows, meta

    @staticmethod
    def _blend_fade(px, old, k):
        """Krydsfade mellem det gemte billede og det nye.

        Riggen kan aendre sig MENS et fade koerer - en lampe tilfoejes,
        fjernes eller flyttes i Patch. Saa har 'old' et andet antal
        lamper end 'px', og en direkte opslag ville ryge ud over listen
        og slaa hele render-traaden ihjel (hvorefter baade DMX og
        simulator stod stille til en genstart). Derfor: lamper og pixels
        der ikke findes i det gamle billede fader fra sig selv, og k
        klemmes fast i 0..1 saa der aldrig ekstrapoleres uden for 0-255."""
        k = 0.0 if k < 0.0 else (1.0 if k > 1.0 else k)
        out = []
        for mi in range(len(px)):
            orow = old[mi] if mi < len(old) else None
            row = []
            for i in range(len(px[mi])):
                npx = px[mi][i]
                opx = orow[i] if (orow is not None and i < len(orow)) else npx
                row.append([clamp(int(lerp(opx[c], npx[c], k)), 0, 255)
                            for c in range(3)])
            out.append(row)
        return out

    # -- loop ----------------------------------------------------------
    def _loop(self):
        last = time.monotonic()
        acc_fps = 0.0
        while self.running:
            fps = clamp(self.show["settings"]["fps"], 5, 60)
            period = 1.0 / fps
            now = time.monotonic()
            try:
              with self.lock:
                bpm = clamp(float(self.show["master"].get("bpm", 120) or 120), 1.0, 999.0)
                self.beats += max(0.0, now - self.beat_last) * bpm / 60.0
                self.beat_last = now
                if self.show["master"].get("freeze") and self.pixels:
                    px = self.pixels
                else:
                    px = self.render(now - self.t0, beats=self.beats)
                    if self.fade:
                        k = (now - self.fade["t0"]) / max(1e-6, self.fade["dur"])
                        self.fade_k = min(1.0, max(0.0, k))
                        if k >= 1.0:
                            self.fade = None
                            self.fade_k = 1.0
                        else:
                            px = self._blend_fade(px, self.fade["from"], k)
                self.pixels = px
                self.dmx = self.pack(px)
                cfgs = json.loads(json.dumps(self.show["outputs"]))
            except Exception as e:
                # Én daarlig frame maa ALDRIG slaa render-traaden ihjel:
                # sker det, staar baade DMX og simulator stille indtil
                # programmet genstartes. Vi noterer fejlen, springer
                # framen over og koerer videre.
                self.render_err = "%s: %s" % (type(e).__name__, e)
                self.fade = None
                time.sleep(0.05)
                continue
            for name, drv in self.outputs.items():
                cfg = cfgs.get(name, {})
                if cfg.get("on"):
                    try:
                        drv.send(self.dmx, cfg)
                    except Exception as e:
                        drv.err = str(e)

            dt = time.monotonic() - now
            acc_fps = acc_fps * 0.9 + (1.0 / max(1e-6, now - last)) * 0.1
            self.fps_real = acc_fps
            last = now
            time.sleep(max(0.001, period - dt))

    def scene_preview(self, index, cells=72):
        """Én stribe der viser hvad scenen laver lige nu, uden at kalde den
        frem. Alle moduler laegges i raekkefoelge og skaleres ned til
        'cells' felter, saa baade moenster og forskelle mellem moduler ses."""
        sc = self.show["scenes"][index]
        sp = self.preview_sparkle.setdefault(index, {})
        px = self.render(time.monotonic() - self.t0, self._scene_master(sc),
                         sc.get("layers"), sc.get("levels"), sp,
                         live_in=sc.get("live"), ctl_in=scene_control(sc))
        flat = [c for row in px for c in row]
        if not flat:
            return ""
        st = self.show["settings"]
        n, out = len(flat), bytearray()
        for k in range(cells):
            a = k * n // cells
            b = max(a + 1, (k + 1) * n // cells)
            seg = flat[a:b]
            for ci in range(3):
                v = scale8(sum(p[ci] for p in seg) // len(seg), st["bright"])
                out.append(DUTY_TO_SRGB[GAMMA_LUT[v] if st["gamma"] else v])
        return out.hex()

    def scene_preview_rows(self, index, cols=16):
        """Som scene_preview, men én stribe pr. modul. Passer i en kvadratisk
        flise og goer forskelle mellem moduler tydelige."""
        sc = self.show["scenes"][index]
        sp = self.preview_sparkle.setdefault(index, {})
        px = self.render(time.monotonic() - self.t0, self._scene_master(sc),
                         sc.get("layers"), sc.get("levels"), sp,
                         live_in=sc.get("live"), ctl_in=scene_control(sc))
        st = self.show["settings"]
        out = []
        for row in px:
            n = len(row)
            if not n:
                out.append("")
                continue
            buf = bytearray()
            for k in range(cols):
                a = k * n // cols
                b = max(a + 1, (k + 1) * n // cols)
                seg = row[a:b]
                for ci in range(3):
                    v = scale8(sum(p[ci] for p in seg) // len(seg), st["bright"])
                    buf.append(DUTY_TO_SRGB[GAMMA_LUT[v] if st["gamma"] else v])
            out.append(buf.hex())
        return out

    def _scene_master(self, sc):
        """Masteren en scene vil koere med. Saetter scenerne ikke selv
        tempoet, er det live-tempoet (det tappede) der gaelder."""
        m = sc.get("master")
        if not m or self.show["settings"].get("scene_tempo"):
            return m
        m = dict(m)
        m["bpm"] = self.show["master"].get("bpm", 120)
        return m

    def start_fade(self, seconds):
        if seconds > 0.02 and self.pixels:
            self.fade = {"from": [[list(p) for p in row] for row in self.pixels],
                         "t0": time.monotonic(), "dur": seconds}


# ======================================================================
#  Scener
# ======================================================================
SCENE_KEYS = ("master", "layers", "modules")


def snapshot(show, name, keep_id=None, tab=None):
    tabs = show.get("scene_tabs") or [{"id": "main", "name": "Scener"}]
    return {
        "id": keep_id or uuid.uuid4().hex[:10],
        "name": name,
        "tab": tab or tabs[0]["id"],
        "fade": 2.0,
        "master": json.loads(json.dumps(show["master"])),
        "layers": json.loads(json.dumps(show["layers"])),
        "levels": [{"on": m["on"], "level": m["level"],
                    "ovr": json.loads(json.dumps(m.get("ovr", {})))}
                   for m in show["modules"]],
        # Afviklings gruppe-looks gemmes med scenen, saa en live-styring
        # kan kaldes frem igen praecis som den stod.
        "live": looks_snapshot(show["live"]["looks"]),
        # og hvem der styrede, saa scenen kalder de samme styringer frem
        "control": list(control_of(show)),
    }


def looks_snapshot(looks):
    """Kopi af looks til en scene. Krydsfade-tilstanden nulstilles, saa
    looket staar paa sin maalvaerdi - selve overgangen klarer scenens
    eget fade."""
    out = json.loads(json.dumps(looks or []))
    for lk in out:
        lk["cfrom"] = lk.get("colour", [255, 255, 255])
        lk["lfrom"] = lk.get("level", 255)
        lk["ft0"] = 0
        lk["fdur"] = 0
    return out


FRAME_PATTERNS = ("gnister", "random_flash")

# Moenstre der fejer FREM OG TILBAGE mellem to ender i stedet for at
# loebe rundt. De vil have lamperne fordelt 0..1 inklusive begge ender;
# alle andre loeber cyklisk og skal have dem fordelt 0..1 EKSKLUSIVE den
# sidste - ellers lander foerste og sidste lampe samme sted i cyklussen
# og koerer parallelt (det gjorde chase i en gruppe).
SPAN_PATTERNS = ("scanner", "komet")


def set_layer_sync(L, on, bpm):
    """Saet lagets Foelg tempo og regn Fart om, saa den synlige fart er den
    samme ved det givne tempo. Returnerer 1 hvis laget blev aendret."""
    if bool(L.get("sync")) == on:
        return 0
    # Gnister og Tilfaeldige blink koerer pr. ramme og bruger Fart direkte -
    # dem regner vi ikke om, ellers ville de skifte karakter.
    if L.get("pattern") not in FRAME_PATTERNS:
        bpm = clamp(float(bpm or 120), 1.0, 999.0)
        f = 60.0 / bpm if on else bpm / 60.0
        L["speed"] = int(clamp(round(L.get("speed", 30) * f), 0, 200))
    L["sync"] = on
    return 1


def apply_scene(show, scene):
    live_bpm = show["master"].get("bpm", 120)
    # En scene er et helt billede: den medbringer ogsaa Afviklings looks.
    # Scener gemt foer dette havde ingen - saa rydder den Afvikling.
    show.setdefault("live", {"looks": []})["looks"] = looks_snapshot(scene.get("live"))
    show["control"] = scene_control(scene)
    show["master"].update(scene["master"])
    if not show["settings"].get("scene_tempo"):
        # Live-tempoet (det tappede) gaelder ogsaa i scenen - scenens gemte
        # BPM bruges kun naar "Scener saetter eget tempo" er slaaet til.
        show["master"]["bpm"] = live_bpm
    for i, l in enumerate(scene["layers"]):
        if i < len(show["layers"]):
            show["layers"][i] = json.loads(json.dumps(l))
    for i, lv in enumerate(scene.get("levels", [])):
        if i < len(show["modules"]):
            show["modules"][i]["on"] = lv["on"]
            show["modules"][i]["level"] = lv["level"]
            if "ovr" in lv:
                show["modules"][i]["ovr"] = json.loads(json.dumps(lv["ovr"]))


# ======================================================================
#  Guide (wizard): bygger et helt sceneforloeb ud fra riggen
# ======================================================================
#  Guiden gemmer sin tilstand i show["wizard"], saa den kan genoptages -
#  ogsaa efter genstart og naar showet hentes paa en anden maskine.
#  Scenerne den bygger, faar feltet "wiz" og ligger i deres eget
#  faneblad. Retter brugeren selv i en scene (Opdatér), forsvinder "wiz",
#  og saa roerer guiden den aldrig igen.

WIZ_ROLES = [
    ("farve", "Farvelys", "PAR'er og lignende - bærer farverne og effekterne"),
    ("baggrund", "Baggrund", "Washes der fylder bagvæg eller scene med farve"),
    ("front", "Frontlys", "Hvidt lys på musikerne, så de kan ses"),
    ("ude", "Ikke med", "Lampen bruges ikke af guiden og er slukket i dens scener"),
]

WIZ_COLOURS = [
    ("roed", "Rød", [255, 0, 0]), ("orange", "Orange", [255, 80, 0]),
    ("rav", "Ravgul", [255, 150, 0]), ("gul", "Gul", [255, 220, 0]),
    ("groen", "Grøn", [0, 255, 40]), ("cyan", "Cyan", [0, 220, 255]),
    ("blaa", "Blå", [0, 40, 255]), ("lilla", "Lilla", [130, 0, 255]),
    ("magenta", "Magenta", [255, 0, 200]), ("pink", "Pink", [255, 60, 120]),
    ("varm", "Varm hvid", [255, 190, 120]), ("kold", "Kold hvid", [200, 220, 255]),
]
WIZ_COLOUR = dict((k, c) for k, _, c in WIZ_COLOURS)

WIZ_PALETTES = [
    ("rock", "Rock", "roed", "rav"),
    ("klassisk", "Klassisk", "roed", "blaa"),
    ("koelig", "Kølig", "blaa", "lilla"),
    ("pop", "Pop", "pink", "blaa"),
    ("sol", "Solnedgang", "orange", "magenta"),
    ("natur", "Natur", "groen", "cyan"),
    ("akustisk", "Akustisk", "rav", "varm"),
]

# Lagopskrifter pr. rolle. col: a/b = scenens to farver, w = varm hvid
# (frontlys), hvid = rent hvidt, regnbue = farverne skifter af sig selv.
# lvl er andel af scenens styrke. speed er med Foelg tempo (100 = én
# omgang pr. slag), medmindre sync er False.
def _wl(pattern="fyldt", col="a", lvl=1.0, speed=30, sync=True, spread=False,
        size=30, tail=40, density=50, dir=1, hue=10):
    return {"pattern": pattern, "col": col, "lvl": lvl, "speed": speed,
            "sync": sync, "spread": spread, "size": size, "tail": tail,
            "density": density, "dir": dir, "hue": hue}

WIZ_TEMPLATES = [
    {"key": "slukket", "name": "Alt slukket", "fade": 3.0, "on": True,
     "desc": "Mørkt mellem numrene. Lamperne fader ud.",
     "roles": {}},
    {"key": "indgang", "name": "Publikum kommer ind", "fade": 4.0, "on": True,
     "desc": "Rolig stemning før koncerten. Farverne ånder langsomt.",
     "roles": {"baggrund": [_wl("fade", "b", 0.55, 6, sync=False, density=40)],
               "farve": [_wl("fade", "a", 0.4, 5, sync=False, spread=True, density=30)]}},
    {"key": "rolig", "name": "Rolig sang", "fade": 3.0, "on": True,
     "desc": "Stille farver uden bevægelse. Frontlys på.",
     "roles": {"baggrund": [_wl("fyldt", "b", 0.7)],
               "farve": [_wl("fyldt", "a", 0.6)],
               "front": [_wl("fyldt", "w", 0.6)]}},
    {"key": "ballade", "name": "Ballade", "fade": 3.0, "on": False,
     "desc": "En blød bølge glider gennem farvelyset, én gang pr. takt.",
     "roles": {"baggrund": [_wl("fyldt", "b", 0.6)],
               "farve": [_wl("dim_wave", "a", 0.85, 25, spread=True, size=30, density=30)],
               "front": [_wl("fyldt", "w", 0.5)]}},
    {"key": "mellem", "name": "Mellemtempo", "fade": 1.0, "on": True,
     "desc": "Et chase løber gennem farvelyset i takt med musikken.",
     "roles": {"baggrund": [_wl("puls", "b", 0.7, 50, density=45)],
               "farve": [_wl("chase", "a", 1.0, 25, spread=True, size=15, tail=50),
                         _wl("fyldt", "b", 0.22)],
               "front": [_wl("fyldt", "w", 0.7)]}},
    {"key": "hurtig", "name": "Hurtigt nummer", "fade": 0.3, "on": True,
     "desc": "Farvelyset skifter mellem de to farver på hvert slag.",
     "roles": {"baggrund": [_wl("puls", "b", 0.8, 100, density=30)],
               "farve": [_wl("blink", "a", 1.0, 50),
                         _wl("blink", "b", 1.0, 50, dir=-1)],
               "front": [_wl("fyldt", "w", 0.8)]}},
    {"key": "omkvaed", "name": "Omkvæd", "fade": 0.2, "on": True,
     "desc": "Fuld kraft. Farvelyset pumper på hvert slag.",
     "roles": {"baggrund": [_wl("fyldt", "b", 1.0)],
               "farve": [_wl("puls", "a", 1.0, 100, density=60),
                         _wl("fyldt", "b", 0.35)],
               "front": [_wl("fyldt", "w", 1.0)]}},
    {"key": "solo", "name": "Solo / tale", "fade": 1.5, "on": True,
     "desc": "Frontlys fuldt op, resten dæmpet ned i baggrunden.",
     "roles": {"baggrund": [_wl("fyldt", "b", 0.3)],
               "farve": [_wl("fyldt", "a", 0.15)],
               "front": [_wl("fyldt", "w", 1.0)]}},
    {"key": "finale", "name": "Finale (regnbue)", "fade": 0.5, "on": False,
     "desc": "Alle farver på én gang. Til det sidste nummer.",
     "roles": {"baggrund": [_wl("fyldt", "regnbue", 1.0, hue=8)],
               "farve": [_wl("chase", "regnbue", 1.0, 25, spread=True, size=20, tail=60, hue=20)],
               "front": [_wl("fyldt", "w", 1.0)]}},
    {"key": "strobe", "name": "Strobe-break", "fade": 0.0, "on": False,
     "desc": "Hvidt stroboskop på alt. Kun kort - og ikke for alle publikummer.",
     "strobe": 200,
     "roles": {"baggrund": [_wl("fyldt", "hvid", 1.0)],
               "farve": [_wl("fyldt", "hvid", 1.0)],
               "front": [_wl("fyldt", "hvid", 1.0)]}},
    {"key": "tak", "name": "Tak for i aften", "fade": 4.0, "on": True,
     "desc": "Varmt og roligt til sidst, mens publikum klapper.",
     "roles": {"baggrund": [_wl("fyldt", "b", 0.5)],
               "farve": [_wl("fyldt", "a", 0.4)],
               "front": [_wl("fyldt", "w", 0.8)]}},
    {"key": "arbejdslys", "name": "Arbejdslys", "fade": 1.0, "on": True,
     "desc": "Alt hvidt og fuldt op. Til opstilling og lydprøve.",
     "roles": {"baggrund": [_wl("fyldt", "hvid", 1.0)],
               "farve": [_wl("fyldt", "hvid", 1.0)],
               "front": [_wl("fyldt", "hvid", 1.0)]}},
]
WIZ_TPL = dict((t["key"], t) for t in WIZ_TEMPLATES)
WIZ_FRONT = [255, 200, 150]
WIZ_OFF_KEYS = ("strobe", "macro", "w", "a", "uv", "preset", "sound", "delay")


def _wiz_role_default(show, m):
    prof = profile_for(show, m.get("type"))
    keys = [c["k"] for c in prof["channels"]]
    if not any(k in ("r", "g", "b") for k in keys):
        return "front"
    return "baggrund" if prof.get("shape") == "wash" else "farve"


def wizard_new(show):
    pal = WIZ_PALETTES[0]
    return {
        "v": 1, "step": 0,
        "roles": [_wiz_role_default(show, m) for m in show["modules"]],
        "rig": [m.get("type") for m in show["modules"]],
        "palette": pal[0], "c1": pal[2], "c2": pal[3],
        "items": [{"sid": uuid.uuid4().hex[:10], "tpl": t["key"],
                   "name": t["name"], "a": "s1", "b": "s2",
                   "level": 100, "fart": 1.0, "fade": t["fade"]}
                  for t in WIZ_TEMPLATES if t["on"]],
        "follow": True, "bpm": int(show["master"].get("bpm", 120)),
        "tab_name": "Mit show", "tab_id": "",
        "built": [], "built_at": "",
    }


def wizard_fit(show, wz):
    """Tilpas guidens roller til riggen, hvis lamper er tilfoejet, fjernet
    eller har skiftet type siden sidst. Returnerer True hvis noget aendrede
    sig, saa fladen kan sige det."""
    mods = show["modules"]
    rig = [m.get("type") for m in mods]
    roles = list(wz.get("roles") or [])
    old = list(wz.get("rig") or [])
    changed = False
    out = []
    for i, m in enumerate(mods):
        if i < len(roles) and i < len(old) and old[i] == rig[i] \
                and roles[i] in ("farve", "baggrund", "front", "ude"):
            out.append(roles[i])
        else:
            out.append(_wiz_role_default(show, m))
            changed = True
    if len(roles) != len(mods):
        changed = True
    wz["roles"], wz["rig"] = out, rig
    return changed


def _wiz_colour(wz, key):
    if key == "s1":
        key = wz.get("c1", "roed")
    elif key == "s2":
        key = wz.get("c2", "blaa")
    return list(WIZ_COLOUR.get(key, [255, 255, 255]))


def wizard_scene(show, wz, item, tab_id):
    """Én scene i samme format som snapshot(), bygget af en opskrift."""
    tpl = WIZ_TPL.get(item.get("tpl"), WIZ_TEMPLATES[0])
    mods = show["modules"]
    roles = wz["roles"]
    members = {}
    for i, r in enumerate(roles[:len(mods)]):
        members.setdefault(r, []).append(i)
    xs = [m["x"] for m in mods]
    ys = [m["y"] for m in mods]
    by_pos = (max(xs) - min(xs) > 0.5) if xs else False
    lvl_scene = clamp(float(item.get("level", 100)), 0, 100) / 100.0
    fart = clamp(float(item.get("fart", 1.0)), 0.25, 4.0)
    bpm = clamp(float(wz.get("bpm", 120) or 120), 40, 220)
    colours = {"a": _wiz_colour(wz, item.get("a", "s1")),
               "b": _wiz_colour(wz, item.get("b", "s2")),
               "w": list(WIZ_FRONT), "hvid": [255, 255, 255]}

    specs = []
    for role in ("baggrund", "farve", "front"):
        if not members.get(role):
            continue
        for sp in tpl["roles"].get(role, []):
            specs.append((role, sp))
    n_layers = max(len(show["layers"]), len(specs), 4)
    layers = [default_layer(i) for i in range(n_layers)]
    for L in layers:
        L["on"] = False
    for li, (role, sp) in enumerate(specs):
        op = int(round(255 * sp["lvl"] * lvl_scene))
        L = layers[li]
        L.update({
            "name": dict((k, n) for k, n, _ in WIZ_ROLES)[role],
            "on": op > 0, "opacity": clamp(op, 0, 255), "blend": "max",
            "mask": list(members[role]), "pattern": sp["pattern"],
            "domain": "module", "dir": sp["dir"],
            "size": sp["size"], "tail": sp["tail"], "density": sp["density"],
            "hue_speed": sp["hue"], "hue_spread": 100,
            "spread_mode": ("x" if by_pos else "index") if sp["spread"] else "ingen",
            "spread": 100 if sp["spread"] else 0,
        })
        if sp["col"] == "regnbue":
            L["colour_mode"] = "regnbue"
        else:
            L["colour_mode"] = "fast"
            L["colour"] = list(colours[sp["col"]])
        if sp["sync"]:
            spd = sp["speed"] * fart
            if wz.get("follow", True):
                L["sync"], L["speed"] = True, int(clamp(round(spd), 0, 200))
            else:
                L["sync"], L["speed"] = False, int(clamp(round(spd * bpm / 60.0), 0, 200))
        else:
            L["sync"], L["speed"] = False, int(clamp(round(sp["speed"] * fart), 0, 200))

    levels = []
    for i, m in enumerate(mods):
        ovr = json.loads(json.dumps(m.get("ovr", {})))
        for k in WIZ_OFF_KEYS:
            ovr[k] = 0
        role = roles[i] if i < len(roles) else "ude"
        levels.append({"on": role != "ude", "level": 255, "ovr": ovr})

    return {
        "id": item["sid"], "name": item.get("name") or tpl["name"],
        "tab": tab_id, "fade": clamp(float(item.get("fade", tpl["fade"])), 0.0, 30.0),
        # Ingen "grand": et scenekald fra guiden roerer ikke ved
        # hovedskyderen, saa den bliver hvor brugeren har sat den.
        "master": {"blackout": False, "freeze": False,
                   "strobe": int(tpl.get("strobe", 0)), "bpm": int(bpm)},
        "layers": layers, "levels": levels, "wiz": tpl["key"],
    }


def wizard_clean(show, wz):
    """Lad kun kendte felter og fornuftige vaerdier komme ind i showet."""
    base = wizard_new(show)
    out = {}
    for k in base:
        out[k] = wz.get(k, base[k]) if isinstance(wz, dict) else base[k]
    out["step"] = int(clamp(int(out.get("step") or 0), 0, 4))
    if out["c1"] not in WIZ_COLOUR:
        out["c1"] = base["c1"]
    if out["c2"] not in WIZ_COLOUR:
        out["c2"] = base["c2"]
    items = []
    seen = set()
    for it in out.get("items") or []:
        if not isinstance(it, dict) or it.get("tpl") not in WIZ_TPL:
            continue
        sid = str(it.get("sid") or uuid.uuid4().hex[:10])[:24]
        if sid in seen:
            sid = uuid.uuid4().hex[:10]
        seen.add(sid)
        items.append({"sid": sid, "tpl": it["tpl"],
                      "name": str(it.get("name") or WIZ_TPL[it["tpl"]]["name"])[:60],
                      "a": it.get("a") if it.get("a") in WIZ_COLOUR or it.get("a") in ("s1", "s2") else "s1",
                      "b": it.get("b") if it.get("b") in WIZ_COLOUR or it.get("b") in ("s1", "s2") else "s2",
                      "level": int(clamp(int(it.get("level", 100)), 0, 100)),
                      "fart": float(clamp(float(it.get("fart", 1.0)), 0.25, 4.0)),
                      "fade": float(clamp(float(it.get("fade", WIZ_TPL[it["tpl"]]["fade"])), 0.0, 30.0))})
    out["items"] = items[:60]
    out["bpm"] = int(clamp(int(out.get("bpm") or 120), 40, 220))
    out["follow"] = bool(out.get("follow", True))
    out["tab_name"] = (str(out.get("tab_name") or "Mit show").strip() or "Mit show")[:40]
    wizard_fit(show, out)
    return out


WIZ_AUTOSAVE = "guide-autosave"


def wizard_autosave(show):
    """Programmet gemmer ikke showet af sig selv. For at guiden kan
    genoptages efter en genstart, skriver den hele showet (rig, scener og
    guidens valg) til shows/guide-autosave.json hver gang den gemmer."""
    try:
        os.makedirs(SHOW_DIR, exist_ok=True)
        p = os.path.join(SHOW_DIR, WIZ_AUTOSAVE + ".json")
        tmp = p + ".tmp"
        with open(tmp, "w") as f:
            json.dump(show, f, indent=1)
        os.replace(tmp, p)
    except OSError:
        pass


def wizard_autosave_info():
    p = os.path.join(SHOW_DIR, WIZ_AUTOSAVE + ".json")
    try:
        with open(p) as f:
            d = json.load(f)
        wz = d.get("wizard")
        if not isinstance(wz, dict):
            return None
        return {"when": time.strftime("%d-%m-%Y kl. %H:%M", time.localtime(os.path.getmtime(p))),
                "step": int(wz.get("step") or 0), "items": len(wz.get("items") or []),
                "lamps": len(d.get("modules") or []), "show": d.get("name", ""),
                "built": bool(wz.get("built_at"))}
    except (OSError, ValueError):
        return None


def wizard_build(show, wz):
    """Laeg guidens scener i dens faneblad. Scener den selv har lavet
    erstattes paa deres plads; scener brugeren har rettet i, roeres ikke."""
    tabs = show.setdefault("scene_tabs", [{"id": "main", "name": "Scener"}])
    tab = next((t for t in tabs if t["id"] == wz.get("tab_id")), None)
    if tab is None:
        tab = {"id": uuid.uuid4().hex[:8], "name": wz["tab_name"]}
        tabs.append(tab)
        wz["tab_id"] = tab["id"]
    tab["name"] = wz["tab_name"]
    while len(show["layers"]) < 4:
        show["layers"].append(default_layer(len(show["layers"])))

    scenes = show["scenes"]
    by_id = dict((s.get("id"), s) for s in scenes)
    kept = [it["sid"] for it in wz["items"]
            if it["sid"] in by_id and not by_id[it["sid"]].get("wiz")]
    wanted = [it for it in wz["items"] if it["sid"] not in kept]
    old_ids = set(wz.get("built") or []) | set(it["sid"] for it in wanted)
    pos = None
    removed = 0
    keep_list = []
    for s in scenes:
        if s.get("wiz") and s.get("id") in old_ids:
            if pos is None:
                pos = len(keep_list)
            removed += 1
            continue
        keep_list.append(s)
    if pos is None:
        pos = len(keep_list)
    new = [wizard_scene(show, wz, it, tab["id"]) for it in wanted]
    show["scenes"] = keep_list[:pos] + new + keep_list[pos:]
    wz["built"] = [s["id"] for s in new]
    wz["built_at"] = time.strftime("%Y-%m-%d %H:%M")
    if wz.get("follow", True):
        show["master"]["bpm"] = wz["bpm"]
    return {"made": len(new), "kept": len(kept), "replaced": min(removed, len(new)),
            "tab": tab["id"]}


# ======================================================================
#  Grupper (Layout) og live-looks (Afvikling)
# ======================================================================
#  En gruppe (group_label) har et navn, en ORDNET medlemsliste (lamper og
#  under-grupper) og en placering paa layoutet. Raekkefoelgen i members er
#  gruppens nummerering (1, 2, 3 ...), som moenstre i Afvikling loeber efter.
#  Et live-look peger paa en gruppe eller en ad-hoc markering og giver den
#  farve/moenster. Looks gemmes i showet.

def find_group(show, gid):
    for g in show.get("group_labels", []):
        if g.get("id") == gid:
            return g
    return None


def group_leaves(show, gid, seen=None):
    """Alle lampe-indekser under en gruppe, fladet ud i raekkefoelge. Under-
    grupper foldes ud paa deres plads. Dubletter droppes (foerste vinder).
    Cykler (gruppe der indeholder sig selv) stoppes."""
    g = find_group(show, gid)
    if g is None:
        return []
    seen = seen or set()
    if gid in seen:
        return []
    seen.add(gid)
    out = []
    for mem in g.get("members", []):
        if mem.get("t") == "lamp":
            out.append(int(mem.get("i", -1)))
        elif mem.get("t") == "grp":
            out.extend(group_leaves(show, mem.get("id"), seen))
    dedup, got = [], set()
    for i in out:
        if i not in got:
            got.add(i)
            dedup.append(i)
    return dedup


def group_contains(show, gid, target, seen=None):
    """Er 'target' et sted nede i 'gid's traeet?"""
    if gid == target:
        return True
    seen = seen or set()
    if gid in seen:
        return False
    seen.add(gid)
    g = find_group(show, gid)
    if not g:
        return False
    for mem in g.get("members", []):
        if mem.get("t") == "grp" and group_contains(show, mem.get("id"), target, seen):
            return True
    return False


def clean_group_members(show, members, self_id=None):
    """Kun gyldige medlemmer: lamper der findes, og grupper der findes og
    ikke er gruppen selv. Bevarer raekkefoelgen (= nummereringen)."""
    nmods = len(show["modules"])
    out, seen = [], set()
    for mem in (members or [])[:256]:
        if not isinstance(mem, dict):
            continue
        if mem.get("t") == "lamp":
            i = int(mem.get("i", -1))
            if 0 <= i < nmods and ("l", i) not in seen:
                seen.add(("l", i)); out.append({"t": "lamp", "i": i})
        elif mem.get("t") == "grp":
            gid = mem.get("id")
            # En gruppe maa hverken vaere sig selv eller en gruppe der
            # laengere nede indeholder den - ellers peger traeet i ring.
            if gid and gid != self_id and find_group(show, gid) and ("g", gid) not in seen \
                    and not (self_id and group_contains(show, gid, self_id)):
                seen.add(("g", gid)); out.append({"t": "grp", "id": gid})
    return out


# Hvem der styrer lyset. Pult = lagene, Afvikling = gruppe-/lampe-looks,
# Enkel = én farve pr. lampe. Som udgangspunkt styrer kun én ad gangen;
# flere samtidig skal vaelges aktivt.
CONTROLLERS = ("pult", "afvikling", "enkel")


def look_src(look):
    """Hvilken styring et look hoerer til. Looks fra foer der var flere
    styringer, hoerer til Afvikling (Enkels har noeglen e:)."""
    src = look.get("src")
    if src in ("afvikling", "enkel"):
        return src
    return "enkel" if str(look.get("key", "")).startswith("e:") else "afvikling"


def clean_control(ctl):
    """Gyldig liste over styringer i fast raekkefoelge - eller None."""
    if not isinstance(ctl, (list, tuple)):
        return None
    out = [c for c in CONTROLLERS if c in ctl]
    return out or None


def infer_control(layers, looks):
    """Hvem der styrer et billede uden gemt styring (aeldre shows og
    scener): dem der faktisk har noget taendt. Saa ser det ud som foer."""
    out = []
    if any(l.get("on") or l.get("solo") for l in (layers or [])):
        out.append("pult")
    srcs = set(look_src(lk) for lk in (looks or []))
    for c in ("afvikling", "enkel"):
        if c in srcs:
            out.append(c)
    return out or ["pult"]


def control_of(show):
    return clean_control(show.get("control")) or ["pult"]


def scene_control(scene):
    return clean_control(scene.get("control")) or \
        infer_control(scene.get("layers"), scene.get("live"))


def look_key(target):
    if target.get("group"):
        return "g:" + str(target["group"])
    return "l:" + ",".join(str(int(i)) for i in target.get("lamps", []))


def look_targets(show, look):
    """De ordnede lampe-indekser et look rammer."""
    tgt = look.get("target", {})
    if tgt.get("group"):
        return group_leaves(show, tgt["group"])
    out, got = [], set()
    for i in tgt.get("lamps", []):
        i = int(i)
        if i not in got:
            got.add(i); out.append(i)
    return out


def look_eased(look, now):
    """Looks farve og niveau lige nu, med krydsfade fra forrige vaerdi."""
    col = look.get("colour", [255, 255, 255])
    cfrom = look.get("cfrom", col)
    lvl = look.get("level", 255)
    lfrom = look.get("lfrom", lvl)
    dur = look.get("fdur", 0) or 0
    if dur <= 0:
        k = 1.0
    else:
        k = clamp((now - look.get("ft0", 0)) / dur, 0.0, 1.0)
    try:
        ce = [int(clamp(lerp(cfrom[c], col[c], k), 0, 255)) for c in range(3)]
    except Exception:
        ce = [int(clamp(col[c], 0, 255)) for c in range(3)]
    le = clamp(lerp(lfrom, lvl, k), 0, 255)
    return ce, le


def default_look(target, fade=1.0):
    return {
        "id": uuid.uuid4().hex[:10], "key": look_key(target), "target": target,
        "on": True, "level": 255, "fade": fade, "fdur": 0, "ft0": 0,
        "pattern": "fyldt", "custom": 0,
        "colour_mode": "fast", "colour": [255, 120, 40],
        "cfrom": [255, 120, 40], "lfrom": 255,
        "stops": [[255, 0, 0], [0, 0, 255]],
        "hue_speed": 10, "hue_spread": 100,
        "speed": 30, "size": 30, "density": 50, "tail": 40, "steps": 3,
        "dir": 1, "mirror": False, "sync": False, "spread": 0,
    }


def live_apply(show, target, fields, fade, src="afvikling"):
    """Saet vaerdier paa looket for 'target' (opret det hvis det mangler).
    Med fade toner farve og niveau over fra det der vises lige nu.
    Enkels looks har deres egen noegle (e:<lampe>), saa de aldrig blandes
    sammen med Afviklings looks paa samme lampe."""
    if src == "enkel":
        key = "e:" + ",".join(str(int(i)) for i in target.get("lamps", []))
    else:
        key = look_key(target)
    lk = find_look(show, key)
    if lk is None:
        lk = default_look(target, show["live"].get("fade", 1.0))
        show["live"]["looks"].append(lk)
    now = time.monotonic()
    if fade is not None and float(fade) > 0.02 and \
            ("colour" in fields or "level" in fields):
        cur_c, cur_l = look_eased(lk, now)
        lk["cfrom"] = cur_c
        lk["lfrom"] = cur_l
        lk["ft0"] = now
        lk["fdur"] = float(fade)
    else:
        # ingen fade: vaerdierne gaelder med det samme
        if "colour" in fields:
            lk["cfrom"] = [int(clamp(c, 0, 255)) for c in fields["colour"]]
        if "level" in fields:
            lk["lfrom"] = int(clamp(fields["level"], 0, 255))
        lk["ft0"] = 0
        lk["fdur"] = 0
    for k2, v2 in fields.items():
        lk[k2] = v2
    lk["key"] = key
    lk["target"] = target
    lk["src"] = src
    lk.setdefault("id", uuid.uuid4().hex[:10])
    return lk


def find_look(show, key):
    for lk in show["live"]["looks"]:
        if lk.get("key") == key:
            return lk
    return None


# ======================================================================
#  HTTP
# ======================================================================
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json"}


def ui_bytes(name):
    """Filen ved siden af scriptet vinder, saa man kan rette i fladen.
    Findes den ikke, bruges den indbyggede kopi - dermed kan dmxmixer.py
    koere alene, ogsaa naar den er kopieret til en anden maskine."""
    p = os.path.join(HERE, name)
    if os.path.exists(p):
        try:
            with open(p, "rb") as f:
                return f.read()
        except OSError:
            pass
    blob = EMBEDDED_B64.get(name)
    return base64.b64decode(blob) if blob else None


def ui_source():
    ondisk = [n for n in ("ui.html", "ui.css", "ui.js")
              if os.path.exists(os.path.join(HERE, n))]
    if len(ondisk) == 3:
        return "filer ved siden af scriptet"
    if not ondisk:
        return "indbygget kopi"
    return "indbygget kopi (fandt kun %s paa disk)" % ", ".join(ondisk)


class Handler(BaseHTTPRequestHandler):
    engine = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        eng = Handler.engine

        if path in ("/", "/index.html"):
            return self._file("ui.html")
        if path in ("/ui.css", "/ui.js"):
            return self._file(path[1:])
        if path in ("/sim", "/sim.html"):
            return self._file("sim.html")

        if path == "/state":
            with eng.lock:
                return self._send(json.dumps({"rev": eng.rev, "show": eng.show,
                                              "meta": self.meta()}))

        if path == "/frame":
            with eng.lock:
                px = eng.pixels or eng.render(0)
                rows, meta = eng.display(px)
                dmx_peek = {}
                for uni, buf in list(eng.dmx.items())[:3]:
                    dmx_peek[str(uni)] = list(buf[:24])
                out_status = {}
                for k, v in eng.outputs.items():
                    if k == "enttec":
                        if v.err:
                            out_status[k] = "FEJL: " + v.err
                        elif v.opened:
                            out_status[k] = "%s · %d rammer" % (v.opened, v.frames_sent)
                        else:
                            out_status[k] = "ikke åbnet"
                    else:
                        out_status[k] = v.err or "ok"
                return self._send(json.dumps({
                    "rev": eng.rev, "px": rows, "meta": meta,
                    "fps": int(round(eng.fps_real)),
                    "fade": (None if eng.fade is None else round(eng.fade_k, 3)),
                    "out": out_status,
                    "lt": eng.lamptest_now,
                    "probe": (eng.probe["type"] if eng.probe and
                              time.monotonic() < eng.probe.get("until", 0) else None),
                    "dmx": dmx_peek}))

        if path == "/scenepx":
            q = parse_qs(urlparse(self.path).query)
            cells = clamp(int(q.get("cells", ["72"])[0]), 8, 240)
            rows = q.get("rows", ["0"])[0] == "1"
            only_raw = q.get("idx", [""])[0]
            wanted = None
            if only_raw:
                try:
                    wanted = set(int(x) for x in only_raw.split(",") if x != "")
                except ValueError:
                    wanted = None
            with eng.lock:
                # Listen foelger scenernes rigtige indeks. Uden idx regnes
                # kun de foerste 48 ud; med idx (et faneblad eller de
                # synlige fliser) regnes netop de oenskede, hvor de end ligger.
                n = len(eng.show["scenes"])
                if wanted is None:
                    n = min(n, 48)
                else:
                    wanted = set(sorted(wanted)[:64])
                px = []
                for i in range(n):
                    if wanted is not None and i not in wanted:
                        px.append([] if rows else "")
                        continue
                    px.append(eng.scene_preview_rows(i, cells) if rows
                             else eng.scene_preview(i, cells))
            return self._send(json.dumps({"px": px, "rows": rows}))

        if path == "/library":
            return self._send(json.dumps({"library": FIXTURE_LIBRARY}))

        if path == "/shows":
            return self._send(json.dumps({"shows": list_shows(),
                                          "ports": EnttecOut.ports()}))
        self.send_error(404)

    def _file(self, name):
        data = ui_bytes(name)
        if data is None:
            return self.send_error(404, "kender ikke filen %s" % name)
        self._send(data, MIME.get(os.path.splitext(name)[1], "text/plain"))

    def meta(self):
        return {"patterns": PATTERNS, "colour_modes": COLOUR_MODES,
                "blends": BLENDS, "spreads": SPREADS,
                "ports": EnttecOut.ports(),
                "ftdi_devices": EnttecOut.ftdi_devices(),
                "ftdi_error": EnttecOut.ftdi_error,
                "builtin_profiles": FIXTURE_PROFILES,
                "themes": load_themes(),
                "channel_palette": CHANNEL_PALETTE,
                "wiz": {"roles": WIZ_ROLES, "colours": WIZ_COLOURS,
                        "palettes": WIZ_PALETTES,
                        "templates": [{"key": t["key"], "name": t["name"],
                                       "desc": t["desc"], "fade": t["fade"],
                                       "moving": any(sp["pattern"] != "fyldt"
                                                     for r in t["roles"].values() for sp in r)}
                                      for t in WIZ_TEMPLATES]},
                "generic_order": [{"id": k, "name": FIXTURE_PROFILES[k]["name"],
                                   "span": len(FIXTURE_PROFILES[k]["channels"])}
                                  for k in GENERIC_ORDER]}

    def do_POST(self):
        if urlparse(self.path).path != "/api":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length", 0))
        try:
            msg = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._send('{"ok":false,"err":"bad json"}')
        try:
            res = self.dispatch(msg)
        except Exception as e:
            res = {"ok": False, "err": str(e)}
        res["rev"] = Handler.engine.rev
        return self._send(json.dumps(res))

    # ------------------------------------------------------------------
    def dispatch(self, m):
        eng = Handler.engine
        op = m.get("op", "")
        with eng.lock:
            show = eng.show

            if op == "set":
                # {"op":"set","path":["layers",0,"speed"],"value":40}
                ref = show
                p = m["path"]
                for k in p[:-1]:
                    ref = ref[k]
                ref[p[-1]] = m["value"]
                if p[0] in ("modules", "settings"):
                    eng.touch()
                else:
                    eng.rev += 1
                return {"ok": True}

            if op == "patch":
                # flere vaerdier paa én gang
                for item in m["items"]:
                    ref = show
                    for k in item["path"][:-1]:
                        ref = ref[k]
                    ref[item["path"][-1]] = item["value"]
                eng.touch()
                return {"ok": True}

            if op == "wizard_resume":
                # Hent den autogemte guide (med rig og scener) ind igen
                p = os.path.join(SHOW_DIR, WIZ_AUTOSAVE + ".json")
                try:
                    with open(p) as f:
                        loaded = json.load(f)
                except (OSError, ValueError) as e:
                    return {"ok": False, "err": str(e)}
                merge_show(show, loaded)
                eng.touch()
                m, op = {"op": "wizard_open"}, "wizard_open"

            if op == "wizard_open":
                # Hent guiden (eller start en ny) og tilpas den til riggen
                wz = show.get("wizard")
                if not isinstance(wz, dict) and not m.get("restart") and not m.get("new"):
                    info = wizard_autosave_info()
                    if info:
                        # Der ligger en guide fra sidst - lad brugeren vaelge
                        return {"ok": True, "offer": info}
                fresh = not isinstance(wz, dict) or bool(m.get("restart"))
                prev_rig = None if fresh else list(wz.get("rig") or [])
                wz = wizard_new(show) if fresh else wizard_clean(show, wz)
                # wizard_clean tilpasser rollerne; sammenlign med riggen fra sidst
                changed = False if fresh else prev_rig != wz["rig"]
                show["wizard"] = wz
                if fresh:
                    wizard_autosave(show)
                eng.rev += 1
                return {"ok": True, "wizard": wz, "rig_changed": changed, "fresh": fresh}

            if op == "wizard_save":
                show["wizard"] = wizard_clean(show, m.get("wizard") or {})
                wizard_autosave(show)
                eng.rev += 1
                return {"ok": True, "wizard": show["wizard"]}

            if op == "wizard_try":
                # Vis én af guidens scener paa lamperne uden at gemme den
                wz = wizard_clean(show, m.get("wizard") or {})
                show["wizard"] = wz
                if m.get("tpl") in WIZ_TPL:
                    t = WIZ_TPL[m["tpl"]]
                    item = {"sid": "proev", "tpl": t["key"], "name": t["name"],
                            "a": "s1", "b": "s2", "level": 100, "fart": 1.0,
                            "fade": t["fade"]}
                else:
                    i = int(m.get("index", 0))
                    if not (0 <= i < len(wz["items"])):
                        return {"ok": False, "err": "ukendt scene"}
                    item = wz["items"][i]
                while len(show["layers"]) < 4:
                    show["layers"].append(default_layer(len(show["layers"])))
                sc = wizard_scene(show, wz, item, "")
                eng.start_fade(min(1.0, sc["fade"]))
                apply_scene(show, sc)
                if wz.get("follow", True) and not m.get("keep_bpm"):
                    show["master"]["bpm"] = wz["bpm"]
                eng.touch()
                return {"ok": True}

            if op == "wizard_build":
                wz = wizard_clean(show, m.get("wizard") or {})
                res = wizard_build(show, wz)
                show["wizard"] = wz
                wizard_autosave(show)
                eng.touch()
                res.update({"ok": True, "wizard": wz})
                return res

            if op == "layer_sync":
                # Slaa "Foelg tempo" til/fra uden at farten springer: Fart
                # regnes om, saa laget koerer lige saa hurtigt som foer ved
                # det tempo der staar nu. Herefter styrer tap farten.
                L = show["layers"][int(m["layer"])]
                set_layer_sync(L, bool(m["on"]), show["master"].get("bpm", 120))
                eng.rev += 1
                return {"ok": True}

            if op == "sync_all":
                # Alle lag i showet og i alle scener foelger tempoet. Hver
                # scenes fart regnes om efter scenens eget gemte tempo, saa
                # intet ser anderledes ud foer man tapper.
                n = 0
                for L in show["layers"]:
                    n += set_layer_sync(L, True, show["master"].get("bpm", 120))
                for sc in show["scenes"]:
                    sb = (sc.get("master") or {}).get("bpm", show["master"].get("bpm", 120))
                    for L in sc.get("layers", []):
                        n += set_layer_sync(L, True, sb)
                eng.rev += 1
                return {"ok": True, "changed": n}

            if op == "group_select":
                gi = m["group"]
                members = show["groups"][gi]["members"]
                show["layers"][m["layer"]]["mask"] = list(members)
                eng.rev += 1
                return {"ok": True}

            if op == "group_new":
                show["groups"].append({"name": m.get("name", "Gruppe"),
                                       "members": m.get("members", [])})
                eng.rev += 1
                return {"ok": True}

            if op == "group_del":
                del show["groups"][m["index"]]
                eng.rev += 1
                return {"ok": True}

            if op == "scene_store":
                show["scenes"].append(snapshot(
                    show,
                    m.get("name", "Scene %d" % (len(show["scenes"]) + 1)),
                    tab=m.get("tab")))
                eng.rev += 1
                return {"ok": True}

            if op == "scene_recall":
                if m.get("id"):
                    idx = next((k for k, s in enumerate(show["scenes"])
                               if s.get("id") == m["id"]), None)
                    if idx is None:
                        return {"ok": False, "err": "scenen findes ikke laengere"}
                else:
                    idx = int(m["index"])
                sc = show["scenes"][idx]
                eng.start_fade(float(m.get("fade", sc.get("fade", 0))))
                apply_scene(show, sc)
                eng.touch()
                return {"ok": True}

            if op == "scene_update":
                i = m["index"]
                old = show["scenes"][i]
                fade = old.get("fade", 2.0)
                show["scenes"][i] = snapshot(show, old["name"], keep_id=old.get("id"),
                                             tab=old.get("tab"))
                show["scenes"][i]["fade"] = fade
                eng.rev += 1
                return {"ok": True}

            if op == "scene_move":
                # Flytter en scene hen foran en anden (indsaetning, ikke
                # ombytning) - saa foeles traek/slip som en liste man
                # sorterer. Cuelisten peger paa scene_id og roeres ikke.
                a, b = int(m["from"]), int(m["to"])
                n = len(show["scenes"])
                if 0 <= a < n and 0 <= b < n and a != b:
                    sc = show["scenes"].pop(a)
                    show["scenes"].insert(b, sc)
                    eng.rev += 1
                return {"ok": True}

            if op == "scene_set_tab":
                i = int(m["index"])
                tid = m.get("tab")
                tabs = show.get("scene_tabs") or []
                if 0 <= i < len(show["scenes"]) and any(t["id"] == tid for t in tabs):
                    show["scenes"][i]["tab"] = tid
                    eng.rev += 1
                return {"ok": True}

            if op == "tab_add":
                tabs = show.setdefault("scene_tabs", [])
                tid = uuid.uuid4().hex[:8]
                tabs.append({"id": tid, "name": m.get("name") or
                             ("Gruppe %d" % (len(tabs) + 1))})
                eng.rev += 1
                return {"ok": True, "id": tid}

            if op == "tab_rename":
                for t in show.get("scene_tabs", []):
                    if t["id"] == m.get("id"):
                        t["name"] = m.get("name") or t["name"]
                        eng.rev += 1
                return {"ok": True}

            if op == "tab_move":
                tabs = show.get("scene_tabs", [])
                a, b = int(m["from"]), int(m["to"])
                if 0 <= a < len(tabs) and 0 <= b < len(tabs) and a != b:
                    tabs.insert(b, tabs.pop(a))
                    eng.rev += 1
                return {"ok": True}

            if op == "tab_del":
                tabs = show.get("scene_tabs", [])
                tid = m.get("id")
                if len(tabs) <= 1:
                    return {"ok": False, "err": "det sidste faneblad kan ikke fjernes"}
                idx = next((k for k, t in enumerate(tabs) if t["id"] == tid), None)
                if idx is None:
                    return {"ok": True}
                del tabs[idx]
                # scenerne bliver - de flyttes til det foerste faneblad,
                # saa man aldrig kan tabe et gemt look ved et uheld.
                home = tabs[0]["id"]
                for sc in show["scenes"]:
                    if sc.get("tab") == tid:
                        sc["tab"] = home
                eng.rev += 1
                return {"ok": True}

            if op == "scene_swap":
                a, b = int(m["a"]), int(m["b"])
                n = len(show["scenes"])
                if 0 <= a < n and 0 <= b < n and a != b:
                    show["scenes"][a], show["scenes"][b] = \
                        show["scenes"][b], show["scenes"][a]
                    eng.rev += 1
                return {"ok": True}

            if op == "scene_del":
                removed_id = show["scenes"][m["index"]].get("id")
                del show["scenes"][m["index"]]
                show["cuelist"] = [c for c in show["cuelist"]
                                   if c.get("scene_id") != removed_id]
                eng.rev += 1
                return {"ok": True}

            if op == "cue_add":
                idx = int(m["scene"])
                if 0 <= idx < len(show["scenes"]):
                    show["cuelist"].append({"scene_id": show["scenes"][idx]["id"],
                                            "fade": 2.0, "follow": 0})
                    eng.rev += 1
                return {"ok": True}

            if op == "cue_del":
                del show["cuelist"][m["index"]]
                eng.rev += 1
                return {"ok": True}

            if op == "cue_move":
                i, j = int(m["index"]), int(m["index"]) + int(m["dir"])
                cl = show["cuelist"]
                if 0 <= i < len(cl) and 0 <= j < len(cl):
                    cl[i], cl[j] = cl[j], cl[i]
                    eng.rev += 1
                return {"ok": True}

            if op == "pattern_new":
                show["patterns"].append({
                    "name": m.get("name", "Eget %d" % (len(show["patterns"]) + 1)),
                    "steps": [[0.0] * 36 for _ in range(int(m.get("steps", 8)))],
                    "smooth": True})
                eng.rev += 1
                return {"ok": True}

            if op == "pattern_set":
                pat = show["patterns"][m["index"]]
                pat["steps"] = m["steps"]
                eng.rev += 1
                return {"ok": True}

            if op == "pattern_resize":
                pat = show["patterns"][m["index"]]
                n = clamp(int(m["steps"]), 1, 64)
                cur = pat["steps"]
                pat["steps"] = [(cur[i] if i < len(cur) else [0.0] * 36)
                                for i in range(n)]
                eng.rev += 1
                return {"ok": True}

            if op == "pattern_del":
                if len(show["patterns"]) > 1:
                    del show["patterns"][m["index"]]
                    eng.rev += 1
                return {"ok": True}

            if op == "modules_set":
                n = clamp(int(m["count"]), 1, 64)
                cur = show["modules"]
                show["modules"] = [(cur[i] if i < len(cur) else default_module(i))
                                   for i in range(n)]
                eng.touch()
                return {"ok": True}

            if op == "layer_copy":
                src = show["layers"][int(m["from"])]
                di = int(m["to"])
                keep = show["layers"][di]["name"]
                show["layers"][di] = json.loads(json.dumps(src))
                show["layers"][di]["name"] = keep
                show["layers"][di]["solo"] = False
                eng.rev += 1
                return {"ok": True}

            if op == "layer_swap":
                a, b = int(m["from"]), int(m["to"])
                na, nb = show["layers"][a]["name"], show["layers"][b]["name"]
                show["layers"][a], show["layers"][b] = \
                    show["layers"][b], show["layers"][a]
                show["layers"][a]["name"], show["layers"][b]["name"] = na, nb
                eng.rev += 1
                return {"ok": True}

            if op == "layer_clear":
                i = int(m["index"])
                keep = show["layers"][i]["name"]
                show["layers"][i] = default_layer(i)
                show["layers"][i]["name"] = keep
                show["layers"][i]["on"] = False
                eng.rev += 1
                return {"ok": True}

            if op == "layers_set":
                n = clamp(int(m["count"]), 1, 32)
                cur = show["layers"]
                show["layers"] = [(cur[i] if i < len(cur) else default_layer(i))
                                  for i in range(n)]
                eng.rev += 1
                return {"ok": True}

            if op == "view_set":
                v = show.setdefault("view", default_view())
                for k, val in (m.get("values") or {}).items():
                    if k in default_view():
                        v[k] = val
                eng.rev += 1
                return {"ok": True}

            if op == "fixture_reorder":
                a = int(m.get("from", -1))
                b = int(m.get("to", -1))
                n = len(show["modules"])
                if not (0 <= a < n and 0 <= b < n) or a == b:
                    return {"ok": True}
                mod = show["modules"].pop(a)
                show["modules"].insert(b, mod)
                # order[nyt index] = gammelt index  ->  vend til gammelt->nyt,
                # saa lagmasker og grupper peger paa de samme lamper som foer.
                order = list(range(n))
                order.insert(b, order.pop(a))
                remap = {}
                for new_i, old_i in enumerate(order):
                    remap[old_i] = new_i
                for L in show["layers"]:
                    L["mask"] = sorted(remap[x] for x in L["mask"] if x in remap)
                for gr in show["groups"]:
                    gr["members"] = sorted(remap[x] for x in gr["members"] if x in remap)
                for sc in show["scenes"]:
                    lv = sc.get("levels")
                    if lv and len(lv) == n:
                        sc["levels"] = [lv[order[i]] for i in range(n)]
                if m.get("renumber"):
                    for i2, mm in enumerate(show["modules"]):
                        mm["num"] = str(i2 + 1)
                eng.touch()
                return {"ok": True}

            if op == "renumber_all":
                for i2, mm in enumerate(show["modules"]):
                    mm["num"] = str(i2 + 1)
                eng.rev += 1
                return {"ok": True}

            if op == "stage_objects":
                show["stage_objects"] = m.get("objects") or []
                eng.rev += 1
                return {"ok": True}

            # -- grupper (Layout/Afvikling) --------------------------------
            if op == "glabel_add":
                g = {"id": uuid.uuid4().hex[:10],
                     "name": (str(m.get("name") or "Gruppe").strip() or "Gruppe")[:40],
                     "members": clean_group_members(show, m.get("members")),
                     "x": float(m.get("x", 0.0)), "y": float(m.get("y", 0.0)),
                     "collapsed": False}
                show["group_labels"].append(g)
                eng.rev += 1
                return {"ok": True, "id": g["id"]}

            if op == "glabel_update":
                g = find_group(show, m.get("id"))
                if not g:
                    return {"ok": False, "err": "gruppen findes ikke"}
                if "name" in m:
                    g["name"] = (str(m.get("name") or g["name"]).strip() or g["name"])[:40]
                if "members" in m:
                    g["members"] = clean_group_members(show, m.get("members"), self_id=g["id"])
                for f in ("x", "y"):
                    if f in m:
                        g[f] = float(m[f])
                if "collapsed" in m:
                    g["collapsed"] = bool(m["collapsed"])
                eng.rev += 1
                return {"ok": True}

            if op == "glabel_pos":
                g = find_group(show, m.get("id"))
                if g:
                    g["x"] = float(m.get("x", g["x"]))
                    g["y"] = float(m.get("y", g["y"]))
                    eng.rev += 1
                return {"ok": True}

            if op == "glabel_del":
                gid = m.get("id")
                show["group_labels"] = [g for g in show["group_labels"] if g.get("id") != gid]
                # fjern referencer fra andre grupper og eventuelle looks
                for g in show["group_labels"]:
                    g["members"] = [mm for mm in g.get("members", [])
                                    if not (mm.get("t") == "grp" and mm.get("id") == gid)]
                show["live"]["looks"] = [lk for lk in show["live"]["looks"]
                                         if lk.get("target", {}).get("group") != gid]
                eng.touch()
                return {"ok": True}

            # -- live-looks (Afvikling) ------------------------------------
            if op == "live_set":
                lk = live_apply(show, m.get("target") or {}, m.get("values") or {},
                                m.get("fade"))
                eng.rev += 1
                return {"ok": True, "id": lk["id"], "key": lk["key"]}

            # Enkel: de samme vaerdier paa flere lamper - ét look pr. lampe
            if op == "live_lamps":
                nm = len(show["modules"])
                lamps = sorted(set(int(i) for i in (m.get("lamps") or [])
                                   if 0 <= int(i) < nm))
                for i in lamps:
                    live_apply(show, {"lamps": [i]}, dict(m.get("values") or {}),
                               m.get("fade"), src="enkel")
                eng.rev += 1
                return {"ok": True, "n": len(lamps)}

            # Enkel: alt moerkt - hver lampe faar et slukket Enkel-look, saa
            # den heller ikke falder tilbage til Pulten naar flere styrer
            if op == "live_dark":
                for i in range(len(show["modules"])):
                    live_apply(show, {"lamps": [i]}, {"on": False}, None, src="enkel")
                eng.rev += 1
                return {"ok": True}

            if op == "control_set":
                ctl = clean_control(m.get("control"))
                if not ctl:
                    return {"ok": False, "err": "vælg mindst én styring"}
                if ctl != control_of(show):
                    # krydsfade med standard-overgangstiden, saa skiftet ikke klipper
                    eng.start_fade(float(show["live"].get("fade", 1.0) or 0))
                    show["control"] = ctl
                eng.rev += 1
                return {"ok": True, "control": ctl}

            if op == "live_on":
                lk = None
                if m.get("key"):
                    lk = find_look(show, m["key"])
                elif m.get("id"):
                    lk = next((x for x in show["live"]["looks"] if x.get("id") == m["id"]), None)
                if lk:
                    lk["on"] = bool(m.get("on", True))
                    eng.rev += 1
                return {"ok": True}

            if op == "live_del":
                key = m.get("key")
                show["live"]["looks"] = [lk for lk in show["live"]["looks"]
                                         if lk.get("key") != key]
                eng.touch()
                return {"ok": True}

            if op == "live_clear":
                # Afviklings "Alt moerkt": kun Afviklings egne looks
                show["live"]["looks"] = [lk for lk in show["live"]["looks"]
                                         if look_src(lk) != "afvikling"]
                eng.touch()
                return {"ok": True}

            if op == "fixture_settype":
                typ = m.get("type")
                idxs = m.get("indices")
                if idxs is None:
                    idxs = [int(m.get("index", 0))]
                for i in idxs:
                    if 0 <= i < len(show["modules"]) and typ:
                        show["modules"][i]["type"] = typ
                if m.get("readdress"):
                    auto_address(show)
                eng.touch()
                return {"ok": True}

            if op == "import_patch":
                items = m.get("fixtures") or []
                if m.get("clear"):
                    show["modules"] = []
                    for L in show["layers"]:
                        L["mask"] = []
                    for gr in show["groups"]:
                        gr["members"] = []
                # signatur -> profil-id, saa ens lamper genbruger samme profil
                def _sig(shape, chans):
                    return shape + "|" + ",".join(c["k"] for c in chans)
                sig2id = {}
                for bid, bp in FIXTURE_PROFILES.items():
                    sig2id[_sig(bp["shape"], bp["channels"])] = bid
                for pid, pp in show.get("profiles", {}).items():
                    sig2id.setdefault(_sig(pp.get("shape", "par"), pp["channels"]), pid)
                added = 0
                for it in items:
                    chans = it.get("channels") or [{"k": "dimmer", "n": "Dimmer"}]
                    shape = it.get("shape", "par")
                    sig = _sig(shape, chans)
                    pid = sig2id.get(sig)
                    if pid is None:
                        pid = "imp_" + uuid.uuid4().hex[:6]
                        show.setdefault("profiles", {})[pid] = {
                            "name": it.get("profile_name") or ("Import %dk" % len(chans)),
                            "shape": shape, "channels": chans}
                        sig2id[sig] = pid
                    idx = len(show["modules"])
                    mod = default_module(idx)
                    mod["type"] = pid
                    mod["name"] = it.get("name") or profile_for(show, pid)["name"]
                    mod["universe"] = max(1, int(it.get("universe", 1)))
                    mod["address"] = clamp(int(it.get("address", 1)), 1, 512)
                    col = idx % 12
                    mod["x"] = -5.5 + col * 1.0
                    mod["y"] = 2.2 - (idx // 12) * 1.4
                    show["modules"].append(mod)
                    added += 1
                eng.touch()
                return {"ok": True, "added": added}

            if op == "auto_address":
                auto_address(show)
                eng.touch()
                return {"ok": True}

            if op == "fixture_add":
                typ = m.get("type", "root_par_6")
                qty = clamp(int(m.get("qty", 1)), 1, 96)
                uni = int(m.get("universe", 1))
                addr = int(m.get("address", 1))
                n = profile_span(show, typ)
                start = len(show["modules"])
                for k in range(qty):
                    mod = default_module(start + k)
                    mod["type"] = typ
                    mod["universe"] = uni
                    mod["address"] = addr + k * n
                    mod["name"] = "%s %d" % (profile_for(show, typ)["name"],
                                             start + k + 1)
                    col = (start + k) % 12
                    mod["x"] = -5.5 + col * 1.0
                    mod["y"] = 2.2 - ((start + k) // 12) * 1.4
                    show["modules"].append(mod)
                eng.touch()
                return {"ok": True}

            if op == "fixture_del":
                i = int(m.get("index", len(show["modules"]) - 1))
                if 0 <= i < len(show["modules"]) and len(show["modules"]) > 1:
                    del show["modules"][i]
                    for L in show["layers"]:
                        mask = [x for x in L["mask"] if x != i]
                        L["mask"] = [x - 1 if x > i else x for x in mask]
                    for g in show["groups"]:
                        mm = [x for x in g["members"] if x != i]
                        g["members"] = [x - 1 if x > i else x for x in mm]
                eng.touch()
                return {"ok": True}

            if op == "profile_new":
                pid = m.get("id") or ("custom_" + uuid.uuid4().hex[:6])
                chans = m.get("channels") or [{"k": "dimmer", "n": "Dimmer"}]
                show.setdefault("profiles", {})[pid] = {
                    "name": m.get("name", "Egen lampe"),
                    "shape": m.get("shape", "par"),
                    "channels": chans}
                eng.rev += 1
                return {"ok": True, "id": pid}

            if op == "profile_save":
                # Gem en egen lampetype (ny eller rettet). Indbyggede typer
                # kan ikke overskrives - de gemmes som en ny egen type.
                pid = m.get("id") or ""
                if not pid or pid in FIXTURE_PROFILES:
                    pid = "custom_" + uuid.uuid4().hex[:6]
                chans = clean_channels(m.get("channels"))
                if not chans:
                    return {"ok": False, "err": "en lampetype skal have mindst én kanal"}
                shape = m.get("shape") if m.get("shape") in ("par", "wash", "spot", "bar") else "par"
                show.setdefault("profiles", {})[pid] = {
                    "name": (str(m.get("name") or "Egen lampe").strip() or "Egen lampe")[:60],
                    "shape": shape, "channels": chans}
                eng.touch()
                return {"ok": True, "id": pid}

            if op == "profile_copy":
                src = profile_for(show, m.get("from"))
                pid = "custom_" + uuid.uuid4().hex[:6]
                show.setdefault("profiles", {})[pid] = {
                    "name": (m.get("name") or (src["name"] + " (kopi)"))[:60],
                    "shape": src.get("shape", "par"),
                    "channels": clean_channels(src["channels"])}
                eng.rev += 1
                return {"ok": True, "id": pid}

            if op == "profile_probe":
                if m.get("clear"):
                    eng.probe = None
                else:
                    eng.probe = {"type": m.get("type"), "slot": int(m.get("slot", 0)),
                                 "value": clamp(int(m.get("value", 0)), 0, 255),
                                 # sikkerhed: slipper af sig selv efter 2 minutter
                                 "until": time.monotonic() + 120}
                return {"ok": True}

            if op == "theme_save":
                name, th = clean_theme(m)
                if not name:
                    return {"ok": False, "err": th}
                themes = load_themes()
                if name in themes and not m.get("overwrite"):
                    return {"ok": False, "exists": True, "err": "der findes allerede et tema med det navn"}
                themes[name] = th
                try:
                    save_themes(themes)
                except OSError as e:
                    return {"ok": False, "err": "kunne ikke gemme: %s" % e}
                eng.rev += 1          # andre skaerme henter den nye liste
                return {"ok": True, "name": name}

            if op == "theme_del":
                themes = load_themes()
                if m.get("name") in themes:
                    del themes[m["name"]]
                    try:
                        save_themes(themes)
                    except OSError as e:
                        return {"ok": False, "err": "kunne ikke gemme: %s" % e}
                    eng.rev += 1
                return {"ok": True}

            if op == "lamptest":
                if m.get("stop"):
                    eng.lamptest = None
                    eng.lamptest_now = None
                    return {"ok": True}
                typ = m.get("type")
                if typ not in FIXTURE_PROFILES and typ not in (show.get("profiles") or {}):
                    return {"ok": False, "err": "ukendt lampetype"}
                steps = []
                for st in (m.get("steps") or [])[:32]:
                    if isinstance(st, dict):
                        steps.append({k: clamp(int(st.get(k, 0) or 0), 0, 255)
                                      for k in LAMPTEST_KEYS})
                if not steps:
                    return {"ok": False, "err": "ingen trin i sekvensen"}
                uni = clamp(int(m.get("universe", 1)), 1, 64)
                addr = clamp(int(m.get("address", 1)), 1, 512)
                step_s = min(10.0, max(0.2, float(m.get("step_s", 1.0))))
                hold = m.get("hold")
                hold = None if hold is None else max(0, int(hold))
                old = eng.lamptest
                # Samme sekvens og fart: fortsaet i takt, saa man kan skifte
                # opsaetning uden at sekvensen starter forfra.
                t0 = old["t0"] if (old and old["steps"] == steps
                                   and old["step_s"] == step_s) else time.monotonic()
                eng.lamptest = {"universe": uni, "address": addr, "type": typ,
                                "steps": steps, "step_s": step_s, "hold": hold,
                                "t0": t0,
                                # sikkerhed: slipper af sig selv efter 10 minutter
                                "until": time.monotonic() + 600}
                return {"ok": True}

            if op == "reset_setup":
                # Gem en kopi af det hele foerst, saa nulstillingen kan fortrydes
                # ved at hente kopien under Show.
                backup = None
                if show["modules"] or show["scenes"] or show["group_labels"]:
                    stamp = time.strftime("%Y-%m-%d %H-%M")
                    backup = safe_name("%s før nulstilling %s"
                                       % ((show.get("name") or "Show")[:24], stamp))
                    cp = json.loads(json.dumps(show))
                    cp["name"] = backup
                    os.makedirs(SHOW_DIR, exist_ok=True)
                    with open(os.path.join(SHOW_DIR, backup + ".json"), "w") as f:
                        json.dump(cp, f, indent=1)
                # Det der beskriver udstyret og fladen - ikke selve setuppet -
                # bliver: DMX-udgange, indstillinger, egne lampetyper,
                # farvepaletter og fanernes raekkefoelge.
                keep = {k: json.loads(json.dumps(show[k]))
                        for k in ("outputs", "settings", "profiles", "palettes",
                                  "active_palette", "tab_order") if k in show}
                fresh = default_show(0, len(show["layers"]) or 6)
                fresh.update(keep)
                merge_show(show, fresh)
                eng.probe = None
                eng.lamptest = None
                eng.lamptest_now = None
                eng.fade = None
                eng.touch()
                return {"ok": True, "backup": backup}

            if op == "profile_del":
                pid = m.get("id")
                used = sum(1 for mo in show["modules"] if mo.get("type") == pid)
                if used:
                    return {"ok": False, "err": "bruges af %d lamper" % used}
                if pid and pid in show.get("profiles", {}):
                    del show["profiles"][pid]
                    eng.rev += 1
                return {"ok": True}

            if op == "autolayout":
                n = len(show["modules"])
                for i, mod in enumerate(show["modules"]):
                    mod["x"] = -(n - 1) / 2.0 + i
                    mod["y"] = 0.0
                    mod["rot"] = 0.0
                eng.touch()
                return {"ok": True}

            if op == "save":
                name = safe_name(m.get("name") or show["name"])
                show["name"] = m.get("name") or show["name"]
                with open(os.path.join(SHOW_DIR, name + ".json"), "w") as f:
                    json.dump(show, f, indent=1)
                return {"ok": True, "saved": name}

            if op == "load":
                p = os.path.join(SHOW_DIR, safe_name(m["name"]) + ".json")
                with open(p) as f:
                    loaded = json.load(f)
                merge_show(show, loaded)
                eng.touch()
                return {"ok": True}

            if op == "delete":
                p = os.path.join(SHOW_DIR, safe_name(m["name"]) + ".json")
                if os.path.exists(p):
                    os.remove(p)
                return {"ok": True}

            if op == "new":
                merge_show(show, default_show(len(show["modules"]),
                                              len(show["layers"])))
                eng.touch()
                return {"ok": True}

            if op == "import":
                merge_show(show, m["show"])
                eng.touch()
                return {"ok": True}

            # --- paletter ---
            if op == "palette_save":
                # Gem ændringer til en palette (navn + farver).
                # idx=-1 opretter en ny.
                idx = m.get("idx", -1)
                name = str(m.get("name", "Palette"))[:40]
                colours = m.get("colours", [])
                if not isinstance(colours, list) or len(colours) != 14:
                    return {"ok": False, "err": "Præcis 14 farver kræves"}
                cols = []
                for c in colours:
                    if isinstance(c, list) and len(c) >= 3:
                        cols.append([int(clamp(c[0],0,255)),
                                     int(clamp(c[1],0,255)),
                                     int(clamp(c[2],0,255))])
                    else:
                        cols.append([255,255,255])
                pal = {"name": name, "colours": cols}
                pals = show.setdefault("palettes", [])
                if 0 <= idx < len(pals):
                    pals[idx] = pal
                else:
                    pals.append(pal)
                    idx = len(pals) - 1
                show["active_palette"] = idx
                eng.touch()
                return {"ok": True, "idx": idx}

            if op == "palette_activate":
                idx = m.get("idx", 0)
                pals = show.get("palettes", [])
                if 0 <= idx < len(pals):
                    show["active_palette"] = idx
                    eng.touch()
                    return {"ok": True}
                return {"ok": False, "err": "Ukendt palette-indeks"}

            if op == "palette_del":
                idx = m.get("idx", -1)
                pals = show.get("palettes", [])
                if len(pals) <= 1:
                    return {"ok": False, "err": "Mindst én palette kræves"}
                if 0 <= idx < len(pals):
                    pals.pop(idx)
                    if show.get("active_palette", 0) >= len(pals):
                        show["active_palette"] = len(pals) - 1
                    eng.touch()
                    return {"ok": True}
                return {"ok": False, "err": "Ukendt palette-indeks"}

            # --- fanebladsraekkefoelge ---
            if op == "tab_order":
                order = m.get("order", [])
                if (isinstance(order, list) and len(order) == len(TAB_IDS)
                        and set(order) == set(TAB_IDS)):
                    show["tab_order"] = order
                    eng.touch()
                    return {"ok": True}
                return {"ok": False, "err": "Ugyldigt tab_order"}

        return {"ok": False, "err": "ukendt op: %s" % op}


def open_server(bind, port, handler):
    """Windows giver WinError 10013 hvis porten ligger i et af de omraader
    Hyper-V/WSL reserverer, eller hvis en politik spaerrer den. Vi proever
    derfor et par alternativer i stedet for bare at vaelte."""
    tried, last = [], None
    cands = [(bind, port)]
    for p in (port + 1, port + 2, 8090, 8123, 9080, 0):
        if p != port:
            cands.append((bind, p))
    if bind != "127.0.0.1":
        cands.append(("127.0.0.1", port))
        cands.append(("127.0.0.1", 0))

    for host, p in cands:
        try:
            srv = ThreadingHTTPServer((host, p), handler)
            if tried:
                print("  BEMAERK: %s kunne ikke bruges (%s)." % (tried[0], last))
                print("  Bruger i stedet %s:%d\n" % (host, srv.server_address[1]))
            return srv
        except OSError as e:
            tried.append("%s:%d" % (host, p))
            last = e

    print()
    print("  Kunne ikke aabne nogen port. Sidste fejl: %s" % last)
    print()
    print("  Paa Windows betyder WinError 10013 naesten altid én af disse:")
    print("    * Porten ligger i et reserveret omraade. Tjek med:")
    print("        netsh interface ipv4 show excludedportrange protocol=tcp")
    print("      Hyper-V, WSL og Docker laegger beslag paa store blokke,")
    print("      og 8080 rammer dem ofte.")
    print("    * Firewall eller antivirus blokerer Python.")
    print("    * En anden proces har porten med eneret.")
    print()
    print("  Proev en hoej port der ligger uden for de reserverede omraader:")
    print("        python dmxmixer.py --port 17080")
    print("  Eller lad styresystemet vaelge en ledig:")
    print("        python dmxmixer.py --port 0")
    print()
    raise SystemExit(1)


def lan_ip():
    """Rutespoergsmaal uden at sende noget - virker hvor gethostbyname fejler."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


# ======================================================================
#  Egne farvetemaer
# ======================================================================
#  De faste temaer ligger i ui.css og kan aldrig aendres. Et eget tema er
#  et fast tema (skrift og hjoerner) med egne farver ovenpaa, og gemmes i
#  temaer.json ved siden af shows-mappen - saa det findes paa alle skaerme.
THEME_FILE = os.path.join(os.path.dirname(SHOW_DIR), "temaer.json")
BUILTIN_THEMES = [("rav", "Rav"), ("nat", "Nat"), ("lys", "Lys"), ("kontrast", "Kontrast"),
                  ("scope", "Scope"), ("fluent", "Windows 11"), ("macos", "macOS"),
                  ("material", "Material (Google, lys)"), ("office", "Office (lys)"),
                  ("vscode", "VS Code"), ("ubuntu", "Ubuntu"), ("mint", "Linux Mint"),
                  ("magicq", "MagicQ-stil"), ("grandma", "grandMA-stil"),
                  ("ableton", "Ableton-stil")]
THEME_VARS = ("bg", "panel", "panel2", "rule", "ink", "muted", "dim",
              "accent", "accent-ink", "alarm", "alarm-ink", "ok")


def load_themes():
    try:
        with open(THEME_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_themes(themes):
    tmp = THEME_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(themes, f, indent=1, ensure_ascii=False)
    os.replace(tmp, THEME_FILE)


def clean_theme(m):
    """(navn, tema) eller (None, fejltekst)."""
    name = str(m.get("name") or "").strip()[:40]
    if not name:
        return None, "giv temaet et navn"
    low = name.lower()
    if any(low == tid or low == lbl.lower() for tid, lbl in BUILTIN_THEMES):
        return None, "navnet bruges af et fast tema - vælg et andet"
    base = m.get("base")
    if base not in [t for t, _ in BUILTIN_THEMES]:
        return None, "ukendt grundtema"
    vars_in = m.get("vars") or {}
    out = {}
    for k in THEME_VARS:
        v = str(vars_in.get(k, ""))
        if len(v) == 7 and v[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in v[1:]):
            out[k] = v.lower()
    if len(out) != len(THEME_VARS):
        return None, "alle farver skal være sat"
    return name, {"base": base, "vars": out}


def safe_name(s):
    return "".join(c for c in str(s) if c.isalnum() or c in " -_")[:60] or "show"


def list_shows():
    if not os.path.isdir(SHOW_DIR):
        return []
    return sorted(f[:-5] for f in os.listdir(SHOW_DIR) if f.endswith(".json"))


def migrate_show(show):
    """Sikrer at alle scener har et stabilt id, og at cuelisten peger paa
    scener via det id - ikke via array-position, som forskubbes af enhver
    sletning eller ombytning. Gammelt indeksbaseret format oversaettes."""
    show.setdefault("profiles", {})
    show.setdefault("stage_objects", [])
    gls = show.setdefault("group_labels", [])
    for g in gls:
        g.setdefault("id", uuid.uuid4().hex[:10])
        g.setdefault("name", "Gruppe")
        g.setdefault("members", [])
        g.setdefault("x", 0.0)
        g.setdefault("y", 0.0)
        g.setdefault("collapsed", False)
    live = show.setdefault("live", {"looks": []})
    if not isinstance(live, dict):
        show["live"] = {"looks": []}
    looks = show["live"].setdefault("looks", [])
    try:
        show["live"]["fade"] = float(clamp(float(show["live"].get("fade", 1.0)), 0.0, 30.0))
    except (TypeError, ValueError):
        show["live"]["fade"] = 1.0
    for lk in looks:
        lk.setdefault("id", uuid.uuid4().hex[:10])
        lk.setdefault("target", {})
        lk.setdefault("key", look_key(lk["target"]))
        # Krydsfade-tilstand er kun gyldig i den koerende proces (monotonic
        # ur). Efter genindlaesning staar looket paa sin maalvaerdi.
        lk["cfrom"] = lk.get("colour", [255, 255, 255])
        lk["lfrom"] = lk.get("level", 255)
        lk["ft0"] = 0
        lk["fdur"] = 0
    if "wizard" in show and not isinstance(show["wizard"], dict):
        show.pop("wizard")
    v = show.setdefault("view", default_view())
    for k, dv in default_view().items():
        v.setdefault(k, dv)
    for i, m in enumerate(show.get("modules", [])):
        m.setdefault("type", "root_par_6")
        m.setdefault("ovr", {})
        m.setdefault("pixels", 1)
        m.setdefault("num", str(i + 1))
        m.setdefault("lbl", True)
        m.setdefault("lx", 0.0)
        m.setdefault("ly", 0.0)
    tabs = show.setdefault("scene_tabs", [{"id": "main", "name": "Scener"}])
    if not tabs:
        tabs.append({"id": "main", "name": "Scener"})
    first_tab = tabs[0]["id"]
    known = set(t["id"] for t in tabs)
    for sc in show["scenes"]:
        if not sc.get("id"):
            sc["id"] = uuid.uuid4().hex[:10]
        sc.setdefault("live", [])
        # scener fra et show uden faneblade havner paa det foerste
        if sc.get("tab") not in known:
            sc["tab"] = first_tab

    fixed = []
    for c in show["cuelist"]:
        if c.get("scene_id"):
            fixed.append(c)
            continue
        idx = c.get("scene")
        if isinstance(idx, int) and 0 <= idx < len(show["scenes"]):
            c["scene_id"] = show["scenes"][idx]["id"]
            c.pop("scene", None)
            fixed.append(c)
        # cue uden gyldig maal droppes - bedre end at pege forkert
    show["cuelist"] = fixed

    # --- paletter (farvesamlinger til Pult og Afvikling) ---
    DEFAULT_PALETTE = {"name": "Standard", "colours": [
        [255,0,0],[255,80,0],[255,160,0],[255,230,0],[120,255,0],[0,255,80],
        [0,220,255],[0,80,255],[130,0,255],[230,0,255],[255,0,140],
        [255,255,255],[255,180,110],[180,210,255]]}
    pals = show.setdefault("palettes", [DEFAULT_PALETTE])
    if not pals:
        pals.append(dict(DEFAULT_PALETTE))
    for p in pals:
        p.setdefault("name", "Palette")
        cols = p.setdefault("colours", DEFAULT_PALETTE["colours"][:])
        # sørg for præcis 14 pladser
        while len(cols) < 14:
            cols.append([255, 255, 255])
        if len(cols) > 14:
            p["colours"] = cols[:14]
    ai = show.setdefault("active_palette", 0)
    if not isinstance(ai, int) or ai < 0 or ai >= len(pals):
        show["active_palette"] = 0

    # --- fanebladsraekkefoelge ---
    # (shows fra den tid fanerne var samlet i fem grupper har en anden liste
    # og faar standardraekkefoelgen)
    show["tab_order"] = fix_tab_order(show.get("tab_order"))

    # --- hvem styrer lyset ---
    # Shows fra foer der var en styrings-linje, faar de styringer der faktisk
    # har noget taendt - saa lyset ser ud som det plejede.
    for lk in (show.get("live") or {}).get("looks") or []:
        lk["src"] = look_src(lk)
    ctl = clean_control(show.get("control"))
    show["control"] = ctl or infer_control(show.get("layers"),
                                           (show.get("live") or {}).get("looks"))


def merge_show(target, src):
    """Erstat indholdet uden at bytte selve objektet ud - motoren holder
    en reference til det."""
    base = default_show(len(src.get("modules", [])) or 10,
                        len(src.get("layers", [])) or 6)
    target.clear()
    target.update(base)
    for k, v in src.items():
        if k in ("settings", "master", "outputs") and isinstance(v, dict):
            target[k].update(v)
        else:
            target[k] = v
    # sikr at alle lag har alle felter, ogsaa hvis showet er gammelt
    for i, l in enumerate(target["layers"]):
        d = default_layer(i)
        d.update(l)
        target["layers"][i] = d
    for i, mo in enumerate(target["modules"]):
        d = default_module(i)
        d.update(mo)
        target["modules"][i] = d
    if "control" not in src:
        # aeldre show: lad migrate_show finde ud af hvem der styrede
        target.pop("control", None)
    migrate_show(target)


# ======================================================================
def build_server(args):
    """Opret motor og server ud fra argumenterne. Returnerer (server, port,
    url) hvor url er netvaerksadressen (eller None hvis bundet lokalt)."""
    os.makedirs(SHOW_DIR, exist_ok=True)
    n_layers = args.layers or 6
    show = default_show(0, n_layers) if args.blank else demo_show()
    if args.show:
        p = os.path.join(SHOW_DIR, safe_name(args.show) + ".json")
        if os.path.exists(p):
            with open(p) as f:
                merge_show(show, json.load(f))

    Handler.engine = Engine(show)
    server = open_server(args.bind, args.port, Handler)
    port = server.server_address[1]
    url = "http://%s:%d" % (lan_ip(), port) if args.bind == "0.0.0.0" else None
    return server, port, url


def open_browser_soon(port):
    threading.Timer(0.7,
                    lambda: webbrowser.open("http://127.0.0.1:%d" % port)
                    ).start()


def run_gui(server, port, url):
    """Lille vindue med adressen og en Stop-knap, saa en installeret app
    kan koere uden en terminal. Falder tilbage til konsollen hvis der ikke
    er noget vinduessystem (fx en ren server)."""
    try:
        import tkinter as tk
    except Exception:
        return False

    local = "http://127.0.0.1:%d" % port

    def do_stop():
        Handler.engine.running = False
        try:
            threading.Thread(target=server.shutdown, daemon=True).start()
        except Exception:
            pass
        root.destroy()

    try:
        root = tk.Tk()
    except Exception:
        return False
    root.title("Lyspult")
    root.configure(bg="#14181E")
    try:
        root.minsize(380, 0)
    except Exception:
        pass
    pad = {"padx": 18, "pady": 4}
    tk.Label(root, text="Lyspult kører", fg="#F2B33D", bg="#14181E",
             font=("Helvetica", 18, "bold")).pack(anchor="w", padx=18, pady=(16, 2))
    tk.Label(root, text="Lad dette vindue stå åbent, mens du bruger pulten.",
             fg="#B4BCC8", bg="#14181E", justify="left").pack(anchor="w", **pad)
    tk.Label(root, text="På denne computer:", fg="#8B94A2", bg="#14181E").pack(anchor="w", padx=18, pady=(10, 0))
    tk.Label(root, text=local, fg="#EDF0F5", bg="#14181E",
             font=("Helvetica", 13, "bold")).pack(anchor="w", **pad)
    if url:
        tk.Label(root, text="Fra iPad eller telefon på samme wifi:", fg="#8B94A2", bg="#14181E").pack(anchor="w", padx=18, pady=(8, 0))
        tk.Label(root, text=url, fg="#EDF0F5", bg="#14181E",
                 font=("Helvetica", 13, "bold")).pack(anchor="w", **pad)

    btns = tk.Frame(root, bg="#14181E")
    btns.pack(anchor="w", padx=16, pady=(16, 18))
    tk.Button(btns, text="Åbn i browser", command=lambda: webbrowser.open(local),
              highlightbackground="#14181E").pack(side="left", padx=2)
    tk.Button(btns, text="Stop pulten", command=do_stop, fg="#180C08",
              bg="#E86A50", activebackground="#F2805C",
              highlightbackground="#14181E").pack(side="left", padx=2)

    root.protocol("WM_DELETE_WINDOW", do_stop)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    open_browser_soon(port)
    try:
        root.mainloop()
    finally:
        Handler.engine.running = False
    return True


def run_console(args, server, port, url):
    n_mods = len(Handler.engine.show["modules"])
    print()
    print("  Lyspult - %d lamper" % n_mods)
    print("  Lokalt:      http://127.0.0.1:%d" % port)
    if url:
        print("  Netvaerk:    %s" % url)
        print()
        l1 = "Telefon eller iPad paa samme wifi:"
        l2 = "aabn  %s  og tryk Live-matrix" % url
        w = max(len(l1), len(l2))
        print("  +" + "-" * (w + 4) + "+")
        print("  |  %s  |" % l1.ljust(w))
        print("  |  %s  |" % l2.ljust(w))
        print("  +" + "-" * (w + 4) + "+")
    else:
        print()
        print("  BEMAERK: bundet til %s, saa telefon og iPad kan IKKE naa den."
              % args.bind)
        print("  Start uden --bind (eller med --bind 0.0.0.0) for adgang "
              "fra netvaerket.")
    print()
    print("  Shows:       %s" % SHOW_DIR)
    print("  Brugerflade: %s" % ui_source())
    print()
    print("  Ctrl-C for at stoppe")
    print()
    if not args.no_browser:
        open_browser_soon(port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        Handler.engine.running = False
        print("\n  Stoppet.")


def main():
    ap = argparse.ArgumentParser(description="Lyspult - DMX-mixer til lamper")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--bind", default="0.0.0.0",
                    help="0.0.0.0 for adgang fra iPad m.fl.")
    ap.add_argument("--layers", type=int, default=6)
    ap.add_argument("--blank", action="store_true",
                    help="tomt rig i stedet for demo-rigget")
    ap.add_argument("--show", default="", help="indlaes dette show ved start")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--gui", action="store_true",
                    help="vis et lille vindue med en Stop-knap i stedet for konsollen")
    ap.add_argument("--no-gui", action="store_true",
                    help="koer altid i konsollen, ogsaa i en pakket app")
    args = ap.parse_args()

    server, port, url = build_server(args)

    # En pakket app vises som vindue (ingen terminal); et almindeligt
    # scriptkald bruger konsollen. --gui / --no-gui tvinger valget.
    want_gui = args.gui or (getattr(sys, "frozen", False) and not args.no_gui)
    if want_gui and run_gui(server, port, url):
        return
    run_console(args, server, port, url)


# =====================================================================
#  Indbygget kopi af brugerfladen
# ---------------------------------------------------------------------
#  ui.html, ui.css og ui.js ligger her som base64, saa denne fil kan
#  koere alene. Ligger filerne ved siden af scriptet, bruges de i
#  stedet - saa kan man stadig rette i fladen uden at genskabe blobben.
# =====================================================================

# Brugerfladen ligger som ui.html/ui.css/ui.js ved siden af scriptet.
EMBEDDED_B64 = {}


if __name__ == "__main__":
    main()
