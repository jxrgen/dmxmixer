@echo off
REM ====================================================================
REM  Bygger Lyspult til Windows: foerst en .exe med PyInstaller, saa et
REM  installationsprogram (Lyspult-Setup.exe) med Inno Setup.
REM
REM  Koeres paa en Windows-maskine. Krav:
REM    - Python 3.9+            https://www.python.org/downloads/
REM    - Inno Setup 6           https://jrsoftware.org/isdl.php
REM  Koer denne fil ved at dobbeltklikke den, eller i en kommandoprompt.
REM ====================================================================
setlocal
cd /d "%~dp0\.."

echo === Installerer byggevaerktoejer ===
python -m pip install --upgrade pip pyinstaller pyftdi pyusb || goto :err

echo === Bygger Lyspult.exe ===
python -m PyInstaller --noconfirm --clean ^
  --name Lyspult ^
  --windowed ^
  --icon "Windows_installation\icon.ico" ^
  --add-data "ui.html;." ^
  --add-data "ui.css;." ^
  --add-data "ui.js;." ^
  --add-data "sim.html;." ^
  --collect-submodules pyftdi ^
  --collect-submodules usb ^
  --hidden-import usb.backend.libusb1 ^
  dmxmixer.py || goto :err

echo === Bygger installationsprogrammet ===
where iscc >nul 2>nul
if errorlevel 1 (
  echo.
  echo Inno Setup ^(iscc^) blev ikke fundet i PATH.
  echo Installer det fra https://jrsoftware.org/isdl.php og koer igen,
  echo eller aabn Windows_installation\installer.iss i Inno Setup og tryk Compile.
  goto :err
)
iscc "Windows_installation\installer.iss" || goto :err

echo.
echo FAERDIG. Installationsprogrammet ligger i:  Windows_installation\output\Lyspult-Setup.exe
goto :eof

:err
echo.
echo Byggningen fejlede - se meddelelserne ovenfor.
exit /b 1
