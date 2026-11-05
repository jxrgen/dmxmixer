/* lang.js – i18n for Lyspult / Pixelpult
   ES5-kompatibel (Safari 9 / iPad 3)
   Dansk er default; strengene bruges som nøgler. */
(function (root) {
"use strict";

var translations = {
  en: {
    /* ---- tabs ---- */
    "Guide": "Guide",
    "Pult": "Console",
    "Layout": "Layout",
    "Afvikling": "Playback",
    "Enkel": "Simple",
    "Patch": "Patch",
    "Mønstre": "Patterns",
    "Scener": "Scenes",
    "Output": "Output",
    "Show": "Show",
    "Indstillinger": "Settings",

    /* ---- top bar ---- */
    " — styrer lyset": " — controls the lights",
    "Lyspult · {name}": "Lightdesk · {name}",

    /* ---- master ---- */
    "fra": "off",
    "Grand": "Grand",
    "Tempo": "Tempo",
    "Blackout": "Blackout",
    "Frys": "Freeze",
    "Tap": "Tap",
    "Fuld": "Full",
    "Nul": "Zero",
    "Scene-tempo": "Scene tempo",
    "Synk alle lag": "Sync all layers",

    /* ---- master confirm/toast ---- */
    "Slå Følg tempo til på alle lag — både nu og i alle gemte scener?\n\nFarten regnes om, så intet ser anderledes ud før du tapper.":
      "Enable Follow tempo on all layers — both current and in all saved scenes?\n\nSpeed is recalculated so nothing looks different until you tap.",
    "{n} lag følger nu tempoet": "{n} layers now follow the tempo",

    /* ---- guide / wizard ---- */
    "Lamper": "Fixtures",
    "Farver": "Colours",
    "Gem og afvikl": "Save and play",
    "Start guiden forfra?\n\nDine valg i guiden nulstilles. Scener der allerede er oprettet, bliver liggende.":
      "Restart the guide?\n\nYour guide choices will be reset. Scenes already created will remain.",
    "Tilbage": "Back",
    "Næste": "Next",
    "Start forfra": "Start over",
    "Færdig — vis Afvikling": "Done — show Playback",
    "Færdig — vis Pult": "Done — show Console",
    "Færdig": "Done",
    "Trin {n} af {total}": "Step {n} of {total}",

    /* wizard step strings */
    "Hvor mange lamper har du?": "How many fixtures do you have?",
    "Hvad er det for lamper?": "What kind of fixtures?",
    "Hvor mange farver?": "How many colours?",
    "Vælg farver": "Choose colours",
    "Vælg roller": "Choose roles",
    "Giv lamperne roller": "Assign roles to fixtures",
    "Alle": "All",
    "Ingen": "None",
    "Ulige": "Odd",
    "Lige": "Even",
    "Vend om": "Invert",
    "Baggrund": "Background",
    "Effekt": "Effect",
    "Accent": "Accent",
    "Solo": "Solo",
    "Fyld": "Fill",
    "Tænd alle": "Turn all on",
    "Sluk alle": "Turn all off",

    /* ---- layers (Pult) ---- */
    "Tænd eller sluk laget": "Turn layer on or off",
    "Mønster": "Pattern",
    "Hvilket": "Which",
    "Fart": "Speed",
    "Størrelse": "Size",
    "Tæthed": "Density",
    "Hale": "Tail",
    "Hop": "Skip",
    "Fremad": "Forward",
    "Baglæns": "Reverse",
    "Spejlvend": "Mirror",
    "Følg tempo (tap)": "Follow tempo (tap)",
    "Farvekilde": "Colour source",
    "Farve": "Colour",
    "Tilføj stop": "Add stop",
    "Fjern stop": "Remove stop",
    "Cyklusfart": "Cycle speed",
    "Styrke": "Intensity",
    "Blanding": "Blend",
    "Retning": "Direction",
    "Forskydning": "Offset",
    "Mængde": "Amount",
    "Kopiér til": "Copy to",
    "Kopiér": "Copy",
    "Byt om": "Swap",
    "Nulstil dette lag": "Reset this layer",
    "Nulstil {name}?": "Reset {name}?",
    "Lag {n} nulstillet": "Layer {n} reset",
    "Lag {a} og {b} byttet om": "Layers {a} and {b} swapped",
    "Lag {src} kopieret til {dst}": "Layer {src} copied to {dst}",
    "Gem valg som gruppe": "Save selection as group",
    "Maske": "Mask",
    "Hue-fart": "Hue speed",
    "Hue-spredn.": "Hue spread",

    /* colour source options */
    "fast": "fixed",
    "gradient": "gradient",
    "regnbue": "rainbow",

    /* ---- strips (lamp bar) ---- */
    "På": "On",
    "Af": "Off",
    "Tændt": "On",
    "Slukket": "Off",
    "Lag": "Layer",
    "I lag": "In layer",
    "Kun": "Only",
    "Kun her": "Only here",
    "Tryk for at tænde lampen i dette lag": "Click to turn on the fixture in this layer",
    "Tryk for at slukke lampen i dette lag": "Click to turn off the fixture in this layer",
    "Skift: tænd lampen kun i dette lag (sluk i alle andre)": "Shift: turn on fixture only in this layer (off in all others)",
    "{n} lampe valgt": "{n} fixture selected",
    "{n} lamper valgt": "{n} fixtures selected",
    "Kompakt": "Compact",

    /* ---- groups (Pult) ---- */
    "Ingen grupper endnu. ": "No groups yet. ",
    "Lav grupper under Layout": "Create groups in Layout",
    "Gruppe": "Group",
    "{n} lampe": "{n} fixture",
    "{n} lamper": "{n} fixtures",

    /* ---- manual channels ---- */
    "Hvid": "White",
    "Amber": "Amber",
    "UV": "UV",
    "Stroboskop": "Strobe",
    "Varighed": "Duration",
    "Makro": "Macro",
    "Generisk": "Generic",
    "Kanal {n}": "Channel {n}",
    "Ingen faste kanaler": "No fixed channels",
    "Ingen lamper har faste kanaler (hvid, amber, UV, stroboskop, makro …). De styres i lagene ovenfor.":
      "No fixtures have fixed channels (white, amber, UV, strobe, macro …). They are controlled in the layers above.",

    /* ---- Enkel ---- */
    "Ingen lamper valgt. Tryk på en lampe for at styre den.":
      "No fixtures selected. Tap a fixture to control it.",
    "Alle valgt": "All selected",
    "{n} valgt": "{n} selected",
    "Vælg alle": "Select all",
    "Fravælg alle": "Deselect all",
    "Alt slukket": "All dark",
    "Gem som scene": "Save as scene",
    "Scene {n}": "Scene {n}",
    "Lysstyrke": "Brightness",

    /* ---- Patch ---- */
    "#": "#",
    "Adresse": "Address",
    "Kanaler": "Channels",
    "Type": "Type",
    "Navn": "Name",
    "Handling": "Action",
    "Tilføj": "Add",
    "Slet": "Delete",
    "Omdøb": "Rename",
    "Flyt op": "Move up",
    "Flyt ned": "Move down",
    "Adressér": "Address",
    "{count} lampe · {ch} kanaler · universum {u}": "{count} fixture · {ch} channels · universe {u}",
    "{count} lamper · {ch} kanaler · universum {u}": "{count} fixtures · {ch} channels · universe {u}",
    "Tilføj lamper": "Add fixtures",
    "Antal": "Quantity",
    "Universum": "Universe",
    "Start-adresse": "Start address",
    "Omnummerer alle": "Renumber all",
    "Automatisk": "Automatic",
    "Importér": "Import",
    "Lampebibliotek": "Fixture library",
    "Ny lampetype": "New fixture type",

    /* pixel bar */
    "Pixel bar": "Pixel bar",
    "Ny pixel bar": "New pixel bar",
    "Segmentets type": "Segment type",
    "Hvad ét segment er — typen beskriver ét segment, ikke hele baren.": "What one segment is — the type describes a single segment, not the whole bar.",
    "Der er ingen lampetyper med farvekanaler. Lav en under Lampetyper først.": "There are no fixture types with colour channels. Create one under Fixture types first.",
    "Antal segmenter": "Number of segments",
    "Spring": "Step",
    "Kanaler fra ét segment til det næste. 0 = lige efter hinanden (segmentets egen bredde). Sæt den højere, hvis baren har huller i sit kanalkort.": "Channels from one segment to the next. 0 = back to back (the segment's own width). Set it higher if the bar has gaps in its channel map.",
    "Bagvendt": "Reversed",
    "Segment 1 får den højeste adresse. Brug den, hvis baren er monteret omvendt af hvordan den er kablet.": "Segment 1 gets the highest address. Use it when the bar is mounted the opposite way from how it is wired.",
    "Vend adresserne": "Reverse the addresses",
    "Nulstil til springet": "Reset to the step",
    "Segmenternes adresser": "Segment addresses",
    "Sådan ligger de med de valg du har gjort. Når baren er oprettet, kan hver enkelt adresse rettes.": "How they will fall with the choices you have made. Once the bar exists, each address can be edited.",
    "Ret en adresse for at flytte netop det segment. Tom eller 0 følger springet fra start-adressen.": "Edit an address to move that one segment. Empty or 0 follows the step from the start address.",
    "Segment": "Segment",
    "Ret segmenternes adresser": "Edit the segment addresses",
    "I alt {ch} kanaler — fra {lo} til {hi}": "{ch} channels in total — from {lo} to {hi}",
    "{n} segmenter ligger uden for universet og sendes ikke.": "{n} segments fall outside the universe and are not sent.",
    "Opret pixel bar": "Create pixel bar",
    "Pixel bar oprettet med": "Pixel bar created with",
    "segmenter": "segments",
    "Kunne ikke oprette baren": "Could not create the bar",
    "Kunne ikke rette baren": "Could not change the bar",
    "Fjern baren": "Remove the bar",
    "En lampe med flere segmenter. Hvert segment har sin egen adresse, så du kan sætte dem præcis som baren er kablet.": "One fixture with several segments. Each segment has its own address, so you can set them exactly as the bar is wired.",

    /* patch editor */
    "Lampe {n} af {total}": "Fixture {n} of {total}",
    "Skift type": "Change type",
    "Brug denne type": "Use this type",
    "Luk": "Close",
    "Forrige": "Previous",
    "Kan ikke fjerne den sidste lampe": "Cannot remove the last fixture",

    /* lamp test */
    "Lampetest": "Fixture test",
    "Start lampetest": "Start fixture test",
    "Stop test": "Stop test",
    "Forrige lampe": "Previous fixture",
    "Næste lampe": "Next fixture",
    "Rød": "Red",
    "Grøn": "Green",
    "Blå": "Blue",
    "Kold hvid": "Cool white",
    "Varm hvid": "Warm white",
    "Alle farver": "All colours",
    "Dæmpning": "Dimming",
    "Fuld hvid": "Full white",
    "Sluk": "Off",
    "Adresse-brug": "Address usage",
    "Tip: Brug ← → piletasterne for at skifte lampe under testen.":
      "Tip: Use the ← → arrow keys to switch fixture during the test.",

    /* library */
    "Ingen match. Prøv et andet ord, eller importér en QLC+ .qxf-fil.":
      "No match. Try another word, or import a QLC+ .qxf file.",
    "Andet": "Other",
    "Tilføjet: ": "Added: ",
    "Kunne ikke læse profil-filen": "Could not read the profile file",
    "Kunne ikke læse QLC+-fixturen": "Could not read the QLC+ fixture",
    "Importeret: {name} — vælg mode og tryk Tilføj": "Imported: {name} — select mode and press Add",
    "Ukendt filformat": "Unknown file format",
    "Kanal ": "Channel ",
    "Lampe": "Fixture",
    "Importeret": "Imported",
    "Ingen lamper fundet i {name}": "No fixtures found in {name}",
    "Importeret {n} lamper fra {name}": "Imported {n} fixtures from {name}",
    "CSV mangler kolonnerne 'adresse' og 'kanaler'": "CSV is missing columns 'adresse' and 'kanaler'",

    /* ---- profile editor ---- */
    "Lampetype": "Fixture type",
    "Gem": "Save",
    "Gem som nyt tema…": "Save as new theme…",
    "Fortryd ændringer": "Undo changes",
    "Slet tema": "Delete theme",
    "Kopi oprettet — nu kan du rette i den": "Copy created — you can now edit it",
    "Slet lampetypen “{name}”?": "Delete fixture type “{name}”?",
    "Kan ikke slette: {err}": "Cannot delete: {err}",
    "Profil": "Profile",

    /* profile editor channel types */
    "Dimmer": "Dimmer",
    "Pan": "Pan",
    "Tilt": "Tilt",
    "Pan fin": "Pan fine",
    "Tilt fin": "Tilt fine",
    "Zoom": "Zoom",

    /* ---- groups UI (Layout) ---- */
    "Slet gruppen “{name}”? (lamperne bevares, kun gruppen fjernes)":
      "Delete the group “{name}”? (fixtures are kept, only the group is removed)",
    "Ny gruppe": "New group",
    "Redigér gruppe": "Edit group",
    "Gruppenavn": "Group name",
    "Tilføj markerede": "Add selected",
    "Fjern markerede": "Remove selected",

    /* ---- Layout ---- */
    "Stråler": "Beams",
    "Navne": "Names",
    "Vis alle": "Show all",
    "Skjul alle": "Hide all",
    "Nulstil pladser": "Reset positions",
    "Vælg/flyt": "Select/move",
    "Flyt visning": "Pan view",
    "Auto-layout": "Auto layout",
    "Gitter": "Grid",
    "Bue": "Arc",
    "Tilpas": "Snap",
    "▾ Skjul værktøjer": "▾ Hide tools",
    "▸ Vis værktøjer": "▸ Show tools",
    "⬚ Zoom område": "⬚ Zoom area",
    "Lås visning": "Lock view",
    "Rektangel": "Rectangle",
    "Cirkel": "Circle",
    "Trekant": "Triangle",
    "Slet valgt": "Delete selected",
    "Ryd alle former": "Clear all shapes",

    /* layout view settings */
    "Lys": "Light",
    "Lyspøl": "Light pool",
    "Intensitet": "Intensity",
    "Strålekraft": "Beam power",
    "Strålevinkel": "Beam angle",
    "Gulvlysstyrke": "Floor brightness",
    "Synlighed": "Visibility",

    /* ---- Afvikling (Playback) ---- */
    "Sæt look": "Set look",
    "Nulstil": "Reset",
    "Nulstil alle gruppe-looks i Afvikling? Alt styret herfra slukkes.":
      "Reset all group looks in Playback? Everything controlled from here will be turned off.",
    "Gemt som scene “{name}”": "Saved as scene “{name}”",
    "Navn på scenen": "Scene name",
    "Fade": "Fade",
    "Palette": "Palette",
    "Palet": "Palette",

    /* afvikling sections */
    "Position": "Position",
    "Gobo": "Gobo",

    /* ---- Scenes ---- */
    "Alle scener": "All scenes",
    "Animér denne flise": "Animate this tile",
    "Ingen scener endnu. Afslut live, sæt et look op og tryk Gem nuværende som scene.":
      "No scenes yet. Exit live, set up a look and press Save current as scene.",
    "Ingen scener i dette faneblad. Vælg et andet øverst.":
      "No scenes in this tab. Choose another one above.",
    "Kald": "Recall",
    "Opdatér": "Update",
    "Til cue": "To cue",
    "Hop til": "Jump to",
    "Slet scenen “{name}”?": "Delete scene “{name}”?",
    "Scene opdateret": "Scene updated",
    "Gem nuværende som scene": "Save current as scene",
    "Liste": "List",
    "Matrice": "Matrix",
    "Billede": "Image",
    "Faneblad": "Tab",
    "Forhåndsvis": "Preview",
    "Live": "Live",

    /* scene tabs */
    "Navn på det nye faneblad:": "Name for the new tab:",
    "Gruppe {n}": "Group {n}",
    "Nyt navn til fanebladet:": "New name for the tab:",
    "Det sidste faneblad kan ikke fjernes": "The last tab cannot be removed",
    "Fjern fanebladet {name}?": "Remove the tab {name}?",
    "De {n} scener i det flyttes til det første faneblad — de slettes ikke.":
      "The {n} scenes in it will be moved to the first tab — they are not deleted.",

    /* cue list */
    "Scene": "Scene",
    "Følg efter": "Follow after",
    "(scene mangler)": "(scene missing)",
    "{n} cues · ca. {s} s hvis alle blev kørt i træk med Auto-følg":
      "{n} cues · approx. {s} s if all are run in sequence with Auto-follow",
    "Ingen cues endnu. Tryk Til cue på en scene i listen ovenfor.":
      "No cues yet. Press To cue on a scene in the list above.",
    "Auto-følg": "Auto-follow",

    /* ---- Output ---- */
    "Art-Net": "Art-Net",
    "sACN (E1.31)": "sACN (E1.31)",
    "Broadcast": "Broadcast",
    "Host": "Host",
    "Prioritet": "Priority",
    "Enttec USB DMX": "Enttec USB DMX",
    "Port": "Port",
    "Scan": "Scan",
    "(ingen enhed fundet)": "(no device found)",
    "Søgte efter enheder": "Scanned for devices",
    "DMX-kig": "DMX view",
    "Opdateringshastighed": "Refresh rate",
    "Art-Net base-universum": "Art-Net base universe",
    "Strømbesparende": "Power saving",

    /* ---- Show ---- */
    "Ingen gemte shows.": "No saved shows.",
    "Indlæst: {name}": "Loaded: {name}",
    "Slet {name}?": "Delete {name}?",
    "Gemt": "Saved",
    "Kunne ikke gemme": "Could not save",
    "Nyt show? Alt ugemt går tabt.": "New show? All unsaved changes will be lost.",
    "Nyt show": "New show",
    "Gem show": "Save show",
    "Eksportér": "Export",
    "Importér show": "Import show",
    "Filen kunne ikke læses": "The file could not be read",
    "Hentet: {name}": "Loaded: {name}",
    "Kunne ikke hente": "Could not load",

    /* ---- Sceneplaner ---- */
    "Ingen sceneplaner gemt endnu.": "No stage plans saved yet.",
    "2D-sceneplaner": "2D stage plans",
    "3D-sceneplaner": "3D stage plans",
    "Navn på sceneplanen": "Stage plan name",
    "Gem 2D-sceneplan": "Save 2D stage plan",
    "Gem 3D-sceneplan": "Save 3D stage plan",
    "Hent": "Load",

    /* ---- Settings / Help ---- */
    "Indstillinger og hjælp": "Settings and help",
    "Udseende": "Appearance",
    "Tema": "Theme",
    "Egne temaer": "Custom themes",
    "Du har ændret farver uden at gemme. Kassér ændringerne?":
      "You have changed colours without saving. Discard the changes?",
    "▾ Avanceret": "▾ Advanced",
    "▸ Avanceret": "▸ Advanced",
    "Tekst på baggrund": "Text on background",
    "Tekst i rammer": "Text on panels",
    "Tekst på knapper": "Text on buttons",
    "Dæmpet tekst": "Muted text",
    "Tekst på det fremhævede": "Text on highlights",
    "Tekst på advarsler": "Text on warnings",
    "— svær at læse": "— hard to read",
    "Kan det læses?": "Is it readable?",
    "Rammer": "Panels",
    "Knapper, felter og skydere": "Buttons, fields and sliders",
    "Kanter og streger": "Borders and lines",
    "Tekst": "Text",
    "Svag tekst": "Dim text",
    "Fremhævning": "Highlights",
    "Valgte knapper, skyderknop, overskrifter": "Selected buttons, slider thumb, headings",
    "Advarsler og blackout": "Warnings and blackout",
    "OK og solo": "OK and solo",
    "Flader": "Surfaces",

    /* theme save/delete */
    "Navn på det nye tema:": "Name for the new theme:",
    "Slet temaet “{name}”?": "Delete the theme “{name}”?",
    "Temaet “{name}” slettet": "Theme “{name}” deleted",

    /* ---- Control (CTRL) ---- */
    "Styring": "Control",
    "Lad styre": "Let control",
    "Stop styring": "Stop controlling",
    "Ingen styring": "No control",
    "Nu styrer {names} lyset": "Now {names} controls the lights",
    "Overtagelse": "Takeover",
    "Tag over": "Take over",
    "Denne enhed styrer ikke lyset.": "This device is not controlling the lights.",
    "Tryk Lad styre for at tage over.": "Press Let control to take over.",
    "styrer lyset": "controls the lights",
    "styrer ikke lyset — tryk Lad styre": "not controlling the lights — press Let control",
    "ingen scene klar": "no scene ready",
    "næste: ": "next: ",

    /* ---- LC-11 ---- */
    "LC-11 er slået til": "LC-11 is enabled",
    "Brug LC-11": "Use LC-11",
    "Slå LC-11 til for at bruge panelet": "Enable LC-11 to use the panel",
    "Henter status…": "Fetching status…",
    "LC-11 kan ikke bruges: ": "LC-11 cannot be used: ",
    "Slået fra": "Disabled",
    "Panelet er tilsluttet": "Panel is connected",
    "Find selv (NewTek Control Surface)": "Auto-detect (NewTek Control Surface)",
    " (ikke fundet)": " (not found)",
    "Sidste input: ": "Last input: ",
    "side {page} af {pages}": "page {page} of {pages}",
    "Knap 1": "Knob 1",
    "Knap 2": "Knob 2",
    "Knap 3": "Knob 3",
    "T-bar": "T-bar",
    "før til ": "move to ",
    "Transition": "Transition",
    "Overlay": "Overlay",
    "Tom tast": "Empty key",
    " (lyser)": " (lit)",
    " (scene klar)": " (scene ready)",
    "Drejeknap": "Rotary knob",
    "Drej ned": "Turn down",
    "Drej op": "Turn up",
    "Tryk på knappen": "Press the button",
    "Lyser når T-baren styrer noget, blinker når den skal føres hen til værdien":
      "Lights up when the T-bar controls something, blinks when it needs to be moved to the value",
    "Joystick 1": "Joystick 1",
    "Joystick 2": "Joystick 2",
    " — ikke i brug": " — not in use",

    /* LC-11 settings */
    "Startkanal": "Start channel",
    "Pickup-tilstand": "Pickup mode",
    "Invertér T-bar": "Invert T-bar",
    "Invertér encodere": "Invert encoders",
    "Følsomhed": "Sensitivity",
    "Vis bjælke": "Show bar",
    "Vis markeringer": "Show markings",
    "Følg faner": "Follow tabs",
    "Test lamper": "Test lamps",

    /* ---- reset dialog ---- */
    "Nulstil show": "Reset show",
    "Vil du nulstille hele showet? Alle scener, lamper og indstillinger slettes.":
      "Do you want to reset the entire show? All scenes, fixtures and settings will be deleted.",
    "Vil du gemme en sikkerhedskopi først?": "Do you want to save a backup first?",
    "Gem kopi og nulstil": "Save copy and reset",
    "Nulstil uden kopi": "Reset without copy",
    "Annullér": "Cancel",

    /* ---- patterns ---- */
    "Eget {n}": "Custom {n}",
    "Trin": "Steps",
    "Pensel": "Brush",
    "Udjævn": "Smooth",
    "Inverter": "Invert",
    "Ryd": "Clear",
    "Nyt mønster": "New pattern",
    "Slet mønster": "Delete pattern",

    /* ---- live matrix ---- */
    "Afslut live": "Exit live",
    "Animér alle": "Animate all",

    /* ---- dialogs / prompts / toasts ---- */
    "OK": "OK",
    "Ja": "Yes",
    "Nej": "No",
    "Fejl": "Error",
    "Advarsel": "Warning",
    "Annuller": "Cancel",

    /* ---- sim.html (2D simulator) ---- */
    "2D-simulator": "2D Simulator",
    "forbinder…": "connecting…",
    "{n} lamper · {fps} fps · zoom {pct}%": "{n} fixtures · {fps} fps · zoom {pct}%",
    "ingen forbindelse til pulten": "no connection to the desk",
    "Ingen forbindelse — kører lyspulten?": "No connection — is the lightdesk running?",
    "Gulv": "Floor",
    "Editor": "Editor",
    "✋ Flyt visning": "✋ Pan view",
    "Navn til/fra": "Names on/off",
    "Fuldskærm": "Fullscreen",
    "◳ 3D-simulator": "◳ 3D simulator",
    "Drejet": "Rotated",
    "Indstillingerne deles med Layout i pulten.":
      "Settings are shared with Layout in the desk.",
    "Tændt — tryk for at slukke": "On — press to turn off",
    "Slukket — tryk for at tænde": "Off — press to turn on",

    /* sim.html scene plans */

    /* ---- sim3d.html (3D simulator) ---- */
    "3D-simulator": "3D Simulator",
    "Truss": "Truss",
    "Bord": "Table",
    "Stol": "Chair",
    "Gardin": "Curtain",
    "Scenekant": "Stage edge",
    "Væg": "Wall",
    "Platform": "Platform",
    "Trappe": "Stairs",
    "Rampe": "Ramp",
    "Kamera": "Camera",
    "Perspektiv": "Perspective",
    "Ovenfra": "Top view",
    "Forfra": "Front view",
    "Fri": "Free",
    "Fortryd": "Undo",
    "Gentag": "Redo",
    "Gruppér": "Group",
    "Opløs gruppe": "Ungroup",
    "Indsæt": "Paste",
    "Valgt: ": "Selected: ",

    /* ---- common / shared ---- */
    "kun simulering": "simulation only",
    "Sprog": "Language",
    "Dansk": "Danish",
    "Engelsk": "English",

    /* ---- help section headings ---- */
    "Kom i gang": "Getting started",
    "Guiden": "The guide",
    "Lagene": "The layers",
    "Lag-indstillinger": "Layer settings",
    "Enkel tilstand": "Simple mode",
    "Cue-listen": "The cue list",
    "Lampetyper": "Fixture types",
    "Genvejstaster": "Keyboard shortcuts",
    "LC-11 panel": "LC-11 panel",

    /* ---- help section body text (ui.html) ---- */
    "Åbn guiden i den første fane for at komme hurtigt i gang. Den leder dig igennem opsætningen trin for trin.":
      "Open the guide in the first tab to get started quickly. It walks you through the setup step by step.",
    "Lyspulten er bygget op om lag, ligesom lagene i et billedredigeringsprogram. Hvert lag kan tænde et sæt lamper med sit eget mønster, sin egen fart og sine egne farver. Lagene blandes oveni hinanden – det øverste lag har forrang.":
      "The lightdesk is built around layers, like layers in an image editor. Each layer can turn on a set of fixtures with its own pattern, speed and colours. The layers mix on top of each other — the top layer takes priority.",
    "Brug Pult-fanen til at styre lagene. Hvert lag har en tænd/sluk-knap, en mønstervælger, fart- og størrelsesknapper og en farvevælger.":
      "Use the Console tab to control the layers. Each layer has an on/off button, a pattern selector, speed and size controls and a colour picker.",
    "Tryk Tap for at indstille tempoet. Alle lag der har Følg tempo slået til, synkroniserer til det tempo du tapper.":
      "Press Tap to set the tempo. All layers with Follow tempo enabled will synchronise to the tempo you tap.",
    "Brug Layout-fanen til at placere lamperne, så du kan se dem i simulatoren. Træk lamperne rundt, eller brug Auto-layout, Gitter eller Bue til at placere dem automatisk.":
      "Use the Layout tab to position the fixtures so you can see them in the simulator. Drag the fixtures around, or use Auto layout, Grid or Arc to position them automatically.",
    "Afvikling giver dig en oversigt over alle grupper og lader dig sætte et look op for hver gruppe med mønster, farve og dimmer. Tryk Gem for at gemme det hele som en scene.":
      "Playback gives you an overview of all groups and lets you set up a look for each group with pattern, colour and dimmer. Press Save to save it all as a scene.",
    "Enkel tilstand giver hurtig styring: tryk på de lamper du vil styre, vælg en farve og justér lysstyrken.":
      "Simple mode gives you quick control: tap the fixtures you want to control, pick a colour and adjust the brightness.",
    "Scener gemmer hele billedet — alle lag, alle gruppe-looks, master og lampeniveauer. Du kan kalde en scene op igen med ét tryk.":
      "Scenes save the entire picture — all layers, all group looks, master and fixture levels. You can recall a scene with a single tap.",
    "Cue-listen lader dig lægge scener i rækkefølge og køre dem med fade-tider. Tryk Til cue for at tilføje en scene til listen.":
      "The cue list lets you put scenes in order and run them with fade times. Press To cue to add a scene to the list.",
    "Under Output finder du indstillingerne for Art-Net, sACN og Enttec USB. Tænd den protokol du bruger, og angiv værten.":
      "Under Output you find the settings for Art-Net, sACN and Enttec USB. Enable the protocol you use and enter the host.",
    "Under Show kan du gemme og indlæse hele showet, eksportere det som JSON og importere fra en fil.":
      "Under Show you can save and load the entire show, export it as JSON and import from a file.",
    "Lampetest tænder én lampe ad gangen, så du kan kontrollere at adresserne er rigtige. Brug ← → piletasterne til at skifte lampe.":
      "Fixture test turns on one fixture at a time so you can verify that the addresses are correct. Use the ← → arrow keys to switch fixture.",

    /* strobeTxt */
    "Hz": "Hz",

    /* Du har ændringer der ikke er gemt. Kassér dem? */
    "Du har ændringer der ikke er gemt. Kassér dem?":
      "You have unsaved changes. Discard them?",

    /* ---- misc dynamic strings ---- */
    "Tilpas zoom": "Fit zoom",
    "Nulstil visning": "Reset view",

    /* ---- static UI elements (data-t in ui.html) ---- */
    "gælder kun denne skærm": "applies to this screen only",
    "byg dit eget show trin for trin": "build your own show step by step",
    "◀ Tilbage": "◀ Back",
    "Næste ▶": "Next ▶",
    "Faste kanaler": "Manual channels",
    "rammer lamperne i det lag du redigerer": "affects the fixtures in the layer you are editing",
    "gul kant = hele gruppen er med i det lag du redigerer": "yellow border = entire group is in the layer you are editing",
    "gul kant = med i det lag du redigerer": "yellow border = included in the layer you are editing",
    "Kompakt visning": "Compact view",
    "Scenegulv": "Stage floor",
    "træk lamperne derhen hvor de hænger": "drag the fixtures to where they hang",
    "Stil på række": "Arrange in a row",
    "Stil i gitter": "Arrange in a grid",
    "Bue bag scenen": "Arc behind stage",
    "Snap til ½ meter": "Snap to ½ metre",
    "Flyt lamper": "Move fixtures",
    "Flyt former": "Move shapes",
    "Slet form": "Delete shape",
    "⬚ Vælg lamper": "⬚ Select fixtures",
    "+ Gruppe": "+ Group",
    "Slet gruppe": "Delete group",
    "Vis alle navne": "Show all names",
    "Skjul alle navne": "Hide all names",
    "Nulstil navnepladser": "Reset name positions",
    "Lås zoom og panorering, så visningen bliver stående": "Lock zoom and panning so the view stays fixed",
    "◱ 2D-simulator": "◱ 2D simulator",
    "Drej lampe": "Rotate fixture",
    "Navnefarve": "Name colour",
    "Grupper:": "Groups:",
    "Farvetema": "Colour theme",
    "Pultens egne": "Desk themes",
    "I stil med kendte flader": "Inspired by well-known interfaces",
    "Rav": "Amber",
    "Nat": "Night",
    "Kontrast": "Contrast",
    "Skift af styring": "Control transfer",
    "Spørg om farverne skal overtages": "Ask whether to take over the colours",
    "Overtag altid de farver der lyser": "Always take over the current colours",
    "Overtag aldrig farverne": "Never take over the colours",
    "NewTek LiveControl som styring af pulten": "NewTek LiveControl as desk controller",
    "◀ Forrige": "◀ Previous",
    "GO ▶": "GO ▶",
    "1–9 kalder · mellemrum GO · T tap · B blackout · Esc ud": "1–9 recall · space GO · T tap · B blackout · Esc exit",
    "Overtag farverne?": "Take over colours?",
    "Nulstil setup": "Reset setup",
    "Redigér palette": "Edit palette",
    "Fixture-bibliotek": "Fixture library",
    "Søg lampe eller mærke…": "Search fixture or brand…",
    "DMX ud": "DMX out",
    "Valget gemmes i browseren. Hjælpeteksten er kun på dansk.": "The choice is saved in the browser. Help text is in Danish only.",

    /* ---- dynamic strings wrapped with t() in ui.js ---- */
    "Gemt som scene \u201c{name}\u201d": "Saved as scene \u201c{name}\u201d",
    "Slet lampetypen \u201c{name}\u201d?": "Delete fixture type \u201c{name}\u201d?",
    "Kan ikke slette: ": "Cannot delete: ",
    "Prøv": "Try",
    "Farve 1": "Colour 1",
    "Farve 2": "Colour 2",
    "Til": "On",
    "Fra": "Off",
    "Sluk alle andre lag imens": "Mute all other layers",
    "omg./slag": "rev./beat",
    "Kører i": "Runs in",
    "Hver lampe": "Each fixture",
    "Rummet": "The room",
    "til": "on",
    "Overskriv det valgte lag med dette lags indstillinger": "Overwrite the selected layer with this layer's settings",
    "Lag kopieret": "Layer copied",
    "Lag byttet": "Layer swapped",
    "Navn på gruppen": "Name of the group",
    "Maske — hvilke lamper laget rammer:": "Mask — which fixtures the layer affects:",
    "Simulerer at strømmen tages af lampen": "Simulates power being cut to the fixture",
    "Tag lampen med i det lag du redigerer": "Include the fixture in the layer you are editing",
    "Lad laget ramme kun denne lampe": "Let the layer affect only this fixture",
    "Ingen grupper endnu.": "No groups yet.",
    "lampe": "fixture",
    "lamper": "fixtures",
    "Lysstyrke for": "Brightness for",
    "gruppen": "the group",
    "Tænd eller sluk alle lamper i gruppen": "Turn all fixtures in the group on or off",
    "Tag hele gruppen med i det lag du redigerer": "Include the entire group in the layer you are editing",
    "Ravgul": "Amber",
    "Blinkvarighed": "Flash duration",
    "Ekstra": "Extra",
    "De valgte lamper har ingen manuelle kanaler.": "The selected fixtures have no manual channels.",
    "Ingen lamper i lagets maske.": "No fixtures in the layer mask.",
    "Nr.": "No.",
    "Univ": "Univ",
    "Adr": "Addr",
    "Kan.": "Ch.",
    "Slut": "End",
    "Vis navn": "Show name",
    "Træk for at flytte lampen op eller ned": "Drag to move the fixture up or down",
    "Skjult": "Hidden",
    "Vist": "Shown",
    "kan.": "ch.",
    "nuværende": "current",
    "Sat til": "Set to",
    "Mindst én skal styre lyset": "At least one must control the lights",
    "Flere styrer samtidig:": "Multiple controlling simultaneously:",
    "DMX ud er slået fra": "DMX output is disabled",
    "Slå til": "Enable",
    "BLACKOUT": "BLACKOUT",
    "Slå fra": "Disable",
    "Billedet er frosset": "The image is frozen",
    "Strobe er slået til": "Strobe is enabled",
    "1 lampe er": "1 fixture is",
    "lamper er": "fixtures are",
    "slukket eller skruet ned i Pult → Lamper": "turned off or dimmed in Mixer → Fixtures",
    "Vis": "Show",
    "DMX-udgang": "DMX output",
    "Lampetest sender på": "Fixture test transmitting on",
    "Kanaltest kører": "Channel test running",
    "Nu styrer": "Now",
    "sammen": "control together",
    "lyset": "controls the lights",
    "med farverne der lyste": "with the colours that were showing",
    "{name} styrer nu lyset": "{name} now controls the lights",
    "Snap": "Snap",
    "Skift med det samme": "Change instantly",
    "Ton over {n} sekunder": "Fade over {n} seconds",
    "Hvem styrer lyset": "Who controls the lights",
    "Lad": "Let",
    "styre lyset": "control the lights",
    "Flere på én gang: tryk på de styringer der skal styre sammen": "Multiple at once: press the controls that should work together",
    "Flere": "Multiple",
    "Styrer": "Controls",
    "styrer ikke lyset lige nu — det gør": "is not controlling the lights right now —",
    "Det du ændrer her, ses først på lamperne når": "Changes you make here won't show on the fixtures until",
    "styrer.": "is controlling.",
    "styre med": "control too",
    "styre": "control",
    "Enkel styrer ikke lyset — tryk “Lad Enkel styre” øverst": "Simple is not controlling the lights — press “Let Simple control” at the top",
    "Tryk først på de lamper du vil styre": "First press the fixtures you want to control",
    "overtager styringen fra": "takes over control from",
    "Skal": "Should",
    "starte med de farver, der lyser nu? Så står lyset stille ved skiftet, og du kan rette videre derfra. Ellers viser": "start with the colours currently showing? The lights will stay still during the switch, and you can adjust from there. Otherwise",
    "det, den selv havde.": "shows what it had before.",
    "Husk mit valg på denne skærm (kan ændres under Indstillinger)": "Remember my choice on this screen (can be changed in Settings)",
    "Ja, overtag farverne": "Yes, take over the colours",
    "Nej, brug": "No, use",
    "s egne": "'s own",
    "Avanceret": "Advanced",
    "svær at læse": "hard to read",
    "Du retter i": "You are editing",
    "Ændringerne ses med det samme, men gemmes først, når du trykker Gem.": "Changes are shown immediately but are only saved when you press Save.",
    "Det er et fast tema og kan ikke ændres — gem dine ændringer som et eget tema.": "It is a fixed theme and cannot be changed — save your changes as a custom theme.",
    "Navn på temaet (findes det i forvejen blandt dine egne, kan du overskrive det):": "Name of the theme (if it already exists among yours, you can overwrite it):",
    "Der findes allerede et tema der hedder": "There is already a theme called",
    "Vil du overskrive det?": "Do you want to overwrite it?",
    "Slet temaet": "Delete the theme",
    "Skærme der bruger det, skifter til": "Screens using it will switch to",
    "Kunne ikke gemme temaet": "Could not save the theme",
    "gemmer…": "saving…",
    "Gemt — du kan fortsætte senere": "Saved — you can continue later",
    "Riggen er ændret siden sidst. Guiden har givet de nye eller ændrede lamper en rolle — tjek trin 1.": "The rig has changed. The guide has assigned roles to new or changed fixtures — check step 1.",
    "Velkommen tilbage. Du fortsætter hvor du slap": "Welcome back. You continue where you left off",
    "Du har en guide i gang fra sidst": "You have a guide in progress from last time",
    "Du var nået til trin": "You had reached step",
    "Fortsæt hvor jeg slap": "Continue where I left off",
    "Kunne ikke hente guiden": "Could not load the guide",
    "Velkommen tilbage. Lamper, scener og dine valg er hentet ind igen.": "Welcome back. Fixtures, scenes and your choices have been restored.",
    "Start en ny guide": "Start a new guide",
    "Fortsæt henter hele opsætningen fra sidst ind — lamper, scener og guidens valg — og erstatter det der er åbent nu. Start en ny guide bruger de lamper, der er i Patch lige nu.": "Continue restores the entire setup from last time — fixtures, scenes and guide choices — and replaces what is currently open. Start a new guide uses the fixtures currently in Patch.",
    "Vises nu på lamperne": "Now showing on the fixtures",
    "Der er ingen lamper endnu. Opret dem under Patch først — så kommer du tilbage hertil.": "There are no fixtures yet. Create them under Patch first — then you'll come back here.",
    "Gå til Patch": "Go to Patch",
    "Guiden har fundet": "The guide has found",
    "lamper i Patch. Fortæl hvad de skal bruges til — så ved guiden hvilke lamper der skal have farver, hvilke der skal lyse på musikerne, og hvilke den skal lade være. Den har allerede gættet ud fra lampetyperne.": "fixtures in Patch. Tell the guide what they should be used for — so it knows which fixtures need colours, which should light the musicians, and which to leave alone. It has already guessed from the fixture types.",
    "Hele typer på én gang": "Whole types at once",
    "Eller lampe for lampe — tryk på en lampe for at flytte den": "Or fixture by fixture — tap a fixture to move it",
    "Bemærk: der er lamper uden farver (fx hvide spots) under Farvelys eller Baggrund. De lyser bare hvidt med i takt.": "Note: there are fixtures without colours (e.g. white spots) under Colour light or Background. They just shine white in sync.",
    "Vælg showets to hovedfarver. Farve 1 bruges på farvelyset, farve 2 på baggrunden og som modfarve i effekterne. Du kan senere give enkelte scener andre farver.": "Choose the show's two main colours. Colour 1 is used for colour lights, colour 2 for background and as a contrasting colour in effects. You can give individual scenes other colours later.",
    "Færdige farvesæt": "Ready-made colour sets",
    "Eller vælg selv": "Or choose your own",
    "Se farverne på lamperne": "See the colours on the fixtures",
    "Her er de scener, du får at spille med. Rækkefølgen her bliver rækkefølgen i live-matrixen, og de første ni kan kaldes med tasterne 1–9. Giv dem gerne navne efter jeres numre, og tryk Prøv for at se en scene på lamperne.": "Here are the scenes you get to play with. The order here becomes the order in the live matrix, and the first nine can be recalled with keys 1–9. Feel free to name them after your songs, and press Try to see a scene on the fixtures.",
    "Ingen scener endnu — tilføj nogle herunder.": "No scenes yet — add some below.",
    "Tilføj scene:": "Add scene:",
    "Tip: Har I flere numre i samme stil, så tilføj den samme slags scene flere gange og giv dem numrenes navne.": "Tip: If you have several songs in the same style, add the same kind of scene multiple times and name them after the songs.",
    "Effekterne i scenerne (chase, puls, skift) kan følge musikkens tempo. Så tapper du bare takten under koncerten, og lyset følger med — også i den scene der kører.": "The effects in the scenes (chase, pulse, switch) can follow the music's tempo. Then you just tap the beat during the concert, and the lights follow — including in the running scene.",
    "Ja, lyset skal følge musikkens tempo (anbefalet)": "Yes, the lights should follow the music's tempo (recommended)",
    "Nej, effekterne kører i fast fart": "No, the effects run at a fixed speed",
    "Kender du ikke tempoet, så lad det stå på 120. Det er kun et udgangspunkt — ": "If you don't know the tempo, leave it at 120. It's just a starting point — ",
    "De lægges i deres eget faneblad under Scener, så dine andre scener ikke røres.": "They are placed in their own tab under Scenes, so your other scenes are not touched.",
    "Effekterne følger tempoet (start": "The effects follow the tempo (start",
    "Effekterne kører i fast fart": "The effects run at a fixed speed",
    "Opdatér scenerne": "Update the scenes",
    "Opret scenerne": "Create the scenes",
    "er beholdt uændret, fordi du selv har rettet i": "was kept unchanged because you edited",
    "den": "it",
    "dem": "them",
    "under Scener.": "under Scenes.",
    "Har du rettet noget i guiden, så tryk Opdatér scenerne.": "If you changed something in the guide, press Update the scenes.",
    "Tryk på en flise for at skifte scene — eller tasterne 1–9.": "Tap a tile to switch scene — or keys 1–9.",
    "Tap takten med T eller knappen TAP, så følger effekterne musikken.": "Tap the beat with T or the TAP button, and the effects follow the music.",
    "Effekterne kører i fast fart.": "The effects run at a fixed speed.",
    "B eller Blackout gør alt mørkt med det samme. Tryk igen for at tænde.": "B or Blackout turns everything dark immediately. Press again to turn on.",
    "Esc eller Afslut live går tilbage hertil.": "Esc or Exit live returns to this view.",
    "Gul": "Yellow",
    "Lilla": "Purple",
    "Hvid LED (W)": "White LED (W)",
    "Ravgul (A)": "Amber (A)",
    "Rød → grøn → blå → gul → lilla → hvid": "Red → green → blue → yellow → purple → white",
    "Rød → grøn → blå": "Red → green → blue",
    "Én farvekanal ad gangen: R → G → B → W → A → UV": "One colour channel at a time: R → G → B → W → A → UV",
    "Hvid / slukket (reagerer lampen overhovedet?)": "White / off (does the fixture respond at all?)",
    "Egen sekvens…": "Custom sequence…",
    "Univers": "Universe",
    "Hent adressen fra en lampe…": "Get the address from a fixture…",
    "Ingen lamper i riggen": "No fixtures in the rig",
    "Hent adressen fra en lampe": "Get the address from a fixture",
    "Sekvens": "Sequence",
    "Tid pr. farve": "Time per colour",
    "Opsætning": "Profile",
    "Standardopsætninger": "Standard profiles",
    "■ Stop test": "■ Stop test",
    "▶ Start test": "▶ Start test",
    "◀ Trin": "◀ Step",
    "❚❚ Pause": "❚❚ Pause",
    "▶ Fortsæt": "▶ Resume",
    "Trin ▶": "Step ▶",
    "Start testen og tryk Næste, indtil lampen lyser i den farve der står i den store boks. Så passer opsætningen — tryk på knappen nedenfor for at give lampen den. Testen sender kun på de kanaler opsætningen fylder, og gør det oven i alt andet (også blackout). Piletasterne ← → skifter opsætning, mens testen kører. Den stopper når du forlader Patch, og af sig selv efter 10 minutter.": "Start the test and press Next until the fixture shows the colour in the large box. Then the profile matches — press the button below to assign it. The test sends only on the channels the profile uses and overrides everything else (including blackout). Arrow keys ← → switch profile while the test is running. It stops when you leave Patch, and automatically after 10 minutes.",
    "Tom — tilføj farver nedenfor.": "Empty — add colours below.",
    "Klik for at fjerne": "Click to remove",
    "Tilføj:": "Add:",
    "Højst 32 trin": "Maximum 32 steps",
    "Fra paletten:": "From the palette:",
    "Ryd sekvensen": "Clear the sequence",
    "opsætningen løber ud over kanal 512.": "the profile exceeds channel 512.",
    "ingen lamper er patchet her. Testen sender direkte på adressen.": "no fixtures are patched here. The test sends directly to the address.",
    "her sidder:": "located here:",
    "DMX ud er slået fra, så testen når ikke ud til lamperne.": "DMX output is disabled, so the test won't reach the fixtures.",
    "Slå DMX ud til": "Enable DMX output",
    "har allerede denne opsætning.": "already has this profile.",
    "Bemærk: den vil overlappe en lampe der allerede er patchet.": "Note: it will overlap a fixture that is already patched.",
    "Testen kører ikke": "Test is not running",
    "Lampen skal nu lyse": "The fixture should now show",
    "Riggen tømmes, så du kan bygge et nyt setup op fra bunden.": "The rig is cleared so you can build a new setup from scratch.",
    "Kunne ikke nulstille": "Could not reset",
    "Styres af pulten (lysstyrke)": "Controlled by the mixer (brightness)",
    "Fast kanal — sættes i Pult": "Fixed channel — set in Mixer",
    "Sender altid standardværdien": "Always sends the default value",
    "Holdes på standardværdien": "Held at the default value",
    "Egne lampetyper": "Custom fixture types",
    "Indbyggede": "Built-in",
    "Ikke gemt": "Unsaved",
    "+ Tilføj kanal": "+ Add channel",
    "Gem lampetype": "Save fixture type",
    "Lampetype gemt": "Fixture type saved",
    "Egen lampe": "Custom fixture",
    "Ny lampetype oprettet — ret navn og kanaler": "New fixture type created — edit name and channels",
    "Indhold og rækkefølge (= nummerering til chase)": "Contents and order (= numbering for chase)",
    "Ingen medlemmer endnu. Tilføj lamper eller grupper herunder.": "No members yet. Add fixtures or groups below.",
    "Tilføj grupper (indlejring)": "Add groups (nesting)",
    "Alle lamper er med.": "All fixtures are included.",
    "Gem gruppe": "Save group",
    "Opret gruppe": "Create group",
    "Mønster og bevægelse": "Pattern and motion",
    "Vælg en lampe eller en gruppe — i oversigten, eller i gruppe-kolonnen ved siden af. Tasterne 1–9 og 0 vælger en gruppe direkte.": "Select a fixture or a group — in the overview, or in the group column next to it. Keys 1–9 and 0 select a group directly.",
    "Fjern dette looks styring": "Remove this look's control",
    "Overgangstid": "Transition time",
    "Gælder når du trykker på et farvefelt — så toner lyset blødt over. Tiden hører til dette valg og huskes, når du vælger gruppen igen.": "Applies when you tap a colour swatch — the light fades smoothly. The time belongs to this selection and is remembered when you select the group again.",
    "Farvefelt": "Colour field",
    "Skydere": "Sliders",
    "Paletter": "Palettes",
    "Aktuel farve": "Current colour",
    "Faste farvekanaler": "Fixed colour channels",
    "Sluk dem alle": "Turn them all off",
    "Lamper med hvid, ravgul eller UV lyser også med dem. De hører til dette valg — står de på 0, er det kun R/G/B der bestemmer farven. De dæmpes med lysstyrken og slukker ved Alt mørkt.": "Fixtures with white, amber or UV also emit from those. They belong to this selection — at 0, R/G/B alone decides the colour. They follow the brightness and go out on Blackout.",
    "Chase o.l. løber efter gruppens nummerering (rediger den under Layout → Redigér gruppe).": "Chase etc. follows the group's numbering (edit it under Layout → Edit group).",
    "Farver i gradienten": "Colours in the gradient",
    "Farver i paletten": "Colours in the palette",
    "Fjern farven": "Remove colour",
    "+ Farve": "+ Colour",
    "Farverne fordeles hen over gruppen i dens nummerering — første farve på nr. 1, sidste på den sidste lampe.": "Colours are spread across the group in its numbering — first colour on no. 1, last on the final fixture.",
    "Farverne skifter efter hinanden på alle lamperne. Farvefart styrer hvor hurtigt.": "Colours cycle one after another on all fixtures. Colour speed controls how fast.",
    "Farvefart": "Colour speed",
    "Farvebredde": "Colour spread",
    "Standard overgangstid": "Default transition time",
    "sek. — bruges af grupper der ikke har fået deres egen": "sec. — used by groups that don't have their own",
    "Træk i feltet for at blande farven. Den øverste bjælke vælger kulør.": "Drag in the field to mix the colour. The top bar selects hue.",
    "Tryk på et felt eller brug bogstavet som genvejstast.": "Tap a swatch or use the letter as a shortcut key.",
    "Redigér…": "Edit…",
    "Gem som ny…": "Save as new…",
    "Navn på den nye palette:": "Name of the new palette:",
    "Slet palette": "Delete palette",
    "Slet paletten": "Delete the palette",
    "Tilføjet:": "Added:",
    "Matrixvisning: kun navn, fadetid og Kald. Træk kortene for at sortere dem.": "Matrix view: name, fade time and Recall only. Drag the cards to sort them.",
    "Listevisning: alle knapper. Træk i ⠿ (eller brug ▲▼) for at sortere.": "List view: all buttons. Drag ⠿ (or use ▲▼) to sort.",
    "Ingen scener i dette faneblad. Vælg et andet faneblad, eller flyt en scene hertil fra listevisningen.": "No scenes in this tab. Choose another tab, or move a scene here from list view.",
    "Ingen scener gemt endnu. Sæt et look op på Pult-fanen og tryk Gem nuværende som scene.": "No scenes saved yet. Set up a look on the Mixer tab and press Save current as scene.",
    "Træk for at flytte scenen": "Drag to move the scene",
    "Overskriv scenen med det der står nu": "Overwrite the scene with the current state",
    "Slet scenen": "Delete the scene",
    "Sekunder efter fadet er færdigt, før den går videre selv (kræver Auto-følg)": "Seconds after the fade is done before it advances on its own (requires Auto-follow)",
    "Kald denne cue uden at røre de andre": "Recall this cue without changing the others",
    "s hvis alle blev kørt i træk med Auto-følg": "s if all were run in sequence with Auto-follow",
    "Enttec Open DMX USB drives direkte via FTDI, præcis som QLC+ gør det. Vælg FTDI-enheden herover — det er ikke en /dev/tty-port. Kræver pyftdi og pyusb.": "Enttec Open DMX USB is driven directly via FTDI, just like QLC+ does. Select the FTDI device above — it is not a /dev/tty port. Requires pyftdi and pyusb.",
    "Ingen enhed:": "No device:",
    "Indlæst:": "Loaded:",
    "3D-sceneplan: rummet med ting og modeller": "3D stage plan: the room with objects and models",
    "2D-sceneplan: formerne på gulvet": "2D stage plan: the shapes on the floor",
    "Rummet i 3D-simulatoren erstattes.": "The room in the 3D simulator will be replaced.",
    "Formerne på gulvet erstattes.": "The shapes on the floor will be replaced.",
    "LC-11 kan ikke bruges:": "LC-11 cannot be used:",
    "Sidste input:": "Last input:",
    "(ikke fundet)": "(not found)",
    "Ingen lamper valgt — tryk på dem til venstre": "No fixtures selected — tap them on the left",
    "Starttempo": "Start tempo",
    "Styres af pulten (samme som dimmer)": "Controlled by the mixer (same as dimmer)",
    "Styres af pulten": "Controlled by the mixer",
    "+ Tilføj": "+ Add",
    "Giv lampe": "Assign fixture",
    "opsætningen": "the profile",
    "Tilføj en lampe her med": "Add a fixture here with",
    "af": "of",
    "på pause": "paused",
    "Fjernes": "Removed",
    "Alle lamper (Patch), alle grupper, alle scener og cuelisten, det der kører i Afvikling, lagene i Pult, egne mønstre og guiden.": "All fixtures (Patch), all groups, all scenes and the cue list, playback settings, mixer layers, custom patterns and the guide.",
    "Bliver": "Kept",
    "DMX-udgangen (Output), indstillinger, dine egne lampetyper, farvepaletter og fanernes rækkefølge.": "DMX output (Output), settings, your custom fixture types, colour palettes and tab order.",
    "Inden der nulstilles, gemmes en kopi af det hele under Show → Gemte shows (med “før nulstilling” og tidspunktet i navnet). Hent den der, hvis du fortryder.": "Before resetting, a backup of everything is saved under Show → Saved shows (with “before reset” and the time in the name). Load it there if you change your mind.",
    "Nulstillet": "Reset complete",
    "kanaler": "channels",
    "Indbygget type, lavet efter producentens manual. Den kan ikke rettes direkte — tryk Lav kopi for at få en egen type du kan finpudse.": "Built-in type based on the manufacturer's manual. It cannot be edited directly — press Make copy to get your own type you can fine-tune.",
    "Værdien kanalen har, indtil du sætter den i Pult (og altid for Fast værdi)": "The value the channel has until you set it in Mixer (and always for Fixed value)",
    "Standard": "Default",
    "Kanalen sendes aldrig højere end dette. Fx 159 hvis lampen strober over 159.": "The channel is never sent higher than this. E.g. 159 if the fixture strobes above 159.",
    "Maks": "Max",
    "Funktioner med grøn kant styres af pulten. Faste kanaler (hvid, strobe, ekstra …) sættes i Pult under Faste kanaler og har standardværdien indtil da. Fast værdi sender altid standardværdien — brug den til mode- eller indstillingskanaler. Maks er en grænse, fx 159 hvis lampen begynder at strobe over 159.": "Functions with a green border are controlled by the mixer. Fixed channels (white, strobe, extra …) are set in Mixer under Fixed channels and have the default value until then. Fixed value always sends the default value — use it for mode or setup channels. Max is a limit, e.g. 159 if the fixture starts to strobe above 159.",
    "og adressér alle igen": "and re-address all",
    "Gem typen først": "Save the type first",
    "Alle lamper får nye adresser bagefter.": "All fixtures will get new addresses afterwards.",
    "Ingen lamper bruger typen, så der er intet at teste på.": "No fixtures use the type, so there is nothing to test on.",
    "Hold én DMX-kanal på en bestemt værdi på alle lamper af denne type — så kan du se, hvad kanalen gør. Kræver at DMX ud er slået til. Testen slipper af sig selv efter 2 minutter.": "Hold one DMX channel at a specific value on all fixtures of this type — so you can see what the channel does. Requires DMX output to be enabled. The test releases by itself after 2 minutes.",
    "Tester den gemte udgave.": "Tests the saved version.",
    "● Test kører": "● Test running",
    "før til": "move to",
    "Hentet:": "Loaded:",
    "lamper med adresser og placering,": "fixtures with addresses and placement,",
    "grupper,": "groups,",
    "scener, cuelisten, det der kører i Afvikling, lagene i Pult, egne mønstre og guiden.": "scenes, the cue list, playback settings, mixer layers, custom patterns and the guide.",
    "Nulstillet — kopi gemt som": "Reset — backup saved as",
    "⬜ Zoom område": "⬜ Zoom area",
    "Træk et område op, så zoomes der ind på det": "Draw an area to zoom into it",
    "Lampens rigtige niveau — det samme som under Pult → Lamper. <b>Drejet</b> er den samme drejning som i Layout og 3D-simulatoren. Tryk på en anden lampe for at vælge den, eller på tom baggrund for at lukke.": "The fixture's actual level — the same as under Console → Fixtures. <b>Rotated</b> is the same rotation as in Layout and the 3D simulator. Click another fixture to select it, or on an empty area to close.",
    "Gemmes i Show-mappen ved siden af dine shows som «navn.sceneplan-2d.json» — en 2D-sceneplan er formerne på gulvet.": "Saved in the Show folder next to your shows as «name.stageplan-2d.json» — a 2D stage plan is the shapes on the floor.",
    "Træk i et navn for at flytte det væk fra lampen — så tegnes der en henvisningsstreg. Træk på tom baggrund for at panorere.": "Drag a label to move it away from the fixture — a reference line is drawn. Drag on an empty area to pan.",
    "Ingen 2D-sceneplaner gemt": "No 2D stage plans saved",
    "Skriv et navn på sceneplanen først.": "Enter a stage plan name first.",
    "Der findes allerede en 2D-sceneplan, der hedder": "There is already a 2D stage plan called",
    "Skal den overskrives?": "Do you want to overwrite it?",
    "Kunne ikke gemme:": "Could not save:",
    "Gemt som 2D-sceneplanen": "Saved as 2D stage plan",
    "Hent 2D-sceneplanen": "Load 2D stage plan",
    "Formerne, der står nu, erstattes.": "The current shapes will be replaced.",
    "Kunne ikke hente sceneplanen.": "Could not load the stage plan.",
    "Hentet: 2D-sceneplanen": "Loaded: 2D stage plan",
    "Slet 2D-sceneplanen": "Delete 2D stage plan",
    "Slettet.": "Deleted.",
    "3D-simulatoren kan ikke køre i denne browser.": "The 3D simulator cannot run in this browser.",
    "Den kræver WebGL 2.": "It requires WebGL 2.",
    "Salen": "Auditorium",
    "Se scenen fra salen": "View the stage from the auditorium",
    "Se rummet ovenfra": "View the room from above",
    "Siden": "Side",
    "Se scenen fra siden": "View the stage from the side",
    "Lås kameraet, så visningen bliver stående": "Lock the camera so the view stays fixed",
    "Skygger": "Shadows",
    "Skygger fra op til 8 lamper (kræver en hurtig computer)": "Shadows from up to 8 fixtures (requires a fast computer)",
    "Rediger": "Edit",
    "↶ Fortryd": "↶ Undo",
    "Fortryd sidste flytning (Ctrl+Z)": "Undo last move (Ctrl+Z)",
    "↷ Gentag": "↷ Redo",
    "Gentag (Ctrl+Y)": "Redo (Ctrl+Y)",
    "Visning": "Display",
    "gælder denne skærm": "applies to this screen",
    "Røg": "Smoke",
    "Eksponering": "Exposure",
    "gemmes i showet": "saved in the show",
    "Rumlys": "Ambient light",
    "Rumlys er det svage lys, der gør rummet synligt, selv om lamperne er slukket. Røg bestemmer, hvor tydelige lysstrålerne er.": "Ambient light is the faint light that makes the room visible even when the fixtures are off. Smoke controls how visible the light beams are.",
    "Ting": "Objects",
    "Rum": "Room",
    "Træk": "Drag",
    "Flyt": "Move",
    "Drej": "Rotate",
    "Til siden": "Sideways",
    "Ind/ud": "In/out",
    "Højde": "Height",
    "(som i 2D)": "(same as in 2D)",
    "Peg på…": "Aim at…",
    "<b>Flyt</b>: træk i pilene. <b>Drej</b>: træk i ringene. <b>Peg på…</b>: klik derefter på det sted i rummet, lampen skal lyse på — fx en person eller et punkt på scenen. Drejningen er den samme som i Layout og 2D-simulatoren: drejer du her, drejer den også dér, og omvendt. Lysstyrken er lampens rigtige niveau (som under Pult → Lamper).": "<b>Move</b>: drag the arrows. <b>Rotate</b>: drag the rings. <b>Aim at…</b>: then click the spot in the room the fixture should light — e.g. a person or a point on stage. The rotation is the same as in Layout and the 2D simulator: rotating here rotates there too, and vice versa. The brightness is the fixture's actual level (as under Console → Fixtures).",
    "Hent 3D-model (.glb)…": "Load 3D model (.glb)…",
    "I rummet": "In the room",
    "Shift+klik vælger flere": "Shift+click selects multiple",
    "Gruppér dem": "Group them",
    "Står i højde": "Standing at height",
    "Bredde/dybde/højde": "Width/depth/height",
    "Skala": "Scale",
    "Stil på gulv/scene": "Place on floor/stage",
    "Bredde": "Width",
    "Dybde": "Depth",
    "Loftshøjde": "Ceiling height",
    "Midte til siden": "Centre sideways",
    "Midte ind/ud": "Centre in/out",
    "Vægge": "Walls",
    "Gulvfarve": "Floor colour",
    "Vægfarve": "Wall colour",
    "Målene er i meter og passer med Layout: x til siden, y ind mod scenens bagkant (salen er på minus-siden). Væggene er gennemsigtige udefra, så du kan se ind fra alle sider.": "Dimensions are in metres and match Layout: x sideways, y towards the back of the stage (the auditorium is on the minus side). The walls are transparent from outside, so you can see in from all sides.",
    "En 3D-sceneplan er rummet med alle ting og modeller (ikke lamperne). Den gemmes i Show-mappen ved siden af dine shows som «navn.sceneplan-3d.json».": "A 3D stage plan is the room with all objects and models (not the fixtures). It is saved in the Show folder next to your shows as «name.stageplan-3d.json».",
    "Klik på det sted, lampen skal pege på — Esc fortryder": "Click the spot the fixture should aim at — Esc cancels",
    "3D-modellen": "The 3D model",
    "findes ikke på denne computer (mappen modeller ved siden af shows).": "was not found on this computer (the modeller folder next to shows).",
    "Peger automatisk mod scenen.": "Aims automatically at the stage.",
    "Peger på punktet x": "Aims at point x",
    "højde": "height",
    "Scenepodie": "Stage platform",
    "Person": "Person",
    "Trommesæt": "Drum kit",
    "Forstærker": "Amplifier",
    "Højttaler": "Speaker",
    "Mikrofon": "Microphone",
    "Keyboard": "Keyboard",
    "Scenetæppe": "Stage curtain",
    "Travers": "Truss",
    "Klods": "Box",
    "Cylinder": "Cylinder",
    "3D-model": "3D model",
    "Ingen ting endnu": "No objects yet",
    "ting": "objects",
    "Vælg hele gruppen": "Select the entire group",
    "ting valgt": "objects selected",
    "Tingene flyttes, drejes og skaleres samlet. <b>Størrelse</b> skalerer hele gruppen — også afstandene mellem tingene. Vil du rette én af dem, så klik på den i listen (eller Alt+klik i rummet).": "The objects are moved, rotated and scaled together. <b>Scale</b> scales the entire group — including the distances between objects. To edit one of them, click it in the list (or Alt+click in the room).",
    "Træk i håndtaget for at flytte de valgte samlet. <b>Gruppér dem</b>, så de altid hænger sammen.": "Drag the handle to move the selection together. <b>Group them</b> so they always stay together.",
    "(kopi)": "(copy)",
    "Skala 1 = modellens egne mål (glTF er i meter).": "Scale 1 = the model's own dimensions (glTF is in metres).",
    "Scenetæppe: dybden er hvor dybe folderne er (fx 0,2 m). Drej det med «Drejet», hvis det skal hænge på tværs.": "Stage curtain: the depth is how deep the folds are (e.g. 0.2 m). Rotate it with «Rotated» if it should hang crosswise.",
    "Henter": "Loading",
    "Kunne ikke hente modellen:": "Could not load the model:",
    "er sat ind": "has been inserted",
    "Ingen 3D-sceneplaner gemt": "No 3D stage plans saved",
    "Der findes allerede en 3D-sceneplan, der hedder": "There is already a 3D stage plan called",
    "ukendt fejl": "unknown error",
    "Gemt som 3D-sceneplanen": "Saved as 3D stage plan",
    "Hent 3D-sceneplanen": "Load 3D stage plan",
    "Rummet, der står nu, erstattes.": "The current room will be replaced.",
    "Hentet: 3D-sceneplanen": "Loaded: 3D stage plan",
    "Slet 3D-sceneplanen": "Delete 3D stage plan",
    "Fortrudt": "Undone",
    "billeder/s": "fps"
  }
};

var currentLang = "da";
try { currentLang = localStorage.getItem("pixelpult.lang") || "da"; } catch (e) {}

/* t(key)           → oversætter nøglen
   t(key, {n: 5})   → erstatter {n} med 5 i resultatet */
function t(key, params) {
  var dict = translations[currentLang];
  var text = (dict && dict.hasOwnProperty(key)) ? dict[key] : key;
  if (params) {
    for (var k in params) {
      if (params.hasOwnProperty(k)) {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
      }
    }
  }
  return text;
}

function setLang(lang) {
  currentLang = lang;
  try { localStorage.setItem("pixelpult.lang", lang); } catch (e) {}
  if (document.documentElement) document.documentElement.lang = (lang === "da" ? "da" : "en");
  applyLang();
}

function getLang() {
  return currentLang;
}

/* Går igennem alle elementer med data-t-attributter og oversætter dem */
function applyLang() {
  var els, i, key;

  /* textContent */
  els = document.querySelectorAll("[data-t]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t");
    if (key) els[i].textContent = t(key);
  }

  /* innerHTML (for elementer der indeholder formatering) */
  els = document.querySelectorAll("[data-t-html]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-html");
    if (key) els[i].innerHTML = t(key);
  }

  /* placeholder */
  els = document.querySelectorAll("[data-t-placeholder]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-placeholder");
    if (key) els[i].placeholder = t(key);
  }

  /* title (tooltip) */
  els = document.querySelectorAll("[data-t-title]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-title");
    if (key) els[i].title = t(key);
  }

  /* aria-label */
  els = document.querySelectorAll("[data-t-aria]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-aria");
    if (key) els[i].setAttribute("aria-label", t(key));
  }

  /* value (for buttons med value-tekst) */
  els = document.querySelectorAll("[data-t-value]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-value");
    if (key) els[i].value = t(key);
  }

  /* option text */
  els = document.querySelectorAll("[data-t-option]");
  for (i = 0; i < els.length; i++) {
    key = els[i].getAttribute("data-t-option");
    if (key) {
      if (els[i].tagName === "OPTGROUP") els[i].label = t(key);
      else els[i].textContent = t(key);
    }
  }
}

/* Liste over tilgængelige sprog */
function getLanguages() {
  var langs = [{ code: "da", name: "Dansk" }];
  for (var code in translations) {
    if (translations.hasOwnProperty(code)) {
      langs.push({ code: code, name: code === "en" ? "English" : code });
    }
  }
  return langs;
}

/* Tilføj/hent oversættelser dynamisk (til brug af sim.html / sim3d.html) */
function addTranslations(lang, dict) {
  if (!translations[lang]) translations[lang] = {};
  for (var k in dict) {
    if (dict.hasOwnProperty(k)) translations[lang][k] = dict[k];
  }
}

/* Sæt sproget på html-elementet ved load */
if (document.documentElement && currentLang !== "da") {
  document.documentElement.lang = "en";
}

root.t = t;
root.setLang = setLang;
root.getLang = getLang;
root.applyLang = applyLang;
root.getLanguages = getLanguages;
root.addTranslations = addTranslations;

})(window);
