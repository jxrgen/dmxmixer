# macOS-installation

Her ligger det, der skal til for at lave et diskbillede til Mac: **Lyspult.dmg**,
som man trækker over i Programmer.

## Den nemme vej: lad GitHub bygge den

Du behøver ikke en Mac. Gå til fanen **Actions** på GitHub, vælg **Byg
installationsfiler** og tryk **Run workflow**. Der bygges to udgaver:
`macOS-AppleSilicon` (M1/M2/M3 …) og `macOS-Intel`. Hent den, der passer til din
Mac. (Skubber du et versionsmærke som `v1.0.0`, lægges de i en Release.)

Er du i tvivl om chiptypen:  Æble-menuen → **Om denne Mac**. Står der "Apple
M…", er det Apple Silicon.

## Byg den selv på en Mac

1. Installer [Python 3.9+](https://www.python.org/downloads/) (eller `brew install python`).
2. Kør i Terminal:  `bash MacOS_installation/build.sh`

Resultatet lander i `MacOS_installation/Lyspult.dmg`. Det bygges til den chiptype,
Mac'en selv har.

## Installér og åbn

1. Åbn `.dmg`-filen og træk **Lyspult** over i **Programmer**.
2. Første gang: macOS blokerer programmet, fordi det ikke er underskrevet med et
   betalt Apple-udviklercertifikat. Sådan åbner du det alligevel:
   - Dobbeltklik Lyspult. Der kommer en advarsel — tryk **Færdig**.
   - Åbn **Systemindstillinger → Anonymitet og sikkerhed**.
   - Rul ned. Der står, at Lyspult blev blokeret. Tryk **Åbn alligevel**.

   (Ctrl-klik-genvejen til at springe dette over er fjernet i nyere macOS, så
   det skal gøres via Systemindstillinger.) Det skal kun gøres én gang.

Pulten åbner et lille vindue med adressen og en **Stop**-knap, og starter din
browser. Shows og egne temaer gemmes i `~/Library/Application Support/Lyspult`.

## USB-donglen (Enttec Open DMX USB)

Art-Net, sACN og simulatoren virker uden videre. Skal du bruge USB-donglen,
kræver den libusb på systemet:  `brew install libusb`.

## Vil du slippe for "Åbn alligevel"?

Det kræver et [Apple-udviklermedlemskab](https://developer.apple.com/programs/)
til 99 USD om året, så appen kan signeres og notariseres. Så åbner den normalt.
Det er ikke nødvendigt for at bruge pulten — kun for at undgå det ene ekstra trin
første gang.
