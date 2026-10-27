; ======================================================================
;  Inno Setup-script for Lyspult.
;  Pakker mappen dist\Lyspult (lavet af PyInstaller) til et
;  installationsprogram: Lyspult-Setup.exe.
;  Laver genvej i Start-menuen og paa skrivebordet og en regel i
;  Windows-firewallen, saa iPad og telefon kan naa pulten.
; ======================================================================

#define AppName "Lyspult"
#define AppVersion "1.0.0"
#define AppExe "Lyspult.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Joergen Holm
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
OutputDir=output
OutputBaseFilename=Lyspult-Setup
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
Name: "dansk"; MessagesFile: "compiler:Languages\Danish.isl"

[Tasks]
Name: "desktopicon"; Description: "Opret en genvej paa skrivebordet"; GroupDescription: "Genveje:"

[Files]
Source: "..\dist\Lyspult\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Afinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Luk porten op i Windows-firewallen, saa andre enheder paa netvaerket kan naa pulten.
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""Lyspult"" dir=in action=allow program=""{app}\{#AppExe}"" enable=yes profile=private"; Flags: runhidden; StatusMsg: "Aabner i Windows-firewallen..."
; Start pulten naar installationen er faerdig.
Filename: "{app}\{#AppExe}"; Description: "Start Lyspult nu"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Lyspult"""; Flags: runhidden
