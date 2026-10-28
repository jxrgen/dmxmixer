#!/bin/bash
# =====================================================================
#  Bygger Lyspult til Linux (Mint/Ubuntu/Debian) som en .deb-pakke.
#  Pakken lægger programmet i /opt/lyspult, en menugenvej, et ikon og
#  udev-reglen til USB-donglen, så intet skal sættes op bagefter.
#
#  Køres på en Debian-baseret maskine. Krav:
#    sudo apt install python3 python3-pip python3-venv python3-tk
#  Kør:  bash build.sh
# =====================================================================
set -e
cd "$(dirname "$0")/.."
HERE="Linux_installation"
VERSION="1.0.0"

echo "=== Installerer byggeværktøjer ==="
python3 -m pip install --upgrade pip pyinstaller pyftdi pyusb pyserial

echo "=== Bygger programmet ==="
python3 -m PyInstaller --noconfirm --clean \
  --name Lyspult \
  --add-data "ui.html:." \
  --add-data "ui.css:." \
  --add-data "ui.js:." \
  --add-data "sim.html:." \
  --collect-submodules pyftdi \
  --collect-submodules usb \
  --hidden-import usb.backend.libusb1 \
  --collect-submodules serial \
  --hidden-import lc11 \
  --hidden-import lc11_driver \
  dmxmixer.py

echo "=== Bygger .deb ==="
PKG="$(mktemp -d)"
install -d "$PKG/opt/lyspult"
cp -R dist/Lyspult/. "$PKG/opt/lyspult/"
install -d "$PKG/usr/bin"
ln -sf /opt/lyspult/Lyspult "$PKG/usr/bin/lyspult"
install -Dm644 "$HERE/lyspult.desktop" "$PKG/usr/share/applications/lyspult.desktop"
install -Dm644 "$HERE/icon.png" "$PKG/usr/share/icons/hicolor/256x256/apps/lyspult.png"
install -Dm644 "$HERE/99-lyspult-ftdi.rules" "$PKG/lib/udev/rules.d/99-lyspult-ftdi.rules"

install -d "$PKG/DEBIAN"
cat > "$PKG/DEBIAN/control" <<EOF
Package: lyspult
Version: $VERSION
Section: sound
Priority: optional
Architecture: amd64
Maintainer: Joergen Holm <jxrgen@gmail.com>
Depends: libusb-1.0-0
Description: Lyspult - DMX-lysstyring
 Lagbaseret DMX-lyspult med browser-flade. Styr lamper fra computeren,
 en iPad eller en telefon paa samme netvaerk. Art-Net, sACN og Enttec
 Open DMX USB.
EOF

cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
# genindlaes udev-reglen for USB-donglen
if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
    udevadm trigger || true
fi
# opdater menu og ikoner
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
echo "Lyspult er installeret. Start den fra menuen, eller skriv 'lyspult'."
echo "Bruger du USB-donglen: log ud og ind igen, saa gruppen plugdev faar virkning."
exit 0
EOF
chmod 0755 "$PKG/DEBIAN/postinst"

chmod 755 "$PKG"
find "$PKG" -type d -exec chmod 755 {} +
chmod -R go-w "$PKG"
chmod 0755 "$PKG/DEBIAN/postinst"
OUT="$HERE/lyspult_${VERSION}_amd64.deb"
rm -f "$OUT"
dpkg-deb --build --root-owner-group "$PKG" "$OUT"
rm -rf "$PKG"

echo
echo "FÆRDIG. Pakken ligger i:  $OUT"
echo "Installer med:  sudo apt install ./$OUT"
