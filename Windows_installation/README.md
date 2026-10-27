# Windows-installation

Her ligger det, der skal til for at lave et installationsprogram til Windows:
**Lyspult-Setup.exe**.

## Den nemme vej: lad GitHub bygge den

Du behøver ikke en Windows-maskine. Gå til fanen **Actions** på GitHub, vælg
**Byg installationsfiler** og tryk **Run workflow**. Når den er færdig, kan du
hente `Windows-Lyspult-Setup` nederst på siden. (Skubber du i stedet et
versionsmærke som `v1.0.0`, lægges filen i en Release.)

## Byg den selv på en Windows-maskine

1. Installer [Python 3.9+](https://www.python.org/downloads/) — sæt flueben i
   "Add Python to PATH" under installationen.
2. Installer [Inno Setup 6](https://jrsoftware.org/isdl.php).
3. Dobbeltklik `build.bat` (eller kør den i en kommandoprompt).

Resultatet lander i `Windows_installation\output\Lyspult-Setup.exe`.

## Hvad installationsprogrammet gør

- Lægger Lyspult i `Program Files` med genvej i Start-menuen (og på skrivebordet,
  hvis du vælger det).
- Åbner en regel i Windows-firewallen, så iPad og telefon på samme netværk kan
  nå pulten.
- Shows og egne temaer gemmes i din egen mappe (`%APPDATA%\Lyspult`), ikke i
  Program Files.

## Første gang du åbner den

Windows viser sandsynligvis **"Windows beskyttede din pc"** (SmartScreen), fordi
programmet ikke er underskrevet med et betalt certifikat. Tryk **Mere info** og
**Kør alligevel**. Det er ufarligt — advarslen kommer, fordi filen er ny og
ukendt for Microsoft, ikke fordi der er noget galt.

## USB-donglen (Enttec Open DMX USB)

Art-Net, sACN og simulatoren virker uden videre. Skal du bruge USB-donglen, skal
Windows bruge en libusb-driver på den: kør [Zadig](https://zadig.akeo.ie/), vælg
din FTDI-enhed (USB-ID 0403 6001) og installér **libusbK**. Se afsnittet
**Output** i selve pulten for detaljer.
