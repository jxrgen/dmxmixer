# Linux-installation

Her ligger det, der skal til for at lave en **.deb**-pakke til Linux Mint,
Ubuntu og andre Debian-baserede systemer.

## Den nemme vej: lad GitHub bygge den

Gå til fanen **Actions** på GitHub, vælg **Byg installationsfiler** og tryk
**Run workflow**. Hent så `Linux-deb`. (Skubber du et versionsmærke som
`v1.0.0`, lægges filen i en Release.)

## Byg den selv

```
sudo apt install python3 python3-pip python3-venv python3-tk
bash Linux_installation/build.sh
```

Resultatet lander i `Linux_installation/lyspult_1.0.0_amd64.deb`.

## Installér

```
sudo apt install ./lyspult_1.0.0_amd64.deb
```

Pakken:

- lægger programmet i `/opt/lyspult` og en kommando `lyspult`,
- opretter en menugenvej med ikon,
- lægger **udev-reglen** til USB-donglen ind, så den virker uden root,
- afhænger af `libusb-1.0-0`, som apt henter automatisk.

Start Lyspult fra menuen eller skriv `lyspult` i en terminal. Pulten åbner et
lille vindue med adressen og en **Stop**-knap. Shows og egne temaer gemmes i
`~/.local/share/Lyspult`.

## USB-donglen (Enttec Open DMX USB)

Udev-reglen giver adgang til donglen for brugere i gruppen **plugdev**. De fleste
er allerede med i den; er du ikke, så kør én gang:

```
sudo usermod -aG plugdev $USER
```

Log ud og ind igen, så det får virkning. Herefter virker donglen uden root.

## Afinstallér

```
sudo apt remove lyspult
```
