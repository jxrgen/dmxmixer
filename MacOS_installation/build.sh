#!/bin/bash
# =====================================================================
#  Bygger Lyspult til macOS: en Lyspult.app med PyInstaller, pakket i en
#  Lyspult.dmg som man trækker til Programmer.
#
#  Køres på en Mac. Krav:
#    - Python 3.9+   (fx fra https://www.python.org/downloads/ eller brew)
#  Kør:  bash build.sh
# =====================================================================
set -e
cd "$(dirname "$0")/.."

echo "=== Installerer byggeværktøjer ==="
python3 -m pip install --upgrade pip pyinstaller pyftdi pyusb

echo "=== Bygger Lyspult.app ==="
python3 -m PyInstaller --noconfirm --clean \
  --name Lyspult \
  --windowed \
  --icon "MacOS_installation/icon.icns" \
  --osx-bundle-identifier dk.lyspult.app \
  --add-data "ui.html:." \
  --add-data "ui.css:." \
  --add-data "ui.js:." \
  --add-data "sim.html:." \
  --collect-submodules pyftdi \
  --collect-submodules usb \
  --hidden-import usb.backend.libusb1 \
  dmxmixer.py

echo "=== Bygger Lyspult.dmg ==="
STAGE="$(mktemp -d)"
cp -R "dist/Lyspult.app" "$STAGE/"
ln -s /Applications "$STAGE/Programmer"
rm -f "MacOS_installation/Lyspult.dmg"
hdiutil create -volname "Lyspult" -srcfolder "$STAGE" -ov -format UDZO \
  "MacOS_installation/Lyspult.dmg"
rm -rf "$STAGE"

echo
echo "FÆRDIG. Diskbilledet ligger i:  MacOS_installation/Lyspult.dmg"
echo "Træk Lyspult over i Programmer, når du åbner det."
