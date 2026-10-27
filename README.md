# Lyspult

DMX-lysstyring til et fast rig af lamper (Cameo Root Par 6, Thunder Wash 600,
hvide spots m.fl.). Pulten er en lagbaseret effektmotor med en browser-flade,
så den kan styres fra computeren, en iPad eller en telefon på samme netværk.

Fladen kører i en helt almindelig browser og er skrevet, så den også virker på
en gammel iPad. Der skal ikke installeres nogen app på de enheder, der styrer —
kun computeren, der kører selve pulten.

## Kom i gang

```
python3 dmxmixer.py
```

Åbn så `http://127.0.0.1:8080` i en browser. Vil du styre fra en iPad eller
telefon, skal den være på samme netværk — åbn da computerens LAN-adresse, som
programmet skriver i terminalen ved opstart (fx `http://192.168.1.42:8080`).

Første gang ligger der et demorig klar. Tryk **Nulstil setup** under Patch for at
starte på en tom rig, eller lad **Guide** bygge et helt show ud fra dine lamper.

### Valgfrie opstartsflag

| Flag | Betydning |
|------|-----------|
| `--port 8080` | Porten fladen lytter på |
| `--bind 0.0.0.0` | Bind-adresse (0.0.0.0 giver adgang fra andre enheder) |
| `--blank` | Start med en tom rig i stedet for demoriggen |
| `--show NAVN` | Indlæs et gemt show ved start |
| `--no-browser` | Luk ikke en browser op automatisk |

## Output

Pulten kan sende DMX tre veje på én gang:

* **Simulator** — altid tændt, det du ser på skærmen.
* **Art-Net** — UDP 6454, unicast eller broadcast.
* **sACN / E1.31** — UDP 5568, multicast eller unicast.
* **Enttec Open DMX USB** — en rå FTDI-chip (VID 0403 / PID 6001), drevet
  direkte via libusb, ligesom QLC+. Kræver `pip3 install pyftdi pyusb`.

Art-Net og sACN virker uden ekstra pakker. USB-donglen kræver pyftdi og pyusb
samt libusb på systemet:

* **Linux:** `sudo apt install libusb-1.0-0`, og læg en udev-regel så du ikke
  skal være root (se under Output → DMX-udgang i selve pulten for den præcise
  linje).
* **macOS:** `brew install libusb`.
* **Windows:** donglen skal have WinUSB/libusbK-driveren (fx via Zadig).

Kun ét program ad gangen kan bruge donglen — luk QLC+ eller en anden pult først.

`enttec_test.py` er et lille selvstændigt testprogram, der fejer en farve hen
over riggen direkte på donglen, til at tjekke at timingen og kablingen virker.

## Filer

| Fil | Indhold |
|-----|---------|
| `dmxmixer.py` | Backend: effektmotor, outputdrivere, showlagring og HTTP-API |
| `ui.html` / `ui.css` / `ui.js` | Brugerfladen (ingen byggeproces, ren ES5) |
| `sim.html` | Simulatoren, der viser riggen live ud fra DMX-data |
| `enttec_test.py` | Selvstændig DMX-test af Enttec Open DMX USB |
| `shows/` | Gemte shows (JSON) — lægges her ved siden af programmet |

## Krav

Python 3.9 eller nyere. Selve pulten og simulatoren bruger kun Pythons
standardbibliotek; kun USB-udgangen kræver de to ekstra pakker i
`requirements.txt`.
