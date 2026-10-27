#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enttec Open DMX-testfejer  (FTDI-udgave)
========================================

Denne udgave taler DIREKTE med FTDI-chippen via pyftdi - praecis som QLC+
goer det med libftdi. Det er den eneste metode der virker til Enttec Open
DMX USB: donglen har ingen processor, saa computeren skal selv lave et
rigtigt hardware-break med korrekt timing. (Den gamle pyserial-metode kunne
IKKE det - derfor kom der intet lys.)

Timing kopieret 1:1 fra QLC+ (enttecdmxusbopen.cpp / libftdi-interface.cpp):
  250000 baud, 8 databit, 2 stopbit, ingen paritet, ingen flow control,
  RTS lav; pr. frame:  break til -> 110 us -> break fra -> 16 us (MAB) ->
  skriv 0x00 + 512 kanaler.

Kraever:  pip3 install pyftdi pyusb
Linux:    sudo apt install libusb-1.0-0   (QLC+ installerede den allerede)
          din bruger skal have USB-adgang - du er allerede i dialout/plugdev
          fra QLC+-opsaetningen, saa det er paa plads. pyftdi kobler selv
          ftdi_sio af for enheden, saa du behoever normalt ikke 'rmmod'.

    python3 enttec_test.py       # aabner http://127.0.0.1:8090
"""

import json
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8090

STATE = {
    "url": "",              # pyftdi-URL til enheden, fx ftdi://0x403:0x6001/1
    "mode": "combo",        # allfull | walk | combo
    "base": 1,
    "span": 16,
    "hold": 1.0,
    "break_us": 110,
    "mab_us": 16,
    "freq": 40,             # frames pr. sekund
    "running": False,
    "frozen": False,
    "desc": "Klar.",
    "active": [],
    "err": "",
    "opened": "",
    "frames": 0,
}
LOCK = threading.Lock()
FRAME = bytearray(512)


# --------------------------------------------------------------------------
#  Praecis kort ventetid (busy-wait) - time.sleep er for grov til us
# --------------------------------------------------------------------------
def spin_us(us):
    if us <= 0:
        return
    end = time.perf_counter() + us / 1e6
    while time.perf_counter() < end:
        pass


# --------------------------------------------------------------------------
#  FTDI Open DMX-driver (som QLC+ libftdi)
# --------------------------------------------------------------------------
def list_ftdi():
    try:
        from pyftdi.ftdi import Ftdi
    except Exception:
        return {"err": "pyftdi mangler - kør: pip3 install pyftdi pyusb", "devices": []}
    try:
        out = []
        for desc, _ifc in Ftdi.list_devices():
            if getattr(desc, "sn", None):
                url = "ftdi://0x%04x:0x%04x:%s/1" % (desc.vid, desc.pid, desc.sn)
            else:
                url = "ftdi://0x%04x:0x%04x/1" % (desc.vid, desc.pid)
            label = "%s  [VID %04x · PID %04x%s]" % (
                desc.description or "FTDI", desc.vid, desc.pid,
                (" · SN " + desc.sn) if getattr(desc, "sn", None) else "")
            out.append({"url": url, "label": label})
        return {"err": "", "devices": out}
    except Exception as e:
        return {"err": str(e), "devices": []}


class OpenDmxFtdi:
    def __init__(self):
        self.ftdi = None
        self.url = ""

    def open(self, url):
        from pyftdi.ftdi import Ftdi
        self.close()
        f = Ftdi()
        f.open_from_url(url)                 # libusb - kobler ftdi_sio af selv
        f.set_baudrate(250000)
        f.set_line_property(8, 2, 'N')       # 8 databit, 2 stopbit, ingen paritet
        for call in (lambda: f.set_flowctrl(''),
                     lambda: f.set_latency_timer(1),
                     lambda: f.set_rts(False),
                     lambda: f.purge_buffers(),
                     lambda: f.write_data_set_chunksize(1024)):
            try:
                call()
            except Exception:
                pass
        self.ftdi = f
        self.url = url

    line_free_at = 0.0

    def send(self, frame, break_us, mab_us):
        f = self.ftdi
        if not f:
            return
        # Vent til forrige frame er helt ude paa kablet. write_data vender
        # tilbage foer FT232R'ens 256-bytes sendebuffer er toemt, og et
        # break midt i en frame klipper halen af den (= kort flimmer).
        now = time.perf_counter()
        if now < self.line_free_at:
            time.sleep(self.line_free_at - now)
        t_end = time.perf_counter() + 0.006
        while time.perf_counter() < t_end:
            try:
                if f.poll_modem_status() & (1 << 14):   # TEMT: sender tom
                    break
            except Exception:
                break
            time.sleep(0.0005)
        f.set_break(True)
        spin_us(break_us)
        f.set_break(False)
        spin_us(mab_us)
        data = b"\x00" + bytes(frame)            # startkode 0x00 + 512 kanaler
        t0 = time.perf_counter()
        f.write_data(data)
        self.line_free_at = t0 + len(data) * 11 / 250000.0 + 0.001

    def close(self):
        try:
            if self.ftdi:
                self.ftdi.close()
        except Exception:
            pass
        self.ftdi = None
        self.url = ""


DMX = OpenDmxFtdi()


# --------------------------------------------------------------------------
#  Fejer
# --------------------------------------------------------------------------
def set_frame(active_channels, desc):
    with LOCK:
        for i in range(512):
            FRAME[i] = 0
        for ch in active_channels:
            if 1 <= ch <= 512:
                FRAME[ch - 1] = 255
        STATE["active"] = list(active_channels)
        STATE["desc"] = desc


def build_steps(mode, base, span):
    lo, hi = base, base + span - 1
    steps = []
    if mode == "allfull":
        steps.append((list(range(lo, hi + 1)),
                      "Alt fuldt: kanal %d-%d = 255" % (lo, hi)))
        return steps
    if mode in ("walk", "combo"):
        for c in range(lo, hi + 1):
            steps.append(([c], "Kanalgennemgang: kanal %d = 255 (adr-offset %d)"
                          % (c, c - base + 1)))
    if mode == "combo":
        for d in range(lo, hi + 1):
            for col in range(lo, hi + 1):
                if col == d:
                    continue
                steps.append(([d, col],
                              "Kombination: kanal %d + kanal %d = 255  "
                              "(dimmer-gaet %d, kanal %d)" % (d, col, d, col)))
    return steps


def ensure_open():
    with LOCK:
        url = STATE["url"]
    if not url:
        with LOCK:
            STATE["err"] = "vælg en FTDI-enhed først"
        return False
    if DMX.url == url and DMX.ftdi:
        return True
    try:
        DMX.open(url)
        with LOCK:
            STATE["err"] = ""
            STATE["opened"] = url
            STATE["frames"] = 0
        return True
    except Exception as e:
        with LOCK:
            STATE["err"] = str(e)
            STATE["opened"] = ""
        return False


def tx(frame):
    with LOCK:
        b, m = STATE["break_us"], STATE["mab_us"]
    try:
        DMX.send(frame, b, m)
        with LOCK:
            STATE["frames"] += 1
            STATE["err"] = ""
    except Exception as e:
        with LOCK:
            STATE["err"] = str(e)
        DMX.close()


def worker():
    while True:
        with LOCK:
            running = STATE["running"]
            frozen = STATE["frozen"]
            mode = STATE["mode"]
            base = STATE["base"]
            span = STATE["span"]
            hold = STATE["hold"]
            freq = max(1, STATE["freq"])
        if not (running or frozen):
            time.sleep(0.05)
            continue
        if not ensure_open():
            time.sleep(0.4)
            continue
        period = 1.0 / freq

        if frozen and not running:
            tx(FRAME)
            time.sleep(period)
            continue

        steps = build_steps(mode, base, span)
        if not steps:
            with LOCK:
                STATE["running"] = False
            continue
        idx = 0
        while True:
            with LOCK:
                if not STATE["running"]:
                    break
                hold = STATE["hold"]
                freq = max(1, STATE["freq"])
            period = 1.0 / freq
            active, desc = steps[idx]
            set_frame(active, desc)
            t0 = time.monotonic()
            while time.monotonic() - t0 < hold:
                with LOCK:
                    if not STATE["running"]:
                        break
                tx(FRAME)
                time.sleep(period)
            with LOCK:
                if not STATE["running"]:
                    break
            idx = (idx + 1) % len(steps)
        with LOCK:
            STATE["frozen"] = True
            a = STATE["active"]
            STATE["desc"] = ("STOPPET. Sender nu konstant: "
                             + (", ".join("kanal %d = 255" % c for c in a) if a else "alt 0")
                             + ".  Det er signalet der virkede.")


threading.Thread(target=worker, daemon=True).start()


# --------------------------------------------------------------------------
#  Webside
# --------------------------------------------------------------------------
PAGE = """<!DOCTYPE html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open DMX-testfejer (FTDI)</title>
<style>
:root{font-size:18px}*{box-sizing:border-box}
body{margin:0;background:#0b0d11;color:#f4f6fb;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-variant-numeric:tabular-nums;padding:18px;max-width:860px;margin:auto}
h1{font-size:1.4rem;margin:.2rem 0 1rem}
.card{background:#16181d;border:1px solid #2c313c;border-radius:10px;padding:16px;margin-bottom:14px}
label{font-weight:600;display:block;margin:.2rem 0 .3rem}
select,input{font:inherit;color:#f4f6fb;background:#0d0f13;border:1px solid #3a4150;border-radius:8px;padding:.5rem .6rem}
select,input[type=text]{width:100%}
.row{display:flex;gap:14px;flex-wrap:wrap}.row>div{flex:1 1 150px}
button{font:inherit;font-weight:800;color:#0b0d11;border:0;border-radius:9px;padding:.7rem 1.2rem;cursor:pointer}
.start{background:#39d98a}.stop{background:#ff3b46;color:#fff}.ghost{background:#2a2f3a;color:#f4f6fb}
.big{font-size:1.15rem;padding:.9rem 1.6rem}
.desc{font-size:1.15rem;font-weight:700;min-height:2.6em;line-height:1.3;margin:.4rem 0}
.mut{color:#9aa4b6;font-size:.85rem}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.chip{border:1px solid #3a4150;border-radius:5px;padding:3px 9px;font-size:.8rem;font-weight:700}
.chip.on{background:#ffb200;color:#181206;border-color:#ffd166}
.stat{font-size:.9rem;color:#9aa4b6}.err{color:#ff6b73;font-weight:700}
code{background:#0d0f13;border:1px solid #3a4150;border-radius:5px;padding:.05rem .4rem}
</style></head><body>
<h1>Open DMX-testfejer <span class="mut" style="font-size:1rem">· direkte FTDI, som QLC+</span></h1>

<div class="card">
  <label>FTDI-enhed</label>
  <div class="row">
    <div style="flex:3 1 300px"><select id="dev"></select></div>
    <div style="display:flex;align-items:flex-end"><button class="ghost" id="refresh">Find enheder</button></div>
  </div>
  <label style="margin-top:10px">… eller skriv pyftdi-URL selv</label>
  <input type="text" id="urlman" placeholder="ftdi://0x0403:0x6001/1">
  <div class="row" style="margin-top:10px">
    <div><label>Metode</label>
      <select id="mode">
        <option value="combo">Kombinationer (dimmer + farve)</option>
        <option value="walk">Kanalgennemgang (enkelt)</option>
        <option value="allfull">Alt fuldt (er lampen i live?)</option>
      </select></div>
    <div><label>Basisadresse</label><input type="number" id="base" value="1" min="1" max="512"></div>
    <div><label>Antal kanaler</label><input type="number" id="span" value="16" min="1" max="64"></div>
  </div>
  <div class="row" style="margin-top:10px">
    <div><label>Hold pr. trin (s)</label><input type="number" id="hold" value="1.0" min="0.2" max="10" step="0.1"></div>
    <div><label>Break (µs)</label><input type="number" id="brk" value="110" min="60" max="1000"></div>
    <div><label>MAB (µs)</label><input type="number" id="mab" value="16" min="4" max="500"></div>
    <div><label>Frekvens (Hz)</label><input type="number" id="freq" value="40" min="10" max="44"></div>
  </div>
  <div class="row" style="margin-top:14px">
    <button class="start big" id="start">START</button>
    <button class="stop big" id="stop">STOP</button>
    <button class="ghost big" id="off">Sluk (alt 0)</button>
  </div>
</div>

<div class="card">
  <div class="mut">Sender nu:</div>
  <div class="desc" id="desc">Klar.</div>
  <div class="chips" id="chips"></div>
  <div class="stat" id="stat" style="margin-top:10px"></div>
  <div class="err" id="err"></div>
</div>

<div class="card mut">
  <b>Sådan:</b> tryk <b>Find enheder</b>, vælg din FTDI (Open DMX melder sig typisk som
  <code>FT232R</code>, VID 0403). Lad Basisadresse stå på 1. Tryk <b>START</b> — når
  lampen reagerer, tryk <b>STOP</b>, så fryser den og teksten viser hvilke kanaler
  der virkede. Ser du ingen enheder: <code>pip3 install pyftdi pyusb</code>, og på
  Linux skal <code>libusb-1.0-0</code> være installeret (det er den, når QLC+ virker).
  Reagerer intet selv på <b>Alt fuldt</b>, så prøv en anden <b>Break</b>-værdi
  (88–200 µs) eller sænk <b>Frekvens</b> til 30 Hz.
</div>

<script>
function id(s){return document.getElementById(s);}
function post(m){var x=new XMLHttpRequest();x.open("POST","/api",true);
  x.setRequestHeader("Content-Type","application/json");x.send(JSON.stringify(m));}
function cfg(){return {url:id("urlman").value.trim()||id("dev").value,
  mode:id("mode").value,base:parseInt(id("base").value)||1,span:parseInt(id("span").value)||16,
  hold:parseFloat(id("hold").value)||1.0,break_us:parseInt(id("brk").value)||110,
  mab_us:parseInt(id("mab").value)||16,freq:parseInt(id("freq").value)||40};}
id("start").onclick=function(){post(Object.assign({op:"start"},cfg()));};
id("stop").onclick=function(){post({op:"stop"});};
id("off").onclick=function(){post({op:"off"});};
id("refresh").onclick=loadDevs;
["mode","base","span","hold","brk","mab","freq"].forEach(function(k){
  id(k).onchange=function(){post(Object.assign({op:"cfg"},cfg()));};});
function loadDevs(){var x=new XMLHttpRequest();x.open("GET","/devices",true);
  x.onreadystatechange=function(){if(x.readyState==4){try{var d=JSON.parse(x.responseText);
    var sel=id("dev");var cur=sel.value;sel.innerHTML="";
    if(!d.devices.length){var o=document.createElement("option");o.value="";
      o.textContent=d.err?("— "+d.err):"(ingen FTDI fundet — tryk Find enheder)";sel.appendChild(o);}
    else d.devices.forEach(function(v){var o=document.createElement("option");o.value=v.url;
      o.textContent=v.label;sel.appendChild(o);});
    if(cur)sel.value=cur;
    id("err").textContent=d.err?("FEJL: "+d.err):"";}catch(e){}}};x.send();}
function poll(){var x=new XMLHttpRequest();x.open("GET","/state",true);
  x.onreadystatechange=function(){if(x.readyState==4){try{var d=JSON.parse(x.responseText);
    id("desc").textContent=d.desc;var c=id("chips");c.innerHTML="";
    for(var i=1;i<=Math.max(16,d.base+d.span-1);i++){var e=document.createElement("span");
      e.className="chip"+(d.active.indexOf(i)>=0?" on":"");e.textContent=i;c.appendChild(e);}
    id("stat").textContent=(d.opened?("Åben: "+d.opened+" · "+d.frames+" rammer"):"Ingen enhed åben")
      +(d.running?" · KØRER":(d.frozen?" · frosset":" · standset"));
    if(d.err)id("err").textContent="FEJL: "+d.err;else if(d.opened)id("err").textContent="";
  }catch(e){}}};x.send();}
loadDevs();setInterval(poll,250);poll();
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype="application/json"):
        b = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/state"):
            with LOCK:
                return self._send(json.dumps({
                    "desc": STATE["desc"], "active": STATE["active"],
                    "running": STATE["running"], "frozen": STATE["frozen"],
                    "err": STATE["err"], "opened": STATE["opened"],
                    "frames": STATE["frames"], "base": STATE["base"], "span": STATE["span"]}))
        if self.path.startswith("/devices"):
            return self._send(json.dumps(list_ftdi()))
        return self._send(PAGE, "text/html")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            msg = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            msg = {}
        op = msg.get("op")
        with LOCK:
            for k in ("url", "mode", "base", "span", "hold", "break_us", "mab_us", "freq"):
                if k in msg:
                    STATE[k] = msg[k]
            if op == "start":
                STATE["running"] = True
                STATE["frozen"] = False
                STATE["desc"] = "Starter…"
            elif op == "stop":
                STATE["running"] = False
            elif op == "off":
                STATE["running"] = False
                STATE["frozen"] = False
                for i in range(512):
                    FRAME[i] = 0
                STATE["active"] = []
                STATE["desc"] = "Slukket (alt 0)."
        return self._send(json.dumps({"ok": True}))


class Server(ThreadingHTTPServer):
    allow_reuse_address = True     # undgaa "Address already in use" efter Ctrl-C
    daemon_threads = True


def main():
    srv = None
    port = PORT
    for p in range(PORT, PORT + 25):
        try:
            srv = Server(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue
    if srv is None:
        print("  Kunne ikke finde en ledig port i %d-%d." % (PORT, PORT + 24))
        print("  Luk en tidligere kørende enttec_test.py og prøv igen.")
        return
    url = "http://127.0.0.1:%d" % port
    print()
    print("  Open DMX-testfejer (FTDI) kører:  " + url)
    if port != PORT:
        print("  (port %d var optaget, bruger %d i stedet)" % (PORT, port))
    print("  Tryk Find enheder, vælg FTDI, START. STOP når lampen reagerer.")
    print("  Ctrl-C for at stoppe.")
    print()
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
