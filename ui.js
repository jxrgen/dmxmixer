/* Pixelpult - brugerflade
   Skrevet i ES5 med var/function og XMLHttpRequest, ikke fordi det er
   pænest, men fordi Safari 9 paa en iPad 3 hverken har fetch eller
   arrow functions. Det koster nogle linjer nu og sparer en omskrivning
   senere. */

(function () {
"use strict";

var S = null;          // showet
var META = null;
var rev = -1;
var layer = 0;         // valgt lag
var lastMod = 0;       // sidst beroerte modul (layout-rotation)
var busy = false;      // brugeren traekker i noget - lad vaere at genindlaese
var patIdx = 0;
var brush = 1.0;
var eraser = false;
var scale = 40;        // px pr. meter i layoutvisningen
var cueAuto = false, cuePos = -1, cueTimer = null;
var taps = [];
var armMemory = [];
var sceneView = "liste";      /* liste | matrix */
var sceneTab = null;          /* id paa det viste faneblad, null = det foerste */
var scenePrev = false;        /* levende miniature ud for hver scene */
var sceneCv = [];
var COLOUR_INPUT_OK = true;
var liveOn = false;           /* live-matrix fylder hele skaermen */
var liveCv = [];
var liveTab = "";             /* "" = alle scener, ellers id paa et faneblad */
try { liveTab = window.localStorage.getItem("pixelpult.liveTab") || ""; } catch (e) {}
var activeSceneId = null;     /* id (ikke indeks) paa sidst kaldte scene */
var lastFrame = null;         /* seneste px-frame, saa Layout kan lyse i farve */
var edLamp = 0;               /* lampe valgt i Lampe-editoren */
var stripsCompact = false;    /* kompakt lampevisning i Pult */
var layEdSel = -1;            /* valgt scene-objekt i Layout */
var layEdTool = "lamp";       /* "lamp" | "rect" | "circle" | "tri" | "sel" */
var layEdDraw = null;         /* igangværende tegning */
var layEdDrag = null;         /* igangværende træk af form */

/* ---------------------------------------------------------------- net */
function req(method, path, body, cb) {
  var x = new XMLHttpRequest();
  x.open(method, path, true);
  x.onreadystatechange = function () {
    if (x.readyState !== 4) return;
    if (cb) {
      var d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { d = null; }
      cb(d);
    }
  };
  if (body) {
    x.setRequestHeader("Content-Type", "application/json");
    x.send(JSON.stringify(body));
  } else { x.send(); }
}
function api(msg, cb) {
  req("POST", "/api", msg, function (d) {
    /* Serveren taeller rev op ved hver aendring. Naar aendringen kom fra os
       selv, foelger vi bare med - ellers ville hver eneste faderbevaegelse
       udloese en fuld genopbygning af fladen midt i traekket. */
    if (d && typeof d.rev === "number") rev = d.rev;
    if (cb) cb(d);
  });
}
function setv(path, value, cb) { api({ op: "set", path: path, value: value }, cb); }

function toast(txt) {
  var t = id("toast");
  t.textContent = txt; t.style.display = "block";
  setTimeout(function () { t.style.display = "none"; }, 1800);
}

/* -------------------------------------------------------------- utils */
function id(s) { return document.getElementById(s); }
function el(tag, cls, txt) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
function press(btn, on) { btn.setAttribute("aria-pressed", on ? "true" : "false"); }
function hex(c) {
  function h(v) { v = Math.max(0, Math.min(255, v | 0)).toString(16);
                  return v.length < 2 ? "0" + v : v; }
  return "#" + h(c[0]) + h(c[1]) + h(c[2]);
}
function unhex(s) {
  return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16),
          parseInt(s.substr(5, 2), 16)];
}
function rgba(hexcol) {
  var c = hexcol.charAt(0) === "#" ? unhex(hexcol) : [242, 179, 61];
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",";
}
function markBusy() { busy = true; }
function clearBusy() { setTimeout(function () { busy = false; }, 350); }

/* Sender highest ét setv-kald pr. "wait" ms pr. sti, plus altid det
   sidste naar traekket slipper. En hurtig skydertraek udloeser 'input'
   op til 60 gange i sekundet; uden dette sendes lige saa mange separate
   HTTP-kald, og et svar der naar frem i forkert raekkefoelge kan faa
   klientens lokale rev til kortvarigt at gaa baglaens. Faerre kald goer
   den race umulig i praksis og er i forvejen oplagt paa en gammel iPad. */
function throttledSetv(key, path, value, wait) {
  var t = throttledSetv._t || (throttledSetv._t = {});
  var st = t[key] || (t[key] = { last: 0, timer: null, pending: null });
  var now = Date.now();
  st.pending = value;
  function flush() {
    st.last = Date.now(); st.timer = null;
    setv(path, st.pending);
  }
  if (now - st.last >= wait) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    flush();
  } else if (!st.timer) {
    st.timer = setTimeout(flush, wait - (now - st.last));
  }
}
function flushSetv(key, path, value) {
  var t = throttledSetv._t;
  var st = t && t[key];
  if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
  setv(path, value);
}

/* Skyder plus talfelt. Skyderen er til at foele efter, feltet til at ramme
   en bestemt vaerdi. De to holdes synkroniserede, og fmt vises ved siden af
   naar tallet i sig selv ikke siger nok (fx "fra" eller "12 Hz").

   Mens brugeren traekker, ignorerer .set() alt der kommer udefra (fx et
   baggrundsopdateret show). Uden det ville en genopfrisket vaerdi kunne
   naa at blive skrevet ind i elementet MENS pointeren stadig er nede,
   hvilket faar skyderen til at hakke eller "slippe" midt i traekket. */
function slider(elm, out, path, fmt) {
  var num, unit = null, dragging = false, dragEnd = null;
  var key = path.join(".");

  if (out && out.tagName === "SPAN") {
    num = document.createElement("input");
    num.type = "number"; num.className = "v";
    num.min = elm.min; num.max = elm.max; num.step = elm.step || 1;
    num.value = elm.value;
    out.parentNode.replaceChild(num, out);
    if (fmt) {
      unit = el("span", "u", fmt(parseInt(elm.value, 10) || 0));
      if (num.nextSibling) num.parentNode.insertBefore(unit, num.nextSibling);
      else num.parentNode.appendChild(unit);
    }
  } else {
    num = out;
  }

  function show(v) {
    if (num && num.tagName === "INPUT") num.value = v;
    else if (num) num.textContent = fmt ? fmt(v) : v;
    if (unit) unit.textContent = fmt(v);
  }
  function beginDrag() {
    dragging = true;
    if (dragEnd) { clearTimeout(dragEnd); dragEnd = null; }
  }
  function endDrag() {
    dragEnd = setTimeout(function () { dragging = false; }, 300);
  }

  elm.addEventListener("mousedown", beginDrag);
  elm.addEventListener("touchstart", beginDrag);
  elm.addEventListener("input", function () {
    var v = parseInt(elm.value, 10);
    beginDrag();
    show(v); markBusy(); throttledSetv(key, path, v, 45);
  });
  elm.addEventListener("change", function () {
    flushSetv(key, path, parseInt(elm.value, 10));
    clearBusy(); endDrag();
  });
  elm.addEventListener("touchend", function () {
    flushSetv(key, path, parseInt(elm.value, 10));
    clearBusy(); endDrag();
  });
  elm.addEventListener("mouseup", function () {
    flushSetv(key, path, parseInt(elm.value, 10));
    clearBusy(); endDrag();
  });

  if (num && num.tagName === "INPUT") {
    num.addEventListener("change", function () {
      var v = parseInt(num.value, 10);
      if (isNaN(v)) v = parseInt(elm.value, 10);
      v = Math.max(parseInt(elm.min, 10), Math.min(parseInt(elm.max, 10), v));
      num.value = v; elm.value = v;
      if (unit) unit.textContent = fmt(v);
      flushSetv(key, path, v); clearBusy();
    });
    num.addEventListener("focus", markBusy);
  }
  return { set: function (v) { if (!dragging) { elm.value = v; show(v); } } };
}
/* Som slider(), men til skydere der ikke skriver direkte til showet.
   onchange(v, faerdig) kaldes loebende, og med faerdig=true naar man
   slipper eller taster en vaerdi ind. Samme beskyttelse mod at et
   udefrakommende .set() afbryder et aktivt traek. */
function localPair(elm, out, onchange) {
  var num = document.createElement("input");
  num.type = "number"; num.className = "v";
  num.min = elm.min; num.max = elm.max; num.value = elm.value;
  out.parentNode.replaceChild(num, out);
  var dragging = false, dragEnd = null;
  function fire(v, done) {
    num.value = v; elm.value = v; onchange(v, done);
    if (done) { dragEnd = setTimeout(function () { dragging = false; }, 300); }
  }
  function begin() {
    dragging = true;
    if (dragEnd) { clearTimeout(dragEnd); dragEnd = null; }
  }
  elm.addEventListener("mousedown", begin);
  elm.addEventListener("touchstart", begin);
  elm.addEventListener("input", function () { begin(); fire(parseInt(elm.value, 10), false); });
  elm.addEventListener("change", function () { fire(parseInt(elm.value, 10), true); });
  elm.addEventListener("touchend", function () { fire(parseInt(elm.value, 10), true); });
  num.addEventListener("change", function () {
    var v = parseInt(num.value, 10);
    if (isNaN(v)) v = parseInt(elm.value, 10);
    v = Math.max(parseInt(elm.min, 10), Math.min(parseInt(elm.max, 10), v));
    fire(v, true);
  });
  return { set: function (v) { if (!dragging) { num.value = v; elm.value = v; } } };
}

function strobeTxt(v) { return v < 8 ? "fra" : (1 + Math.floor((v - 8) * 24 / 247)) + " Hz"; }

/* ------------------------------------------------------------ profiler */
function profilesAll() {
  var out = {}, k;
  if (META && META.builtin_profiles) for (k in META.builtin_profiles) out[k] = META.builtin_profiles[k];
  if (S && S.profiles) for (k in S.profiles) out[k] = S.profiles[k];
  return out;
}
function lampProfile(m) {
  var all = profilesAll();
  return all[m.type] || { name: m.type, shape: "par", channels: [{ k: "dimmer", n: "Dimmer" }] };
}
function lampSpan(m) { return lampProfile(m).channels.length; }
function lampHasKey(m, k) {
  var ch = lampProfile(m).channels, i;
  for (i = 0; i < ch.length; i++) if (ch[i].k === k) return true;
  return false;
}

/* Sender ét patch-kald pr. "wait" ms pr. noegle - til de manuelle
   kanalskydere der skriver til mange lamper paa én gang. */
function throttledPatch(key, items) {
  var t = throttledPatch._t || (throttledPatch._t = {});
  var st = t[key] || (t[key] = { last: 0, timer: null, items: null });
  st.items = items;
  var now = Date.now(), wait = 60;
  function flush() { st.last = Date.now(); st.timer = null; api({ op: "patch", items: st.items }); }
  if (now - st.last >= wait) { if (st.timer) { clearTimeout(st.timer); st.timer = null; } flush(); }
  else if (!st.timer) { st.timer = setTimeout(flush, wait - (now - st.last)); }
}

/* -------------------------------------------- fallbacks for gammel Safari */

/* Flexbox gap kom foerst i Safari 14. Vi maaler det i stedet for at gaette
   paa browserversion, og lader CSS'en klare afstanden med margin hvis det
   mangler. */
function detectFlexGap() {
  var f = document.createElement("div");
  f.style.display = "flex";
  f.style.flexDirection = "column";
  f.style.rowGap = "1px";
  f.style.position = "absolute";
  f.style.visibility = "hidden";
  f.appendChild(document.createElement("div"));
  f.appendChild(document.createElement("div"));
  document.body.appendChild(f);
  var ok = f.scrollHeight === 1;
  f.parentNode.removeChild(f);
  if (!ok) document.documentElement.className += " nogap";
}

/* iOS Safari 9 kender ikke input type=color og degraderer til et tekstfelt.
   Vi opdager det og bygger tre skydere i stedet. */
function detectColourInput() {
  var i = document.createElement("input");
  i.setAttribute("type", "color");
  COLOUR_INPUT_OK = (i.type === "color");
}

/* Faelles farvevaelger: rigtig vaelger hvor den findes, ellers R/G/B. */
function colourControl(parent, value, onchange) {
  if (COLOUR_INPUT_OK) {
    var cp = document.createElement("input");
    cp.type = "color"; cp.value = hex(value);
    cp.oninput = function () { onchange(unhex(cp.value)); };
    parent.appendChild(cp);
    return { set: function (c) { cp.value = hex(c); } };
  }
  var box = el("div", "rgbset");
  var chip = el("div", "rgbchip");
  chip.style.background = hex(value);
  var cur = [value[0], value[1], value[2]], inputs = [];
  ["R", "G", "B"].forEach(function (nm, k) {
    box.appendChild(el("span", "lbl", nm));
    var r = document.createElement("input");
    r.type = "range"; r.min = 0; r.max = 255; r.value = cur[k];
    r.addEventListener("input", function () {
      cur[k] = parseInt(r.value, 10);
      chip.style.background = hex(cur);
      markBusy(); onchange([cur[0], cur[1], cur[2]]);
    });
    r.addEventListener("change", clearBusy);
    r.addEventListener("touchend", clearBusy);
    inputs.push(r);
    box.appendChild(r);
  });
  box.appendChild(chip);
  parent.appendChild(box);
  return { set: function (c) {
    cur = [c[0], c[1], c[2]];
    inputs.forEach(function (r, k) { r.value = cur[k]; });
    chip.style.background = hex(cur);
  } };
}

/* ---------------------------------------------------------------- tema */
/* De faste temaer ligger i ui.css og kan aldrig ændres. Et eget tema er et
   fast tema (skrift og hjørner) med egne farver lagt ovenpå som CSS-
   variabler. Egne temaer gemmes på serveren (alle skærme kan bruge dem);
   hvilket tema den enkelte skærm bruger, huskes i browseren. */
var THEME_GROUPS = [
  ["Flader", [["bg", "Baggrund"], ["panel", "Rammer"],
              ["panel2", "Knapper, felter og skydere"], ["rule", "Kanter og streger"]]],
  ["Tekst", [["ink", "Tekst"], ["muted", "Dæmpet tekst"], ["dim", "Svag tekst"]]],
  ["Fremhævning", [["accent", "Valgte knapper, skyderknop, overskrifter"],
                   ["accent-ink", "Tekst på det fremhævede"],
                   ["alarm", "Advarsler og blackout"], ["alarm-ink", "Tekst på advarsler"],
                   ["ok", "OK og solo"]]]
];
var THEME_VARS = [];
THEME_GROUPS.forEach(function (g) { g[1].forEach(function (v) { THEME_VARS.push(v[0]); }); });
var themeCur = "rav", themePending = null, themeDraft = null, themeDirty = false, themeRedrawT = null;

function themeOwn() { return (META && META.themes) || {}; }
function themeIsOwn(key) { return key.indexOf("custom:") === 0; }
function themeOwnName(key) { return key.substr(7); }
function themeBaseOf(key) {
  if (!themeIsOwn(key)) return key;
  var t = themeOwn()[themeOwnName(key)];
  return t ? t.base : "rav";
}
function themeLabel(key) {
  if (themeIsOwn(key)) return themeOwnName(key);
  var o = id("theme").querySelector('option[value="' + key + '"]');
  return o ? o.textContent : key;
}
function themeInline(vars) {
  var st = document.documentElement.style;
  THEME_VARS.forEach(function (k) {
    if (vars && vars[k]) st.setProperty("--" + k, vars[k]); else st.removeProperty("--" + k);
  });
}
function themeRedraw() {
  if (themeRedrawT) return;
  themeRedrawT = setTimeout(function () { themeRedrawT = null; drawStage(); drawPattern(); }, 60);
}
function applyTheme(name) {
  if (themeIsOwn(name)) {
    var t = themeOwn()[themeOwnName(name)];
    if (!t) {
      /* temaerne er ikke hentet endnu - vent på serveren */
      if (!META) { themePending = name; return; }
      name = "rav";
    } else {
      document.documentElement.setAttribute("data-theme", t.base);
      themeInline(t.vars);
    }
  }
  if (!themeIsOwn(name)) {
    themeInline(null);
    document.documentElement.setAttribute("data-theme", name);
  }
  themeCur = name;
  try { window.localStorage.setItem("pixelpult.theme", name); } catch (e) {}
  var sel = id("theme"); if (sel && sel.value !== name) sel.value = name;
  /* lærrederne tegner med temaets farver og skal males om */
  setTimeout(function () { drawStage(); drawPattern(); }, 0);
}
/* listen over egne temaer i vælgeren - kaldes når showet/serveren er hentet */
function themeOptions() {
  var sel = id("theme"); if (!sel) return;
  var og = id("theme-own"), own = themeOwn(), names = Object.keys(own).sort();
  if (og) og.parentNode.removeChild(og);
  if (names.length) {
    og = document.createElement("optgroup"); og.label = "Egne temaer"; og.id = "theme-own";
    names.forEach(function (n) { var o = el("option", "", n); o.value = "custom:" + n; og.appendChild(o); });
    sel.appendChild(og);
  }
  if (themePending) { var p = themePending; themePending = null; applyTheme(p); }
  else if (themeIsOwn(themeCur) && !own[themeOwnName(themeCur)]) applyTheme(themeBaseOf(themeCur) || "rav");
  else if (themeIsOwn(themeCur) && !themeDraft) applyTheme(themeCur);     /* rettet fra en anden skærm */
  sel.value = themeCur;
  if (id("theme-adv").style.display !== "none" && !themeDraft) buildThemeEditor();
}
function initTheme() {
  var t = "rav";
  try { t = window.localStorage.getItem("pixelpult.theme") || "rav"; } catch (e) {}
  var sel = id("theme");
  if (themeIsOwn(t)) {
    /* eget tema: farverne kommer med serverens svar (themeOptions) */
    themePending = t; themeCur = t;
  } else {
    sel.value = t; if (sel.value !== t) t = "rav";
    applyTheme(t);
  }
  sel.onchange = function () {
    if (themeDirty && !confirm("Du har ændret farver uden at gemme. Kassér ændringerne?")) {
      sel.value = themeCur; return;
    }
    themeDraft = null; themeDirty = false;
    applyTheme(sel.value); fitTabs();
    if (id("theme-adv").style.display !== "none") buildThemeEditor();
  };
  id("theme-advbtn").onclick = function () {
    var a = id("theme-adv"), open = a.style.display === "none";
    a.style.display = open ? "" : "none";
    this.textContent = (open ? "▾" : "▸") + " Avanceret";
    this.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) buildThemeEditor();
  };
}
/* temaets farver som #rrggbb, læst fra siden */
function themeRead() {
  var cs = getComputedStyle(document.documentElement), out = {};
  THEME_VARS.forEach(function (k) {
    var v = cs.getPropertyValue("--" + k).replace(/\s/g, "").toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    var m = /^rgba?\((\d+),(\d+),(\d+)/.exec(v);
    if (m) v = hex([+m[1], +m[2], +m[3]]);
    out[k] = /^#[0-9a-f]{6}$/.test(v) ? v : "#808080";
  });
  return out;
}
/* kontrast efter WCAG: 4,5:1 er grænsen for almindelig tekst */
function themeContrast(a, b) {
  function lum(h) {
    var c = unhex(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  var x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function themeShowContrast() {
  var box = id("theme-contrast"); if (!box || !themeDraft) return;
  var v = themeDraft.vars;
  box.innerHTML = "";
  [["ink", "bg", "Tekst på baggrund"], ["ink", "panel", "Tekst i rammer"], ["ink", "panel2", "Tekst på knapper"],
   ["muted", "panel", "Dæmpet tekst"], ["accent-ink", "accent", "Tekst på det fremhævede"],
   ["alarm-ink", "alarm", "Tekst på advarsler"]].forEach(function (p) {
    var r = themeContrast(v[p[0]], v[p[1]]), good = r >= 4.5;
    var c = el("span", "th-ct" + (good ? "" : " bad"));
    var sw = el("span", "sw", "Aa"); sw.style.background = v[p[1]]; sw.style.color = v[p[0]];
    c.appendChild(sw);
    c.appendChild(document.createTextNode(p[2] + ": " + r.toFixed(1).replace(".", ",") + ":1 " + (good ? "✓" : "— svær at læse")));
    box.appendChild(c);
  });
}
function buildThemeEditor() {
  var box = id("theme-adv"); if (!box) return;
  if (!themeDraft) { themeDraft = { base: themeBaseOf(themeCur), vars: themeRead() }; themeDirty = false; }
  var own = themeIsOwn(themeCur);
  box.innerHTML = "";
  var lead = el("p", "th-lead");
  lead.appendChild(document.createTextNode("Du retter i "));
  lead.appendChild(el("b", "", themeLabel(themeCur)));
  lead.appendChild(document.createTextNode(own
    ? ". Ændringerne ses med det samme, men gemmes først, når du trykker Gem."
    : ". Det er et fast tema og kan ikke ændres — gem dine ændringer som et eget tema."));
  box.appendChild(lead);
  var grid = el("div", "th-groups");
  THEME_GROUPS.forEach(function (g) {
    var gb = el("div", "th-group");
    gb.appendChild(el("div", "th-gname", g[0]));
    g[1].forEach(function (vk) {
      var k = vk[0], row = el("div", "th-row");
      row.appendChild(el("span", "th-lbl", vk[1]));
      var cc = el("span", "th-cc");
      var hx = el("code", "th-hex", themeDraft.vars[k]);
      colourControl(cc, unhex(themeDraft.vars[k]), function (c) {
        themeDraft.vars[k] = hex(c);
        document.documentElement.style.setProperty("--" + k, themeDraft.vars[k]);
        hx.textContent = themeDraft.vars[k];
        if (!themeDirty) { themeDirty = true; themeButtons(); }
        themeShowContrast(); themeRedraw();
      });
      row.setAttribute("data-var", k);
      row.appendChild(cc); row.appendChild(hx);
      gb.appendChild(row);
    });
    grid.appendChild(gb);
  });
  box.appendChild(grid);
  box.appendChild(el("div", "th-gname", "Kan det læses?"));
  var ct = el("div", "th-contrast"); ct.id = "theme-contrast"; box.appendChild(ct);
  var br = el("div", "btns th-btns"); br.id = "theme-btns"; box.appendChild(br);
  themeShowContrast();
  themeButtons();
}
function themeButtons() {
  var br = id("theme-btns"); if (!br) return;
  var own = themeIsOwn(themeCur);
  br.innerHTML = "";
  if (own) {
    var sv = el("button", themeDirty ? "lt-go" : "", "Gem"); sv.id = "theme-save";
    sv.disabled = !themeDirty;
    sv.onclick = function () { themeStore(themeOwnName(themeCur), true); };
    br.appendChild(sv);
  }
  var sn = el("button", own ? "" : "lt-go", "Gem som nyt tema…"); sn.id = "theme-saveas";
  sn.onclick = function () {
    var sug = own ? themeOwnName(themeCur) + " 2" : "Mit " + themeLabel(themeCur).toLowerCase();
    var n = prompt("Navn på temaet (findes det i forvejen blandt dine egne, kan du overskrive det):", sug);
    if (n === null) return;
    n = n.replace(/^\s+|\s+$/g, "");
    if (!n) return;
    var exists = !!themeOwn()[n];
    if (exists && !confirm("Der findes allerede et tema der hedder “" + n + "”. Vil du overskrive det?")) return;
    themeStore(n, exists);
  };
  br.appendChild(sn);
  var un = el("button", "", "Fortryd ændringer"); un.id = "theme-undo";
  un.disabled = !themeDirty;
  un.onclick = function () { themeDraft = null; themeDirty = false; applyTheme(themeCur); buildThemeEditor(); };
  br.appendChild(un);
  if (own) {
    var dl = el("button", "alarm", "Slet tema"); dl.id = "theme-del";
    dl.onclick = function () {
      var n = themeOwnName(themeCur);
      if (!confirm("Slet temaet “" + n + "”? Skærme der bruger det, skifter til " + themeLabel(themeBaseOf(themeCur)) + ".")) return;
      var base = themeBaseOf(themeCur);
      api({ op: "theme_del", name: n }, function () {
        themeDraft = null; themeDirty = false;
        applyTheme(base);
        refresh(function () { buildThemeEditor(); toast("Temaet “" + n + "” er slettet"); });
      });
    };
    br.appendChild(dl);
  }
}
function themeStore(name, overwrite) {
  api({ op: "theme_save", name: name, base: themeDraft.base, vars: themeDraft.vars, overwrite: !!overwrite }, function (r) {
    if (!r || !r.ok) { toast((r && r.err) || "Kunne ikke gemme temaet"); return; }
    themeCur = "custom:" + r.name;
    try { window.localStorage.setItem("pixelpult.theme", themeCur); } catch (e) {}
    themeDraft = null; themeDirty = false;
    refresh(function () { applyTheme(themeCur); buildThemeEditor(); toast("Temaet “" + r.name + "” er gemt"); });
  });
}
function cssvar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).replace(/\s/g, "")
         || "#888888";
}

/* ---------------------------------------------------------------- ikoner */
/* Enkle stregikoner i tekstens farve (currentColor), så de følger temaet. */
var ICONS = {
  "v-guide": '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  "v-pult": '<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.5" y="13" width="5" height="3.5" rx="1" fill="currentColor"/><rect x="9.5" y="6" width="5" height="3.5" rx="1" fill="currentColor"/><rect x="15.5" y="10" width="5" height="3.5" rx="1" fill="currentColor"/>',
  "v-layout": '<circle cx="6" cy="7" r="2.2"/><circle cx="12" cy="5" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M3 20h18M6 9.5l-1.5 7M12 7.5v9M18 9.5l1.5 7"/>',
  "v-afvikling": '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z" fill="currentColor"/>',
  "v-enkel": '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  "v-patch": '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>',
  "v-pat": '<path d="M2 12c2.2-6 4.4-6 6.6 0s4.4 6 6.6 0 4.4-6 6.6 0"/>',
  "v-scene": '<rect x="3" y="8" width="13" height="12" rx="1.5"/><path d="M7 5h11.5A2.5 2.5 0 0 1 21 7.5V16"/>',
  "v-out": '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M8.2 7.8a6 6 0 0 0 0 8.4M15.8 7.8a6 6 0 0 1 0 8.4M5.2 4.8a10 10 0 0 0 0 14.4M18.8 4.8a10 10 0 0 1 0 14.4"/>',
  "v-show": '<path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7"/>',
  "v-help": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  /* kun i hjælpen */
  "go": '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  "tabs": '<path d="M2 20h20M4 20V8.5A1.5 1.5 0 0 1 5.5 7h5A1.5 1.5 0 0 1 12 8.5V20M12 11h6.5a1.5 1.5 0 0 1 1.5 1.5V20"/>',
  "ipad": '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>'
};
function icon(vid, cls) {
  var sp = el("span", "ico" + (cls ? " " + cls : ""));
  sp.setAttribute("aria-hidden", "true");
  sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[vid] || "") + '</svg>';
  return sp;
}

/* Hjælpens overskrifter får deres fanes ikon, og øverst laves en række
   knapper der hopper til hvert afsnit. */
function initHelp() {
  var toc = id("help-toc"); if (!toc) return;
  [].forEach.call(document.querySelectorAll("#v-help h3[data-ico]"), function (h) {
    var txt = h.textContent;
    h.insertBefore(icon(h.getAttribute("data-ico")), h.firstChild);
    var b = el("button", "sm");
    b.appendChild(icon(h.getAttribute("data-ico")));
    b.appendChild(document.createTextNode(txt));
    b.onclick = function () { h.scrollIntoView(true); };
    toc.appendChild(b);
  });
}

/* --------------------------------------------------------------- faner */
var TABS = [["v-guide", "Guide"], ["v-pult", "Pult"], ["v-layout", "Layout"],
            ["v-afvikling", "Afvikling"], ["v-enkel", "Enkel"], ["v-patch", "Patch"],
            ["v-pat", "Mønstre"], ["v-scene", "Scener"], ["v-out", "Output"],
            ["v-show", "Show"], ["v-help", "Indstillinger"]];
var viewCur = "v-pult";
function enterAfvikling() { afFit(); afSelChanged(); }

/* kaldes når en visning bliver synlig - tegn/byg det den har brug for */
function enterView(vid) {
  if (vid === "v-layout") drawStage();
  if (vid === "v-pat") drawPattern();
  if (vid === "v-show") loadShowList();
  if (vid === "v-scene") buildScenes();
  if (vid === "v-guide") wzOpen();
  if (vid === "v-afvikling") enterAfvikling();
  if (vid === "v-enkel") buildEnkel();
}
function gotoTab(vid) {
  if (!id(vid)) return;
  /* kanaltesten i Lampetyper må aldrig blive hængende når man går væk */
  if (vid !== "v-patch" && PT.testOn) { ptTestStop(); buildProfileEditor(); }
  if (vid !== "v-patch" && LT.on) { ltStop(); buildLampTest(true); }
  TABS.forEach(function (o) { id(o[0]).className = "view"; });
  id(vid).className = "view active";
  viewCur = vid;
  [].forEach.call(id("tabs").children, function (c) {
    press(c, c.getAttribute("data-vid") === vid);
  });
  enterView(vid);
}

/* Fanerne i brugerens rækkefølge (S.tab_order, gemt i showet) */
function orderedTabs() {
  var order = (S && S.tab_order) || [], map = {}, out = [];
  TABS.forEach(function (t) { map[t[0]] = t; });
  order.forEach(function (v) { if (map[v] && out.indexOf(map[v]) < 0) out.push(map[v]); });
  TABS.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
  return out;
}
var tabDragSrc = null;
function buildTabs() {
  if (tabDragSrc) return;               /* byg ikke om midt i et træk */
  var box = id("tabs"); box.innerHTML = "";
  orderedTabs().forEach(function (t) {
    var ctlc = null;
    CTRL.forEach(function (c) { if (c[2] === t[0]) ctlc = c[0]; });
    var styrer = !!(ctlc && S && ctlOn(ctlc));
    var b = el("button", styrer ? "ctl-tab" : "");
    b.appendChild(icon(t[0]));
    b.appendChild(el("span", "lbl", t[1]));
    b.setAttribute("data-vid", t[0]);
    b.title = t[1] + (styrer ? " — styrer lyset" : "");
    press(b, t[0] === viewCur);
    b.onclick = function () { gotoTab(t[0]); };
    /* træk en fane for at flytte den - en pil viser hvor den lander */
    b.draggable = true;
    b.addEventListener("dragstart", function (e) {
      tabDragSrc = t[0];
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", t[0]); } catch (er) {}
      b.className += " tab-dragging";
    });
    b.addEventListener("dragend", function () {
      if (!tabDragSrc) return;           /* allerede håndteret i drop */
      tabDragSrc = null; tabMark(null);
      buildTabs();
    });
    box.appendChild(b);
  });
  fitTabs();
}
/* Hvor en sluppet fane lander: før den første fane i rækken under musen
   hvis midte ligger til højre for musen - ellers efter den sidste. */
function tabDropAt(x, y) {
  var bs = [].slice.call(id("tabs").children), best = null, bd = 1e9, i, r;
  if (!bs.length) return null;
  for (i = 0; i < bs.length; i++) {
    r = bs[i].getBoundingClientRect();
    var d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
    if (d < bd) { bd = d; best = r.top; }
  }
  var row = [];
  for (i = 0; i < bs.length; i++) {
    r = bs[i].getBoundingClientRect();
    if (Math.abs(r.top - best) < 4) row.push(i);
  }
  for (var k = 0; k < row.length; k++) {
    r = bs[row[k]].getBoundingClientRect();
    if (x < r.left + r.width / 2) return { idx: row[k], x: r.left - 2, top: r.top, h: r.height };
  }
  r = bs[row[row.length - 1]].getBoundingClientRect();
  return { idx: row[row.length - 1] + 1, x: r.right + 2, top: r.top, h: r.height };
}
function tabMark(at) {
  var m = id("tabmark");
  if (!m) {
    m = el("div"); m.id = "tabmark";
    m.appendChild(el("span", "arr", "▼"));
    id("top").appendChild(m);
  }
  if (!at) { m.style.display = "none"; return; }
  var tr = id("top").getBoundingClientRect();
  m.style.display = "block";
  m.style.left = Math.round(at.x - tr.left) + "px";
  m.style.top = Math.round(at.top - tr.top - 6) + "px";
  m.style.height = Math.round(at.h + 6) + "px";
}
function tabMove(src, idx) {
  var order = orderedTabs().map(function (x) { return x[0]; });
  var fi = order.indexOf(src);
  if (fi < 0) return false;
  if (idx > fi) idx--;
  if (idx === fi) return false;
  order.splice(fi, 1);
  order.splice(idx, 0, src);
  if (S) S.tab_order = order;
  api({ op: "tab_order", order: order });
  return true;
}
function wireTabDrag() {
  var box = id("tabs");
  box.addEventListener("dragover", function (e) {
    if (!tabDragSrc) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    tabMark(tabDropAt(e.clientX, e.clientY));
  });
  box.addEventListener("dragleave", function (e) {
    var to = e.relatedTarget;
    if (!to || !box.contains(to)) tabMark(null);
  });
  box.addEventListener("drop", function (e) {
    if (!tabDragSrc) return;
    e.preventDefault();
    var at = tabDropAt(e.clientX, e.clientY), src = tabDragSrc;
    tabMark(null);
    tabDragSrc = null;
    if (at) tabMove(src, at.idx);
    buildTabs();
  });
}
/* Er der ikke plads til det hele på én linje, skjules først navnet
   "Lyspult" (det står også i vinduets titel), så viser de andre faner
   end den valgte kun deres ikon, og til sidst alle faner. Navnene står
   altid i værktøjstippet. */
function fitTabs() {
  var top = id("top"), box = id("tabs");
  if (!top || !box || !box.children.length) return;
  function wraps() {
    var bs = box.children, f = bs[0].getBoundingClientRect(), l = bs[bs.length - 1].getBoundingClientRect();
    if (Math.abs(l.top - f.top) > 4) return true;               /* fanerne på flere linjer */
    var c = id("topright").getBoundingClientRect(), d = id("dmxarm").getBoundingClientRect();
    return c.top >= f.bottom - 2 || f.top >= d.bottom - 2;       /* noget er røget ned under */
  }
  box.className = ""; top.className = "";
  if (!wraps()) return;
  top.className = "tight";                 /* 1: uden navnet "Lyspult" */
  if (!wraps()) return;
  box.className = "compact";               /* 2: de andre faner kun som ikon */
  if (!wraps()) return;
  top.className = "tight icons";           /* 3: alle faner kun som ikon */
}

/* ---------------------------------------------------------------- guide */
/* Guiden bygger et helt sceneforløb ud fra riggen. Tilstanden ligger i
   showet (S.wizard) og gemmes løbende, så den kan genoptages - også fra
   en anden maskine eller efter genstart. Selve scenerne bygges af
   serveren (wizard_scene i dmxmixer.py), så Prøv og Opret altid giver
   præcis det samme. */
var WZ = null, wzSaveT = null, wzInfo = null, wzResult = null;
var WZ_STEPS = ["Lamper", "Farver", "Scener", "Tempo", "Gem og afvikl"];

function wzMeta() { return (META && META.wiz) || { roles: [], colours: [], palettes: [], templates: [] }; }
function wzTpl(key) {
  var t = wzMeta().templates;
  for (var i = 0; i < t.length; i++) if (t[i].key === key) return t[i];
  return t[0];
}
function wzRgb(key) {
  if (key === "s1") key = WZ.c1;
  if (key === "s2") key = WZ.c2;
  var c = wzMeta().colours;
  for (var i = 0; i < c.length; i++) if (c[i][0] === key) return c[i][2];
  return [255, 255, 255];
}
function wzColName(key) {
  var c = wzMeta().colours;
  for (var i = 0; i < c.length; i++) if (c[i][0] === key) return c[i][1];
  return key;
}
function wzSwatch(key) {
  var s = el("span", "wz-sw");
  s.style.background = hex(wzRgb(key));
  return s;
}
function wzProfName(typ) {
  var p = (META.builtin_profiles || {})[typ] || (S.profiles || {})[typ];
  return p ? p.name : typ;
}
function wzSave() {
  id("wz-saved").textContent = "gemmer…";
  if (wzSaveT) clearTimeout(wzSaveT);
  wzSaveT = setTimeout(function () {
    wzSaveT = null;
    api({ op: "wizard_save", wizard: WZ }, function (d) {
      id("wz-saved").textContent = d && d.ok ? "Gemt — du kan fortsætte senere" : "Kunne ikke gemme";
    });
  }, 450);
}
function wzOpen(restart, extra) {
  var msg = { op: "wizard_open", restart: !!restart };
  if (extra) for (var k in extra) msg[k] = extra[k];
  api(msg, function (d) {
    if (!d || !d.ok) return;
    if (d.offer) { wzOffer(d.offer); return; }
    WZ = d.wizard; wzResult = null;
    wzInfo = null;
    if (d.rig_changed) wzInfo = "Riggen er ændret siden sidst. Guiden har givet de nye eller ændrede lamper en rolle — tjek trin 1.";
    else if (!d.fresh && (WZ.step > 0 || WZ.built_at))
      wzInfo = "Velkommen tilbage. Du fortsætter hvor du slap" +
        (WZ.built_at ? " — scenerne blev sidst oprettet " + WZ.built_at + "." : ".");
    wzRender();
  });
}
/* Der ligger en guide fra sidst (autogemt). Lad brugeren vælge. */
function wzOffer(info) {
  WZ = null;
  id("wz-steps").innerHTML = "";
  id("wz-note").style.display = "none";
  id("wz-back").style.visibility = "hidden";
  id("wz-next").style.display = "none";
  id("wz-saved").textContent = "";
  var box = id("wz-body"); box.innerHTML = "";
  box.appendChild(el("div", "wz-q", "Du har en guide i gang fra sidst"));
  var ul = el("ul", "wz-sum");
  ul.appendChild(el("li", "", "Gemt " + info.when));
  ul.appendChild(el("li", "", info.lamps + " lamper, " + info.items + " scener" +
    (info.built ? " — scenerne er oprettet" : " — scenerne er ikke oprettet endnu")));
  ul.appendChild(el("li", "", "Du var nået til trin " + (info.step + 1) + ": " + WZ_STEPS[info.step]));
  box.appendChild(ul);
  var b = el("div", "btns");
  var go = el("button", "wz-primary wz-big", "Fortsæt hvor jeg slap");
  go.onclick = function () {
    api({ op: "wizard_resume" }, function (d) {
      if (!d || !d.ok) { toast("Kunne ikke hente guiden"); return; }
      refresh(function () {
        WZ = d.wizard; wzResult = null;
        wzInfo = "Velkommen tilbage. Lamper, scener og dine valg er hentet ind igen.";
        wzRender();
      });
    });
  };
  var nw = el("button", "wz-big", "Start en ny guide");
  nw.onclick = function () { wzOpen(false, { "new": true }); };
  b.appendChild(go); b.appendChild(nw);
  box.appendChild(b);
  box.appendChild(el("p", "hint", "Fortsæt henter hele opsætningen fra sidst ind — lamper, scener og guidens valg — " +
    "og erstatter det der er åbent nu. Start en ny guide bruger de lamper, der er i Patch lige nu."));
}
function wzGo(step) {
  WZ.step = Math.max(0, Math.min(WZ_STEPS.length - 1, step));
  wzInfo = null;
  wzSave(); wzRender();
  var v = id("views"); if (v) v.scrollTop = 0;
}
function wzTry(index, tpl) {
  var msg = { op: "wizard_try", wizard: WZ };
  if (tpl) msg.tpl = tpl; else msg.index = index;
  api(msg, function (d) {
    if (d && d.ok) toast("Vises nu på lamperne");
  });
}
function wzStepDone(i) {
  if (i === 0) return WZ.roles.some(function (r) { return r !== "ude"; });
  if (i === 1) return !!(WZ.c1 && WZ.c2);
  if (i === 2) return WZ.items.length > 0;
  if (i === 3) return true;
  return !!WZ.built_at;
}

function wzRender() {
  if (!WZ || !S) return;
  var st = id("wz-steps"); st.innerHTML = "";
  WZ_STEPS.forEach(function (n, i) {
    var b = el("button", (i < WZ.step || (i === 4 && WZ.built_at)) && wzStepDone(i) ? "done" : "", (i + 1) + ". " + n);
    press(b, i === WZ.step);
    b.onclick = function () { wzGo(i); };
    st.appendChild(b);
  });
  var note = id("wz-note");
  note.style.display = wzInfo ? "" : "none";
  note.textContent = wzInfo || "";
  var body = id("wz-body"); body.innerHTML = "";
  [wzStepLamps, wzStepColours, wzStepScenes, wzStepTempo, wzStepFinish][WZ.step](body);
  id("wz-back").style.visibility = WZ.step > 0 ? "visible" : "hidden";
  id("wz-next").style.display = WZ.step < WZ_STEPS.length - 1 ? "" : "none";
}

/* --- trin 1: hvad laver lamperne --- */
function wzStepLamps(box) {
  var roles = wzMeta().roles;
  if (!S.modules.length) {
    box.appendChild(el("p", "wz-lead", "Der er ingen lamper endnu. Opret dem under Patch først — så kommer du tilbage hertil."));
    var b = el("button", "wz-primary", "Gå til Patch"); b.onclick = function () { gotoTab("v-patch"); };
    box.appendChild(b); return;
  }
  box.appendChild(el("p", "wz-lead", "Guiden har fundet " + S.modules.length +
    " lamper i Patch. Fortæl hvad de skal bruges til — så ved guiden hvilke lamper der skal have farver, " +
    "hvilke der skal lyse på musikerne, og hvilke den skal lade være. Den har allerede gættet ud fra lampetyperne."));
  box.appendChild(el("div", "wz-q", "Hele typer på én gang"));
  var types = [], cnt = {};
  S.modules.forEach(function (m) {
    if (!cnt[m.type]) { cnt[m.type] = 0; types.push(m.type); }
    cnt[m.type]++;
  });
  var tb = el("div", "wz-types");
  types.forEach(function (typ) {
    var row = el("div", "wz-type");
    row.appendChild(el("span", "tn", wzProfName(typ) + " (" + cnt[typ] + " stk.)"));
    roles.forEach(function (r) {
      var all = true;
      S.modules.forEach(function (m, i) { if (m.type === typ && WZ.roles[i] !== r[0]) all = false; });
      var b = el("button", "sm", r[1]);
      press(b, all);
      b.onclick = function () {
        S.modules.forEach(function (m, i) { if (m.type === typ) WZ.roles[i] = r[0]; });
        wzSave(); wzRender();
      };
      row.appendChild(b);
    });
    tb.appendChild(row);
  });
  box.appendChild(tb);
  box.appendChild(el("div", "wz-q", "Eller lampe for lampe — tryk på en lampe for at flytte den"));
  var wrap = el("div", "wz-roles");
  roles.forEach(function (r, ri) {
    var col = el("div", "wz-role");
    col.appendChild(el("h4", "", r[1]));
    col.appendChild(el("div", "d", r[2]));
    var n = 0;
    S.modules.forEach(function (m, i) {
      if (WZ.roles[i] !== r[0]) return;
      n++;
      var c = el("button", "wz-chip");
      var bn = el("b", "", m.num || String(i + 1)); c.appendChild(bn);
      c.appendChild(document.createTextNode(m.name));
      c.title = wzProfName(m.type) + " — tryk for at flytte til " + roles[(ri + 1) % roles.length][1];
      c.onclick = function () {
        WZ.roles[i] = roles[(ri + 1) % roles.length][0];
        wzSave(); wzRender();
      };
      col.appendChild(c);
    });
    if (!n) col.appendChild(el("div", "hint", "Ingen lamper her."));
    wrap.appendChild(col);
  });
  box.appendChild(wrap);
  var whiteInColour = S.modules.some(function (m, i) {
    if (WZ.roles[i] !== "farve" && WZ.roles[i] !== "baggrund") return false;
    var p = (META.builtin_profiles || {})[m.type] || (S.profiles || {})[m.type];
    return p && !p.channels.some(function (c) { return c.k === "r" || c.k === "g" || c.k === "b"; });
  });
  if (whiteInColour) box.appendChild(el("p", "hint",
    "Bemærk: der er lamper uden farver (fx hvide spots) under Farvelys eller Baggrund. De lyser bare hvidt med i takt."));
}

/* --- trin 2: farver --- */
function wzStepColours(box) {
  box.appendChild(el("p", "wz-lead", "Vælg showets to hovedfarver. Farve 1 bruges på farvelyset, " +
    "farve 2 på baggrunden og som modfarve i effekterne. Du kan senere give enkelte scener andre farver."));
  box.appendChild(el("div", "wz-q", "Færdige farvesæt"));
  var pals = el("div", "wz-pals");
  wzMeta().palettes.forEach(function (p) {
    var b = el("button", "wz-pal");
    b.appendChild(wzSwatch(p[2])); b.appendChild(wzSwatch(p[3]));
    b.appendChild(el("div", "", p[1]));
    b.appendChild(el("div", "hint", wzColName(p[2]) + " og " + wzColName(p[3])));
    press(b, WZ.c1 === p[2] && WZ.c2 === p[3]);
    b.onclick = function () { WZ.palette = p[0]; WZ.c1 = p[2]; WZ.c2 = p[3]; wzSave(); wzRender(); };
    pals.appendChild(b);
  });
  box.appendChild(pals);
  box.appendChild(el("div", "wz-q", "Eller vælg selv"));
  ["c1", "c2"].forEach(function (k, n) {
    var row = el("div", "wz-colrow");
    row.appendChild(el("span", "", "Farve " + (n + 1)));
    row.appendChild(wzSwatch(WZ[k]));
    var sel = el("select");
    wzMeta().colours.forEach(function (c) {
      var o = el("option", "", c[1]); o.value = c[0]; if (WZ[k] === c[0]) o.selected = true; sel.appendChild(o);
    });
    sel.onchange = function () { WZ[k] = sel.value; WZ.palette = ""; wzSave(); wzRender(); };
    row.appendChild(sel);
    box.appendChild(row);
  });
  var tr = el("div", "btns"); tr.style.marginTop = "14px";
  var b1 = el("button", "", "Se farverne på lamperne");
  b1.onclick = function () { wzTry(0, "rolig"); };
  tr.appendChild(b1);
  box.appendChild(tr);
}

/* --- trin 3: scener --- */
function wzColSelect(item, k) {
  var sel = el("select");
  [["s1", "Showfarve 1 (" + wzColName(WZ.c1) + ")"], ["s2", "Showfarve 2 (" + wzColName(WZ.c2) + ")"]]
    .concat(wzMeta().colours.map(function (c) { return [c[0], c[1]]; }))
    .forEach(function (c) {
      var o = el("option", "", c[1]); o.value = c[0]; if (item[k] === c[0]) o.selected = true; sel.appendChild(o);
    });
  return sel;
}
function wzStepScenes(box) {
  box.appendChild(el("p", "wz-lead", "Her er de scener, du får at spille med. Rækkefølgen her bliver " +
    "rækkefølgen i live-matrixen, og de første ni kan kaldes med tasterne 1–9. Giv dem gerne navne efter jeres " +
    "numre, og tryk Prøv for at se en scene på lamperne."));
  var list = el("div", "wz-cards");
  WZ.items.forEach(function (it, i) {
    var tpl = wzTpl(it.tpl);
    var card = el("div", "wz-card");
    var top = el("div", "top");
    top.appendChild(el("span", "no", String(i + 1)));
    var nm = document.createElement("input"); nm.type = "text"; nm.value = it.name;
    nm.oninput = function () { it.name = nm.value; wzSave(); };
    top.appendChild(nm);
    var ts = el("select");
    wzMeta().templates.forEach(function (t) {
      var o = el("option", "", t.name); o.value = t.key; if (t.key === it.tpl) o.selected = true; ts.appendChild(o);
    });
    ts.title = "Hvilken slags scene";
    ts.onchange = function () {
      var nt = wzTpl(ts.value);
      if (it.name === tpl.name) it.name = nt.name;
      it.tpl = nt.key; it.fade = nt.fade;
      wzSave(); wzRender();
    };
    top.appendChild(ts);
    var pr = el("button", "", "Prøv"); pr.onclick = function () { wzTry(i); };
    top.appendChild(pr);
    var up = el("button", "nudge", "▲"); up.title = "Flyt op"; up.disabled = i === 0;
    up.onclick = function () { WZ.items.splice(i - 1, 0, WZ.items.splice(i, 1)[0]); wzSave(); wzRender(); };
    var dn = el("button", "nudge", "▼"); dn.title = "Flyt ned"; dn.disabled = i === WZ.items.length - 1;
    dn.onclick = function () { WZ.items.splice(i + 1, 0, WZ.items.splice(i, 1)[0]); wzSave(); wzRender(); };
    var rm = el("button", "sm", "Fjern");
    rm.onclick = function () { WZ.items.splice(i, 1); wzSave(); wzRender(); };
    top.appendChild(up); top.appendChild(dn); top.appendChild(rm);
    card.appendChild(top);
    card.appendChild(el("div", "d", tpl.desc));

    var opts = el("div", "opts");
    if (it.tpl !== "slukket" && it.tpl !== "arbejdslys" && it.tpl !== "strobe" && it.tpl !== "finale") {
      ["a", "b"].forEach(function (k) {
        var l = el("label", "", k === "a" ? "Farve 1" : "Farve 2");
        l.appendChild(wzSwatch(it[k]));
        var s = wzColSelect(it, k);
        s.onchange = function () { it[k] = s.value; wzSave(); wzRender(); };
        l.appendChild(s); opts.appendChild(l);
      });
    }
    if (it.tpl !== "slukket") {
      var ll = el("label", "", "Styrke");
      var ls = el("select");
      [25, 50, 75, 100].forEach(function (v) {
        var o = el("option", "", v + " %"); o.value = v; if (it.level === v) o.selected = true; ls.appendChild(o);
      });
      if ([25, 50, 75, 100].indexOf(it.level) < 0) { var o2 = el("option", "", it.level + " %"); o2.value = it.level; o2.selected = true; ls.appendChild(o2); }
      ls.onchange = function () { it.level = parseInt(ls.value, 10); wzSave(); };
      ll.appendChild(ls); opts.appendChild(ll);
    }
    if (tpl.moving) {
      var fl = el("label", "", "Fart");
      var fs = el("select");
      [[0.5, "Halv"], [1, "Normal"], [2, "Dobbelt"]].forEach(function (v) {
        var o = el("option", "", v[1]); o.value = v[0]; if (it.fart === v[0]) o.selected = true; fs.appendChild(o);
      });
      fs.onchange = function () { it.fart = parseFloat(fs.value); wzSave(); };
      fl.appendChild(fs); opts.appendChild(fl);
    }
    var dl = el("label", "", "Overgang (sek.)");
    var di = document.createElement("input"); di.type = "number"; di.min = 0; di.max = 30; di.step = 0.1; di.value = it.fade;
    di.onchange = function () { var v = parseFloat(di.value); it.fade = isNaN(v) ? 0 : Math.max(0, Math.min(30, v)); wzSave(); };
    dl.appendChild(di); opts.appendChild(dl);
    card.appendChild(opts);
    list.appendChild(card);
  });
  if (!WZ.items.length) list.appendChild(el("p", "hint", "Ingen scener endnu — tilføj nogle herunder."));
  box.appendChild(list);
  var add = el("div", "wz-add");
  add.appendChild(el("span", "", "Tilføj scene:"));
  var as = el("select");
  wzMeta().templates.forEach(function (t) { var o = el("option", "", t.name); o.value = t.key; as.appendChild(o); });
  add.appendChild(as);
  var ab = el("button", "", "+ Tilføj");
  ab.onclick = function () {
    var t = wzTpl(as.value);
    WZ.items.push({ sid: Math.random().toString(16).slice(2, 12), tpl: t.key, name: t.name,
                    a: "s1", b: "s2", level: 100, fart: 1, fade: t.fade });
    wzSave(); wzRender();
  };
  add.appendChild(ab);
  box.appendChild(add);
  var hd = el("p", "hint", "");
  hd.style.marginTop = "10px";
  hd.textContent = "Tip: Har I flere numre i samme stil, så tilføj den samme slags scene flere gange og giv dem numrenes navne.";
  box.appendChild(hd);
}

/* --- trin 4: tempo --- */
function wzStepTempo(box) {
  box.appendChild(el("p", "wz-lead", "Effekterne i scenerne (chase, puls, skift) kan følge musikkens tempo. " +
    "Så tapper du bare takten under koncerten, og lyset følger med — også i den scene der kører."));
  [[true, "Ja, lyset skal følge musikkens tempo (anbefalet)",
    "Under koncerten tapper du takten med tasten T eller knappen TAP i live-matrixen."],
   [false, "Nej, effekterne kører i fast fart",
    "Godt hvis ingen skal passe lyset undervejs."]].forEach(function (o) {
    var l = el("label", "wz-radio" + (WZ.follow === o[0] ? " on" : ""));
    var r = document.createElement("input"); r.type = "radio"; r.name = "wz-follow"; r.checked = WZ.follow === o[0];
    r.onchange = function () { WZ.follow = o[0]; wzSave(); wzRender(); };
    l.appendChild(r);
    l.appendChild(el("b", "", o[1]));
    l.appendChild(el("div", "hint", o[2]));
    box.appendChild(l);
  });
  box.appendChild(el("div", "wz-q", WZ.follow ? "Starttempo" : "Fart"));
  var row = el("div", "wz-colrow");
  row.appendChild(el("span", "", "BPM"));
  var bi = document.createElement("input"); bi.type = "number"; bi.min = 40; bi.max = 220; bi.value = WZ.bpm;
  bi.style.width = "90px";
  bi.onchange = function () {
    var v = parseInt(bi.value, 10); if (isNaN(v)) v = 120;
    WZ.bpm = Math.max(40, Math.min(220, v)); bi.value = WZ.bpm; wzSave();
  };
  row.appendChild(bi);
  var tb = el("button", "tapbtn", "Tap takten her");
  tb.appendChild(el("span", "beat"));
  wireTap(tb);
  tb.addEventListener("mousedown", function () { setTimeout(wzTapSync, 0); });
  tb.addEventListener("touchstart", function () { setTimeout(wzTapSync, 0); });
  function wzTapSync() { WZ.bpm = curBpm(); bi.value = WZ.bpm; wzSave(); }
  row.appendChild(tb);
  box.appendChild(row);
  box.appendChild(el("p", "hint", "Kender du ikke tempoet, så lad det stå på 120. Det er kun et udgangspunkt — " +
    (WZ.follow ? "du tapper det rigtige under koncerten." : "farten passer til de fleste numre.")));
}

/* --- trin 5: gem og afvikl --- */
function wzStepFinish(box) {
  box.appendChild(el("p", "wz-lead", "Sidste trin: giv fanebladet et navn og opret scenerne. " +
    "De lægges i deres eget faneblad under Scener, så dine andre scener ikke røres."));
  var row = el("div", "wz-colrow");
  row.appendChild(el("span", "", "Fanebladets navn"));
  var ti = document.createElement("input"); ti.type = "text"; ti.value = WZ.tab_name; ti.style.minWidth = "220px";
  ti.oninput = function () { WZ.tab_name = ti.value; wzSave(); };
  row.appendChild(ti);
  box.appendChild(row);

  var cnt = { farve: 0, baggrund: 0, front: 0, ude: 0 };
  WZ.roles.forEach(function (r) { cnt[r] = (cnt[r] || 0) + 1; });
  var ul = el("ul", "wz-sum");
  ul.appendChild(el("li", "", WZ.items.length + " scener: " + WZ.items.map(function (x) { return x.name; }).join(", ")));
  ul.appendChild(el("li", "", "Lamper: " + cnt.farve + " farvelys, " + cnt.baggrund + " baggrund, " +
    cnt.front + " frontlys" + (cnt.ude ? ", " + cnt.ude + " ikke med" : "")));
  var cl = el("li", "", "Farver: ");
  cl.appendChild(wzSwatch(WZ.c1)); cl.appendChild(document.createTextNode(wzColName(WZ.c1) + "  "));
  cl.appendChild(wzSwatch(WZ.c2)); cl.appendChild(document.createTextNode(wzColName(WZ.c2)));
  ul.appendChild(cl);
  ul.appendChild(el("li", "", WZ.follow ? "Effekterne følger tempoet (start " + WZ.bpm + " BPM)" : "Effekterne kører i fast fart"));
  box.appendChild(ul);

  var built = !!WZ.built_at;
  var mk = el("button", "wz-primary wz-big", built ? "Opdatér scenerne" : "Opret scenerne");
  mk.disabled = !WZ.items.length;
  mk.onclick = function () {
    mk.disabled = true;
    api({ op: "wizard_build", wizard: WZ }, function (d) {
      mk.disabled = false;
      if (!d || !d.ok) { toast("Det gik ikke — prøv igen"); return; }
      WZ = d.wizard;
      var t = d.made + " scener lagt i fanebladet “" + WZ.tab_name + "”.";
      if (d.kept) t += " " + d.kept + (d.kept === 1 ? " scene" : " scener") +
        " er beholdt uændret, fordi du selv har rettet i " + (d.kept === 1 ? "den" : "dem") + " under Scener.";
      wzResult = t; wzInfo = null;
      sceneTab = WZ.tab_id;
      refresh(function () { wzRender(); });
    });
  };
  box.appendChild(mk);
  if (wzResult) box.appendChild(el("div", "wz-result", wzResult));
  else if (built) box.appendChild(el("p", "hint", "Scenerne blev oprettet " + WZ.built_at +
    ". Har du rettet noget i guiden, så tryk Opdatér scenerne."));

  if (built) {
    box.appendChild(el("div", "wz-q", "Afvikling"));
    var go = el("div", "btns");
    var lv = el("button", "wz-primary wz-big", "▶ Start afvikling");
    lv.onclick = function () { setLiveTab(WZ.tab_id); setLive(true); };
    var sc = el("button", "wz-big", "Se scenerne");
    sc.onclick = function () { sceneTab = WZ.tab_id; gotoTab("v-scene"); };
    go.appendChild(lv); go.appendChild(sc);
    box.appendChild(go);
    var keys = el("ul", "wz-keys");
    ["Tryk på en flise for at skifte scene — eller tasterne 1–9.",
     WZ.follow ? "Tap takten med T eller knappen TAP, så følger effekterne musikken." : "Effekterne kører i fast fart.",
     "B eller Blackout gør alt mørkt med det samme. Tryk igen for at tænde.",
     "Grand-skyderen skruer op og ned for det hele.",
     "Esc eller Afslut live går tilbage hertil."].forEach(function (t) { keys.appendChild(el("li", "", t)); });
    box.appendChild(keys);
  }
}

/* ---------------------------------------------------------------- lag */
function buildLayerList() {
  var box = id("layerlist"); box.innerHTML = "";
  S.layers.forEach(function (L, i) {
    var wrap = el("div", "laybtn");
    var pick = el("button", "pick", L.name);
    press(pick, i === layer);
    pick.onclick = function () { layer = i; buildLayerList(); buildLayerForm(); buildStrips(); };
    var eye = el("button", "", L.on ? "Til" : "Fra");
    eye.title = "Tænd eller sluk laget";
    press(eye, L.on);
    eye.onclick = function () { setv(["layers", i, "on"], !L.on); L.on = !L.on; buildLayerList(); };
    var solo = el("button", "solo", "Solo");
    solo.title = "Sluk alle andre lag imens";
    press(solo, !!L.solo);
    solo.onclick = function () { setv(["layers", i, "solo"], !L.solo); L.solo = !L.solo; buildLayerList(); };
    wrap.appendChild(pick); wrap.appendChild(eye); wrap.appendChild(solo);
    box.appendChild(wrap);
  });
}

function optRow(parent, key, label, options, value, onchange) {
  var r = el("div", "rowline");
  r.appendChild(el("span", "k", label));
  var s = el("select");
  options.forEach(function (o) {
    var op = el("option", "", o[1]); op.value = o[0];
    if (o[0] === value) op.selected = true;
    s.appendChild(op);
  });
  s.onchange = function () { onchange(s.value); };
  r.appendChild(s);
  parent.appendChild(r);
  return s;
}
function rangeRow(parent, label, min, max, value, path, fmt) {
  var r = el("div", "rowline");
  r.appendChild(el("span", "k", label));
  var i = document.createElement("input");
  i.type = "range"; i.min = min; i.max = max; i.value = value;
  var v = el("span", "v", "");
  r.appendChild(i); r.appendChild(v);
  parent.appendChild(r);
  slider(i, v, path, fmt);
  return i;
}
function chk(parent, label, value, path) {
  var l = el("label", "chk");
  var c = document.createElement("input");
  c.type = "checkbox"; c.checked = !!value;
  c.onchange = function () { setv(path, c.checked); };
  l.appendChild(c); l.appendChild(document.createTextNode(" " + label));
  parent.appendChild(l);
  return c;
}

function buildLayerForm() {
  var L = S.layers[layer], box = id("layerform");
  box.innerHTML = "";
  var c1 = el("div", "col"), c2 = el("div", "col"), c3 = el("div", "col");
  box.appendChild(c1); box.appendChild(c2); box.appendChild(c3);

  /* --- moenster --- */
  optRow(c1, "pattern", "Mønster", META.patterns, L.pattern, function (v) {
    setv(["layers", layer, "pattern"], v); L.pattern = v; buildLayerForm();
  });
  if (L.pattern === "egen") {
    var names = S.patterns.map(function (p, i) { return [String(i), p.name]; });
    optRow(c1, "custom", "Hvilket", names, String(L.custom), function (v) {
      setv(["layers", layer, "custom"], parseInt(v, 10));
    });
  }
  rangeRow(c1, "Fart", 0, 200, L.speed, ["layers", layer, "speed"],
           L.sync ? function (v) { return (v / 100).toFixed(2).replace(".", ",") + " omg./slag"; } : undefined);
  rangeRow(c1, "Størrelse", 0, 100, L.size, ["layers", layer, "size"]);
  rangeRow(c1, "Tæthed", 0, 100, L.density, ["layers", layer, "density"]);
  if (L.pattern === "chase") rangeRow(c1, "Hale", 0, 100, L.tail, ["layers", layer, "tail"]);
  if (L.pattern === "teater") rangeRow(c1, "Hop", 0, 10, L.steps, ["layers", layer, "steps"]);
  var dirRow = el("div", "btns");
  var dirB = el("button", "", L.dir > 0 ? "Fremad" : "Baglæns");
  dirB.onclick = function () { L.dir = -L.dir; setv(["layers", layer, "dir"], L.dir); dirB.textContent = L.dir > 0 ? "Fremad" : "Baglæns"; };
  dirRow.appendChild(dirB);
  c1.appendChild(dirRow);
  chk(c1, "Spejlvend", L.mirror, ["layers", layer, "mirror"]);
  /* Foelg tempo: serveren regner Fart om, saa laget koerer lige saa
     hurtigt som foer ved det nuvaerende tempo - derefter styrer tap farten */
  var syncC = chk(c1, "Følg tempo (tap)", L.sync, ["layers", layer, "sync"]);
  syncC.onchange = function () {
    api({ op: "layer_sync", layer: layer, on: syncC.checked }, function () { refresh(); });
  };

  /* --- farve --- */
  optRow(c2, "cm", "Farvekilde", META.colour_modes, L.colour_mode, function (v) {
    setv(["layers", layer, "colour_mode"], v); L.colour_mode = v; buildLayerForm();
  });
  if (L.colour_mode === "fast") {
    var r = el("div", "rowline");
    r.appendChild(el("span", "k", "Farve"));
    var cc = colourControl(r, L.colour, function (c) {
      setv(["layers", layer, "colour"], c);
    });
    c2.appendChild(r);
    var sw = el("div", "swatchrow af-swatches");
    activePalette().forEach(function (col, ki) {
      var b = el("button", "af-sw" + (col[0] + col[1] + col[2] > 720 ? " wht" : ""));
      b.style.background = hex(col);
      var lbl = el("span", "pal-key", PAL_KEYS[ki] || "");
      b.appendChild(lbl);
      b.title = PAL_KEYS[ki] || "";
      b.onclick = function () { cc.set(col); setv(["layers", layer, "colour"], col); };
      sw.appendChild(b);
    });
    c2.appendChild(sw);
    buildPaletteBar(c2);
  } else if (L.colour_mode === "regnbue") {
    rangeRow(c2, "Hue-fart", -100, 100, L.hue_speed, ["layers", layer, "hue_speed"]);
    rangeRow(c2, "Hue-spredn.", 0, 400, L.hue_spread, ["layers", layer, "hue_spread"]);
  } else {
    var wrap = el("div", "swatchrow");
    L.stops.forEach(function (col, si) {
      colourControl(wrap, col, function (c) {
        setv(["layers", layer, "stops", si], c);
      });
    });
    var add = el("button", "sm", "Tilføj stop");
    add.onclick = function () {
      L.stops.push([255, 255, 255]);
      setv(["layers", layer, "stops"], L.stops, buildLayerForm);
    };
    var rem = el("button", "sm", "Fjern stop");
    rem.onclick = function () {
      if (L.stops.length > 1) { L.stops.pop(); setv(["layers", layer, "stops"], L.stops, buildLayerForm); }
    };
    wrap.appendChild(add); wrap.appendChild(rem);
    c2.appendChild(wrap);
    if (L.colour_mode === "cyklus")
      rangeRow(c2, "Cyklusfart", 0, 100, L.hue_speed, ["layers", layer, "hue_speed"]);
  }
  rangeRow(c2, "Styrke", 0, 255, L.opacity, ["layers", layer, "opacity"]);
  optRow(c2, "blend", "Blanding", META.blends, L.blend, function (v) {
    setv(["layers", layer, "blend"], v); L.blend = v;
  });

  /* --- rum og spredning --- */
  optRow(c3, "domain", "Kører i", [["module", "Hver lampe"], ["world", "Rummet"]],
    L.domain, function (v) { setv(["layers", layer, "domain"], v); L.domain = v; buildLayerForm(); });
  if (L.domain === "world")
    rangeRow(c3, "Retning", -180, 180, L.angle, ["layers", layer, "angle"], function (v) { return v + "°"; });
  optRow(c3, "sm", "Forskydning", META.spreads, L.spread_mode, function (v) {
    setv(["layers", layer, "spread_mode"], v); L.spread_mode = v; buildLayerForm();
  });
  if (L.spread_mode !== "ingen")
    rangeRow(c3, "Mængde", 0, 300, L.spread, ["layers", layer, "spread"], function (v) { return v + "%"; });

  /* --- kopiér / byt / nulstil --- */
  var tools = el("div", "laytools");
  var tr = el("div", "rowline");
  tr.appendChild(el("span", "k", "Kopiér til"));
  var tsel = el("select");
  S.layers.forEach(function (LL, li) {
    if (li === layer) return;
    var o = el("option", "", LL.name + (LL.on ? " (til)" : ""));
    o.value = String(li);
    tsel.appendChild(o);
  });
  tr.appendChild(tsel);
  tools.appendChild(tr);
  var tb = el("div", "btns");
  var bcopy = el("button", "sm", "Kopiér");
  bcopy.title = "Overskriv det valgte lag med dette lags indstillinger";
  bcopy.onclick = function () {
    if (!tsel.value) return;
    api({ op: "layer_copy", from: layer, to: parseInt(tsel.value, 10) },
        function () { refresh(); toast("Lag kopieret"); });
  };
  var bswap = el("button", "sm", "Byt om");
  bswap.onclick = function () {
    if (!tsel.value) return;
    api({ op: "layer_swap", from: layer, to: parseInt(tsel.value, 10) },
        function () { refresh(); toast("Lag byttet"); });
  };
  var bclr = el("button", "sm", "Nulstil dette lag");
  bclr.onclick = function () {
    if (confirm("Nulstil " + L.name + "?"))
      api({ op: "layer_clear", index: layer }, refresh);
  };
  tb.appendChild(bcopy); tb.appendChild(bswap); tb.appendChild(bclr);
  tools.appendChild(tb);
  c3.appendChild(tools);

  var gb = el("div", "btns");
  S.groups.forEach(function (g, gi) {
    var b = el("button", "ghost", g.name);
    b.onclick = function () { api({ op: "group_select", layer: layer, group: gi }, refresh); };
    gb.appendChild(b);
  });
  var ball = el("button", "ghost", "Alle");
  ball.onclick = function () { setv(["layers", layer, "mask"], [], refresh); };
  gb.appendChild(ball);
  var bnew = el("button", "ghost", "Gem valg som gruppe");
  bnew.onclick = function () {
    var n = prompt("Navn på gruppen", "Gruppe " + (S.groups.length + 1));
    if (n) api({ op: "group_new", name: n, members: S.layers[layer].mask.slice() }, refresh);
  };
  gb.appendChild(bnew);
  var mh = el("div", "hint", "Maske — hvilke lamper laget rammer:");
  c3.insertBefore(mh, tools);
  c3.insertBefore(gb, tools);
}

/* ------------------------------------------------------------ moduler */
function buildQuickPick() {
  var box = id("quickpick"); box.innerHTML = "";
  function mask(list) { setv(["layers", layer, "mask"], list, refresh); }
  var n = S.modules.length, i;
  var defs = [
    ["Alle", function () { mask([]); }],
    ["Ingen", function () { mask([-1]); }],
    ["Ulige", function () { var a = []; for (i = 0; i < n; i += 2) a.push(i); mask(a); }],
    ["Lige", function () { var a = []; for (i = 1; i < n; i += 2) a.push(i); mask(a); }],
    ["Vend om", function () {
      var cur = S.layers[layer].mask, a = [];
      for (i = 0; i < n; i++) if (cur.indexOf(i) < 0) a.push(i);
      mask(a);
    }]
  ];
  defs.forEach(function (d) {
    var b = el("button", "ghost", d[0]); b.onclick = d[1]; box.appendChild(b);
  });
  var bon = el("button", "ghost", "Tænd alle");
  bon.onclick = function () { allPower(true); };
  var boff = el("button", "ghost", "Sluk alle");
  boff.onclick = function () { allPower(false); };
  box.appendChild(bon); box.appendChild(boff);
}
function allPower(v) {
  var items = S.modules.map(function (m, i) {
    m.on = v; return { path: ["modules", i, "on"], value: v };
  });
  api({ op: "patch", items: items }, refresh);
}

var stripCv = [];
function buildStrips() {
  var box = id("strips"); box.innerHTML = ""; stripCv = [];
  box.className = stripsCompact ? "compact" : "";
  var mask = S.layers[layer].mask;
  S.modules.forEach(function (m, i) {
    var inMask = mask.length === 0 || mask.indexOf(i) >= 0;
    var s = el("div", "strip" + (m.on ? "" : " off") + (inMask ? " inmask" : ""));
    var hd = el("div", "hd");
    hd.appendChild(el("span", "no", String(m.num != null ? m.num : (i + 1))));
    hd.appendChild(el("span", "nm", m.name));
    if (!stripsCompact)
      hd.appendChild(el("span", "ad", "U" + m.universe + "·" + m.address));
    s.appendChild(hd);

    var cv = document.createElement("canvas");
    s.appendChild(cv); stripCv.push(cv);

    var lv = el("div", "lv");
    var f = document.createElement("input");
    f.type = "range"; f.min = 0; f.max = 255; f.value = m.level;
    var vv = el("span", "", String(m.level));
    lv.appendChild(f); lv.appendChild(vv);
    s.appendChild(lv);
    slider(f, vv, ["modules", i, "level"]);

    var bt = el("div", "bt");
    var bo = el("button", "", stripsCompact ? (m.on ? "På" : "Af") : (m.on ? "Tændt" : "Slukket"));
    bo.title = "Simulerer at strømmen tages af lampen";
    press(bo, m.on);
    bo.onclick = function () { m.on = !m.on; setv(["modules", i, "on"], m.on); buildStrips(); };
    var bv = el("button", "", stripsCompact ? "Lag" : "I lag");
    bv.title = "Tag lampen med i det lag du redigerer";
    press(bv, inMask);
    bv.onclick = function () {
      var cur = S.layers[layer].mask.slice();
      if (cur.length === 0) { cur = []; for (var k = 0; k < S.modules.length; k++) cur.push(k); }
      var p = cur.indexOf(i);
      if (p >= 0) cur.splice(p, 1); else cur.push(i);
      S.layers[layer].mask = cur;
      setv(["layers", layer, "mask"], cur, function () { buildStrips(); });
    };
    var bs = el("button", "", stripsCompact ? "Kun" : "Kun her");
    bs.title = "Lad laget ramme kun denne lampe";
    bs.onclick = function () {
      S.layers[layer].mask = [i];
      setv(["layers", layer, "mask"], [i], function () { buildStrips(); });
    };
    bt.appendChild(bo); bt.appendChild(bv); bt.appendChild(bs);
    s.appendChild(bt);
    box.appendChild(s);
  });
  buildManual();
}

/* ------------------------------------------------------- faste kanaler */
/* Manuelle kanaler (hvid, ravgul, UV, strobe, makro) der ligger uden for
   farvemotoren. Rammer lamperne i det lag du redigerer (tom maske = alle).
   Kun kanaler som mindst én af mållamperne faktisk har, vises. */
function manualTargets() {
  var mask = S.layers[layer].mask, idxs = [];
  S.modules.forEach(function (m, i) {
    if (mask.length === 0 || mask.indexOf(i) >= 0) idxs.push(i);
  });
  return idxs;
}
function buildManual() {
  var box = id("manual"); if (!box) return;
  box.innerHTML = "";
  var idxs = manualTargets();
  var LABELS = { w: "Hvid", a: "Ravgul", uv: "UV", strobe: "Strobe", duration: "Blinkvarighed", macro: "Makro", generic: "Ekstra" };
  var order = ["w", "a", "uv", "strobe", "duration", "macro", "generic"];
  var have = {};
  idxs.forEach(function (i) {
    order.forEach(function (k) { if (lampHasKey(S.modules[i], k)) have[k] = true; });
  });
  var present = order.filter(function (k) { return have[k]; });
  if (!idxs.length || !present.length) {
    box.appendChild(el("div", "hint", idxs.length
      ? "De valgte lamper har ingen manuelle kanaler."
      : "Ingen lamper i lagets maske."));
    return;
  }
  present.forEach(function (k) {
    var first = 0, j;
    for (j = 0; j < idxs.length; j++) {
      if (lampHasKey(S.modules[idxs[j]], k)) {
        first = (S.modules[idxs[j]].ovr || {})[k] || 0; break;
      }
    }
    var r = el("div", "rowline");
    r.appendChild(el("span", "k", LABELS[k] || k));
    var inp = document.createElement("input");
    inp.type = "range"; inp.min = 0; inp.max = 255; inp.value = first;
    var v = el("span", "v", "");
    r.appendChild(inp); r.appendChild(v);
    box.appendChild(r);
    localPair(inp, v, function (val) {
      var items = [];
      manualTargets().forEach(function (i) {
        if (!lampHasKey(S.modules[i], k)) return;
        S.modules[i].ovr = S.modules[i].ovr || {};
        S.modules[i].ovr[k] = val;
        items.push({ path: ["modules", i, "ovr", k], value: val });
      });
      if (items.length) throttledPatch("ovr." + k, items);
    });
  });
}

/* ------------------------------------------------------------- layout */
var dragMod = -1;
var panX = 0, panY = 0;          /* layoutets forskydning i px */
var layPan = null;               /* igangvaerende traek af hele visningen */
var layLblDrag = null;           /* igangvaerende traek af et navn */
var layEdResize = null;          /* igangvaerende resize af en form */
var layEdPreview = null;         /* form der tegnes lige nu */
var LAY_HANDLE = 8;              /* haandtagets stoerrelse i px */
var laySel = [];                 /* valgte lampe-indekser i Layout (til gruppe) */
var laySelG = [];                /* valgte gruppe-id'er i Layout */
var layGDrag = null;             /* igangvaerende traek af en gruppe-label */
var layMarq = null;              /* markeringsrektangel */
var gBoxesLay = [];              /* label-kasser i Layout (til klik) */

/* ---------------------------------------------------- grupper (fælles) */
function groupById(gid) {
  var gs = (S && S.group_labels) || [];
  for (var i = 0; i < gs.length; i++) if (gs[i].id === gid) return gs[i];
  return null;
}
/* alle lampe-indekser under en gruppe, fladet ud i rækkefølge (= nummerering) */
function groupLeaves(gid, seen) {
  var g = groupById(gid); if (!g) return [];
  seen = seen || {}; if (seen[gid]) return []; seen[gid] = 1;
  var out = [];
  (g.members || []).forEach(function (m) {
    if (m.t === "lamp") out.push(m.i);
    else if (m.t === "grp") out = out.concat(groupLeaves(m.id, seen));
  });
  var got = {}, dedup = [];
  out.forEach(function (i) { if (!got[i]) { got[i] = 1; dedup.push(i); } });
  return dedup;
}
/* indeholder gruppen 'gid' et sted nede gruppen 'target'? */
function grpContains(gid, target, seen) {
  if (gid === target) return true;
  seen = seen || {}; if (seen[gid]) return false; seen[gid] = 1;
  var g = groupById(gid); if (!g) return false;
  for (var i = 0; i < (g.members || []).length; i++) {
    var m = g.members[i];
    if (m.t === "grp" && grpContains(m.id, target, seen)) return true;
  }
  return false;
}
function inArr(a, v) { return a.indexOf(v) >= 0; }
function toggleArr(a, v) { var k = a.indexOf(v); if (k >= 0) a.splice(k, 1); else a.push(v); }

/* Tegn gruppe-labels med stiplede streger til indholdet. X/Y er
   koordinat-funktioner (verden -> skærm). Fylder boxes med label-kasser
   til klik-test. Tegnes i to runder: streger nederst, labels øverst. */
function drawGroupLabels(g, X, Y, selG, boxes, litFrame) {
  var gs = (S && S.group_labels) || [];
  boxes.length = 0;
  if (!gs.length) return;
  g.save();
  g.lineWidth = 1.2;
  gs.forEach(function (gr) {
    var ax = X(gr.x), ay = Y(gr.y);
    var on = inArr(selG, gr.id);
    g.strokeStyle = cssvar("--accent");
    g.globalAlpha = on ? 0.85 : 0.4;
    g.lineWidth = on ? 2 : 1.2;
    if (g.setLineDash) g.setLineDash(on ? [6, 3] : [4, 4]);
    (gr.members || []).forEach(function (m) {
      var tx = null, ty = null;
      if (m.t === "lamp" && S.modules[m.i]) { tx = X(S.modules[m.i].x); ty = Y(S.modules[m.i].y); }
      else if (m.t === "grp") { var cg = groupById(m.id); if (cg) { tx = X(cg.x); ty = Y(cg.y); } }
      if (tx != null) { g.beginPath(); g.moveTo(ax, ay); g.lineTo(tx, ty); g.stroke(); }
    });
  });
  if (g.setLineDash) g.setLineDash([]);
  g.globalAlpha = 1;
  g.font = "700 13px " + getComputedStyle(document.body).fontFamily;
  g.textAlign = "center"; g.textBaseline = "middle";
  gs.forEach(function (gr) {
    var ax = X(gr.x), ay = Y(gr.y);
    var on = inArr(selG, gr.id);
    var txt = gr.name || "Gruppe";
    var wTxt = g.measureText(txt).width;
    var bw = wTxt + 22, bh = 24;
    var l = ax - bw / 2, t = ay - bh / 2;
    boxes.push({ id: gr.id, l: l, t: t, w: bw, h: bh });
    g.fillStyle = on ? cssvar("--accent") : "rgba(0,0,0,.62)";
    roundRect(g, l, t, bw, bh, 6); g.fill();
    g.strokeStyle = cssvar("--accent"); g.lineWidth = on ? 2 : 1.5;
    roundRect(g, l, t, bw, bh, 6); g.stroke();
    g.fillStyle = on ? cssvar("--accent-ink") : cssvar("--ink");
    g.fillText(txt, ax, ay + 1);
  });
  g.restore();
}
function hitGroupBox(boxes, sx, sy) {
  for (var i = boxes.length - 1; i >= 0; i--) {
    var b = boxes[i];
    if (sx >= b.l && sx <= b.l + b.w && sy >= b.t && sy <= b.t + b.h) return b.id;
  }
  return null;
}
/* lampe nærmest et punkt (verden), inden for radius */
function lampNear(wx, wy, maxd) {
  var best = -1, bd = 1e9;
  S.modules.forEach(function (m, i) {
    var d = (m.x - wx) * (m.x - wx) + (m.y - wy) * (m.y - wy);
    if (d < bd) { bd = d; best = i; }
  });
  return bd < (maxd || 1.5) ? best : -1;
}
function selOrderedLamps(lampSel, grpSel) {
  /* ordnede lampe-indekser: grupper foldes ud i deres nummerering (i den
     rækkefølge de blev valgt), derefter løse lamper. Dubletter droppes. */
  var out = [], got = {};
  (grpSel || []).forEach(function (gid) {
    groupLeaves(gid).forEach(function (i) { if (!got[i]) { got[i] = 1; out.push(i); } });
  });
  (lampSel || []).forEach(function (i) { if (!got[i]) { got[i] = 1; out.push(i); } });
  return out;
}

/* --- koordinater: verden (meter, y opad) <-> skaerm (px, y nedad) --- */
function layCx() { var cv = id("stage"); return cv.width / 2 + panX; }
function layCy() { var cv = id("stage"); return cv.height / 2 + panY; }
function L2SX(x) { return layCx() + x * scale; }
function L2SY(y) { return layCy() - y * scale; }
function S2LX(p) { return (p - layCx()) / scale; }
function S2LY(p) { return -(p - layCy()) / scale; }

function viewCfg() {
  return (S && S.view) || { labels: false, label_color: "#e8ecf4",
    label_opacity: 85, beams: false, pool: 15, inten: 40, beam: 50, bang: 14, grid: 4 };
}
function poolRadiusL(sh, br, sc, poolK) {
  var base = sh === "wash" ? 3.6 : sh === "spot" ? 1.7 : sh === "bar" ? 3.2 : 2.6;
  return base * sc * (0.45 + 0.55 * br) * poolK;
}

function drawStage() {
  /* Kan blive kaldt foer showet er hentet (fx naar wire() saetter
     vaerktoejerne op). Uden dette vaern kaster den, og alt hvad der
     koerer EFTER kaldet i wire() bliver aldrig sat op. */
  if (!S || !S.modules) return;
  var cv = id("stage");
  if (!cv.width || cv._w !== cv.clientWidth) {
    cv.width = cv.clientWidth; cv.height = cv.clientHeight; cv._w = cv.clientWidth;
  }
  var g = cv.getContext("2d"), w = cv.width, h = cv.height;
  var V = viewCfg();
  g.clearRect(0, 0, w, h);
  var cx = layCx(), cy = layCy();

  /* gitter */
  g.strokeStyle = cssvar("--rule"); g.globalAlpha = 0.45; g.lineWidth = 1;
  var x0 = cx % scale; if (x0 < 0) x0 += scale;
  var y0 = cy % scale; if (y0 < 0) y0 += scale;
  for (var x = x0; x < w; x += scale) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (var y = y0; y < h; y += scale) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.globalAlpha = 1; g.strokeStyle = cssvar("--rule");
  g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke();

  /* scene-former */
  var sobs = (S && S.stage_objects) || [];
  sobs.forEach(function (o, idx) {
    g.save();
    g.fillStyle = o.color || "#2a3040";
    g.strokeStyle = idx === layEdSel ? cssvar("--accent") : "rgba(200,210,225,.2)";
    g.lineWidth = idx === layEdSel ? 3 : 1;
    layShapePath(g, o);
    g.fill(); g.stroke();
    if (o.label) {
      var r = layObjRect(o);
      g.fillStyle = "rgba(255,255,255,.45)";
      g.font = "700 11px " + getComputedStyle(document.body).fontFamily;
      g.textAlign = "center";
      g.fillText(o.label, r.l + r.w / 2, r.t + r.h / 2 + 4);
    }
    g.restore();
  });
  /* resize-haandtag paa valgt form */
  if (layEdSel >= 0 && sobs[layEdSel]) {
    var hs = layHandles(sobs[layEdSel]);
    g.fillStyle = cssvar("--accent"); g.strokeStyle = cssvar("--bg"); g.lineWidth = 1;
    hs.forEach(function (hh) {
      g.fillRect(hh.x - LAY_HANDLE / 2, hh.y - LAY_HANDLE / 2, LAY_HANDLE, LAY_HANDLE);
      g.strokeRect(hh.x - LAY_HANDLE / 2, hh.y - LAY_HANDLE / 2, LAY_HANDLE, LAY_HANDLE);
    });
  }
  /* forhaandsvisning mens man tegner */
  if (layEdPreview) {
    g.save();
    g.fillStyle = (id("le-color") || {}).value || "#2a3040";
    g.globalAlpha = 0.45;
    g.strokeStyle = cssvar("--accent"); g.lineWidth = 2;
    if (g.setLineDash) g.setLineDash([6, 4]);
    layShapePath(g, layEdPreview);
    g.fill(); g.stroke();
    g.restore();
  }

  var frame = lastFrame;

  /* stråler og lyspøl - additivt, så overlap blandes som rigtigt lys */
  if (V.beams) {
    g.save();
    g.globalCompositeOperation = "lighter";
    S.modules.forEach(function (m, i) {
      if (!m.on) return;
      var hx = (frame && frame[i]) ? frame[i].substr(0, 6) : "000000";
      var c = [parseInt(hx.substr(0, 2), 16), parseInt(hx.substr(2, 2), 16),
               parseInt(hx.substr(4, 2), 16)];
      var br = Math.max(c[0], c[1], c[2]) / 255;
      if (br <= 0.01) return;
      var X = L2SX(m.x), Y = L2SY(m.y), sh = lampProfile(m).shape;
      var ang = -(m.rot || 0) * Math.PI / 180;
      var len = poolRadiusL(sh, br, scale, V.pool / 45) * 1.5 * (V.beam / 50);
      var half = (V.bang || 14) * Math.PI / 180;
      var a = Math.min(0.55, (0.08 + 0.3 * br) * (V.beam / 50));
      g.save(); g.translate(X, Y); g.rotate(ang);
      var grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")");
      grd.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(len, -Math.tan(half) * len); g.lineTo(len, Math.tan(half) * len);
      g.closePath(); g.fill();
      g.restore();
    });
    g.restore();
  }

  /* lamperne selv */
  S.modules.forEach(function (m, i) {
    var prof = lampProfile(m);
    var cx2 = L2SX(m.x), cy2 = L2SY(m.y);
    var rad = Math.max(8, scale * 0.26);
    var sel = i === lastMod;
    var col = (frame && frame[i]) ? ("#" + frame[i].substr(0, 6)) : "#202530";
    var lit = m.on && frame && frame[i] && frame[i].substr(0, 6) !== "000000";

    if (lit) {
      g.save(); g.globalAlpha = 0.35; g.fillStyle = col;
      g.beginPath(); g.arc(cx2, cy2, rad * 1.9, 0, 6.283); g.fill(); g.restore();
    }
    g.lineWidth = sel ? 4 : 2;
    g.strokeStyle = sel ? cssvar("--accent") : (m.on ? cssvar("--ink") : cssvar("--dim"));
    g.fillStyle = m.on ? col : cssvar("--panel2");
    if (prof.shape === "wash") {
      roundRect(g, cx2 - rad * 1.35, cy2 - rad * 0.7, rad * 2.7, rad * 1.4, 4);
      g.fill(); g.stroke();
    } else if (prof.shape === "spot") {
      g.beginPath();
      g.moveTo(cx2, cy2 - rad); g.lineTo(cx2 + rad * 0.92, cy2 + rad * 0.8);
      g.lineTo(cx2 - rad * 0.92, cy2 + rad * 0.8); g.closePath();
      g.fill(); g.stroke();
    } else if (prof.shape === "bar") {
      roundRect(g, cx2 - rad * 1.7, cy2 - rad * 0.32, rad * 3.4, rad * 0.64, 3);
      g.fill(); g.stroke();
    } else {
      g.beginPath(); g.arc(cx2, cy2, rad, 0, 6.283); g.fill(); g.stroke();
    }
    /* nummeret - altid synligt, lille og dæmpet */
    g.fillStyle = cssvar("--muted");
    g.font = "bold 11px " + getComputedStyle(document.body).fontFamily;
    g.textAlign = "left";
    g.fillText(String(m.num != null ? m.num : (i + 1)), cx2 + rad + 3, cy2 - rad + 2);
  });

  /* markerede lamper (til gruppedannelse) - tydelig ring */
  if (laySel.length) {
    g.save();
    g.strokeStyle = cssvar("--accent"); g.lineWidth = 3;
    if (g.setLineDash) g.setLineDash([4, 3]);
    laySel.forEach(function (i) {
      var m = S.modules[i]; if (!m) return;
      var rr = Math.max(8, scale * 0.26) + 5;
      g.beginPath(); g.arc(L2SX(m.x), L2SY(m.y), rr, 0, 6.283); g.stroke();
    });
    if (g.setLineDash) g.setLineDash([]);
    g.restore();
  }

  /* navne øverst, så de aldrig gemmer sig bag en lampe */
  if (V.labels) {
    S.modules.forEach(function (m, i) {
      if (m.lbl === false) return;
      drawLampLabel(g, m, i, V);
    });
  }

  /* gruppe-labels med stiplede streger til indholdet */
  drawGroupLabels(g, L2SX, L2SY, laySelG, gBoxesLay);

  /* markeringsrektangel */
  if (layMarq) {
    g.save();
    g.strokeStyle = cssvar("--accent"); g.fillStyle = cssvar("--accent");
    g.globalAlpha = 0.12; g.fillRect(layMarq.l, layMarq.t, layMarq.w, layMarq.h);
    g.globalAlpha = 0.9; g.lineWidth = 1;
    if (g.setLineDash) g.setLineDash([4, 3]);
    g.strokeRect(layMarq.l, layMarq.t, layMarq.w, layMarq.h);
    if (g.setLineDash) g.setLineDash([]);
    g.restore();
  }
}

/* navnets position og henvisningsstreg */
function labelPos(m) {
  var off = (m.lx || m.ly) ? 0 : 1;      /* uden forskydning: lige over lampen */
  var rad = Math.max(8, scale * 0.26);
  return { x: L2SX(m.x + (m.lx || 0)),
           y: L2SY(m.y + (m.ly || 0)) - (off ? rad + 7 : 0) };
}
function drawLampLabel(g, m, i, V) {
  var p = labelPos(m);
  var txt = m.name || ("Lampe " + (i + 1));
  var op = Math.max(0, Math.min(100, V.label_opacity == null ? 85 : V.label_opacity)) / 100;
  var rad = Math.max(8, scale * 0.26);
  g.save();
  g.font = "700 12px " + getComputedStyle(document.body).fontFamily;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  /* henvisningsstreg når navnet er trukket væk */
  if ((Math.abs(m.lx || 0) + Math.abs(m.ly || 0)) > 0.12) {
    var lx = L2SX(m.x), ly = L2SY(m.y);
    var dx = p.x - lx, dy = p.y - ly, d = Math.sqrt(dx * dx + dy * dy) || 1;
    g.globalAlpha = op * 0.55;
    g.strokeStyle = V.label_color || "#e8ecf4";
    g.lineWidth = 1;
    if (g.setLineDash) g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(lx + dx / d * rad, ly + dy / d * rad);
    g.lineTo(p.x - dx / d * 4, p.y - dy / d * 4 + 4);
    g.stroke();
    if (g.setLineDash) g.setLineDash([]);
  }
  g.globalAlpha = op;
  var wTxt = g.measureText(txt).width;
  g.fillStyle = "rgba(0,0,0,.45)";
  g.fillRect(p.x - wTxt / 2 - 4, p.y - 11, wTxt + 8, 15);
  g.fillStyle = V.label_color || "#e8ecf4";
  g.fillText(txt, p.x, p.y);
  g.restore();
}
function hitLabel(sxp, syp) {
  var V = viewCfg(); if (!V.labels) return -1;
  var cv = id("stage"), g = cv.getContext("2d");
  g.font = "700 12px " + getComputedStyle(document.body).fontFamily;
  for (var i = S.modules.length - 1; i >= 0; i--) {
    var m = S.modules[i]; if (m.lbl === false) continue;
    var p = labelPos(m);
    var txt = m.name || ("Lampe " + (i + 1));
    var wTxt = g.measureText(txt).width;
    if (sxp >= p.x - wTxt / 2 - 5 && sxp <= p.x + wTxt / 2 + 5 &&
        syp >= p.y - 13 && syp <= p.y + 5) return i;
  }
  return -1;
}

/* --- scene-former: geometri --- */
function layObjRect(o) {
  if (o.shape === "circle")
    return { l: L2SX(o.x - o.r), t: L2SY(o.y + o.r), w: o.r * 2 * scale, h: o.r * 2 * scale };
  return { l: L2SX(o.x), t: L2SY(o.y + (o.h || 0)), w: (o.w || 0) * scale, h: (o.h || 0) * scale };
}
function layShapePath(g, o) {
  if (o.shape === "rect") {
    g.beginPath(); g.rect(L2SX(o.x), L2SY(o.y + o.h), o.w * scale, o.h * scale);
  } else if (o.shape === "circle") {
    g.beginPath(); g.arc(L2SX(o.x), L2SY(o.y), o.r * scale, 0, 6.283);
  } else if (o.shape === "tri") {
    var tl = L2SX(o.x), tb = L2SY(o.y), tt = L2SY(o.y + o.h), tw = o.w * scale;
    g.beginPath(); g.moveTo(tl, tb); g.lineTo(tl + tw, tb);
    g.lineTo(tl + tw / 2, tt); g.closePath();
  }
}
function layHandles(o) {
  var r = layObjRect(o);
  return [{ id: "tl", x: r.l, y: r.t }, { id: "tr", x: r.l + r.w, y: r.t },
          { id: "bl", x: r.l, y: r.t + r.h }, { id: "br", x: r.l + r.w, y: r.t + r.h }];
}
function layHitHandle(sxp, syp, o) {
  var hs = layHandles(o);
  for (var i = 0; i < hs.length; i++)
    if (Math.abs(sxp - hs[i].x) < LAY_HANDLE && Math.abs(syp - hs[i].y) < LAY_HANDLE) return hs[i];
  return null;
}
function layHitObj(sxp, syp) {
  var sobs = (S && S.stage_objects) || [];
  for (var i = sobs.length - 1; i >= 0; i--) {
    var r = layObjRect(sobs[i]);
    if (sxp >= r.l && sxp <= r.l + r.w && syp >= r.t && syp <= r.t + r.h) return i;
  }
  return -1;
}
function layMakeShape(wx1, wy1, wx2, wy2, tool) {
  var col = (id("le-color") || {}).value || "#2a3040";
  var lbl = (id("le-name") || {}).value || "";
  if (tool === "rect")
    return { shape: "rect", x: Math.min(wx1, wx2), y: Math.min(wy1, wy2),
             w: Math.abs(wx2 - wx1), h: Math.abs(wy2 - wy1), color: col, label: lbl };
  if (tool === "circle") {
    var cr = Math.max(Math.abs(wx2 - wx1), Math.abs(wy2 - wy1)) / 2;
    return { shape: "circle", x: (wx1 + wx2) / 2, y: (wy1 + wy2) / 2,
             r: Math.max(0.05, cr), color: col, label: lbl };
  }
  if (tool === "tri")
    return { shape: "tri", x: Math.min(wx1, wx2), y: Math.min(wy1, wy2),
             w: Math.abs(wx2 - wx1), h: Math.abs(wy2 - wy1), color: col, label: lbl };
  return null;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
/* raa skaermposition i canvas-pixels */
function stageRaw(ev) {
  var cv = id("stage"), r = cv.getBoundingClientRect();
  var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
  return { sx: t.clientX - r.left, sy: t.clientY - r.top };
}
/* position i verden (meter) */
function stagePos(ev) {
  var p = stageRaw(ev);
  return { x: S2LX(p.sx), y: S2LY(p.sy), sx: p.sx, sy: p.sy };
}
function stageDown(ev) {
  ev.preventDefault();
  var p = stagePos(ev);
  var sobs = S.stage_objects || [];

  /* panorering: eget værktøj, midterste museknap eller Alt */
  if (layEdTool === "pan" || ev.button === 1 || (ev.altKey && ev.button === 0)) {
    layPan = { sx: p.sx, sy: p.sy, px: panX, py: panY };
    return;
  }
  /* gruppe-labels kan trækkes uanset værktøj (klik uden træk vælger i grp-værktøjet) */
  var gid = hitGroupBox(gBoxesLay, p.sx, p.sy);
  if (gid) {
    var gr = groupById(gid);
    layGDrag = { id: gid, moved: false, sx: p.x, sy: p.y, ox: gr.x, oy: gr.y };
    return;
  }
  /* navne kan trækkes væk uanset værktøj */
  var li = hitLabel(p.sx, p.sy);
  if (li >= 0) {
    layLblDrag = { i: li, sx: p.x, sy: p.y, ox: S.modules[li].lx || 0, oy: S.modules[li].ly || 0 };
    lastMod = li; drawStage(); return;
  }
  /* grp-værktøj: vælg lamper (klik eller marquee) */
  if (layEdTool === "grpsel") {
    var hl = lampNear(p.x, p.y, 1.3);
    if (hl >= 0) { toggleArr(laySel, hl); updateGrpInfo(); drawStage(); return; }
    layMarq = { sx: p.sx, sy: p.sy, l: p.sx, t: p.sy, w: 0, h: 0, add: ev.shiftKey };
    return;
  }
  /* resize-håndtag på den valgte form */
  if (layEdSel >= 0 && sobs[layEdSel]) {
    var hh = layHitHandle(p.sx, p.sy, sobs[layEdSel]);
    if (hh) {
      var o = sobs[layEdSel];
      layEdResize = { i: layEdSel, handle: hh.id, sx: p.sx, sy: p.sy,
        ox: o.x, oy: o.y, ow: o.w || 0, oh: o.h || 0, or: o.r || 0 };
      return;
    }
  }
  if (layEdTool === "lamp") {
    var best = -1, bd = 1e9;
    S.modules.forEach(function (m, i) {
      var d = (m.x - p.x) * (m.x - p.x) + (m.y - p.y) * (m.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    if (bd < 1.5) {
      dragMod = best; lastMod = best;
      if (H.rot) H.rot.set(S.modules[best].rot);
      drawStage();
    }
  } else if (layEdTool === "sel") {
    var hit = layHitObj(p.sx, p.sy);
    if (hit >= 0) {
      layEdSel = hit;
      layEdDrag = { i: hit, ox: sobs[hit].x, oy: sobs[hit].y, sx: p.x, sy: p.y };
    } else layEdSel = -1;
    drawStage();
  } else {
    layEdDraw = { wx: p.x, wy: p.y };
  }
}
function stageMove(ev) {
  if (layPan) {
    ev.preventDefault();
    var pp = stageRaw(ev);
    panX = layPan.px + (pp.sx - layPan.sx);
    panY = layPan.py + (pp.sy - layPan.sy);
    drawStage(); return;
  }
  if (layGDrag) {
    ev.preventDefault();
    var pg = stagePos(ev), gr = groupById(layGDrag.id);
    if (gr) {
      if (Math.abs(pg.x - layGDrag.sx) + Math.abs(pg.y - layGDrag.sy) > 0.08) layGDrag.moved = true;
      gr.x = Math.round((layGDrag.ox + (pg.x - layGDrag.sx)) * 100) / 100;
      gr.y = Math.round((layGDrag.oy + (pg.y - layGDrag.sy)) * 100) / 100;
      drawStage();
    }
    return;
  }
  if (layMarq) {
    ev.preventDefault();
    var pm = stageRaw(ev);
    layMarq.l = Math.min(layMarq.sx, pm.sx); layMarq.t = Math.min(layMarq.sy, pm.sy);
    layMarq.w = Math.abs(pm.sx - layMarq.sx); layMarq.h = Math.abs(pm.sy - layMarq.sy);
    drawStage(); return;
  }
  if (layLblDrag) {
    ev.preventDefault();
    var pl = stagePos(ev), ml = S.modules[layLblDrag.i];
    ml.lx = Math.round((layLblDrag.ox + (pl.x - layLblDrag.sx)) * 100) / 100;
    ml.ly = Math.round((layLblDrag.oy + (pl.y - layLblDrag.sy)) * 100) / 100;
    drawStage(); return;
  }
  if (layEdResize) {
    ev.preventDefault();
    var pr = stagePos(ev), r = layEdResize, o = (S.stage_objects || [])[r.i];
    if (o) {
      var dwx = (pr.sx - r.sx) / scale, dwy = -(pr.sy - r.sy) / scale;
      if (o.shape === "circle") {
        o.r = Math.max(0.1, r.or + Math.max(dwx, dwy));
      } else {
        if (r.handle.indexOf("r") >= 0) o.w = Math.max(0.1, r.ow + dwx);
        if (r.handle.indexOf("l") >= 0) { o.x = r.ox + dwx; o.w = Math.max(0.1, r.ow - dwx); }
        if (r.handle.indexOf("t") >= 0) o.h = Math.max(0.1, r.oh + dwy);
        if (r.handle.indexOf("b") >= 0) { o.y = r.oy + dwy; o.h = Math.max(0.1, r.oh - dwy); }
      }
      drawStage();
    }
    return;
  }
  if (dragMod >= 0) {
    ev.preventDefault();
    var p = stagePos(ev), m = S.modules[dragMod];
    m.x = Math.round(p.x * 100) / 100; m.y = Math.round(p.y * 100) / 100;
    drawStage(); return;
  }
  if (layEdDrag) {
    ev.preventDefault();
    var p2 = stagePos(ev), o2 = (S.stage_objects || [])[layEdDrag.i];
    if (o2) {
      o2.x = layEdDrag.ox + (p2.x - layEdDrag.sx);
      o2.y = layEdDrag.oy + (p2.y - layEdDrag.sy);
      drawStage();
    }
    return;
  }
  if (layEdDraw) {
    ev.preventDefault();
    var p3 = stagePos(ev);
    layEdPreview = layMakeShape(layEdDraw.wx, layEdDraw.wy, p3.x, p3.y, layEdTool);
    drawStage();
  }
}
function stageUp(ev) {
  if (layPan) { layPan = null; return; }
  if (layGDrag) {
    var gd = layGDrag; layGDrag = null;
    if (gd.moved) {
      var gr = groupById(gd.id);
      if (gr) api({ op: "glabel_pos", id: gd.id, x: gr.x, y: gr.y });
    } else if (layEdTool === "grpsel") {
      toggleArr(laySelG, gd.id); updateGrpInfo(); drawStage();
    }
    return;
  }
  if (layMarq) {
    var mq = layMarq; layMarq = null;
    if (!mq.add) laySel = [];
    if (mq.w > 3 || mq.h > 3) {
      S.modules.forEach(function (m, i) {
        var sx = L2SX(m.x), sy = L2SY(m.y);
        if (sx >= mq.l && sx <= mq.l + mq.w && sy >= mq.t && sy <= mq.t + mq.h && !inArr(laySel, i)) laySel.push(i);
      });
    }
    updateGrpInfo(); drawStage(); return;
  }
  if (layLblDrag) {
    var il = layLblDrag.i, ml = S.modules[il]; layLblDrag = null;
    api({ op: "patch", items: [{ path: ["modules", il, "lx"], value: ml.lx },
                               { path: ["modules", il, "ly"], value: ml.ly }] });
    return;
  }
  if (layEdResize) { layEdResize = null; pushStageObjs(); return; }
  if (dragMod >= 0) {
    var m = S.modules[dragMod];
    api({ op: "patch", items: [{ path: ["modules", dragMod, "x"], value: m.x },
                               { path: ["modules", dragMod, "y"], value: m.y }] });
    dragMod = -1; return;
  }
  if (layEdDrag) { layEdDrag = null; pushStageObjs(); return; }
  if (layEdDraw) {
    var ds = layEdDraw; layEdDraw = null; layEdPreview = null;
    var wx2 = ds.wx + 2, wy2 = ds.wy + 1;
    if (ev) { var pe = stagePos(ev); wx2 = pe.x; wy2 = pe.y; }
    if (Math.abs(wx2 - ds.wx) < 0.15 && Math.abs(wy2 - ds.wy) < 0.15) {
      wx2 = ds.wx + 2; wy2 = ds.wy + 1;    /* klik uden træk: standardstørrelse */
    }
    var obj = layMakeShape(ds.wx, ds.wy, wx2, wy2, layEdTool);
    if (obj) {
      S.stage_objects = S.stage_objects || [];
      S.stage_objects.push(obj);
      layEdSel = S.stage_objects.length - 1;
      drawStage(); pushStageObjs();
    }
  }
}
function pushStageObjs(){
  api({ op: "stage_objects", objects: S.stage_objects || [] });
}
/* tilpas zoom og panorering så hele riggen er synlig */
function layFit() {
  var cv = id("stage");
  if (!cv.width) { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }
  panX = 0; panY = 0;
  if (!S || !S.modules.length) { scale = 40; }
  else {
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    S.modules.forEach(function (m) {
      minx = Math.min(minx, m.x); maxx = Math.max(maxx, m.x);
      miny = Math.min(miny, m.y); maxy = Math.max(maxy, m.y);
    });
    /* tag også gruppe-labels med, så de ikke klippes af kanten */
    (S.group_labels || []).forEach(function (gr) {
      minx = Math.min(minx, gr.x); maxx = Math.max(maxx, gr.x);
      miny = Math.min(miny, gr.y); maxy = Math.max(maxy, gr.y);
    });
    var sx2 = (maxx - minx) + 3, sy2 = (maxy - miny) + 2.4;
    scale = Math.max(10, Math.min(140,
      Math.min((cv.width * 0.88) / sx2, (cv.height * 0.84) / sy2)));
    panX = -((minx + maxx) / 2) * scale;
    panY = ((miny + maxy) / 2) * scale;
  }
  if (H.scale) H.scale.set(Math.round(scale));
  drawStage();
}

/* sæt knapper og skydere efter showets visningsindstillinger */
function syncViewUI() {
  var V = viewCfg();
  if (id("le-beams")) press(id("le-beams"), !!V.beams);
  if (id("le-labels")) press(id("le-labels"), !!V.labels);
  function sset(sid, vid, val) {
    var e = id(sid); if (!e) return;
    e.value = val; var o = id(vid); if (o) o.textContent = val;
  }
  sset("vw-pool", "vw-pool-v", V.pool);
  sset("vw-beam", "vw-beam-v", V.beam);
  sset("vw-bang", "vw-bang-v", V.bang);
  sset("vw-lblop", "vw-lblop-v", V.label_opacity);
  if (id("vw-lblcol")) id("vw-lblcol").value = V.label_color || "#e8ecf4";
}

/* visningsindstillinger (delt med simulatoren) */
function pushView(vals) {
  S.view = S.view || {};
  var k;
  for (k in vals) S.view[k] = vals[k];
  api({ op: "view_set", values: vals });
  drawStage();
}

/* ------------------------------------------------------------- patch */
function buildPatch() {
  var t = id("patchtab");
  buildPatchTypes();
  t.innerHTML = "<thead><tr><th>↕</th><th>Nr.</th><th>Navn</th><th>Type</th>" +
    "<th>Univ</th><th>Adr</th><th>Kan.</th><th>Slut</th><th>Vis navn</th><th></th></tr></thead><tbody></tbody>";
  var tb = t.getElementsByTagName("tbody")[0];
  var bad = patchConflicts();
  var all = profilesAll();
  S.modules.forEach(function (m, i) {
    var span = lampSpan(m), end = m.address + span - 1;
    var tr = el("tr", bad[i] ? "conflict" : "");
    tr.setAttribute("draggable", "true");
    tr.dataset.idx = i;
    patchRowDrag(tr, i);

    var tdg = el("td", "draghandle");
    tdg.title = "Træk for at flytte lampen op eller ned";
    tdg.appendChild(el("span", "grip", "⠿"));
    var bup = el("button", "nudge", "▲"); bup.title = "Flyt op";
    var bdn = el("button", "nudge", "▼"); bdn.title = "Flyt ned";
    bup.onclick = function () { patchMove(i, i - 1); };
    bdn.onclick = function () { patchMove(i, i + 1); };
    if (i === 0) bup.disabled = true;
    if (i === S.modules.length - 1) bdn.disabled = true;
    tdg.appendChild(bup); tdg.appendChild(bdn);
    tr.appendChild(tdg);

    /* nummeret - frit tekstfelt, følger lampen når rækken flyttes */
    var tdnum = el("td");
    var numin = document.createElement("input");
    numin.type = "text";
    numin.value = (m.num != null ? m.num : String(i + 1));
    numin.style.width = "54px"; numin.style.fontWeight = "700";
    numin.onchange = function () {
      m.num = numin.value; setv(["modules", i, "num"], numin.value, function () { drawStage(); });
    };
    tdnum.appendChild(numin); tr.appendChild(tdnum);

    var tdn = el("td");
    var nin = document.createElement("input");
    nin.type = "text"; nin.value = m.name; nin.style.minWidth = "150px";
    nin.onchange = function () {
      m.name = nin.value;
      setv(["modules", i, "name"], nin.value, function () { drawStage(); });
    };
    tdn.appendChild(nin); tr.appendChild(tdn);

    var tdt = el("td");
    var tsel = el("select");
    var key;
    for (key in all) {
      var o = el("option", "", all[key].name); o.value = key;
      if (key === m.type) o.selected = true;
      tsel.appendChild(o);
    }
    tsel.onchange = function () {
      m.type = tsel.value;
      setv(["modules", i, "type"], tsel.value, function () { refresh(); });
    };
    tdt.appendChild(tsel); tr.appendChild(tdt);

    tr.appendChild(patchNum(m, i, "universe", 1, 8));
    tr.appendChild(patchNum(m, i, "address", 1, 512));
    tr.appendChild(el("td", "", String(span)));
    var tde = el("td", "", String(end));
    if (end > 512) tde.style.color = "var(--alarm)";
    tr.appendChild(tde);

    /* vis navnet for netop denne lampe */
    var tdl = el("td");
    var bl = el("button", "sm", m.lbl === false ? "Skjult" : "Vist");
    press(bl, m.lbl !== false);
    bl.onclick = function () {
      m.lbl = (m.lbl === false);
      press(bl, m.lbl !== false);
      bl.textContent = m.lbl === false ? "Skjult" : "Vist";
      setv(["modules", i, "lbl"], m.lbl, function () { drawStage(); });
    };
    tdl.appendChild(bl); tr.appendChild(tdl);

    var tdx = el("td");
    var bx = el("button", "ghost", "Fjern");
    bx.onclick = function () { api({ op: "fixture_del", index: i }, refresh); };
    tdx.appendChild(bx); tr.appendChild(tdx);
    tb.appendChild(tr);
  });
  var c = id("pa-count");
  if (c) c.textContent = S.modules.length + (S.modules.length === 1 ? " lampe" : " lamper");
  updatePatchHint();
  buildEditor();
}

/* --------------------------------------------------- Lampe-editor */
function buildEditor() {
  var lampSel = id("ed-lamp"); if (!lampSel) return;
  if (!S.modules.length) { lampSel.innerHTML = ""; id("ed-chans").innerHTML = ""; return; }
  if (edLamp >= S.modules.length) edLamp = 0;
  lampSel.innerHTML = "";
  S.modules.forEach(function (m, i) {
    var o = el("option", "", (i + 1) + " · " + m.name + " — " + lampProfile(m).name);
    o.value = i; if (i === edLamp) o.selected = true; lampSel.appendChild(o);
  });
  var tsel = id("ed-type"); tsel.innerHTML = "";
  var order = META.generic_order || [];
  order.forEach(function (g) {
    var o = el("option", "", g.name + " — " + g.span + " kan."); o.value = g.id; tsel.appendChild(o);
  });
  var cur = S.modules[edLamp] ? S.modules[edLamp].type : null;
  var inList = order.some(function (g) { return g.id === cur; });
  if (inList) tsel.value = cur;
  else if (cur) {
    var o = el("option", "", lampProfile(S.modules[edLamp]).name + " (nuværende)");
    o.value = cur; tsel.insertBefore(o, tsel.firstChild); tsel.value = cur;
  }
  buildEdChans();
}
function buildEdChans() {
  var box = id("ed-chans"); if (!box) return; box.innerHTML = "";
  var t = id("ed-type").value;
  var prof = profilesAll()[t] || (S.modules[edLamp] ? lampProfile(S.modules[edLamp]) : null);
  if (!prof) return;
  prof.channels.forEach(function (c, i) {
    var chip = el("span", "edchip");
    chip.appendChild(el("b", "", String(i + 1)));
    chip.appendChild(document.createTextNode(c.n || c.k));
    box.appendChild(chip);
  });
}
function edTargets() {
  if (id("ed-allsel").checked && S.sel.size) {
    var a = []; S.sel.forEach(function (i) { a.push(i); }); return a;
  }
  return [edLamp];
}
function edApplyType(t) {
  api({ op: "fixture_settype", indices: edTargets(), type: t },
    function () {
      refresh(function () {
        buildEditor();
        var p = profilesAll()[t];
        toast("Sat til " + (p ? p.name : t));
      });
    });
}
function edCycle(dir) {
  var order = META.generic_order || []; if (!order.length) return;
  var t = id("ed-type").value, idx = -1;
  order.forEach(function (g, i) { if (g.id === t) idx = i; });
  idx = (idx + dir + order.length) % order.length;
  var nt = order[idx].id;
  id("ed-type").value = nt; buildEdChans(); edApplyType(nt);
}
/* -------------------------------------------------- Hvem styrer lyset */
/* Ikonerne øverst til højre er de styringer der kan bestemme over
   lamperne; den der gør det nu, er udfyldt. Som udgangspunkt kun én: vælger man en anden,
   mister den forrige styringen (dens indstillinger bliver liggende, de
   ses bare ikke). Flere på én gang skal slås til med "Flere på én gang".
   Striben under fanerne viser alt det der påvirker ALLE lamper uanset styring -
   blackout, grand, frys, tests - så man kan se hvorfor lyset gør som det gør. */
var CTRL = [["pult", "Pult", "v-pult"], ["afvikling", "Afvikling", "v-afvikling"], ["enkel", "Enkel", "v-enkel"]];
var ctlMulti = false, ctlFrame = { lt: null, probe: null }, ctlSig = "";
try { ctlMulti = localStorage.getItem("lyspult.ctlmulti") === "1"; } catch (e) {}
function ctlNow() { return (S && S.control && S.control.length) ? S.control : ["pult"]; }
function ctlOn(c) { return ctlNow().indexOf(c) >= 0; }
function ctlName(c) { for (var i = 0; i < CTRL.length; i++) if (CTRL[i][0] === c) return CTRL[i][1]; return c; }
function ctlNames(list) { return list.map(ctlName).join(" + "); }
/* et tryk på en styring: alene, eller - med "Flere på én gang" - til/fra */
function ctlPick(c) {
  var cur = ctlNow().slice(), nl;
  if (ctlMulti) {
    var k = cur.indexOf(c);
    if (k >= 0) {
      if (cur.length === 1) { toast("Mindst én skal styre lyset"); return; }
      cur.splice(k, 1); nl = cur;
    } else nl = cur.concat([c]);
  } else nl = [c];
  nl = CTRL.map(function (x) { return x[0]; }).filter(function (x) { return nl.indexOf(x) >= 0; });
  if (nl.join() === ctlNow().join()) return;
  S.control = nl;
  markBusy(); clearBusy();
  api({ op: "control_set", control: nl });
  ctlRefresh();
  toast(nl.length > 1 ? "Nu styrer " + ctlNames(nl) + " sammen" : "Nu styrer " + ctlName(nl[0]) + " lyset");
}
function buildCtrlBar() {
  var bar = id("ctlsel"); if (!bar) return;
  bar.innerHTML = "";
  var multi = ctlNow().length > 1;
  var g = el("span", "cb-ctrls" + (multi ? " multi" : ""));
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", "Hvem styrer lyset");
  CTRL.forEach(function (c) {
    var on = ctlOn(c[0]);
    var b = el("button", "cb-btn" + (on ? " on" : ""));
    b.id = "cb-" + c[0];
    b.appendChild(icon(c[2]));
    press(b, on);
    b.title = on ? c[1] + " styrer lyset" : "Lad " + c[1] + " styre lyset";
    b.setAttribute("aria-label", b.title);
    b.onclick = function () { ctlPick(c[0]); };
    g.appendChild(b);
  });
  bar.appendChild(g);
  var lb = el("label", "cb-multi");
  lb.title = "Flere på én gang: tryk på de styringer der skal styre sammen";
  var ck = el("input"); ck.type = "checkbox"; ck.id = "cb-multi"; ck.checked = ctlMulti;
  ck.onchange = function () {
    ctlMulti = ck.checked;
    try { localStorage.setItem("lyspult.ctlmulti", ctlMulti ? "1" : "0"); } catch (e) {}
    /* slår man det fra med flere valgt, beholdes de til man vælger én */
    buildCtrlBar(); ctlBanners();
  };
  lb.appendChild(ck); lb.appendChild(el("span", "t", "Flere"));
  bar.appendChild(lb);
  ctlSig = "";
  ctlStatus();
  fitTabs();
}
/* det der påvirker alle lamper uanset styring */
function ctlStatus() {
  var box = id("ctlwarn"); if (!box || !S) return;
  var items = [], ctl = ctlNow(), m = S.master, k;
  if (ctl.length > 1) items.push(["warn", "Flere styrer samtidig: " + ctlNames(ctl), null]);
  if (!armed()) items.push(["warn", "DMX ud er slået fra", ["Slå til", function () { setArm(true); }]]);
  if (m.blackout) items.push(["alarm", "BLACKOUT", ["Slå fra", function () { S.master.blackout = false; setv(["master", "blackout"], false, refresh); }]]);
  if (m.freeze) items.push(["warn", "Billedet er frosset", ["Slå fra", function () { S.master.freeze = false; setv(["master", "freeze"], false, refresh); }]]);
  if (m.grand < 255) items.push([m.grand === 0 ? "alarm" : "info", "Grand " + Math.round(m.grand / 2.55) + " %", ["Pult", function () { gotoTab("v-pult"); }]]);
  if (m.strobe >= 8) items.push(["warn", "Strobe er slået til", ["Pult", function () { gotoTab("v-pult"); }]]);
  var low = 0;
  for (k = 0; k < S.modules.length; k++) if (!S.modules[k].on || S.modules[k].level < 255) low++;
  if (low) items.push(["info", (low === 1 ? "1 lampe er" : low + " lamper er") + " slukket eller skruet ned i Pult → Lamper", ["Vis", function () { gotoTab("v-pult"); }]]);
  var ON = { enttec: "DMX-udgang", artnet: "Art-Net", sacn: "sACN" };
  for (k in (ctlFrame.out || {})) {
    var v = String(ctlFrame.out[k] || ""), bad = k === "enttec" ? v.indexOf("FEJL") === 0 : (v !== "" && v !== "ok");
    if (bad && S.outputs[k] && S.outputs[k].on)
      items.push(["alarm", (ON[k] || k) + ": " + v.replace(/^FEJL: */, "fejl — ").slice(0, 90), ["Output", function () { gotoTab("v-out"); }]]);
  }
  var lt = ctlFrame.lt;
  if (lt) items.push(["warn", "Lampetest sender på U" + lt.uni + " / " + lt.addr, ["Stop", function () {
    if (LT.on) { ltStop(); buildLampTest(true); } else api({ op: "lamptest", stop: true });
  }]]);
  if (ctlFrame.probe) items.push(["warn", "Kanaltest kører", ["Stop", function () {
    if (PT.testOn) { ptTestStop(); buildProfileEditor(); } else api({ op: "profile_probe", clear: true });
  }]]);
  var sig = JSON.stringify(items.map(function (x) { return x[0] + x[1]; }));
  if (sig === ctlSig) return;
  ctlSig = sig;
  box.innerHTML = "";
  items.forEach(function (it) {
    var c = el("span", "cb-chip " + it[0], it[1]);
    if (it[2]) { var b = el("button", "sm", it[2][0]); b.onclick = it[2][1]; c.appendChild(b); }
    box.appendChild(c);
  });
  box.className = items.length ? "on" : "";
}
/* bjælke i Pult, Afvikling og Enkel når fanen ikke styrer lyset */
function ctlBanners() {
  CTRL.forEach(function (c) {
    var v = id(c[2]); if (!v) return;
    var bn = id("cbn-" + c[0]);
    if (!bn) {
      bn = el("div", "ctl-banner"); bn.id = "cbn-" + c[0];
      v.insertBefore(bn, v.firstChild);
    }
    if (ctlOn(c[0])) { bn.style.display = "none"; return; }
    bn.style.display = "";
    bn.innerHTML = "";
    bn.appendChild(el("span", "", c[1] + " styrer ikke lyset lige nu — det gør " + ctlNames(ctlNow()) +
      ". Det du ændrer her, ses først på lamperne når " + c[1] + " styrer."));
    var b = el("button", "lt-go", ctlMulti ? "Lad " + c[1] + " styre med" : "Lad " + c[1] + " styre");
    b.onclick = function () { ctlPick(c[0]); };
    bn.appendChild(b);
  });
}
function ctlRefresh() { buildCtrlBar(); ctlBanners(); buildTabs(); }
/* kaldes fra poll() */
function ctlFrameIn(d) {
  ctlFrame.lt = d.lt || null;
  ctlFrame.probe = d.probe || null;
  ctlFrame.out = d.out || null;
  ctlStatus();
}

/* ------------------------------------------------------------ Enkel */
/* Den enkleste styring: én flise pr. lampe. Vælg lamper, tryk på en farve.
   Bag fliserne ligger de samme live-looks som i Afvikling - ét look pr.
   lampe ("l:<nr>") - så det vises i Afvikling og simulatoren og kan
   gemmes som scene. */
var ekSel = [];
var ekLevelT = null;
function ekLook(i) {
  var ls = (S && S.live && S.live.looks) || [], key = "l:" + i;
  for (var k = 0; k < ls.length; k++) if (ls[k].key === key) return ls[k];
  return null;
}
/* samme ændring i den lokale model som serveren laver (live_apply) */
function ekMirror(lamps, values) {
  S.live = S.live || { looks: [], fade: 1.0 };
  S.live.looks = S.live.looks || [];
  lamps.forEach(function (i) {
    var lk = ekLook(i);
    if (!lk) {
      lk = { key: "l:" + i, target: { lamps: [i] }, on: true, level: 255, fade: afGlobalFade(),
             pattern: "fyldt", colour_mode: "fast", colour: [255, 120, 40] };
      S.live.looks.push(lk);
    }
    for (var k in values) lk[k] = values[k];
  });
}
function ekSend(lamps, values, fade) {
  if (!lamps.length) return;
  ekMirror(lamps, values);
  markBusy(); clearBusy();
  api({ op: "live_lamps", lamps: lamps, values: values, fade: fade || 0 });
}
function ekNeedSel() {
  if (S && !ctlOn("enkel")) toast("Enkel styrer ikke lyset — tryk “Lad Enkel styre” øverst");
  if (ekSel.length) return false;
  toast("Tryk først på de lamper du vil styre");
  return true;
}
function ekColour(c) {
  if (ekNeedSel()) return;
  /* en farve skal altid give lys: lamper skruet helt ned kommer op på fuld */
  var lit = [], zero = [];
  ekSel.forEach(function (i) { var lk = ekLook(i); (lk && lk.level === 0 ? zero : lit).push(i); });
  var v = { colour: [c[0], c[1], c[2]], on: true, pattern: "fyldt", colour_mode: "fast" };
  if (lit.length) ekSend(lit, v, afGlobalFade());
  if (zero.length) {
    var v2 = {}; for (var k in v) v2[k] = v[k]; v2.level = 255;
    ekSend(zero, v2, afGlobalFade());
  }
  ekInfo();
}
function ekOff() {
  if (ekNeedSel()) return;
  ekSend(ekSel.slice(), { on: false }, 0);
  ekInfo();
}
function ekLevel(v) {
  if (!ekSel.length) return;
  /* lamper der endnu ikke har en farve, får hvid - ikke lookets standard */
  var has = [], none = [];
  ekSel.forEach(function (i) { (ekLook(i) ? has : none).push(i); });
  var on = v > 0;
  if (has.length) ekSend(has, on ? { level: v, on: true } : { level: v }, 0);
  if (none.length) ekSend(none, { level: v, on: on, colour: [255, 255, 255], pattern: "fyldt", colour_mode: "fast" }, 0);
}
function ekInfo() {
  var b = id("ek-selinfo"); if (!b) return;
  var n = ekSel.length;
  b.textContent = n ? (n === 1 ? "1 lampe valgt" : n + " lamper valgt")
                    : "Ingen lamper valgt — tryk på dem til venstre";
  b.className = "ek-selinfo" + (n ? " on" : "");
  /* skyderen viser den første valgtes lysstyrke */
  var r = id("ek-level"), v = 255;
  if (n) { var lk = ekLook(ekSel[0]); if (lk) v = lk.on === false ? 0 : (lk.level === undefined ? 255 : lk.level); }
  if (document.activeElement !== r) { r.value = v; }
  id("ek-levelv").textContent = Math.round(r.value / 2.55) + " %";
  r.disabled = !n;
}
function ekTextCol(hx) {
  var r = parseInt(hx.substr(0, 2), 16), g = parseInt(hx.substr(2, 2), 16), b = parseInt(hx.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? "#000" : "#fff";
}
function buildEnkel() {
  var box = id("ek-lamps"); if (!box || !S) return;
  var nm = S.modules.length;
  ekSel = ekSel.filter(function (i) { return i < nm; });
  box.innerHTML = "";
  if (!nm) {
    var e = el("div", "ek-empty");
    e.appendChild(el("p", "", "Der er ingen lamper endnu."));
    var b = el("button", "wz-primary", "Gå til Patch");
    b.onclick = function () { gotoTab("v-patch"); };
    e.appendChild(b);
    box.appendChild(e);
  }
  S.modules.forEach(function (m, i) {
    var t = el("button", "ek-tile" + (ekSel.indexOf(i) >= 0 ? " sel" : ""));
    t.setAttribute("data-i", i);
    t.appendChild(el("span", "no", String(m.num != null && m.num !== "" ? m.num : (i + 1))));
    t.appendChild(el("span", "nm", m.name));
    t.appendChild(el("span", "st", ""));
    t.onclick = function () {
      var k = ekSel.indexOf(i);
      if (k >= 0) ekSel.splice(k, 1); else ekSel.push(i);
      t.className = "ek-tile" + (k >= 0 ? "" : " sel");
      ekInfo();
    };
    box.appendChild(t);
  });
  /* farverne */
  var pb = id("ek-pal"); pb.innerHTML = "";
  activePalette().forEach(function (c, i) {
    var b = el("button", "ek-sw");
    b.style.background = hex(c);
    b.style.color = ekTextCol(hex(c).replace("#", ""));
    b.textContent = PAL_KEYS[i] || "";
    b.title = "Farve " + (PAL_KEYS[i] || (i + 1));
    b.onclick = function () { ekColour(c); };
    pb.appendChild(b);
  });
  var off = el("button", "ek-sw ek-off", "Sluk"); off.id = "ek-off";
  off.onclick = ekOff;
  pb.appendChild(off);
  ekInfo();
  ekPaint(lastFrame);
}
/* fliserne følger lampernes rigtige farve - kaldes fra poll() */
function ekPaint(px) {
  var box = id("ek-lamps"); if (!box || !px) return;
  var ts = box.getElementsByClassName("ek-tile");
  for (var k = 0; k < ts.length; k++) {
    var i = parseInt(ts[k].getAttribute("data-i"), 10);
    var hx = (px[i] || "000000").substr(0, 6);
    if (ts[k]._hx === hx) continue;
    ts[k]._hx = hx;
    var dark = hx === "000000";
    ts[k].style.background = dark ? "" : "#" + hx;
    ts[k].style.color = dark ? "" : ekTextCol(hx);
    ts[k].lastChild.textContent = dark ? "slukket" : "";
  }
}

/* ------------------------------------------------------- Lampetest */
/* Kør en farvesekvens på én adresse efter en valgt opsætning og skift
   opsætning undervejs, til lampen lyser som der står på skærmen. Serveren
   sender testen direkte på adressen (ovenpå riggen, uanset blackout), og
   /frame melder tilbage hvilket trin og hvilke kanalværdier den sender. */
var LT_COL = {
  red:   { n: "Rød",   r: 255 },
  green: { n: "Grøn",  g: 255 },
  blue:  { n: "Blå",   b: 255 },
  yel:   { n: "Gul",   r: 255, g: 255 },
  pur:   { n: "Lilla", r: 255, b: 255 },
  cyan:  { n: "Cyan",  g: 255, b: 255 },
  white: { n: "Hvid",  r: 255, g: 255, b: 255, w: 255 },
  w:     { n: "Hvid LED (W)", w: 255 },
  a:     { n: "Ravgul (A)", a: 255 },
  uv:    { n: "UV", uv: 255 },
  off:   { n: "Slukket" }
};
var LT_PRESETS = [
  ["seks", "Rød → grøn → blå → gul → lilla → hvid", ["red", "green", "blue", "yel", "pur", "white"]],
  ["rgb", "Rød → grøn → blå", ["red", "green", "blue"]],
  ["kanal", "Én farvekanal ad gangen: R → G → B → W → A → UV", ["red", "green", "blue", "w", "a", "uv"]],
  ["blink", "Hvid / slukket (reagerer lampen overhovedet?)", ["white", "off"]],
  ["egen", "Egen sekvens…", null]
];
var LT = { on: false, uni: 1, addr: 1, type: "", preset: "seks", step_s: 1.0, hold: null,
           custom: [{ n: "Rød", r: 255 }, { n: "Hvid LED (W)", w: 255 }], idx: 0, ch: null };
(function () {
  try {
    var sv = JSON.parse(localStorage.getItem("lyspult.lamptest") || "null");
    if (sv) ["uni", "addr", "type", "preset", "step_s", "custom"].forEach(function (k) {
      if (sv[k] !== undefined && sv[k] !== null) LT[k] = sv[k];
    });
  } catch (e) {}
})();
function ltSave() {
  try {
    localStorage.setItem("lyspult.lamptest", JSON.stringify({ uni: LT.uni, addr: LT.addr, type: LT.type,
      preset: LT.preset, step_s: LT.step_s, custom: LT.custom }));
  } catch (e) {}
}
function ltStep(key) {
  var c = LT_COL[key], o = { n: c.n };
  ["r", "g", "b", "w", "a", "uv"].forEach(function (k) { o[k] = c[k] || 0; });
  return o;
}
function ltSteps() {
  for (var i = 0; i < LT_PRESETS.length; i++)
    if (LT_PRESETS[i][0] === LT.preset && LT_PRESETS[i][2]) return LT_PRESETS[i][2].map(ltStep);
  return LT.custom.length ? LT.custom : [ltStep("red")];
}
/* hvordan et trin ser ud på skærmen (W/A/UV vist som deres lys) */
function ltCss(st) {
  var r = st.r || 0, g = st.g || 0, b = st.b || 0;
  if (st.w) { r = Math.max(r, st.w); g = Math.max(g, st.w); b = Math.max(b, Math.round(st.w * 0.92)); }
  if (st.a) { r = Math.max(r, st.a); g = Math.max(g, Math.round(st.a * 0.62)); }
  if (st.uv) { r = Math.max(r, Math.round(st.uv * 0.45)); b = Math.max(b, st.uv); }
  return hex([r, g, b]);
}
/* opsætningerne: de generiske først (som i Lampe-editoren), så resten */
function ltTypes() {
  var all = profilesAll(), out = [], seen = {};
  (META.generic_order || []).forEach(function (g) { if (all[g.id]) { out.push(g.id); seen[g.id] = 1; } });
  var rest = Object.keys(all).filter(function (k) { return !seen[k]; });
  rest.sort(function (x, y) { return (all[x].name || x).localeCompare(all[y].name || y); });
  return out.concat(rest);
}
function ltProf() { return profilesAll()[LT.type] || null; }
function ltLampsAt() {
  /* lamper hvis kanaler overlapper testens kanaler */
  var p = ltProf(), n = p ? p.channels.length : 1, hit = [];
  S.modules.forEach(function (m, i) {
    if ((m.universe || 1) !== LT.uni) return;
    var mn = lampProfile(m).channels.length;
    if (m.address <= LT.addr + n - 1 && m.address + mn - 1 >= LT.addr) hit.push(i);
  });
  return hit;
}
function ltSend() {
  ltSave();
  if (!LT.on) return;
  LT.sentAt = Date.now();
  api({ op: "lamptest", universe: LT.uni, address: LT.addr, type: LT.type,
        steps: ltSteps(), step_s: LT.step_s, hold: LT.hold });
}
function ltStop() {
  if (!LT.on) return;
  LT.on = false; LT.hold = null; LT.ch = null;
  api({ op: "lamptest", stop: true });
}
function ltCycle(dir) {
  var ts = ltTypes(); if (!ts.length) return;
  var i = ts.indexOf(LT.type);
  LT.type = ts[(i + dir + ts.length) % ts.length];
  ltSend(); buildLampTest(true);
}
function ltSetHold(h) {
  var n = ltSteps().length;
  LT.hold = (h === null) ? null : ((h % n) + n) % n;
  if (LT.hold !== null) LT.idx = LT.hold;
  ltSend(); ltShowNow();
}

function buildLampTest(force) {
  var box = id("lt-body"); if (!box || !S || !META) return;
  /* skriver man i et af felterne, så lad panelet være */
  if (!force && document.activeElement && box.contains(document.activeElement) &&
      typingIn(document.activeElement)) return;
  var ts = ltTypes();
  if (ts.indexOf(LT.type) < 0) LT.type = ts[0] || "";
  box.innerHTML = "";

  /* -- adresse -- */
  var r1 = el("div", "lt-row");
  r1.appendChild(el("span", "k", "Adresse"));
  var uw = el("label", "lt-in"); uw.appendChild(el("span", "", "Univers"));
  var ui = el("input"); ui.type = "number"; ui.min = 1; ui.max = 64; ui.value = LT.uni; ui.id = "lt-uni";
  uw.appendChild(ui); r1.appendChild(uw);
  var aw = el("label", "lt-in"); aw.appendChild(el("span", "", "Start-adresse"));
  var ai = el("input"); ai.type = "number"; ai.min = 1; ai.max = 512; ai.value = LT.addr; ai.id = "lt-addr";
  aw.appendChild(ai); r1.appendChild(aw);
  var ls = el("select"); ls.id = "lt-lamp"; ls.setAttribute("aria-label", "Hent adressen fra en lampe");
  var o0 = el("option", "", S.modules.length ? "Hent adressen fra en lampe…" : "Ingen lamper i riggen"); o0.value = "";
  ls.appendChild(o0);
  S.modules.forEach(function (m, i) {
    var o = el("option", "", (m.label || (i + 1)) + " · " + m.name + " — U" + (m.universe || 1) + " / " + m.address);
    o.value = i; ls.appendChild(o);
  });
  r1.appendChild(ls);
  box.appendChild(r1);
  function setAddr() {
    LT.uni = Math.max(1, Math.min(64, parseInt(ui.value, 10) || 1));
    LT.addr = Math.max(1, Math.min(512, parseInt(ai.value, 10) || 1));
    ltSend(); ltShowUse();
  }
  ui.onchange = setAddr; ai.onchange = setAddr;
  ui.oninput = function () { if (ui.value !== "") setAddr(); };
  ai.oninput = function () { if (ai.value !== "") setAddr(); };
  ls.onchange = function () {
    if (ls.value === "") return;
    var m = S.modules[parseInt(ls.value, 10)];
    LT.uni = m.universe || 1; LT.addr = m.address;
    if (profilesAll()[m.type]) LT.type = m.type;
    ltSend(); buildLampTest(true);
  };
  var use = el("div", "lt-use"); use.id = "lt-use"; box.appendChild(use);

  /* -- sekvens og fart -- */
  var r2 = el("div", "lt-row");
  r2.appendChild(el("span", "k", "Sekvens"));
  var ps = el("select"); ps.id = "lt-preset";
  LT_PRESETS.forEach(function (p) { var o = el("option", "", p[1]); o.value = p[0]; ps.appendChild(o); });
  ps.value = LT.preset;
  ps.onchange = function () { LT.preset = ps.value; LT.hold = null; ltSend(); buildLampTest(true); };
  r2.appendChild(ps);
  box.appendChild(r2);
  if (LT.preset === "egen") box.appendChild(ltCustomEditor());

  var r3 = el("div", "lt-row");
  r3.appendChild(el("span", "k", "Tid pr. farve"));
  var sp = el("input"); sp.type = "range"; sp.min = 2; sp.max = 50; sp.value = Math.round(LT.step_s * 10); sp.id = "lt-speed";
  var sv = el("span", "val", LT.step_s.toFixed(1).replace(".", ",") + " s");
  sp.oninput = function () { LT.step_s = parseInt(sp.value, 10) / 10; sv.textContent = LT.step_s.toFixed(1).replace(".", ",") + " s"; };
  sp.onchange = function () { LT.step_s = parseInt(sp.value, 10) / 10; ltSend(); };
  r3.appendChild(sp); r3.appendChild(sv);
  box.appendChild(r3);

  /* -- opsætning -- */
  var r4 = el("div", "lt-row lt-typerow");
  r4.appendChild(el("span", "k", "Opsætning"));
  var pv = el("button", "", "◀ Forrige"); pv.id = "lt-prev"; pv.onclick = function () { ltCycle(-1); };
  var tsel = el("select"); tsel.id = "lt-type";
  var all = profilesAll(), gen = {};
  (META.generic_order || []).forEach(function (g) { gen[g.id] = 1; });
  var og1 = el("optgroup"); og1.label = "Standardopsætninger";
  var og2 = el("optgroup"); og2.label = "Lampetyper";
  ts.forEach(function (k) {
    var o = el("option", "", all[k].name + " — " + all[k].channels.length + " kan."); o.value = k;
    (gen[k] ? og1 : og2).appendChild(o);
  });
  if (og1.children.length) tsel.appendChild(og1);
  if (og2.children.length) tsel.appendChild(og2);
  tsel.value = LT.type;
  tsel.onchange = function () { LT.type = tsel.value; ltSend(); buildLampTest(true); };
  var nx = el("button", "", "Næste ▶"); nx.id = "lt-next"; nx.onclick = function () { ltCycle(1); };
  r4.appendChild(pv); r4.appendChild(tsel); r4.appendChild(nx);
  box.appendChild(r4);

  /* -- start/stop og hvad lampen skal vise lige nu -- */
  var r5 = el("div", "lt-run");
  var go = el("button", LT.on ? "alarm" : "lt-go", LT.on ? "■ Stop test" : "▶ Start test"); go.id = "lt-go";
  go.onclick = function () {
    if (LT.on) ltStop();
    else { LT.on = true; LT.hold = null; ltSend(); }
    buildLampTest(true);
  };
  r5.appendChild(go);
  var stp = el("div", "lt-steps");
  var b1 = el("button", "sm", "◀ Trin"); b1.id = "lt-sback";
  b1.onclick = function () { ltSetHold((LT.hold === null ? LT.idx : LT.hold) - 1); buildLampTest(true); };
  var b2 = el("button", "sm", LT.hold === null ? "❚❚ Pause" : "▶ Fortsæt"); b2.id = "lt-pause";
  b2.onclick = function () { ltSetHold(LT.hold === null ? LT.idx : null); buildLampTest(true); };
  var b3 = el("button", "sm", "Trin ▶"); b3.id = "lt-sfwd";
  b3.onclick = function () { ltSetHold((LT.hold === null ? LT.idx : LT.hold) + 1); buildLampTest(true); };
  [b1, b2, b3].forEach(function (b) { b.disabled = !LT.on; stp.appendChild(b); });
  r5.appendChild(stp);
  box.appendChild(r5);
  var now = el("div", "lt-now"); now.id = "lt-now"; box.appendChild(now);
  var chs = el("div", "lt-chans"); chs.id = "lt-chans"; box.appendChild(chs);

  /* -- brug opsætningen -- */
  var r6 = el("div", "lt-row lt-apply"); r6.id = "lt-apply"; box.appendChild(r6);

  box.appendChild(el("div", "hint",
    "Start testen og tryk Næste, indtil lampen lyser i den farve der står i den store boks. " +
    "Så passer opsætningen — tryk på knappen nedenfor for at give lampen den. " +
    "Testen sender kun på de kanaler opsætningen fylder, og gør det oven i alt andet (også blackout). " +
    "Piletasterne ← → skifter opsætning, mens testen kører. Den stopper når du forlader Patch, og af sig selv efter 10 minutter."));
  ltShowUse(); ltShowNow();
}

function ltCustomEditor() {
  var wrap = el("div", "lt-custom");
  var row = el("div", "lt-seq");
  if (!LT.custom.length) row.appendChild(el("span", "hint", "Tom — tilføj farver nedenfor."));
  LT.custom.forEach(function (st, i) {
    var c = el("button", "lt-chip", (i + 1) + " · " + st.n);
    c.style.borderColor = ltCss(st);
    c.title = "Klik for at fjerne";
    var dot = el("span", "dot"); dot.style.background = ltCss(st); c.insertBefore(dot, c.firstChild);
    c.onclick = function () { LT.custom.splice(i, 1); LT.hold = null; ltSend(); buildLampTest(true); };
    row.appendChild(c);
  });
  wrap.appendChild(row);
  var add = el("div", "lt-add");
  add.appendChild(el("span", "k2", "Tilføj:"));
  function push(st) {
    if (LT.custom.length >= 32) { toast("Højst 32 trin"); return; }
    LT.custom.push(st); LT.hold = null; ltSend(); buildLampTest(true);
  }
  Object.keys(LT_COL).forEach(function (k) {
    var st = ltStep(k), b = el("button", "sm lt-addb", st.n);
    var dot = el("span", "dot"); dot.style.background = ltCss(st); b.insertBefore(dot, b.firstChild);
    b.onclick = function () { push(st); };
    add.appendChild(b);
  });
  wrap.appendChild(add);
  var pal = el("div", "lt-add");
  pal.appendChild(el("span", "k2", "Fra paletten:"));
  activePalette().forEach(function (c, i) {
    var b = el("button", "lt-palb"); b.style.background = hex(c); b.title = "Palettefarve " + (PAL_KEYS[i] || (i + 1));
    b.onclick = function () { push({ n: hex(c).toUpperCase(), r: c[0], g: c[1], b: c[2], w: 0, a: 0, uv: 0 }); };
    pal.appendChild(b);
  });
  wrap.appendChild(pal);
  var clr = el("button", "sm", "Ryd sekvensen");
  clr.onclick = function () { LT.custom = []; ltSend(); buildLampTest(true); };
  wrap.appendChild(clr);
  return wrap;
}

/* hvad der sidder på adressen, og knappen der giver lampen opsætningen */
function ltShowUse() {
  var u = id("lt-use"), ap = id("lt-apply"); if (!u || !ap) return;
  var p = ltProf(), n = p ? p.channels.length : 1, hit = ltLampsAt();
  var rng = "U" + LT.uni + " · kanal " + LT.addr + (n > 1 ? "–" + (LT.addr + n - 1) : "");
  u.innerHTML = "";
  if (LT.addr + n - 1 > 512) {
    u.appendChild(el("span", "lt-warn", rng + " — opsætningen løber ud over kanal 512."));
  } else if (!hit.length) {
    u.appendChild(el("span", "", rng + " — ingen lamper er patchet her. Testen sender direkte på adressen."));
  } else {
    u.appendChild(el("span", "", rng + " — her sidder: " + hit.map(function (i) {
      var m = S.modules[i];
      return (m.label || (i + 1)) + " · " + m.name + " (" + lampProfile(m).name + ", fra " + m.address + ")";
    }).join("; ")));
  }
  if (!armed()) {
    var w = el("div", "lt-warn", "DMX ud er slået fra, så testen når ikke ud til lamperne. ");
    var on = el("button", "sm", "Slå DMX ud til");
    on.onclick = function () { setArm(true); setTimeout(ltShowUse, 400); };
    w.appendChild(on); u.appendChild(w);
  }
  ap.innerHTML = "";
  if (!p) return;
  var exact = hit.filter(function (i) { return S.modules[i].address === LT.addr; });
  if (exact.length) {
    var i0 = exact[0], m0 = S.modules[i0];
    if (m0.type === LT.type) {
      ap.appendChild(el("span", "hint", "Lampe " + (m0.label || (i0 + 1)) + " har allerede denne opsætning."));
    } else {
      var sb = el("button", "lt-go", "Giv lampe " + (m0.label || (i0 + 1)) + " opsætningen “" + p.name + "”");
      sb.id = "lt-settype";
      sb.onclick = function () {
        api({ op: "fixture_settype", indices: [i0], type: LT.type }, function () {
          refresh(function () { toast((m0.label || (i0 + 1)) + " er nu " + p.name); buildLampTest(true); });
        });
      };
      ap.appendChild(sb);
    }
  } else {
    var ab = el("button", "lt-go", "Tilføj en lampe her med “" + p.name + "”");
    ab.id = "lt-addlamp";
    ab.onclick = function () {
      api({ op: "fixture_add", type: LT.type, qty: 1, universe: LT.uni, address: LT.addr }, function () {
        refresh(function () { toast("Lampe tilføjet på U" + LT.uni + " / " + LT.addr); buildLampTest(true); });
      });
    };
    ap.appendChild(ab);
    if (hit.length) ap.appendChild(el("span", "lt-warn", "Bemærk: den vil overlappe en lampe der allerede er patchet."));
  }
}

/* det store felt: hvilken farve lampen skal vise lige nu + kanalværdierne */
function ltShowNow() {
  var nb = id("lt-now"), cb = id("lt-chans"); if (!nb || !cb) return;
  var steps = ltSteps(), p = ltProf();
  if (!LT.on) {
    nb.className = "lt-now off";
    nb.innerHTML = "";
    nb.appendChild(el("span", "lbl", "Testen kører ikke"));
    cb.innerHTML = "";
    if (p) p.channels.forEach(function (c, i) {
      var ch = el("span", "lt-ch");
      ch.appendChild(el("b", "", String(LT.addr + i)));
      ch.appendChild(document.createTextNode(c.n || c.k));
      cb.appendChild(ch);
    });
    return;
  }
  var idx = Math.min(LT.idx, steps.length - 1), st = steps[idx] || steps[0];
  nb.className = "lt-now";
  nb.innerHTML = "";
  var sw = el("span", "sw"); sw.style.background = ltCss(st); nb.appendChild(sw);
  var tx = el("span", "txt");
  tx.appendChild(el("span", "small", "Lampen skal nu lyse"));
  tx.appendChild(el("span", "big", st.n.toUpperCase()));
  tx.appendChild(el("span", "small", "Trin " + (idx + 1) + " af " + steps.length + (LT.hold !== null ? " · på pause" : "")));
  nb.appendChild(tx);
  cb.innerHTML = "";
  if (p) p.channels.forEach(function (c, i) {
    var v = LT.ch && i < LT.ch.length ? LT.ch[i] : null;
    var ch = el("span", "lt-ch" + (v ? " hot" : ""));
    ch.appendChild(el("b", "", String(LT.addr + i)));
    ch.appendChild(document.createTextNode((c.n || c.k) + (v === null ? "" : " = " + v)));
    cb.appendChild(ch);
  });
}
/* kaldes fra poll() med serverens melding */
function ltFrame(lt) {
  if (!LT.on) return;
  if (!lt) {
    /* Et svar der var undervejs før testen blev startet, siger også "ingen
       test" - så kun når der er gået lidt tid siden vi sendte. Ellers har
       serveren sluppet testen (10 min). */
    if (Date.now() - (LT.sentAt || 0) < 2500) return;
    LT.on = false; LT.hold = null; LT.ch = null;
    if (id("v-patch").className.indexOf("active") >= 0) buildLampTest(true);
    return;
  }
  var key = lt.idx + "|" + (lt.ch || []).join(",");
  if (key === LT.lastKey) return;
  LT.lastKey = key; LT.idx = lt.idx; LT.ch = lt.ch;
  if (id("v-patch").className.indexOf("active") >= 0) ltShowNow();
}

/* ------------------------------------------------- Nulstil setup */
function openResetDialog() {
  var body = id("rstdlg-body"); body.innerHTML = "";
  var n = S.modules.length, sc = (S.scenes || []).length, gr = (S.group_labels || []).length;
  body.appendChild(el("p", "rst-lead", "Riggen tømmes, så du kan bygge et nyt setup op fra bunden."));
  var ul1 = el("ul", "rst-list");
  [["Fjernes", n + " lamper med adresser og placering, " + gr + " grupper, " + sc + " scener, cuelisten, " +
     "det der kører i Afvikling, lagene i Pult, egne mønstre og guiden."],
   ["Bliver", "DMX-udgangen (Output), indstillinger, dine egne lampetyper, farvepaletter og fanernes rækkefølge."]
  ].forEach(function (r) {
    var li = el("li"); li.appendChild(el("b", "", r[0] + ": ")); li.appendChild(document.createTextNode(r[1])); ul1.appendChild(li);
  });
  body.appendChild(ul1);
  body.appendChild(el("p", "hint", "Inden der nulstilles, gemmes en kopi af det hele under Show → Gemte shows " +
    "(med “før nulstilling” og tidspunktet i navnet). Hent den der, hvis du fortryder."));
  var row = el("div", "pal-btn-row");
  var yes = el("button", "alarm", "Nulstil setup"); yes.id = "rst-yes";
  var no = el("button", "", "Annullér");
  no.onclick = function () { id("rstdlg").className = ""; };
  yes.onclick = function () {
    yes.disabled = true;
    if (LT.on) { LT.on = false; LT.hold = null; LT.ch = null; }
    api({ op: "reset_setup" }, function (r) {
      id("rstdlg").className = "";
      if (!r || !r.ok) { toast("Kunne ikke nulstille"); return; }
      afSel = []; afSelG = []; laySel = []; laySelG = []; layEdSel = -1; ekSel = [];
      refresh(function () {
        if (typeof afSelChanged === "function" && id("v-afvikling").className.indexOf("active") >= 0) afSelChanged();
        buildLampTest(true);
        toast(r.backup ? "Nulstillet — kopi gemt som “" + r.backup + "”" : "Nulstillet");
        if (id("v-show").className.indexOf("active") >= 0) loadShowList();
      });
    });
  };
  row.appendChild(yes); row.appendChild(no);
  body.appendChild(row);
  id("rstdlg").className = "on";
}

/* --- patch: træk en række op eller ned for at flytte lampen --- */
var patchDragFrom = -1;
function patchMove(from, to) {
  if (to < 0 || to >= S.modules.length || from === to) return;
  var chk = id("pa-renum");
  api({ op: "fixture_reorder", from: from, to: to,
        renumber: !!(chk && chk.checked) },
      function () { refresh(function () { drawStage(); }); });
}
function patchRowDrag(tr, i) {
  tr.addEventListener("dragstart", function (e) {
    /* lad felter i rækken opføre sig normalt */
    if (e.target && e.target.tagName &&
        /INPUT|SELECT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); return; }
    patchDragFrom = i;
    tr.className += " dragging";
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    }
  });
  tr.addEventListener("dragend", function () {
    patchDragFrom = -1;
    var rows = id("patchtab").getElementsByTagName("tr");
    for (var k = 0; k < rows.length; k++)
      rows[k].className = rows[k].className.replace(/\s*drag(ging|over|under)/g, "");
  });
  tr.addEventListener("dragover", function (e) {
    if (patchDragFrom < 0 || patchDragFrom === i) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    tr.className = tr.className.replace(/\s*drag(over|under)/g, "") +
      (i > patchDragFrom ? " dragunder" : " dragover");
  });
  tr.addEventListener("dragleave", function () {
    tr.className = tr.className.replace(/\s*drag(over|under)/g, "");
  });
  tr.addEventListener("drop", function (e) {
    e.preventDefault();
    var from = patchDragFrom; patchDragFrom = -1;
    if (from < 0 || from === i) return;
    var chk = id("pa-renum");
    api({ op: "fixture_reorder", from: from, to: i,
          renumber: !!(chk && chk.checked) },
        function () { refresh(function () { drawStage(); }); });
  });
}

function patchNum(m, i, key, min, max) {
  var td = el("td");
  var inp = document.createElement("input");
  inp.type = "number"; inp.value = m[key]; inp.min = min; inp.max = max; inp.style.width = "62px";
  inp.onchange = function () {
    var v = parseInt(inp.value, 10); if (isNaN(v)) v = min;
    m[key] = v; setv(["modules", i, key], v, function () { buildPatch(); });
  };
  td.appendChild(inp); return td;
}
function patchConflicts() {
  var bad = {}, byU = {};
  S.modules.forEach(function (m, i) { (byU[m.universe] = byU[m.universe] || []).push(i); });
  var u;
  for (u in byU) {
    var arr = byU[u].slice().sort(function (a, b) {
      return S.modules[a].address - S.modules[b].address;
    });
    for (var p = 0; p < arr.length; p++) {
      var A = arr[p], aEnd = S.modules[A].address + lampSpan(S.modules[A]) - 1;
      if (aEnd > 512) bad[A] = true;
      for (var q = p + 1; q < arr.length; q++) {
        var B = arr[q];
        if (S.modules[B].address <= aEnd) { bad[A] = true; bad[B] = true; } else break;
      }
    }
  }
  return bad;
}
function buildPatchTypes() {
  var sel = id("pa-type"); if (!sel) return;
  var cur = sel.value, all = profilesAll(), key;
  sel.innerHTML = "";
  for (key in all) {
    var o = el("option", "", all[key].name + " (" + all[key].channels.length + " kan.)");
    o.value = key; sel.appendChild(o);
  }
  if (cur && all[cur]) sel.value = cur;
}
function updatePatchHint() {
  var e = id("pa-hint"); if (!e || !id("pa-type").value) return;
  var all = profilesAll(), t = id("pa-type").value;
  var span = all[t] ? all[t].channels.length : 1;
  var qty = parseInt(id("pa-qty").value, 10) || 1;
  var addr = parseInt(id("pa-addr").value, 10) || 1;
  var last = addr + qty * span - 1;
  e.innerHTML = qty + " × " + span + " kanaler = " + (qty * span) +
    " kanaler, adresse " + addr + "–" + last +
    (last > 512 ? " <b style='color:var(--alarm)'>(over 512 — brug nyt univers eller lavere start)</b>" : "");
}
function newProfileDialog() { ptNew(); }
/* ------------------------------------------------------- lampetyper */
/* Ret, kopiér og test lampetyper. Indbyggede typer kan ikke rettes
   direkte (de følger producentens manual), men kan kopieres til en egen
   type, der så kan finpudses kanal for kanal. */
var PT = { sel: null, draft: null, dirty: false, testSlot: -1, testVal: 0, testOn: false };
var PT_HELP = {
  dimmer: "Styres af pulten (lysstyrke)", dimmer_fine: "Styres af pulten (samme som dimmer)",
  r: "Styres af pulten", g: "Styres af pulten", b: "Styres af pulten",
  w: "Fast kanal — sættes i Pult", a: "Fast kanal — sættes i Pult", uv: "Fast kanal — sættes i Pult",
  strobe: "Fast kanal — sættes i Pult", duration: "Fast kanal — sættes i Pult",
  macro: "Fast kanal — sættes i Pult", generic: "Fast kanal — sættes i Pult",
  fixed: "Sender altid standardværdien", preset: "Holdes på standardværdien",
  sound: "Holdes på standardværdien", delay: "Holdes på standardværdien"
};
function ptIsBuiltin(t) { return !!(META.builtin_profiles || {})[t] && !(S.profiles || {})[t]; }
function ptUsers(t) {
  var out = [];
  S.modules.forEach(function (m, i) { if (m.type === t) out.push(i); });
  return out;
}
function ptCopyProfile(p) {
  return { name: p.name, shape: p.shape || "par",
           channels: p.channels.map(function (c) {
             var d = { k: c.k, n: c.n || c.k };
             if (c.def != null) d.def = c.def;
             if (c.max != null) d.max = c.max;
             if (c.inv) d.inv = true;
             return d;
           }) };
}
function ptSelect(t) {
  if (PT.testOn) ptTestStop();
  PT.sel = t; PT.dirty = false; PT.testSlot = -1;
  var p = profilesAll()[t];
  PT.draft = p ? ptCopyProfile(p) : null;
  buildProfileEditor();
}
function ptDirty() {
  PT.dirty = true;
  var e = id("pt-dirtymark"); if (e) e.textContent = "Ikke gemt";
}
function buildProfileEditor() {
  var sel = id("pt-sel"); if (!sel || !S || !META) return;
  var all = profilesAll(), k;
  if (!PT.sel || !all[PT.sel]) {
    var first = null;
    for (k in (S.profiles || {})) { first = k; break; }
    PT.sel = first || (S.modules[0] && S.modules[0].type) || Object.keys(all)[0];
    PT.draft = all[PT.sel] ? ptCopyProfile(all[PT.sel]) : null; PT.dirty = false;
  } else if (!PT.dirty) {
    PT.draft = ptCopyProfile(all[PT.sel]);
  }
  sel.innerHTML = "";
  [["Egne lampetyper", false], ["Indbyggede", true]].forEach(function (grp) {
    var og = document.createElement("optgroup"); og.label = grp[0]; var n = 0;
    for (k in all) {
      if (ptIsBuiltin(k) !== grp[1]) continue;
      var u = ptUsers(k).length;
      var o = el("option", "", all[k].name + " — " + all[k].channels.length + " kan." + (u ? " · " + u + " lamper" : ""));
      o.value = k; og.appendChild(o); n++;
    }
    if (n) sel.appendChild(og);
  });
  sel.value = PT.sel;

  var builtin = ptIsBuiltin(PT.sel), users = ptUsers(PT.sel);
  id("pt-del").style.display = builtin ? "none" : "";
  var info = id("pt-info"); info.innerHTML = "";
  info.appendChild(document.createTextNode(builtin
    ? "Indbygget type, lavet efter producentens manual. Den kan ikke rettes direkte — tryk Lav kopi for at få en egen type du kan finpudse. "
    : "Egen lampetype. Ret kanalerne herunder og tryk Gem. "));
  var ub = el("b", "", users.length ? "Bruges af " + users.length + " lamper (" +
    users.map(function (i) { return S.modules[i].num || (i + 1); }).join(", ") + ")." : "Bruges ikke af nogen lamper endnu.");
  info.appendChild(ub);

  /* --- navn, form og kanaler --- */
  var f = id("pt-form"); f.innerHTML = "";
  var d = PT.draft; if (!d) return;
  var r1 = el("div", "pt-row");
  r1.appendChild(el("span", "k", "Navn"));
  var nm = document.createElement("input"); nm.type = "text"; nm.value = d.name; nm.disabled = builtin;
  nm.oninput = function () { d.name = nm.value; ptDirty(); };
  r1.appendChild(nm);
  r1.appendChild(el("span", "k", "Form"));
  var sh = el("select"); sh.disabled = builtin;
  [["par", "PAR"], ["wash", "Wash"], ["spot", "Spot"], ["bar", "Bar"]].forEach(function (o) {
    var op = el("option", "", o[1]); op.value = o[0]; if (d.shape === o[0]) op.selected = true; sh.appendChild(op);
  });
  sh.onchange = function () { d.shape = sh.value; ptDirty(); };
  r1.appendChild(sh);
  f.appendChild(r1);

  var wrap = el("div", "tbl");
  var t = el("table", "pt-tbl");
  t.innerHTML = "<thead><tr><th>DMX</th><th>Funktion</th><th>Navn</th>" +
    "<th title='Værdien kanalen har, indtil du sætter den i Pult (og altid for Fast værdi)'>Standard</th>" +
    "<th title='Kanalen sendes aldrig højere end dette. Fx 159 hvis lampen strober over 159.'>Maks</th>" +
    "<th title='Vend kanalen: 0 bliver 255 og omvendt'>Vend</th><th></th></tr></thead>";
  var tb = document.createElement("tbody");
  var pal = META.channel_palette || [];
  d.channels.forEach(function (c, i) {
    var tr = el("tr", (/^(dimmer|dimmer_fine|r|g|b)$/.test(c.k) ? "auto" : "") + (PT.testOn && PT.testSlot === i ? " testing" : ""));
    tr.appendChild(el("td", "no", String(i + 1)));
    var tdf = el("td", "fn");
    if (builtin) tdf.textContent = (pal.filter(function (p) { return p[0] === c.k; })[0] || [c.k, c.k])[1];
    else {
      var fs = el("select");
      pal.forEach(function (p) { var o = el("option", "", p[1]); o.value = p[0]; if (p[0] === c.k) o.selected = true; fs.appendChild(o); });
      fs.onchange = function () {
        var old = (pal.filter(function (p) { return p[0] === c.k; })[0] || [0, ""])[1];
        if (!c.n || c.n === c.k || c.n === old) c.n = (pal.filter(function (p) { return p[0] === fs.value; })[0] || [0, fs.value])[1].replace(/\s*\(.*\)$/, "");
        c.k = fs.value; ptDirty(); buildProfileEditor();
      };
      tdf.appendChild(fs);
    }
    tdf.title = PT_HELP[c.k] || "";
    tr.appendChild(tdf);
    var tdn = el("td");
    if (builtin) tdn.textContent = c.n;
    else {
      var ni = document.createElement("input"); ni.type = "text"; ni.value = c.n;
      ni.oninput = function () { c.n = ni.value; ptDirty(); };
      tdn.appendChild(ni);
    }
    tr.appendChild(tdn);
    ["def", "max"].forEach(function (fld) {
      var td = el("td");
      var auto = /^(dimmer|dimmer_fine|r|g|b)$/.test(c.k);
      if (fld === "def" && auto) { td.appendChild(el("span", "hint", "pulten")); tr.appendChild(td); return; }
      if (builtin) { td.textContent = c[fld] != null ? c[fld] : (fld === "def" ? "0" : "—"); tr.appendChild(td); return; }
      var ip = document.createElement("input"); ip.type = "number"; ip.min = 0; ip.max = 255;
      ip.value = c[fld] != null ? c[fld] : ""; ip.placeholder = fld === "def" ? "0" : "255";
      ip.onchange = function () {
        var v = parseInt(ip.value, 10);
        if (isNaN(v)) delete c[fld]; else { v = Math.max(0, Math.min(255, v)); c[fld] = v; ip.value = v; }
        ptDirty();
      };
      td.appendChild(ip); tr.appendChild(td);
    });
    var tdi = el("td");
    var ci = document.createElement("input"); ci.type = "checkbox"; ci.checked = !!c.inv; ci.disabled = builtin;
    ci.onchange = function () { if (ci.checked) c.inv = true; else delete c.inv; ptDirty(); };
    tdi.appendChild(ci); tr.appendChild(tdi);
    var tda = el("td");
    if (!builtin) {
      var bu = el("button", "nudge", "▲"); bu.title = "Flyt op"; bu.disabled = i === 0;
      bu.onclick = function () { d.channels.splice(i - 1, 0, d.channels.splice(i, 1)[0]); ptDirty(); buildProfileEditor(); };
      var bd = el("button", "nudge", "▼"); bd.title = "Flyt ned"; bd.disabled = i === d.channels.length - 1;
      bd.onclick = function () { d.channels.splice(i + 1, 0, d.channels.splice(i, 1)[0]); ptDirty(); buildProfileEditor(); };
      var bx = el("button", "sm", "Fjern"); bx.disabled = d.channels.length <= 1;
      bx.onclick = function () { d.channels.splice(i, 1); ptDirty(); buildProfileEditor(); };
      tda.appendChild(bu); tda.appendChild(bd); tda.appendChild(bx);
    }
    tr.appendChild(tda);
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); f.appendChild(wrap);

  if (!builtin) {
    var br = el("div", "pt-row");
    var add = el("button", "", "+ Tilføj kanal");
    add.onclick = function () { d.channels.push({ k: "generic", n: "Ekstra kanal" }); ptDirty(); buildProfileEditor(); };
    var sv = el("button", "wz-primary", "Gem lampetype");
    sv.onclick = ptSave;
    var rv = el("button", "", "Fortryd");
    rv.onclick = function () { PT.dirty = false; buildProfileEditor(); };
    br.appendChild(add); br.appendChild(sv); br.appendChild(rv);
    var dm = el("span", "pt-dirty", PT.dirty ? "Ikke gemt" : ""); dm.id = "pt-dirtymark";
    br.appendChild(dm);
    f.appendChild(br);
    f.appendChild(el("div", "hint", "Funktioner med grøn kant styres af pulten. Faste kanaler (hvid, strobe, ekstra …) sættes i Pult " +
      "under Faste kanaler og har standardværdien indtil da. Fast værdi sender altid standardværdien — brug den til " +
      "mode- eller indstillingskanaler. Maks er en grænse, fx 159 hvis lampen begynder at strobe over 159."));
  }

  /* --- brug typen til lamper --- */
  var u = id("pt-use"); u.innerHTML = "";
  u.appendChild(el("div", "pt-sec", "Brug typen"));
  var ur = el("div", "pt-row");
  ur.appendChild(el("span", "", "Skift alle lamper af typen"));
  var from = el("select"), types = {};
  S.modules.forEach(function (m) { if (m.type !== PT.sel) types[m.type] = (types[m.type] || 0) + 1; });
  var tk = Object.keys(types);
  tk.forEach(function (x) { var o = el("option", "", (all[x] ? all[x].name : x) + " (" + types[x] + ")"); o.value = x; from.appendChild(o); });
  ur.appendChild(from);
  ur.appendChild(el("span", "", "til denne"));
  var ra = el("label", "chk"); var rc = document.createElement("input"); rc.type = "checkbox"; rc.checked = true;
  ra.appendChild(rc); ra.appendChild(document.createTextNode(" og adressér alle igen"));
  var go = el("button", "", "Skift");
  go.disabled = !tk.length || PT.dirty;
  go.title = PT.dirty ? "Gem typen først" : "";
  go.onclick = function () {
    var idx = []; S.modules.forEach(function (m, i) { if (m.type === from.value) idx.push(i); });
    if (!idx.length) return;
    if (!confirm("Skift " + idx.length + " lamper fra \u201c" + (all[from.value] ? all[from.value].name : from.value) +
                 "\u201d til \u201c" + all[PT.sel].name + "\u201d?" +
                 (rc.checked ? "\n\nAlle lamper får nye adresser bagefter." : ""))) return;
    api({ op: "fixture_settype", indices: idx, type: PT.sel, readdress: rc.checked }, function () {
      refresh(function () { toast(idx.length + " lamper skiftet til " + all[PT.sel].name); });
    });
  };
  ur.appendChild(go); ur.appendChild(ra);
  if (!tk.length) { ur.innerHTML = ""; ur.appendChild(el("span", "hint", "Alle lamper bruger allerede denne type.")); }
  u.appendChild(ur);

  /* --- kanaltest --- */
  var te = id("pt-test"); te.innerHTML = "";
  te.appendChild(el("div", "pt-sec", "Kanaltest"));
  if (!users.length) { te.appendChild(el("div", "hint", "Ingen lamper bruger typen, så der er intet at teste på.")); return; }
  te.appendChild(el("div", "hint", "Hold én DMX-kanal på en bestemt værdi på alle lamper af denne type — så kan du se, hvad kanalen gør. " +
    "Kræver at DMX ud er slået til. Testen slipper af sig selv efter 2 minutter." + (PT.dirty ? " Tester den gemte udgave." : "")));
  var tr2 = el("div", "pt-test");
  tr2.appendChild(el("span", "", "Kanal"));
  var ss = el("select");
  var saved = all[PT.sel].channels;
  saved.forEach(function (c, i) { var o = el("option", "", (i + 1) + " · " + c.n); o.value = i; ss.appendChild(o); });
  if (PT.testSlot < 0 || PT.testSlot >= saved.length) PT.testSlot = 0;
  ss.value = PT.testSlot;
  var rg = document.createElement("input"); rg.type = "range"; rg.min = 0; rg.max = 255; rg.value = PT.testVal;
  var vv = el("span", "val", String(PT.testVal));
  var st = el("button", PT.testOn ? "alarm" : "", PT.testOn ? "Stop test" : "Start test");
  var live = el("span", "pt-live", PT.testOn ? "● Test kører" : "");
  function send() {
    if (!PT.testOn) return;
    api({ op: "profile_probe", type: PT.sel, slot: PT.testSlot, value: PT.testVal });
  }
  var sendT = null;
  ss.onchange = function () { PT.testSlot = parseInt(ss.value, 10); send(); buildProfileEditor(); };
  rg.oninput = function () {
    PT.testVal = parseInt(rg.value, 10); vv.textContent = PT.testVal;
    if (!sendT) sendT = setTimeout(function () { sendT = null; send(); }, 60);
  };
  rg.onchange = function () { PT.testVal = parseInt(rg.value, 10); send(); };
  st.onclick = function () {
    if (PT.testOn) ptTestStop();
    else { PT.testOn = true; send(); }
    buildProfileEditor();
  };
  [0, 128, 255].forEach(function (q) {
    var qb = el("button", "sm", String(q));
    qb.onclick = function () { PT.testVal = q; rg.value = q; vv.textContent = q; send(); };
    tr2.appendChild(qb);
  });
  tr2.insertBefore(ss, tr2.children[1] || null);
  tr2.appendChild(rg); tr2.appendChild(vv); tr2.appendChild(st); tr2.appendChild(live);
  te.appendChild(tr2);
}
function ptTestStop() {
  PT.testOn = false;
  api({ op: "profile_probe", clear: true });
}
function ptSave() {
  var d = PT.draft;
  api({ op: "profile_save", id: ptIsBuiltin(PT.sel) ? "" : PT.sel, name: d.name, shape: d.shape, channels: d.channels },
    function (r) {
      if (!r || !r.ok) { toast((r && r.err) || "Kunne ikke gemme"); return; }
      PT.sel = r.id; PT.dirty = false;
      refresh(function () { buildProfileEditor(); toast("Lampetype gemt"); });
    });
}
function ptNew() {
  if (PT.testOn) ptTestStop();
  api({ op: "profile_save", name: "Egen lampe", shape: "par",
        channels: [{ k: "dimmer", n: "Dimmer" }, { k: "r", n: "Rød" }, { k: "g", n: "Grøn" }, { k: "b", n: "Blå" }] },
    function (r) {
      if (!r || !r.ok) return;
      PT.sel = r.id; PT.dirty = false;
      refresh(function () {
        buildProfileEditor();
        var p = id("pt-pan"); if (p && p.scrollIntoView) p.scrollIntoView();
        toast("Ny lampetype oprettet — ret navn og kanaler");
      });
    });
}

/* ============================================================ grupper UI */
function updateGrpInfo() {
  var e = id("le-grpinfo"); if (!e) return;
  var n = laySel.length, gn = laySelG.length;
  var parts = [];
  if (n) parts.push(n + (n === 1 ? " lampe" : " lamper"));
  if (gn) parts.push(gn + (gn === 1 ? " gruppe" : " grupper"));
  e.textContent = parts.length ? "Valgt: " + parts.join(" + ") : "Ingen valgt endnu";
  var one = (gn === 1 && n === 0) ? laySelG[0] : null;
  if (id("le-grpedit")) id("le-grpedit").disabled = !one;
  if (id("le-grpdel")) id("le-grpdel").disabled = gn === 0;
  if (id("le-grpadd")) id("le-grpadd").disabled = (n + gn) === 0;
}

/* --- gruppe-dialog: navngiv og nummerér indholdet --- */
var grpEdit = { id: null, name: "", members: [] };
function memLabel(mem) {
  if (mem.t === "lamp") {
    var m = S.modules[mem.i];
    return { main: m ? (m.name || ("Lampe " + (mem.i + 1))) : ("Lampe " + (mem.i + 1)),
             tag: "nr. " + (m && m.num != null ? m.num : mem.i + 1) };
  }
  var g = groupById(mem.id);
  return { main: g ? g.name : "(slettet gruppe)", tag: "gruppe" };
}
function openGroupDialog(gid) {
  grpEdit.id = gid || null;
  if (gid) {
    var g = groupById(gid);
    grpEdit.name = g.name;
    grpEdit.members = (g.members || []).map(function (m) { return { t: m.t, i: m.i, id: m.id }; });
  } else {
    grpEdit.name = "Gruppe " + (((S.group_labels || []).length) + 1);
    grpEdit.members = [];
    laySel.forEach(function (i) { grpEdit.members.push({ t: "lamp", i: i }); });
    laySelG.forEach(function (x) { if (x !== gid) grpEdit.members.push({ t: "grp", id: x }); });
  }
  id("grpdlg-title").textContent = gid ? "Redigér gruppe" : "Ny gruppe";
  buildGroupDialog();
  id("grpdlg").className = "on";
}
function closeGroupDialog() { id("grpdlg").className = ""; }
function buildGroupDialog() {
  var box = id("grpdlg-body"); box.innerHTML = "";
  var r = el("div", "rowline");
  r.appendChild(el("span", "k", "Navn"));
  var nm = document.createElement("input"); nm.type = "text"; nm.value = grpEdit.name;
  nm.style.flex = "1 1 auto"; nm.oninput = function () { grpEdit.name = nm.value; };
  r.appendChild(nm); box.appendChild(r);

  box.appendChild(el("div", "af-sec", "Indhold og rækkefølge (= nummerering til chase)"));
  if (!grpEdit.members.length) box.appendChild(el("div", "hint", "Ingen medlemmer endnu. Tilføj lamper eller grupper herunder."));
  grpEdit.members.forEach(function (mem, idx) {
    var row = el("div", "grpmem");
    row.appendChild(el("span", "no", String(idx + 1)));
    var lab = memLabel(mem);
    var nmw = el("span", "nm"); nmw.appendChild(el("b", "", lab.main)); nmw.appendChild(document.createTextNode(" ")); 
    var tg = el("span", "tag", lab.tag); nmw.appendChild(tg);
    row.appendChild(nmw);
    var up = el("button", "nudge", "▲"); up.disabled = idx === 0;
    up.onclick = function () { grpEdit.members.splice(idx - 1, 0, grpEdit.members.splice(idx, 1)[0]); buildGroupDialog(); };
    var dn = el("button", "nudge", "▼"); dn.disabled = idx === grpEdit.members.length - 1;
    dn.onclick = function () { grpEdit.members.splice(idx + 1, 0, grpEdit.members.splice(idx, 1)[0]); buildGroupDialog(); };
    var rm = el("button", "sm", "Fjern");
    rm.onclick = function () { grpEdit.members.splice(idx, 1); buildGroupDialog(); };
    row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
    box.appendChild(row);
  });

  /* tilføj lamper (dem der ikke allerede er med) */
  box.appendChild(el("div", "af-sec", "Tilføj lamper"));
  var haveL = {}; grpEdit.members.forEach(function (m) { if (m.t === "lamp") haveL[m.i] = 1; });
  var ll = el("div", "grpadd-list"); var anyL = false;
  S.modules.forEach(function (m, i) {
    if (haveL[i]) return; anyL = true;
    var rr = el("div", "row");
    rr.appendChild(el("span", "", (m.num != null ? m.num : i + 1) + " · " + (m.name || ("Lampe " + (i + 1)))));
    var b = el("button", "sm", "+ Tilføj");
    b.onclick = function () { grpEdit.members.push({ t: "lamp", i: i }); buildGroupDialog(); };
    rr.appendChild(b); ll.appendChild(rr);
  });
  if (!anyL) ll.appendChild(el("div", "hint", "Alle lamper er med."));
  box.appendChild(ll);

  /* tilføj andre grupper (ikke sig selv, ikke dem der allerede er med) */
  var others = (S.group_labels || []).filter(function (g) {
    if (g.id === grpEdit.id) return false;
    /* en gruppe der et sted nede indeholder den vi redigerer, ville
       lave en ring (A i B og B i A) - den kan ikke tilføjes */
    if (grpEdit.id && grpContains(g.id, grpEdit.id)) return false;
    for (var k = 0; k < grpEdit.members.length; k++) if (grpEdit.members[k].t === "grp" && grpEdit.members[k].id === g.id) return false;
    return true;
  });
  if (others.length) {
    box.appendChild(el("div", "af-sec", "Tilføj grupper (indlejring)"));
    var gl = el("div", "grpadd-list");
    others.forEach(function (g) {
      var rr = el("div", "row");
      rr.appendChild(el("span", "", g.name + " (" + groupLeaves(g.id).length + " lamper)"));
      var b = el("button", "sm", "+ Tilføj");
      b.onclick = function () { grpEdit.members.push({ t: "grp", id: g.id }); buildGroupDialog(); };
      rr.appendChild(b); gl.appendChild(rr);
    });
    box.appendChild(gl);
  }

  var bar = el("div", "btns"); bar.style.marginTop = "14px";
  var save = el("button", "wz-primary", grpEdit.id ? "Gem gruppe" : "Opret gruppe");
  save.onclick = saveGroupDialog;
  var cancel = el("button", "", "Annullér"); cancel.onclick = closeGroupDialog;
  bar.appendChild(save); bar.appendChild(cancel);
  box.appendChild(bar);
}
function saveGroupDialog() {
  var name = (grpEdit.name || "").trim() || "Gruppe";
  var members = grpEdit.members.map(function (m) {
    return m.t === "lamp" ? { t: "lamp", i: m.i } : { t: "grp", id: m.id };
  });
  if (grpEdit.id) {
    api({ op: "glabel_update", id: grpEdit.id, name: name, members: members }, function () {
      closeGroupDialog(); refresh(function () { drawStage(); });
    });
  } else {
    /* placér labelen over midten af indholdet */
    var leaves = []; members.forEach(function (m) {
      if (m.t === "lamp") leaves.push(m.i); else groupLeaves(m.id).forEach(function (i) { leaves.push(i); });
    });
    var cx = 0, cy = 0, n = 0;
    leaves.forEach(function (i) { if (S.modules[i]) { cx += S.modules[i].x; cy += S.modules[i].y; n++; } });
    cx = n ? cx / n : 0; cy = n ? cy / n + 1.2 : 2;
    api({ op: "glabel_add", name: name, members: members, x: Math.round(cx * 100) / 100, y: Math.round(cy * 100) / 100 },
      function (d) {
        closeGroupDialog();
        laySel = []; laySelG = d && d.id ? [d.id] : [];
        refresh(function () { updateGrpInfo(); drawStage(); });
      });
  }
}

/* ============================================================ farve-hjælp */
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  var h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360; var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  var r, g, b;
  if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/* ============================================================ AFVIKLING */
var afSel = [], afSelG = [];
var afScale = 40, afPanX = 0, afPanY = 0, afPan = null, afMarq = null, afGDrag = null;
var gBoxesAf = [];
var afPanMode = false;
var afDraft = null, afPicker = "felt";   /* felt | skydere | palet */
var afHue = 20;                           /* valgt kulør i farvefeltet */
var AF_GCOL = ["#ffc23d","#4fc9ec","#62c07b","#f0705c","#b98cff","#ff8fd0"];
var PAL_KEYS = "ASDFGHJZXCVBNM";   /* 14 bogstaver – ét pr. felt */
var AF_SW_FALLBACK = [[255,0,0],[255,80,0],[255,160,0],[255,230,0],[120,255,0],[0,255,80],
  [0,220,255],[0,80,255],[130,0,255],[230,0,255],[255,0,140],[255,255,255],[255,180,110],[180,210,255]];
function activePalette() {
  if (!S || !S.palettes || !S.palettes.length) return AF_SW_FALLBACK;
  var idx = S.active_palette || 0;
  if (idx < 0 || idx >= S.palettes.length) idx = 0;
  return S.palettes[idx].colours || AF_SW_FALLBACK;
}

function afCx() { var cv = id("afstage"); return cv.width / 2 + afPanX; }
function afCy() { var cv = id("afstage"); return cv.height / 2 + afPanY; }
function afX(x) { return afCx() + x * afScale; }
function afY(y) { return afCy() - y * afScale; }
function afSX2L(p) { return (p - afCx()) / afScale; }
function afSY2L(p) { return -(p - afCy()) / afScale; }

function drawAfStage() {
  if (!S || !S.modules) return;
  var cv = id("afstage"); if (!cv) return;
  if (!cv.width || cv._w !== cv.clientWidth) { cv.width = cv.clientWidth; cv.height = cv.clientHeight; cv._w = cv.clientWidth; }
  var g = cv.getContext("2d"), w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  var frame = lastFrame;
  /* gulvlinje */
  g.strokeStyle = cssvar("--rule"); g.globalAlpha = 0.3; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, afCy()); g.lineTo(w, afCy()); g.stroke(); g.globalAlpha = 1;
  /* lamper */
  S.modules.forEach(function (m, i) {
    var prof = lampProfile(m), X = afX(m.x), Y = afY(m.y), rad = Math.max(8, afScale * 0.26);
    var col = (frame && frame[i]) ? ("#" + frame[i].substr(0, 6)) : "#202530";
    var lit = m.on && frame && frame[i] && frame[i].substr(0, 6) !== "000000";
    if (lit) { g.save(); g.globalAlpha = 0.35; g.fillStyle = col; g.beginPath(); g.arc(X, Y, rad * 1.9, 0, 6.283); g.fill(); g.restore(); }
    var selp = inArr(afSel, i);
    g.lineWidth = selp ? 4 : 2;
    g.strokeStyle = selp ? cssvar("--accent") : (m.on ? cssvar("--ink") : cssvar("--dim"));
    g.fillStyle = m.on ? col : cssvar("--panel2");
    if (prof.shape === "wash") { roundRect(g, X - rad * 1.35, Y - rad * 0.7, rad * 2.7, rad * 1.4, 4); g.fill(); g.stroke(); }
    else if (prof.shape === "spot") { g.beginPath(); g.moveTo(X, Y - rad); g.lineTo(X + rad * 0.92, Y + rad * 0.8); g.lineTo(X - rad * 0.92, Y + rad * 0.8); g.closePath(); g.fill(); g.stroke(); }
    else if (prof.shape === "bar") { roundRect(g, X - rad * 1.7, Y - rad * 0.32, rad * 3.4, rad * 0.64, 3); g.fill(); g.stroke(); }
    else { g.beginPath(); g.arc(X, Y, rad, 0, 6.283); g.fill(); g.stroke(); }
    g.fillStyle = cssvar("--muted"); g.font = "bold 11px " + getComputedStyle(document.body).fontFamily; g.textAlign = "left";
    g.fillText(String(m.num != null ? m.num : (i + 1)), X + rad + 3, Y - rad + 2);
  });
  afBadges(g);
  drawGroupLabels(g, afX, afY, afSelG, gBoxesAf);
  if (afMarq) {
    g.save(); g.strokeStyle = cssvar("--accent"); g.fillStyle = cssvar("--accent");
    g.globalAlpha = 0.12; g.fillRect(afMarq.l, afMarq.t, afMarq.w, afMarq.h);
    g.globalAlpha = 0.9; g.lineWidth = 1; if (g.setLineDash) g.setLineDash([4, 3]);
    g.strokeRect(afMarq.l, afMarq.t, afMarq.w, afMarq.h); if (g.setLineDash) g.setLineDash([]); g.restore();
  }
}
function afRaw(ev) { var cv = id("afstage"), r = cv.getBoundingClientRect(); var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev; return { sx: t.clientX - r.left, sy: t.clientY - r.top }; }
function afDown(ev) {
  ev.preventDefault(); var p = afRaw(ev);
  if (afPanMode || ev.button === 1 || (ev.altKey && ev.button === 0)) { afPan = { sx: p.sx, sy: p.sy, px: afPanX, py: afPanY }; return; }
  var gid = hitGroupBox(gBoxesAf, p.sx, p.sy);
  if (gid) { toggleArr(afSelG, gid); afSelChanged(); return; }
  var wx = afSX2L(p.sx), wy = afSY2L(p.sy), hl = lampNear(wx, wy, 1.3);
  if (hl >= 0) { toggleArr(afSel, hl); afSelChanged(); return; }
  afMarq = { sx: p.sx, sy: p.sy, l: p.sx, t: p.sy, w: 0, h: 0, add: ev.shiftKey };
}
function afMove(ev) {
  if (afPan) { ev.preventDefault(); var pp = afRaw(ev); afPanX = afPan.px + (pp.sx - afPan.sx); afPanY = afPan.py + (pp.sy - afPan.sy); drawAfStage(); return; }
  if (afMarq) { ev.preventDefault(); var pm = afRaw(ev); afMarq.l = Math.min(afMarq.sx, pm.sx); afMarq.t = Math.min(afMarq.sy, pm.sy); afMarq.w = Math.abs(pm.sx - afMarq.sx); afMarq.h = Math.abs(pm.sy - afMarq.sy); drawAfStage(); }
}
function afUp(ev) {
  if (afPan) { afPan = null; return; }
  if (afMarq) {
    var mq = afMarq; afMarq = null;
    if (mq.w > 3 || mq.h > 3) {
      if (!mq.add) afSel = [];
      S.modules.forEach(function (m, i) { var sx = afX(m.x), sy = afY(m.y); if (sx >= mq.l && sx <= mq.l + mq.w && sy >= mq.t && sy <= mq.t + mq.h && !inArr(afSel, i)) afSel.push(i); });
      afSelChanged();
    } else drawAfStage();
  }
}
function afFit() {
  var cv = id("afstage");
  /* altid synk til den viste størrelse — ellers regnes fit på canvasets
     standard 300x150 og labels/lamper rammer ved siden af klikket */
  if (cv.clientWidth) { cv.width = cv.clientWidth; cv.height = cv.clientHeight; cv._w = cv.clientWidth; }
  afPanX = 0; afPanY = 0;
  if (!S || !S.modules.length) { afScale = 40; drawAfStage(); return; }
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  S.modules.forEach(function (m) { x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y); });
  (S.group_labels || []).forEach(function (gr) { x0 = Math.min(x0, gr.x); x1 = Math.max(x1, gr.x); y0 = Math.min(y0, gr.y); y1 = Math.max(y1, gr.y); });
  var sw = Math.max(1, x1 - x0 + 2), sh = Math.max(1, y1 - y0 + 2);
  afScale = Math.max(12, Math.min(120, Math.min((cv.width - 40) / sw, (cv.height - 40) / sh)));
  afPanX = -((x0 + x1) / 2) * afScale; afPanY = ((y0 + y1) / 2) * afScale;
  drawAfStage();
}

/* --- hvad er valgt → mål, look og draft --- */
function lookKeyOf(t) { return t.group ? ("g:" + t.group) : ("l:" + (t.lamps || []).join(",")); }
function afTarget() {
  if (afSelG.length === 1 && afSel.length === 0) return { group: afSelG[0] };
  return { lamps: selOrderedLamps(afSel, afSelG) };
}
function afLook() {
  var k = lookKeyOf(afTarget()), ll = (S.live && S.live.looks) || [];
  for (var i = 0; i < ll.length; i++) if (ll[i].key === k) return ll[i];
  return null;
}
function afGlobalFade() {
  return (S && S.live && S.live.fade != null) ? S.live.fade : 1.0;
}
function lookOfGroup(gid) {
  var ll = (S && S.live && S.live.looks) || [], k = "g:" + gid;
  for (var i = 0; i < ll.length; i++) if (ll[i].key === k) return ll[i];
  return null;
}
/* genvejstal: 1..9 og 0 til den tiende gruppe */
function afDigitFor(i) { return i < 9 ? String(i + 1) : (i === 9 ? "0" : ""); }

/* kolonnen med ét ikon pr. gruppe - klik vælger, tallet er genvejstasten */
function buildAfIcons() {
  var box = id("af-icons"); if (!box || !S) return;
  box.innerHTML = "";
  box.appendChild(el("div", "hd", "Grupper"));
  var gs = S.group_labels || [];
  if (!gs.length) {
    box.appendChild(el("div", "none", "Ingen grupper endnu. Lav dem under Layout."));
    return;
  }
  gs.forEach(function (gr, i) {
    var b = el("button", "af-ic");
    var k = afSelG.indexOf(gr.id), on = k >= 0;
    press(b, on);
    b.appendChild(el("span", "key", afDigitFor(i)));
    b.appendChild(el("span", "nm", gr.name));
    var dot = el("span", "dot");
    var lk = lookOfGroup(gr.id);
    dot.style.background = (lk && lk.on !== false) ? hex(lk.colour || [90, 90, 90]) : "transparent";
    b.appendChild(dot);
    if (on) b.style.borderColor = AF_GCOL[k % AF_GCOL.length];
    b.title = gr.name + " (" + groupLeaves(gr.id).length + " lamper)" +
      (afDigitFor(i) ? " — tast " + afDigitFor(i) : "");
    b.onclick = function () { toggleArr(afSelG, gr.id); afSelChanged(); };
    box.appendChild(b);
  });
}

/* gruppens egne numre på lamperne, så man kan se chase-rækkefølgen.
   Flere valgte grupper får hver sin farve, og en lampe der er med i
   flere viser et tal pr. gruppe. */
function afBadges(g) {
  if (!afSelG.length) return;
  var per = {};
  afSelG.forEach(function (gid, k) {
    var col = AF_GCOL[k % AF_GCOL.length];
    groupLeaves(gid).forEach(function (mi, idx) {
      (per[mi] = per[mi] || []).push({ n: idx + 1, col: col });
    });
  });
  g.save();
  g.font = "700 11px " + getComputedStyle(document.body).fontFamily;
  g.textAlign = "center"; g.textBaseline = "middle";
  var rad = Math.max(8, afScale * 0.26);
  for (var mi in per) {
    var m = S.modules[mi]; if (!m) continue;
    var list = per[mi], w = 18, totw = list.length * w;
    var bx = afX(m.x), by = afY(m.y) + rad + 10;
    for (var j = 0; j < list.length; j++) {
      var x = bx - totw / 2 + w / 2 + j * w;
      g.fillStyle = list[j].col;
      g.beginPath(); g.arc(x, by, 8.5, 0, 6.283); g.fill();
      g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#10131a";
      g.fillText(String(list[j].n), x, by + 1);
    }
  }
  g.restore();
}

function afDefaultDraft() {
  return { on: true, level: 255, fade: afGlobalFade(), pattern: "fyldt", colour_mode: "fast",
    colour: [255, 120, 40], stops: [[255, 0, 0], [0, 0, 255]], hue_speed: 10, hue_spread: 100,
    speed: 30, size: 30, density: 50, tail: 40, steps: 3, dir: 1, spread: 0 };
}
function afSelChanged() {
  var lk = afLook();
  if (lk) {
    afDraft = {};
    var d = afDefaultDraft(); for (var k in d) afDraft[k] = (lk[k] != null ? lk[k] : d[k]);
    afDraft.colour = (lk.colour || [255, 120, 40]).slice();
  } else afDraft = afDefaultDraft();
  var hv = rgb2hsv(afDraft.colour[0], afDraft.colour[1], afDraft.colour[2]); afHue = hv[0];
  buildAfCtrl(); buildAfIcons(); drawAfStage();
}
function afHasSel() { return afSel.length > 0 || afSelG.length > 0; }
function afSend(values, useFade) {
  if (!afHasSel()) return;
  for (var k in values) afDraft[k] = values[k];
  var tgt = afTarget(), key = lookKeyOf(tgt);
  /* Skriv ændringen ind i den lokale model med det samme. Fladen følger
     selv med på serverens revisionsnummer efter egne kald og henter
     derfor ikke showet igen - uden dette ville fx en gemt overgangstid
     ikke komme frem, næste gang gruppen vælges. */
  S.live = S.live || { looks: [] };
  S.live.looks = S.live.looks || [];
  var lk = null, i;
  for (i = 0; i < S.live.looks.length; i++) if (S.live.looks[i].key === key) lk = S.live.looks[i];
  if (!lk) {
    lk = { key: key, target: tgt, on: true, level: 255, fade: afGlobalFade() };
    S.live.looks.push(lk);
  }
  for (var k2 in values) lk[k2] = values[k2];
  /* markBusy holder poll fra at genopbygge panelet midt i et træk -
     clearBusy slipper det igen, så fladen ikke holder op med at
     hente opdateringer fra serveren. */
  markBusy(); clearBusy();
  api({ op: "live_set", target: tgt, values: values, fade: useFade ? afDraft.fade : 0 });
}

function afTitle() {
  if (afSelG.length === 1 && afSel.length === 0) { var g = groupById(afSelG[0]); return g ? g.name : "Gruppe"; }
  var parts = [];
  if (afSelG.length) parts.push(afSelG.length + (afSelG.length === 1 ? " gruppe" : " grupper"));
  if (afSel.length) parts.push(afSel.length + (afSel.length === 1 ? " lampe" : " lamper"));
  return parts.join(" + ");
}
function buildAfCtrl() {
  var box = id("af-ctrl"); if (!box) return; box.innerHTML = "";
  var info = id("af-selinfo");
  afGlobalRow(box);
  if (!afHasSel()) {
    if (info) info.innerHTML = "";
    box.appendChild(el("div", "af-empty", "Vælg en lampe eller en gruppe — i oversigten, eller i gruppe-kolonnen ved siden af. Tasterne 1–9 og 0 vælger en gruppe direkte."));
    return;
  }
  if (!afDraft) afDraft = afDefaultDraft();
  var tgt = afTarget(), nlamps = tgt.group ? groupLeaves(tgt.group).length : (tgt.lamps || []).length;
  if (info) info.innerHTML = "Styrer <b>" + afTitle() + "</b> — " + nlamps + (nlamps === 1 ? " lampe" : " lamper");

  /* top: navn + tænd/sluk + fjern */
  var top = el("div", "af-toprow");
  top.appendChild(el("span", "big", afTitle()));
  var onb = el("button", afDraft.on ? "on" : "", afDraft.on ? "Tændt" : "Slukket");
  press(onb, afDraft.on);
  onb.onclick = function () {
    afSend({ on: !afDraft.on }, false);
    press(onb, afDraft.on); onb.textContent = afDraft.on ? "Tændt" : "Slukket";
    buildAfIcons();
  };
  top.appendChild(onb);
  var clr = el("button", "sm", "Nulstil");
  clr.title = "Fjern dette looks styring";
  clr.onclick = function () { api({ op: "live_del", key: lookKeyOf(afTarget()) }, function () { refresh(function () { afDraft = afDefaultDraft(); buildAfCtrl(); drawAfStage(); }); }); };
  top.appendChild(clr);
  box.appendChild(top);

  /* niveau + overgangstid */
  var lv = el("div", "af-row");
  lv.appendChild(el("span", "k", "Lysstyrke"));
  var lvi = document.createElement("input"); lvi.type = "range"; lvi.min = 0; lvi.max = 255; lvi.value = afDraft.level;
  var lvv = el("span", "v", Math.round(afDraft.level / 2.55) + "%");
  lvi.oninput = function () { afDraft.level = parseInt(lvi.value, 10); lvv.textContent = Math.round(afDraft.level / 2.55) + "%"; throttledLive("level", { level: afDraft.level }); };
  lv.appendChild(lvi); lv.appendChild(lvv); box.appendChild(lv);

  var fd = el("div", "af-row");
  fd.appendChild(el("span", "k", "Overgangstid"));
  var fdi = document.createElement("input"); fdi.type = "range";
  fdi.min = 0; fdi.max = 300; fdi.value = Math.round(afDraft.fade * 10);
  var fdn = document.createElement("input"); fdn.type = "number";
  fdn.min = 0; fdn.max = 30; fdn.step = 0.1; fdn.value = afDraft.fade.toFixed(1);
  function setFade(v, fromSlider) {
    v = Math.max(0, Math.min(30, Math.round(v * 10) / 10));
    afDraft.fade = v;
    fdn.value = v.toFixed(1);
    if (!fromSlider) fdi.value = Math.round(v * 10);
    /* gemmes på netop dette valg, så den følger gruppen */
    throttledLive("fade", { fade: v });
  }
  fdi.oninput = function () { setFade(parseInt(fdi.value, 10) / 10, true); };
  fdn.onchange = function () {
    var v = parseFloat(String(fdn.value).replace(",", "."));
    setFade(isNaN(v) ? afDraft.fade : v, false);
  };
  var fw = el("span", "af-fadewrap"); fw.appendChild(fdn); fw.appendChild(el("span", "hint", "sek."));
  fd.appendChild(fdi); fd.appendChild(fw); box.appendChild(fd);
  box.appendChild(el("div", "hint", "Gælder når du trykker på et farvefelt — så toner lyset blødt over. " +
    "Tiden hører til dette valg og huskes, når du vælger gruppen igen."));

  /* farve */
  box.appendChild(el("div", "af-sec", "Farve"));
  var pb = el("div", "af-pickbtns");
  [["felt", "Farvefelt"], ["skydere", "Skydere"], ["palet", "Paletter"]].forEach(function (o) {
    var b = el("button", "sm", o[1]); press(b, afPicker === o[0]);
    b.onclick = function () { afPicker = o[0]; buildAfCtrl(); };
    pb.appendChild(b);
  });
  box.appendChild(pb);

  var cur = el("div", "af-cur");
  var chip = el("span", "chip"); chip.id = "af-chip"; chip.style.background = hex(afDraft.colour);
  cur.appendChild(chip); cur.appendChild(el("span", "hint", "Aktuel farve")); box.appendChild(cur);

  if (afPicker === "felt") afBuildField(box, chip);
  else if (afPicker === "skydere") afBuildSliders(box, chip);
  else afBuildSwatches(box, chip);

  /* mønster m.m. */
  box.appendChild(el("div", "af-sec", "Mønster og bevægelse"));
  var pr = el("div", "af-row");
  pr.appendChild(el("span", "k", "Mønster"));
  var ps = el("select");
  (META.patterns || []).forEach(function (p) { if (p[0] === "egen") return; var o = el("option", "", p[1]); o.value = p[0]; if (afDraft.pattern === p[0]) o.selected = true; ps.appendChild(o); });
  ps.onchange = function () { afSend({ pattern: ps.value }, false); buildAfCtrl(); };
  pr.appendChild(ps); box.appendChild(pr);

  var cm = el("div", "af-row");
  cm.appendChild(el("span", "k", "Farvekilde"));
  var cms = el("select");
  (META.colour_modes || []).forEach(function (c) { var o = el("option", "", c[1]); o.value = c[0]; if (afDraft.colour_mode === c[0]) o.selected = true; cms.appendChild(o); });
  cms.onchange = function () { afSend({ colour_mode: cms.value }, false); buildAfCtrl(); };
  cm.appendChild(cms); box.appendChild(cm);

  if (afDraft.pattern !== "fyldt") {
    afRow(box, "Fart", 0, 200, afDraft.speed, function (v) { afDraft.speed = v; throttledLive("speed", { speed: v }); });
    afRow(box, "Størrelse", 0, 100, afDraft.size, function (v) { afDraft.size = v; throttledLive("size", { size: v }); });
    afRow(box, "Forskydning", 0, 100, afDraft.spread, function (v) { afDraft.spread = v; throttledLive("spread", { spread: v }); });
    var dr = el("div", "af-row"); dr.appendChild(el("span", "k", "Retning"));
    var db = el("button", "", afDraft.dir > 0 ? "Fremad" : "Baglæns");
    db.onclick = function () { afDraft.dir = -afDraft.dir; db.textContent = afDraft.dir > 0 ? "Fremad" : "Baglæns"; afSend({ dir: afDraft.dir }, false); };
    dr.appendChild(db); box.appendChild(dr);
    box.appendChild(el("div", "hint", "Chase o.l. løber efter gruppens nummerering (rediger den under Layout → Redigér gruppe)."));
  }
  if (afDraft.colour_mode === "gradient" || afDraft.colour_mode === "cyklus") {
    var grad = afDraft.colour_mode === "gradient";
    box.appendChild(el("div", "af-sec", grad ? "Farver i gradienten" : "Farver i paletten"));
    if (!afDraft.stops || afDraft.stops.length < 2) afDraft.stops = [[255, 0, 0], [0, 0, 255]];
    var sw = el("div", "af-stops");
    afDraft.stops.forEach(function (c, si) {
      var st = el("span", "st");
      colourControl(st, c, function (nc) {
        afDraft.stops[si] = nc;
        throttledLive("stops", { stops: afDraft.stops.slice() });
      });
      var rm = el("button", "sm", "✕");
      rm.title = "Fjern farven";
      rm.disabled = afDraft.stops.length <= 2;
      rm.onclick = function () {
        afDraft.stops.splice(si, 1);
        afSend({ stops: afDraft.stops.slice() }, false); buildAfCtrl();
      };
      st.appendChild(rm); sw.appendChild(st);
    });
    var addc = el("button", "sm", "+ Farve");
    addc.onclick = function () {
      afDraft.stops.push([255, 255, 255]);
      afSend({ stops: afDraft.stops.slice() }, false); buildAfCtrl();
    };
    sw.appendChild(addc);
    box.appendChild(sw);
    box.appendChild(el("div", "hint", grad
      ? "Farverne fordeles hen over gruppen i dens nummerering — første farve på nr. 1, sidste på den sidste lampe."
      : "Farverne skifter efter hinanden på alle lamperne. Farvefart styrer hvor hurtigt."));
    if (!grad)
      afRow(box, "Farvefart", 0, 100, afDraft.hue_speed, function (v) {
        afDraft.hue_speed = v; throttledLive("hue_speed", { hue_speed: v });
      });
  }
  if (afDraft.colour_mode === "regnbue") {
    afRow(box, "Farvefart", 0, 100, afDraft.hue_speed, function (v) { afDraft.hue_speed = v; throttledLive("hue_speed", { hue_speed: v }); });
    afRow(box, "Farvebredde", 0, 200, afDraft.hue_spread, function (v) { afDraft.hue_spread = v; throttledLive("hue_spread", { hue_spread: v }); });
  }
}
function afGlobalRow(box) {
  var w = el("div", "af-global");
  var r = el("div", "af-fadewrap");
  r.appendChild(el("span", "k", "Standard overgangstid"));
  var ni = document.createElement("input");
  ni.type = "number"; ni.min = 0; ni.max = 30; ni.step = 0.1;
  ni.value = afGlobalFade().toFixed(1);
  ni.onchange = function () {
    var v = parseFloat(String(ni.value).replace(",", "."));
    if (isNaN(v)) v = afGlobalFade();
    v = Math.max(0, Math.min(30, Math.round(v * 10) / 10));
    ni.value = v.toFixed(1);
    S.live = S.live || {}; S.live.fade = v;
    markBusy(); clearBusy(); setv(["live", "fade"], v);
  };
  r.appendChild(ni);
  r.appendChild(el("span", "hint", "sek. — bruges af grupper der ikke har fået deres egen"));
  w.appendChild(r);
  box.appendChild(w);
}

function afRow(box, label, mn, mx, val, cb) {
  var r = el("div", "af-row"); r.appendChild(el("span", "k", label));
  var i = document.createElement("input"); i.type = "range"; i.min = mn; i.max = mx; i.value = val;
  var v = el("span", "v", String(val));
  i.oninput = function () { var x = parseInt(i.value, 10); v.textContent = x; cb(x); };
  r.appendChild(i); r.appendChild(v); box.appendChild(r);
  return i;
}
var throttledLive = (function () {
  var t = {};
  return function (key, values) {
    if (t[key]) return; /* throttle pr. nøgle */
    afSend(values, false);
    t[key] = setTimeout(function () { t[key] = null; afSend(values, false); }, 55);
  };
})();

function afSetColour(c, useFade) { afDraft.colour = c.slice(); var ch = id("af-chip"); if (ch) ch.style.background = hex(c); afSend({ colour: c, colour_mode: "fast" }, useFade); }
function afBuildSliders(box, chip) {
  var wrap = el("div", "af-rgb");
  ["R", "G", "B"].forEach(function (lab, idx) {
    var r = el("div", "rowline"); r.appendChild(el("span", "k", lab));
    var i = document.createElement("input"); i.type = "range"; i.min = 0; i.max = 255; i.value = afDraft.colour[idx];
    var v = el("span", "v", String(afDraft.colour[idx]));
    i.oninput = function () { afDraft.colour[idx] = parseInt(i.value, 10); v.textContent = i.value; chip.style.background = hex(afDraft.colour); throttledLive("col", { colour: afDraft.colour.slice(), colour_mode: "fast" }); };
    r.appendChild(i); r.appendChild(v); wrap.appendChild(r);
  });
  box.appendChild(wrap);
}
function afBuildField(box, chip) {
  var wrap = el("div", "af-hsv-wrap");
  var fc = document.createElement("canvas"); fc.id = "af-hsv"; wrap.appendChild(fc);
  var hc = document.createElement("canvas"); hc.id = "af-hue"; wrap.appendChild(hc);
  box.appendChild(wrap);
  function paint() {
   try {
    var w = fc.clientWidth || 260, h = fc.clientHeight || 150; fc.width = w; fc.height = h;
    var g = fc.getContext("2d");
    var base = hsv2rgb(afHue, 1, 1);
    var gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, "#fff"); gx.addColorStop(1, "rgb(" + base[0] + "," + base[1] + "," + base[2] + ")");
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
    var gy = g.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, "rgba(0,0,0,0)"); gy.addColorStop(1, "#000");
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
    var hw = hc.clientWidth || 260, hh = 30; hc.width = hw; hc.height = hh;
    var hg = hc.getContext("2d"); var grd = hg.createLinearGradient(0, 0, hw, 0);
    for (var s = 0; s <= 6; s++) { var cc = hsv2rgb(s * 60, 1, 1); grd.addColorStop(s / 6, "rgb(" + cc[0] + "," + cc[1] + "," + cc[2] + ")"); }
    hg.fillStyle = grd; hg.fillRect(0, 0, hw, hh);
   } catch (e) { /* gradient ikke tilgængelig - feltet virker stadig til at vælge */ }
  }
  setTimeout(paint, 0);
  function pickField(ev, fade) {
    var r = fc.getBoundingClientRect(), t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    var x = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (t.clientY - r.top) / r.height));
    afSetColour(hsv2rgb(afHue, x, 1 - y), fade);
  }
  function pickHue(ev) {
    var r = hc.getBoundingClientRect(), t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    afHue = Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)) * 360; paint();
    var hv = rgb2hsv(afDraft.colour[0], afDraft.colour[1], afDraft.colour[2]);
    afSetColour(hsv2rgb(afHue, hv[1] || 1, 1), false);
  }
  var fdown = false, hdown = false;
  fc.addEventListener("mousedown", function (e) { fdown = true; pickField(e, false); });
  fc.addEventListener("mousemove", function (e) { if (fdown) pickField(e, false); });
  fc.addEventListener("touchstart", function (e) { e.preventDefault(); fdown = true; pickField(e, false); }, false);
  fc.addEventListener("touchmove", function (e) { e.preventDefault(); pickField(e, false); }, false);
  hc.addEventListener("mousedown", function (e) { hdown = true; pickHue(e); });
  hc.addEventListener("mousemove", function (e) { if (hdown) pickHue(e); });
  hc.addEventListener("touchstart", function (e) { e.preventDefault(); hdown = true; pickHue(e); }, false);
  hc.addEventListener("touchmove", function (e) { e.preventDefault(); pickHue(e); }, false);
  window.addEventListener("mouseup", function () { fdown = false; hdown = false; });
  box.appendChild(el("div", "hint", "Træk i feltet for at blande farven. Den øverste bjælke vælger kulør."));
}
function afBuildSwatches(box, chip) {
  var wrap = el("div", "af-swatches");
  var pal = activePalette();
  pal.forEach(function (c, i) {
    var b = el("button", "af-sw" + (c[0] + c[1] + c[2] > 720 ? " wht" : ""));
    b.style.background = hex(c);
    var lbl = el("span", "pal-key", PAL_KEYS[i] || "");
    b.appendChild(lbl);
    b.onclick = function () { chip.style.background = hex(c); afSetColour(c, true); };
    wrap.appendChild(b);
  });
  box.appendChild(wrap);
  box.appendChild(el("div", "hint", "Tryk på et felt eller brug bogstavet som genvejstast."));
  /* palette management */
  buildPaletteBar(box);
}
function buildPaletteBar(box) {
  var bar = el("div", "pal-bar");
  var pals = (S && S.palettes) || [];
  var aidx = (S && S.active_palette) || 0;
  /* palette selector */
  if (pals.length > 1) {
    var sel = el("select", "pal-sel");
    pals.forEach(function (p, i) {
      var o = el("option", "", p.name || ("Palette " + (i + 1)));
      o.value = "" + i; if (i === aidx) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      api({ op: "palette_activate", idx: parseInt(sel.value) }, function () { refresh(buildAfCtrl); });
    };
    bar.appendChild(sel);
  }
  /* redigér-knap */
  var ed = el("button", "sm", "Redigér…");
  ed.onclick = function () { openPaletteEditor(aidx); };
  bar.appendChild(ed);
  /* gem som ny */
  var sn = el("button", "sm", "Gem som ny…");
  sn.onclick = function () {
    var nm = prompt("Navn på den nye palette:", "Palette " + (pals.length + 1));
    if (!nm) return;
    var cols = activePalette().map(function (c) { return [c[0], c[1], c[2]]; });
    api({ op: "palette_save", idx: -1, name: nm, colours: cols }, function () { refresh(buildAfCtrl); });
  };
  bar.appendChild(sn);
  /* slet */
  if (pals.length > 1) {
    var del = el("button", "sm", "Slet palette");
    del.onclick = function () {
      if (!confirm("Slet paletten \"" + (pals[aidx] && pals[aidx].name) + "\"?")) return;
      api({ op: "palette_del", idx: aidx }, function () { refresh(buildAfCtrl); });
    };
    bar.appendChild(del);
  }
  box.appendChild(bar);
}
function openPaletteEditor(idx) {
  var pals = (S && S.palettes) || [];
  if (idx < 0 || idx >= pals.length) return;
  var pal = pals[idx];
  var cols = pal.colours.map(function (c) { return [c[0], c[1], c[2]]; });
  var nm = pal.name;
  /* Simpel dialog: vis 14 farvevælgere */
  var dlg = id("paldlg"); if (!dlg) return;
  dlg.className = "on";
  var body = id("paldlg-body"); body.innerHTML = "";
  var nr = el("div", "af-row");
  nr.appendChild(el("span", "k", "Navn"));
  var ni = el("input"); ni.type = "text"; ni.value = nm; ni.style.width = "160px";
  ni.onchange = function () { nm = ni.value; };
  nr.appendChild(ni); body.appendChild(nr);
  var grid = el("div", "pal-edit-grid");
  cols.forEach(function (c, i) {
    var cell = el("div", "pal-edit-cell");
    cell.appendChild(el("div", "pal-key-big", PAL_KEYS[i] || ""));
    var ci = el("input"); ci.type = "color"; ci.value = hex(c);
    ci.onchange = function () {
      var v = ci.value;
      cols[i] = [parseInt(v.substr(1,2),16), parseInt(v.substr(3,2),16), parseInt(v.substr(5,2),16)];
      prev.style.background = v;
    };
    cell.appendChild(ci);
    var prev = el("div", "pal-prev"); prev.style.background = hex(c);
    cell.appendChild(prev);
    grid.appendChild(cell);
  });
  body.appendChild(grid);
  var brow = el("div", "pal-btn-row");
  var save = el("button", "", "Gem");
  save.onclick = function () {
    api({ op: "palette_save", idx: idx, name: nm, colours: cols }, function () {
      dlg.className = ""; refresh(buildAfCtrl);
    });
  };
  brow.appendChild(save);
  var cancel = el("button", "", "Annullér");
  cancel.onclick = function () { dlg.className = ""; };
  brow.appendChild(cancel);
  body.appendChild(brow);
}


/* --------------------------------------------------------- bibliotek */
var LIB = null, libImport = null;
function openLib() {
  id("lib").className = "on";
  if (LIB) { buildLibList(id("lib-search").value); }
  else req("GET", "/library", null, function (d) {
    LIB = (d && d.library) || []; buildLibList("");
  });
}
function closeLib() { id("lib").className = ""; libImport = null; }
function buildLibList(filter) {
  var grid = id("libgrid"); grid.innerHTML = "";
  filter = (filter || "").toLowerCase();
  var entries = [];
  if (libImport) entries.push(libImport);
  (LIB || []).forEach(function (e) { entries.push(e); });
  entries = entries.filter(function (e) {
    if (!filter) return true;
    return (e.name + " " + (e.brand || "") + " " + (e.cat || "")).toLowerCase().indexOf(filter) >= 0;
  });
  if (!entries.length) {
    grid.appendChild(el("div", "hint",
      "Ingen match. Prøv et andet ord, eller importér en QLC+ .qxf-fil.")); return;
  }
  var cats = {}, order = [];
  entries.forEach(function (e) {
    var c = e.cat || "Andet";
    if (!cats[c]) { cats[c] = []; order.push(c); }
    cats[c].push(e);
  });
  order.forEach(function (cat) {
    grid.appendChild(el("div", "sub", cat));
    cats[cat].forEach(function (e) {
      var card = el("div", "libcard");
      var h = el("div", "libhd");
      h.appendChild(el("b", "", (e.brand && e.brand !== "Generisk" ? e.brand + " " : "") + e.name));
      card.appendChild(h);
      e.modes.forEach(function (mode) {
        var r = el("div", "librow");
        r.appendChild(el("span", "libmode", mode.name));
        r.appendChild(el("span", "libch",
          mode.channels.map(function (c) { return c.k; }).join(" · ")));
        var b = el("button", "sm", "Tilføj");
        b.onclick = function () { addLibProfile(e, mode); };
        r.appendChild(b);
        card.appendChild(r);
      });
      grid.appendChild(card);
    });
  });
}
function addLibProfile(e, mode) {
  var nm = (e.brand && e.brand !== "Generisk" ? e.brand + " " : "") + e.name;
  if (e.modes.length > 1) nm += " · " + mode.name.replace(/\s*\(.*\)\s*$/, "");
  api({ op: "profile_new", name: nm, shape: e.shape || "par", channels: mode.channels },
    function (d) {
      refresh(function () {
        if (d && d.id) { buildPatchTypes(); id("pa-type").value = d.id; updatePatchHint(); }
        toast("Tilføjet: " + nm); closeLib();
      });
    });
}

/* QLC+ .qxf (og OFL-eksport som QLC+) parses lokalt til vores kanalmodel. */
function tagText(root, tag) {
  var e = root.getElementsByTagName(tag);
  return e.length ? (e[0].textContent || "").replace(/^\s+|\s+$/g, "") : "";
}
function qlcChannelKey(ch) {
  var preset = ch.getAttribute("Preset") || "";
  var name = (ch.getAttribute("Name") || "").toLowerCase();
  var pmap = {
    IntensityRed: "r", IntensityGreen: "g", IntensityBlue: "b",
    IntensityWhite: "w", IntensityAmber: "a", IntensityUV: "uv",
    IntensityDimmer: "dimmer", IntensityMasterDimmer: "dimmer",
    IntensityDimmerFine: "dimmer_fine", IntensityMasterDimmerFine: "dimmer_fine"
  };
  if (preset) {
    if (pmap[preset]) return pmap[preset];
    if (preset.indexOf("Shutter") >= 0 || preset.indexOf("Strobe") >= 0) return "strobe";
  }
  var col = ch.getElementsByTagName("Colour")[0];
  if (col) {
    var c = (col.textContent || "").toLowerCase();
    if (c === "red") return "r"; if (c === "green") return "g"; if (c === "blue") return "b";
    if (c === "white") return "w"; if (c === "amber") return "a";
    if (c === "uv" || c === "ultraviolet") return "uv";
  }
  var grp = ch.getElementsByTagName("Group")[0];
  var g = grp ? (grp.textContent || "").toLowerCase() : "";
  if (g.indexOf("shutter") >= 0 || name.indexOf("strob") >= 0) return "strobe";
  if (g.indexOf("intensity") >= 0) {
    if (name.indexOf("red") >= 0) return "r"; if (name.indexOf("green") >= 0) return "g";
    if (name.indexOf("blue") >= 0) return "b"; if (name.indexOf("white") >= 0) return "w";
    if (name.indexOf("amber") >= 0) return "a"; if (name.indexOf("uv") >= 0) return "uv";
    if (name.indexOf("fine") >= 0) return "dimmer_fine";
    if (name.indexOf("dim") >= 0 || name.indexOf("master") >= 0 || name.indexOf("intensity") >= 0) return "dimmer";
    return "dimmer";
  }
  if ((name.indexOf("dim") >= 0 || name.indexOf("master") >= 0) && name.indexOf("fine") >= 0) return "dimmer_fine";
  if (name.indexOf("dim") >= 0 || name.indexOf("master") >= 0) return "dimmer";
  return "generic";
}
function parseQxf(text) {
  var doc;
  try { doc = new DOMParser().parseFromString(text, "text/xml"); } catch (e) { return null; }
  if (!doc || doc.getElementsByTagName("parsererror").length) return null;
  var model = tagText(doc, "Model"); if (!model) return null;
  var man = tagText(doc, "Manufacturer");
  var type = (tagText(doc, "Type") || "").toLowerCase();
  var shape = type.indexOf("moving") >= 0 ? "spot"
    : (type.indexOf("strobe") >= 0 || type.indexOf("blinder") >= 0 ? "wash" : "par");
  var defs = {}, chs = doc.getElementsByTagName("Channel"), i;
  for (i = 0; i < chs.length; i++) {
    var c = chs[i];
    if (c.parentNode && c.parentNode.nodeName === "Mode") continue;
    var nm = c.getAttribute("Name"); if (!nm) continue;
    defs[nm] = { k: qlcChannelKey(c), n: nm };
  }
  var modes = [], mEls = doc.getElementsByTagName("Mode"), m;
  for (m = 0; m < mEls.length; m++) {
    var mn = mEls[m].getAttribute("Name") || ("Mode " + (m + 1));
    var mchs = mEls[m].getElementsByTagName("Channel"), list = [], j;
    for (j = 0; j < mchs.length; j++) {
      list.push({ num: parseInt(mchs[j].getAttribute("Number") || j, 10),
                  name: (mchs[j].textContent || "").replace(/^\s+|\s+$/g, "") });
    }
    list.sort(function (a, b) { return a.num - b.num; });
    var arr = list.map(function (it) {
      var d = defs[it.name] || { k: "generic", n: it.name };
      return { k: d.k, n: d.n };
    });
    if (arr.length) modes.push({ name: mn + " (" + arr.length + " kan.)", channels: arr });
  }
  if (!modes.length) return null;
  return { id: "import", name: model, brand: man || "", cat: "Importeret", shape: shape, modes: modes };
}
function importFixtureFile(file) {
  var r = new FileReader();
  r.onload = function () {
    var txt = r.result, head = txt.slice(0, 4000);
    if (/^\s*\{/.test(txt)) {                          /* egen profil-JSON */
      var ent = null;
      try {
        var o = JSON.parse(txt);
        if (o && o.channels) ent = { id: "import", name: o.name || "Importeret",
          brand: "", cat: "Importeret", shape: o.shape || "par",
          modes: [{ name: (o.channels.length + " kan."), channels: o.channels }] };
      } catch (e) { ent = null; }
      if (!ent) { toast("Kunne ikke læse profil-filen"); return; }
      libImport = ent; openLib(); buildLibList("");
      toast("Importeret: " + ent.name + " — vælg mode og tryk Tilføj");
    } else if (/<FixtureDefinition/i.test(head)) {     /* QLC+ enkelt-fixture */
      var ent2 = parseQxf(txt);
      if (!ent2) { toast("Kunne ikke læse QLC+-fixturen"); return; }
      libImport = ent2; openLib(); buildLibList("");
      toast("Importeret: " + ent2.name + " — vælg mode og tryk Tilføj");
    } else if (/<Workspace|<Engine|<Fixture>/i.test(head)) {   /* QLC+ workspace */
      doImportPatch(parseQxw(txt), file.name);
    } else if (txt.indexOf(",") >= 0 || txt.indexOf(";") >= 0) { /* CSV-patch */
      doImportPatch(parseCsvPatch(txt), file.name);
    } else {
      toast("Ukendt filformat");
    }
  };
  r.readAsText(file);
}

/* Vælg en generisk profil ud fra kanalantal (kanalfunktionerne kendes ikke
   fra en workspace/CSV - brugeren finpudser bagefter i Lampe-editoren). */
function genForCount(n) {
  var bi = META.builtin_profiles || {};
  var pref = { 1: "gen_dim1", 3: "gen_rgb3", 4: "gen_rgbw4", 5: "gen_rgbwd5",
               6: "gen_rgbwds6", 8: "gen_hex8" };
  var id0 = pref[n];
  if (id0 && bi[id0]) {
    var p = bi[id0];
    return { shape: p.shape, channels: p.channels.map(function (c) { return { k: c.k, n: c.n }; }) };
  }
  (META.generic_order || []).forEach(function (go) { if (go.span === n && bi[go.id]) id0 = go.id; });
  if (id0 && bi[id0]) {
    var p2 = bi[id0];
    return { shape: p2.shape, channels: p2.channels.map(function (c) { return { k: c.k, n: c.n }; }) };
  }
  var keys = ["dimmer", "r", "g", "b", "w", "a", "uv", "strobe"], chans = [];
  for (var i = 0; i < n; i++) {
    var k = keys[i] || "generic";
    chans.push({ k: k, n: k === "generic" ? ("Kanal " + (i + 1)) : k });
  }
  return { shape: "par", channels: chans };
}
function xtext(el, tag) { var e = el.getElementsByTagName(tag)[0]; return e ? (e.textContent || "").replace(/^\s+|\s+$/g, "") : ""; }

/* QLC+ workspace (.qxw): fixtures med univers/adresse/kanalantal.
   QLC+ tæller univers og adresse fra 0, så vi lægger 1 til. */
function parseQxw(text) {
  var doc;
  try { doc = new DOMParser().parseFromString(text, "text/xml"); } catch (e) { return null; }
  if (!doc || doc.getElementsByTagName("parsererror").length) return null;
  var fx = doc.getElementsByTagName("Fixture"), out = [], i;
  for (i = 0; i < fx.length; i++) {
    var f = fx[i];
    if (!f.getElementsByTagName("Address").length) continue;
    var cnt = parseInt(xtext(f, "Channels") || "0", 10);
    if (!cnt) continue;
    var uni = parseInt(xtext(f, "Universe") || "0", 10);
    var addr = parseInt(xtext(f, "Address") || "0", 10);
    var man = xtext(f, "Manufacturer"), model = xtext(f, "Model"), mode = xtext(f, "Mode");
    var nm = xtext(f, "Name") || model || "Lampe";
    var gen = genForCount(cnt);
    out.push({ name: nm, universe: uni + 1, address: addr + 1,
      shape: gen.shape, channels: gen.channels,
      profile_name: ((man ? man + " " : "") + (model || ("Import " + cnt + "k")) + (mode ? " " + mode : "")) });
  }
  return out.length ? out : null;
}

/* Generisk CSV (MagicQ-patcheksport m.fl.). Kolonner (overskriftsrække,
   fleksible navne): navn, univers, adresse, kanaler. Univers/adresse 1-baseret. */
function parseCsvPatch(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length < 2) return null;
  function cells(l) {
    var out = [], cur = "", q = false, i;
    for (i = 0; i < l.length; i++) {
      var ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === "," || ch === ";") { out.push(cur); cur = ""; } else cur += ch; }
    }
    out.push(cur);
    return out.map(function (s) { return s.replace(/^\s+|\s+$/g, ""); });
  }
  var head = cells(lines[0]).map(function (h) { return h.toLowerCase(); });
  function col(names) { for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) >= 0) return i; return -1; }
  var iName = col(["name", "navn", "fixture", "head"]);
  var iUni = col(["universe", "univers", "uni"]);
  var iAddr = col(["address", "adresse", "dmx", "addr", "start"]);
  var iCh = col(["channels", "kanaler", "chans", "footprint", "ch"]);
  if (iAddr < 0 || iCh < 0) { toast("CSV mangler kolonnerne 'adresse' og 'kanaler'"); return null; }
  var out = [], r;
  for (r = 1; r < lines.length; r++) {
    var c = cells(lines[r]); if (c.length < 2) continue;
    var addr = parseInt(c[iAddr], 10), cnt = parseInt(c[iCh], 10);
    if (!addr || !cnt) continue;
    var uni = iUni >= 0 ? (parseInt(c[iUni], 10) || 1) : 1;
    var nm = iName >= 0 && c[iName] ? c[iName] : ("Lampe " + r);
    var gen = genForCount(cnt);
    out.push({ name: nm, universe: uni, address: addr, shape: gen.shape,
      channels: gen.channels, profile_name: nm + " (" + cnt + "k)" });
  }
  return out.length ? out : null;
}

function doImportPatch(list, srcName) {
  if (!list || !list.length) { toast("Ingen lamper fundet i " + srcName); return; }
  api({ op: "import_patch", clear: false, fixtures: list }, function (d) {
    refresh(function () {
      gotoTab("v-patch");
      toast("Importeret " + ((d && d.added) || list.length) + " lamper fra " + srcName);
    });
  });
}

/* ----------------------------------------------------------- moenstre */
function drawPattern() {
  if (!S || !S.patterns) return;   /* kan kaldes foer showet er hentet */
  var pat = S.patterns[patIdx];
  if (!pat) return;
  var cv = id("patcv");
  if (!cv.width || cv._w !== cv.clientWidth) {
    cv.width = cv.clientWidth; cv.height = cv.clientHeight; cv._w = cv.clientWidth;
  }
  var g = cv.getContext("2d"), w = cv.width, h = cv.height;
  if (!pat.steps.length || !pat.steps[0]) return;
  var ns = pat.steps.length, np = pat.steps[0].length;
  var cw = w / np, ch = h / ns;
  var acc0 = rgba(cssvar("--accent"));
  g.clearRect(0, 0, w, h);
  for (var s = 0; s < ns; s++) {
    for (var p = 0; p < np; p++) {
      var v = pat.steps[s][p];
      g.fillStyle = v > 0 ? acc0 + (0.18 + v * 0.82) + ")" : cssvar("--panel");
      g.fillRect(p * cw, s * ch, cw - 1, ch - 1);
    }
  }
}
function patPaint(ev, erase) {
  var pat = S.patterns[patIdx];
  if (!pat || !pat.steps.length) return;
  var cv = id("patcv"), r = cv.getBoundingClientRect();
  var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
  var ns = pat.steps.length, np = pat.steps[0].length;
  var p = Math.floor((t.clientX - r.left) / (r.width / np));
  var s = Math.floor((t.clientY - r.top) / (r.height / ns));
  if (p < 0 || p >= np || s < 0 || s >= ns) return;
  pat.steps[s][p] = erase ? 0 : brush;
  drawPattern();
}
var patDown = false;
function pushPattern() {
  api({ op: "pattern_set", index: patIdx, steps: S.patterns[patIdx].steps });
}
function buildPatternPick() {
  var s = id("pat-pick"); s.innerHTML = "";
  S.patterns.forEach(function (p, i) {
    var o = el("option", "", p.name); o.value = String(i);
    if (i === patIdx) o.selected = true;
    s.appendChild(o);
  });
  if (H.steps) H.steps.set(S.patterns[patIdx] ? S.patterns[patIdx].steps.length : 8);
  id("pat-smooth").checked = S.patterns[patIdx] ? !!S.patterns[patIdx].smooth : true;
}

/* ------------------------------------------------------------- scener */
/* ---------------------------------------------------------- live-matrix */

/* Konstanter der matcher .tile / #livegrid i ui.css. Holdes ens begge
   steder i kommentarform, siden der ikke er noget bygtrin der deler dem. */
var TILE_MARGIN = 4;      // .tile{margin:4px}
var TILE_LABELH = 26;     // .tile .tn - én linje navnetekst
var GRID_PAD = 8;         // #livegrid{padding:8px}

/* Finder det antal kolonner der giver de stoerste kvadratiske fliser der
   med sikkerhed kan being i den plads der er - ingen nedre graense, for
   en tvungen minimumsstoerrelse er praecis det der skubber sidste raekke
   ud over kanten og tvinger en scrollbar frem. */
function tileLayout(n, w, h) {
  var availW = Math.max(0, w - 2 * GRID_PAD);
  var availH = Math.max(0, h - 2 * GRID_PAD);
  var best = { cols: 1, size: 24 };
  for (var cols = 1; cols <= n; cols++) {
    var rows = Math.ceil(n / cols);
    var outerW = availW / cols, outerH = availH / rows;
    var tileW = outerW - 2 * TILE_MARGIN;
    var square = Math.min(tileW, outerH - 2 * TILE_MARGIN - TILE_LABELH);
    if (square > best.size) best = { cols: cols, size: square };
  }
  // 2 px sikkerhedsmargen mod afrundingsfejl paa tvaers af browsere
  best.size = Math.max(24, Math.floor(best.size) - 2);
  return best;
}

/* Scenerne live-matrixen viser, med deres rigtige indeks i S.scenes */
function liveScenes() {
  var out = [], tabs = sceneTabs(), ok = !liveTab;
  for (var k = 0; k < tabs.length; k++) if (tabs[k].id === liveTab) ok = true;
  if (!ok) liveTab = "";
  S.scenes.forEach(function (sc, i) {
    if (!liveTab || (sc.tab || tabs[0].id) === liveTab) out.push({ sc: sc, i: i });
  });
  return out;
}
function setLiveTab(t) {
  liveTab = t || "";
  try { window.localStorage.setItem("pixelpult.liveTab", liveTab); } catch (e) {}
}
function fillLiveTabs() {
  var sel = id("lv-tab"); if (!sel) return;
  sel.innerHTML = "";
  var o = el("option", "", "Alle scener"); o.value = ""; sel.appendChild(o);
  sceneTabs().forEach(function (t) {
    var n = S.scenes.filter(function (sc) { return (sc.tab || sceneTabs()[0].id) === t.id; }).length;
    var op = el("option", "", t.name + " (" + n + ")"); op.value = t.id; sel.appendChild(op);
  });
  sel.value = liveTab;
  sel.style.display = sceneTabs().length > 1 ? "" : "none";
}

function buildLive() {
  var grid = id("livegrid");
  grid.innerHTML = ""; liveCv = [];
  fillLiveTabs();
  var aa = id("lv-animall"); if (aa) aa.checked = liveAnimateAll;

  /* GO og Forrige giver kun mening med en cueliste. Uden én er de bare
     to knapper der optager plads - saerligt paa en telefon. */
  var hasCues = S && S.cuelist && S.cuelist.length > 0;
  id("lv-go").style.display = hasCues ? "" : "none";
  id("lv-back").style.display = hasCues ? "" : "none";
  if (!S || !S.scenes.length) {
    grid.appendChild(el("div", "hint",
      "Ingen scener endnu. Afslut live, sæt et look op og tryk Gem nuværende som scene."));
    return;
  }
  var shown = liveScenes();
  if (!shown.length) {
    grid.appendChild(el("div", "hint", "Ingen scener i dette faneblad. Vælg et andet øverst."));
    return;
  }
  var w = grid.clientWidth || 900;
  var h = grid.clientHeight || 500;
  var lay = tileLayout(shown.length, w, h);

  shown.forEach(function (r, pos) {
    var sc = r.sc, i = r.i;
    var b = el("div", "tile" + (sc.id === activeSceneId ? " active" : ""));
    b._si = i;
    b.style.width = lay.size + "px";
    b.style.height = (lay.size + TILE_LABELH) + "px";
    b.onclick = function () { recallScene(i); };

    if (pos < 10) b.appendChild(el("div", "tk", String((pos + 1) % 10)));

    var cv = document.createElement("canvas");
    cv.style.width = lay.size + "px";
    cv.style.height = lay.size + "px";
    b.appendChild(cv);
    liveCv.push({ cv: cv, id: sc.id, si: i, painted: false });

    var ta = el("div", "ta");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = liveAnimateFor(sc.id);
    cb.title = "Animér denne flise";
    cb.onclick = function (e) { e.stopPropagation(); };
    cb.onchange = function () {
      setLiveAnimate(sc.id, cb.checked);
      b.className = b.className.replace(" paused", "") + (cb.checked ? "" : " paused");
    };
    ta.appendChild(cb);
    b.appendChild(ta);
    if (!liveAnimateFor(sc.id)) b.className += " paused";

    b.appendChild(el("div", "tn", sc.name));
    grid.appendChild(b);
  });
  markActiveTile();
}

function markActiveTile() {
  var g = id("livegrid").children, i;
  for (i = 0; i < g.length; i++) {
    if (g[i].className.indexOf("tile") < 0) continue;
    var sc = S.scenes[g[i]._si];
    var on = sc && sc.id === activeSceneId;
    g[i].className = g[i].className.replace(" active", "");
    if (on) g[i].className += " active";
  }
  var cur = S ? S.scenes.filter(function (s) { return s.id === activeSceneId; })[0] : null;
  id("lv-now").textContent = cur ? cur.name : "—";
}

function recallScene(i) {
  var sc = S.scenes[i];
  if (!sc) return;
  activeSceneId = sc.id;
  markActiveTile();
  api({ op: "scene_recall", index: i }, function () { if (!liveOn) refresh(); });
}

/* animate-tilstand pr. scene-id, husket i browseren saa den overlever
   genindlaesning. Global "animér"-boks styrer alt paa én gang; den
   enkelte flises boks styrer kun den ene, naar globalen er til. */
var liveAnimateMap = {};
var liveAnimateAll = true;
function loadLiveAnimatePrefs() {
  try {
    liveAnimateAll = window.localStorage.getItem("pixelpult.liveAnimAll") !== "0";
    liveAnimateMap = JSON.parse(window.localStorage.getItem("pixelpult.liveAnimMap") || "{}");
  } catch (e) {}
}
function saveLiveAnimateMap() {
  try { window.localStorage.setItem("pixelpult.liveAnimMap", JSON.stringify(liveAnimateMap)); }
  catch (e) {}
}
function liveAnimateFor(id) {
  return liveAnimateAll && (liveAnimateMap[id] !== false);
}
function setLiveAnimate(id, on) {
  liveAnimateMap[id] = on;
  saveLiveAnimateMap();
}

function paintTiles(list) {
  for (var i = 0; i < liveCv.length; i++) {
    var entry = liveCv[i], cv = entry.cv, rows = list[entry.si];
    if (!rows || !rows.length) continue;
    entry.painted = true;
    var wpx = cv.clientWidth, hpx = cv.clientHeight;
    if (!wpx || !hpx) continue;
    if (cv._w !== wpx || cv._h !== hpx) {
      cv.width = wpx; cv.height = hpx; cv._w = wpx; cv._h = hpx;
    }
    var g = cv.getContext("2d");
    var rh = hpx / rows.length;
    for (var r = 0; r < rows.length; r++) {
      var hexs = rows[r], n = hexs.length / 6, cw = wpx / n;
      for (var j = 0; j < n; j++) {
        g.fillStyle = "#" + hexs.substr(j * 6, 6);
        g.fillRect(j * cw, r * rh, Math.ceil(cw) + 1, Math.ceil(rh) + 1);
      }
    }
  }
}

/* Skaermlaas: paa en telefon slukker skaermen efter et halvt minut, og saa
   staar man med en sort skaerm midt i et nummer. Wake Lock holder den
   taendt saa laenge live-matrixen er fremme. iOS fik den foerst i 16.4,
   og den tabes naar man skifter app - derfor baade feature-detektion og
   generhvervelse naar siden bliver synlig igen. */
var wakeLock = null;

function wakeLockAcquire() {
  if (!navigator.wakeLock || wakeLock) return;
  try {
    navigator.wakeLock.request("screen").then(function (wl) {
      wakeLock = wl;
      wl.addEventListener("release", function () { wakeLock = null; });
    }, function () { /* afvist - fx lavt batteri. Ikke kritisk. */ });
  } catch (e) { /* aeldre browser uden wake lock */ }
}
function wakeLockRelease() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && liveOn) wakeLockAcquire();
});

function setLive(on) {
  liveOn = on;
  id("live").className = on ? "on" : "";
  press(id("sc-live"), on);
  if (on) {
    var e = id("live");
    if (e.requestFullscreen) { try { e.requestFullscreen(); } catch (x) {} }
    else if (e.webkitRequestFullscreen) { try { e.webkitRequestFullscreen(); } catch (x) {} }
    wakeLockAcquire();
    setTimeout(buildLive, 30);
  } else {
    wakeLockRelease();
    if (document.exitFullscreen && document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (x) {}
    } else if (document.webkitExitFullscreen && document.webkitFullscreenElement) {
      try { document.webkitExitFullscreen(); } catch (x) {}
    }
    refresh();
  }
}

function liveKeys(ev) {
  if (!liveOn) return;
  var k = ev.keyCode;
  if (k === 27) { setLive(false); ev.preventDefault(); return; }        /* Esc */
  if (k === 32) { cueGo(1); ev.preventDefault(); return; }              /* mellemrum */
  if (k === 66) {                                                       /* B */
    S.master.blackout = !S.master.blackout;
    press(id("lv-black"), S.master.blackout);
    setv(["master", "blackout"], S.master.blackout);
    ev.preventDefault(); return;
  }
  if (k >= 48 && k <= 57) {                                             /* 0-9 */
    var pos = (k === 48) ? 9 : (k - 49);
    var shown = liveScenes();
    if (shown[pos]) { recallScene(shown[pos].i); ev.preventDefault(); }
  }
}

function setSceneView(v) {
  sceneView = v;
  try { window.localStorage.setItem("pixelpult.sceneView", v); } catch (e) {}
  buildScenes();
}
function loadScenePrefs() {
  try {
    sceneView = window.localStorage.getItem("pixelpult.sceneView") || "liste";
    scenePrev = window.localStorage.getItem("pixelpult.scenePrev") === "1";
  } catch (e) {}
  if (sceneView !== "matrix") sceneView = "liste";
}

function sceneTabActive() {
  return id("v-scene").className.indexOf("active") >= 0;
}

function sceneCanvas(parent, cls, si) {
  var cv = document.createElement("canvas");
  if (cls) cv.className = cls;
  cv._si = si;            /* scenens rigtige indeks i S.scenes */
  parent.appendChild(cv);
  sceneCv.push(cv);
  return cv;
}

/* Lærrederne i et faneblad er kun en del af scenerne. Hvert lærred
   males med billedet for sin EGEN scene (cv._si), ikke efter
   placering - ellers viste faneblad 2 billederne fra faneblad 1. */
function paintScenePreviews(list) {
  for (var i = 0; i < sceneCv.length; i++) {
    var cv = sceneCv[i], hexs = list[cv._si];
    if (!hexs) continue;
    if (!cv.width || cv._w !== cv.clientWidth) {
      cv.width = cv.clientWidth || 130;
      cv.height = cv.clientHeight || 24;
      cv._w = cv.clientWidth;
    }
    var g = cv.getContext("2d");
    var n = hexs.length / 6, w = cv.width / n;
    for (var j = 0; j < n; j++) {
      g.fillStyle = "#" + hexs.substr(j * 6, 6);
      g.fillRect(j * w, 0, Math.ceil(w) + 1, cv.height);
    }
  }
}

/* Miniaturerne hentes kun mens fanen er aabne og afkrydsningen er sat, saa
   de ikke koster noget naar man arbejder andre steder. */
function scenePoll() {
  var idle = 400;
  if (!S || !S.scenes.length) return setTimeout(scenePoll, idle);

  if (liveOn && liveCv.length) {
    var want = [];
    for (var k = 0; k < liveCv.length; k++) {
      var e = liveCv[k];
      if (liveAnimateFor(e.id) || !e.painted) want.push(e.si);
    }
    if (!want.length) return setTimeout(scenePoll, 300);
    var idxq = "&idx=" + want.join(",");
    return req("GET", "/scenepx?rows=1&cells=" + (S.settings.perf ? 10 : 18) + idxq,
      null, function (d) {
        if (d && d.px) paintTiles(d.px);
        setTimeout(scenePoll, S.settings.perf ? 220 : 110);
      });
  }
  if (!scenePrev || !sceneTabActive() || !sceneCv.length) {
    return setTimeout(scenePoll, idle);
  }
  var shown = sceneCv.map(function (cv) { return cv._si; });
  req("GET", "/scenepx?cells=" + (S.settings.perf ? 40 : 72) + "&idx=" + shown.join(","), null, function (d) {
    if (d && d.px) paintScenePreviews(d.px);
    setTimeout(scenePoll, S.settings.perf ? 180 : 80);
  });
}

/* ---------------------------------------------- traek kort for at bytte om */
var dragCard = { idx: -1, active: false, sx: 0, sy: 0, el: null, overEl: null, overIdx: -1 };

function cardIsControl(card, t) {
  while (t && t !== card) {
    var tag = t.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "SELECT") return true;
    t = t.parentNode;
  }
  return false;
}
function cardDragStart(card, index, x, y, target) {
  if (cardIsControl(card, target)) return;
  dragCard = { idx: index, active: false, sx: x, sy: y, el: card, overEl: null, overIdx: -1 };
}
function cardDragMove(x, y) {
  var d = dragCard;
  if (d.idx < 0) return;
  if (!d.active) {
    if (Math.abs(x - d.sx) + Math.abs(y - d.sy) < 8) return;
    d.active = true;
    d.el.className += " dragging";
  }
  d.el.style.transform = "translate(" + (x - d.sx) + "px," + (y - d.sy) + "px)";
  var under = document.elementFromPoint(x, y);
  while (under && (!under.className || under.className.indexOf("scard") < 0)) under = under.parentNode;
  if (d.overEl && d.overEl !== under) d.overEl.className = d.overEl.className.replace(" dragover", "");
  if (under && under !== d.el) {
    if (under.className.indexOf("dragover") < 0) under.className += " dragover";
    d.overEl = under;
    d.overIdx = parseInt(under.getAttribute("data-idx"), 10);
  } else {
    d.overEl = null; d.overIdx = -1;
  }
}
function cardDragEnd() {
  var d = dragCard;
  if (d.el) { d.el.className = d.el.className.replace(" dragging", ""); d.el.style.transform = ""; }
  if (d.overEl) d.overEl.className = d.overEl.className.replace(" dragover", "");
  if (d.active && d.overIdx >= 0 && d.overIdx !== d.idx) {
    /* indsaetning, ikke ombytning - saa foeles det som at sortere */
    api({ op: "scene_move", from: d.idx, to: d.overIdx }, refresh);
  }
  dragCard = { idx: -1, active: false, sx: 0, sy: 0, el: null, overEl: null, overIdx: -1 };
}
function attachCardDrag(card, index) {
  card.setAttribute("data-idx", String(index));
  card.addEventListener("mousedown", function (e) { cardDragStart(card, index, e.clientX, e.clientY, e.target); });
  card.addEventListener("touchstart", function (e) {
    var t = e.touches[0]; cardDragStart(card, index, t.clientX, t.clientY, e.target);
  }, false);
}

/* --- scener: traek en raekke for at sortere --- */
function sceneMove(from, to) {
  api({ op: "scene_move", from: from, to: to }, refresh);
}
var sceneDragFrom = -1;
function sceneRowDrag(tr, i) {
  tr.addEventListener("dragstart", function (e) {
    if (e.target && e.target.tagName &&
        /INPUT|SELECT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); return; }
    sceneDragFrom = i;
    tr.className += " dragging";
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    }
  });
  tr.addEventListener("dragend", function () {
    sceneDragFrom = -1;
    var rows = id("scenelist").getElementsByTagName("tr");
    for (var k = 0; k < rows.length; k++)
      rows[k].className = rows[k].className.replace(/\s*drag(ging|over|under)/g, "");
  });
  tr.addEventListener("dragover", function (e) {
    if (sceneDragFrom < 0 || sceneDragFrom === i) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    tr.className = tr.className.replace(/\s*drag(over|under)/g, "") +
      (i > sceneDragFrom ? " dragunder" : " dragover");
  });
  tr.addEventListener("dragleave", function () {
    tr.className = tr.className.replace(/\s*drag(over|under)/g, "");
  });
  tr.addEventListener("drop", function (e) {
    e.preventDefault();
    var from = sceneDragFrom; sceneDragFrom = -1;
    if (from < 0 || from === i) return;
    sceneMove(from, i);
  });
}

function fadeInput(i, value) {
  var f = document.createElement("input");
  f.type = "number"; f.step = "0.1"; f.min = "0"; f.value = value;
  f.onchange = function () { setv(["scenes", i, "fade"], parseFloat(f.value)); };
  return f;
}

/* --- faneblade med grupper af scener --- */
function sceneTabs() { return (S && S.scene_tabs) || [{ id: "main", name: "Scener" }]; }
function curTabId() {
  var tabs = sceneTabs();
  for (var i = 0; i < tabs.length; i++) if (tabs[i].id === sceneTab) return sceneTab;
  return tabs[0].id;
}
/* scenerne i det viste faneblad, med deres rigtige indeks i S.scenes */
function scenesInTab() {
  var tid = curTabId(), out = [];
  S.scenes.forEach(function (sc, i) {
    if ((sc.tab || sceneTabs()[0].id) === tid) out.push({ sc: sc, i: i });
  });
  return out;
}
var tabDragFrom = -1;
function buildSceneTabs() {
  var box = id("scenetabs"); if (!box) return;
  box.innerHTML = ""; box.className = "scenetabs";
  var tid = curTabId();
  sceneTabs().forEach(function (t, ti) {
    var n = S.scenes.filter(function (s) {
      return (s.tab || sceneTabs()[0].id) === t.id;
    }).length;
    var b = el("button", "stab" + (t.id === tid ? " on" : ""), t.name + " (" + n + ")");
    press(b, t.id === tid);
    b.setAttribute("draggable", "true");
    b.onclick = function () { sceneTab = t.id; buildScenes(); };
    b.addEventListener("dragstart", function (e) {
      tabDragFrom = ti; b.className += " dragging";
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(ti)); }
    });
    b.addEventListener("dragend", function () {
      tabDragFrom = -1;
      [].forEach.call(box.children, function (c) {
        c.className = c.className.replace(/\s*drag(ging|over)/g, "");
      });
    });
    b.addEventListener("dragover", function (e) {
      if (tabDragFrom < 0 || tabDragFrom === ti) return;
      e.preventDefault();
      if (b.className.indexOf("dragover") < 0) b.className += " dragover";
    });
    b.addEventListener("dragleave", function () {
      b.className = b.className.replace(/\s*dragover/g, "");
    });
    b.addEventListener("drop", function (e) {
      e.preventDefault();
      var from = tabDragFrom; tabDragFrom = -1;
      if (from < 0 || from === ti) return;
      api({ op: "tab_move", from: from, to: ti }, refresh);
    });
    box.appendChild(b);
  });
}

function buildScenes() {
  var box = id("scenelist");
  box.innerHTML = ""; sceneCv = [];
  press(id("sc-list"), sceneView === "liste");
  press(id("sc-matrix"), sceneView === "matrix");
  press(id("sc-prev"), scenePrev);
  buildSceneTabs();
  var rows = scenesInTab();
  var tabs = sceneTabs();
  id("sc-hint").textContent = sceneView === "matrix"
    ? "Matrixvisning: kun navn, fadetid og Kald. Træk kortene for at sortere dem."
    : "Listevisning: alle knapper. Træk i ⠿ (eller brug ▲▼) for at sortere.";

  if (!rows.length) {
    box.className = "tbl";
    box.appendChild(el("div", "hint", S.scenes.length
      ? "Ingen scener i dette faneblad. Vælg et andet faneblad, eller flyt en scene hertil fra listevisningen."
      : "Ingen scener gemt endnu. Sæt et look op på Pult-fanen og tryk Gem nuværende som scene."));
  } else if (sceneView === "matrix") {
    box.className = "matrix";
    rows.forEach(function (r) {
      var sc = r.sc, i = r.i;
      var card = el("div", "scard");
      attachCardDrag(card, i);
      if (scenePrev) sceneCanvas(card, "", i);
      card.appendChild(el("div", "nm", sc.name));
      var fr = el("div", "fr");
      fr.appendChild(fadeInput(i, sc.fade));
      var go = el("button", "", "Kald");
      go.onclick = function () { recallScene(i); };
      fr.appendChild(go);
      card.appendChild(fr);
      box.appendChild(card);
    });
  } else {
    box.className = "tbl";
    var t = el("table");
    var head = "<tr><th>↕</th><th>#</th>" + (scenePrev ? "<th>Billede</th>" : "") +
               "<th>Navn</th><th>Fade</th>" +
               (tabs.length > 1 ? "<th>Faneblad</th>" : "") +
               "<th>Handling</th></tr>";
    t.innerHTML = head;
    rows.forEach(function (r, pos) {
      var sc = r.sc, i = r.i;
      var tr = el("tr");
      tr.setAttribute("draggable", "true");
      sceneRowDrag(tr, i);

      var tdg = el("td", "draghandle");
      tdg.title = "Træk for at flytte scenen";
      tdg.appendChild(el("span", "grip", "⠿"));
      var bup = el("button", "nudge", "▲"); bup.title = "Flyt op";
      var bdn = el("button", "nudge", "▼"); bdn.title = "Flyt ned";
      bup.onclick = function () { if (pos > 0) sceneMove(i, rows[pos - 1].i); };
      bdn.onclick = function () { if (pos < rows.length - 1) sceneMove(i, rows[pos + 1].i); };
      if (pos === 0) bup.disabled = true;
      if (pos === rows.length - 1) bdn.disabled = true;
      tdg.appendChild(bup); tdg.appendChild(bdn);
      tr.appendChild(tdg);

      tr.appendChild(el("td", "", String(pos + 1)));
      if (scenePrev) {
        var tdp = el("td");
        sceneCanvas(tdp, "scv", i);
        tr.appendChild(tdp);
      }
      var tdn = el("td");
      var inp = document.createElement("input");
      inp.type = "text"; inp.value = sc.name;
      inp.onchange = function () { setv(["scenes", i, "name"], inp.value); };
      tdn.appendChild(inp); tr.appendChild(tdn);
      var tdf = el("td");
      var fi = fadeInput(i, sc.fade); fi.style.width = "76px";
      tdf.appendChild(fi); tr.appendChild(tdf);

      if (tabs.length > 1) {
        var tdt = el("td");
        var tsel = el("select"); tsel.style.minWidth = "120px";
        tabs.forEach(function (tb) {
          var o = el("option", "", tb.name); o.value = tb.id;
          if ((sc.tab || tabs[0].id) === tb.id) o.selected = true;
          tsel.appendChild(o);
        });
        tsel.onchange = function () {
          api({ op: "scene_set_tab", index: i, tab: tsel.value }, refresh);
        };
        tdt.appendChild(tsel); tr.appendChild(tdt);
      }

      var tdb = el("td");
      var bt = el("div", "btns");
      var go = el("button", "sm", "Kald");
      go.onclick = function () { recallScene(i); };
      var up = el("button", "sm", "Opdatér");
      up.title = "Overskriv scenen med det der står nu";
      up.onclick = function () { api({ op: "scene_update", index: i }, refresh); toast("Scene opdateret"); };
      var cu = el("button", "sm", "Til cue");
      cu.onclick = function () { api({ op: "cue_add", scene: i }, refresh); };
      var dl = el("button", "sm", "Slet");
      dl.onclick = function () {
        if (confirm("Slet scenen " + sc.name + "?")) api({ op: "scene_del", index: i }, refresh);
      };
      [go, up, cu, dl].forEach(function (b) { bt.appendChild(b); });
      tdb.appendChild(bt); tr.appendChild(tdb);
      t.appendChild(tr);
    });
    box.appendChild(t);
  }

  function sceneForCue(c) {
    for (var k = 0; k < S.scenes.length; k++) if (S.scenes[k].id === c.scene_id) return S.scenes[k];
    return null;
  }

  var cbox = id("cuelist"); cbox.innerHTML = "";
  var ct = el("table");
  ct.innerHTML = "<tr><th>#</th><th>Scene</th><th>Fade</th><th>Følg efter</th><th></th></tr>";
  var totalFade = 0, totalFollow = 0;
  S.cuelist.forEach(function (c, i) {
    var sc = sceneForCue(c);
    totalFade += c.fade || 0; totalFollow += c.follow || 0;
    var tr = el("tr", i === cuePos ? "sel" : "");
    tr.appendChild(el("td", "", String(i + 1)));
    tr.appendChild(el("td", "", sc ? sc.name : "(scene mangler)"));
    var tdf = el("td");
    var f = document.createElement("input");
    f.type = "number"; f.step = "0.1"; f.value = c.fade; f.style.width = "76px";
    f.onchange = function () { setv(["cuelist", i, "fade"], parseFloat(f.value)); };
    tdf.appendChild(f); tr.appendChild(tdf);
    var tdo = el("td");
    var o = document.createElement("input");
    o.type = "number"; o.step = "0.1"; o.value = c.follow; o.style.width = "76px";
    o.title = "Sekunder efter fadet er færdigt, før den går videre selv (kræver Auto-følg)";
    o.onchange = function () { setv(["cuelist", i, "follow"], parseFloat(o.value)); };
    tdo.appendChild(o); tr.appendChild(tdo);
    var tdb = el("td");
    var bt = el("div", "btns");
    var up = el("button", "sm", "↑");
    up.title = "Flyt op"; up.disabled = i === 0;
    up.onclick = function () { api({ op: "cue_move", index: i, dir: -1 }, refresh); };
    var dn = el("button", "sm", "↓");
    dn.title = "Flyt ned"; dn.disabled = i === S.cuelist.length - 1;
    dn.onclick = function () { api({ op: "cue_move", index: i, dir: 1 }, refresh); };
    var jump = el("button", "sm", "Hop til");
    jump.title = "Kald denne cue uden at røre de andre";
    jump.onclick = function () { cuePos = i - 1; cueGo(1); };
    var dl = el("button", "sm", "Slet");
    dl.onclick = function () { api({ op: "cue_del", index: i }, refresh); };
    [up, dn, jump, dl].forEach(function (b) { bt.appendChild(b); });
    tdb.appendChild(bt); tr.appendChild(tdb);
    ct.appendChild(tr);
  });
  cbox.appendChild(ct);
  id("cue-pos").textContent = cuePos < 0 ? "—" : "cue " + (cuePos + 1) + "/" + S.cuelist.length;

  var stats = id("cue-stats");
  if (stats) {
    stats.textContent = S.cuelist.length
      ? S.cuelist.length + " cues · ca. " + Math.round(totalFade + totalFollow) +
        " s hvis alle blev kørt i træk med Auto-følg"
      : "Ingen cues endnu. Tryk Til cue på en scene i listen ovenfor.";
  }
}

function cueGo(step) {
  if (!S.cuelist.length) return;
  cuePos = (cuePos + step + S.cuelist.length) % S.cuelist.length;
  var c = S.cuelist[cuePos];
  var sc = null;
  for (var k = 0; k < S.scenes.length; k++) if (S.scenes[k].id === c.scene_id) sc = S.scenes[k];
  if (cueTimer) { clearTimeout(cueTimer); cueTimer = null; }
  if (!sc) { buildScenes(); return; }        // (scene mangler) - spring stille over
  activeSceneId = sc.id;
  if (liveOn) markActiveTile();
  api({ op: "scene_recall", id: sc.id, fade: c.fade },
      function () { if (!liveOn) refresh(); else buildScenes(); });
  if (cueAuto && c.follow > 0)
    cueTimer = setTimeout(function () { cueGo(1); }, (c.fade + c.follow) * 1000);
}

/* -------------------------------------------------------------- output */
function enttecHint() {
  var e = document.getElementById("o-enttec-hint");
  if (!e || !S) return;
  var err = META && META.ftdi_error;
  if (err) {
    e.innerHTML = "<b>Ingen enhed:</b> " + escapeHtml(err);
  } else {
    e.innerHTML = "Enttec Open DMX USB drives direkte via FTDI, præcis som QLC+ " +
      "gør det. Vælg FTDI-enheden herover — det er ikke en /dev/tty-port. " +
      "Kræver <code>pyftdi</code> og <code>pyusb</code>.";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, function (c) {
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
  });
}

function enttecDeviceList() {
  return (META.ftdi_devices || []).slice();
}

function fillEnttecPorts() {
  var sel = id("o-enttec-port"); if (!sel) return;
  sel.innerHTML = "";
  var cur = S.outputs.enttec.port;
  var list = enttecDeviceList();
  if (cur && !list.some(function (d) { return d.url === cur; }))
    list.push({ url: cur, label: cur });
  if (!list.length) {
    var o0 = el("option", "", "(ingen enhed fundet)"); o0.value = ""; sel.appendChild(o0);
    return;
  }
  list.forEach(function (d) {
    var o = el("option", "", d.label || d.url); o.value = d.url;
    if (d.url === cur) o.selected = true;
    sel.appendChild(o);
  });
  // Ingen enhed gemt endnu, men der ER en enhed: vælg og GEM den første,
  // så den viste og den gemte værdi følges ad (ellers står port tom, selv
  // om dropdown'en viser enheden, og send() melder "vælg en FTDI-enhed").
  if (!cur && list.length && list[0].url) {
    sel.value = list[0].url;
    S.outputs.enttec.port = list[0].url;
    setv(["outputs", "enttec", "port"], list[0].url);
  }
}

function buildOutputs() {
  var o = S.outputs;
  id("o-artnet").checked = o.artnet.on;
  id("o-artnet-host").value = o.artnet.host;
  id("o-artnet-bc").checked = o.artnet.broadcast;
  id("o-sacn").checked = o.sacn.on;
  id("o-sacn-host").value = o.sacn.host;
  id("o-sacn-prio").value = o.sacn.priority;
  id("o-enttec").checked = o.enttec.on;
  id("o-enttec-uni").value = (o.enttec.universe != null ? o.enttec.universe : 0);
  enttecHint();
  fillEnttecPorts();

  var st = S.settings;
  if (H.fps)    H.fps.set(st.fps);
  if (H.bright) H.bright.set(st.bright);
  id("s-perf").checked = st.perf;
  id("s-abase").value = st.artnet_base;
}
function loadShowList() {
  req("GET", "/shows", null, function (d) {
    if (!d) return;
    var box = id("showlist"); box.innerHTML = "";
    if (!d.shows.length) box.appendChild(el("div", "hint", "Ingen gemte shows."));
    d.shows.forEach(function (n) {
      var r = el("div", "btns");
      r.style.marginBottom = "4px";
      var lb = el("button", "", n);
      lb.onclick = function () { api({ op: "load", name: n }, function () { refresh(); toast("Indlæst: " + n); }); };
      var db = el("button", "ghost", "Slet");
      db.onclick = function () { if (confirm("Slet " + n + "?")) api({ op: "delete", name: n }, loadShowList); };
      r.appendChild(lb); r.appendChild(db);
      box.appendChild(r);
    });
  });
}

/* ------------------------------------------------------------ opdater */
function rebuild() {
  buildLayerList(); buildLayerForm(); buildQuickPick(); buildStrips();
  buildPatch(); buildScenes(); buildOutputs(); buildPatternPick();
  buildProfileEditor();
  buildLampTest();
  buildCtrlBar(); ctlBanners();
  themeOptions();
  syncViewUI();
  buildTabs();
  if (H.grand)  H.grand.set(S.master.grand);
  if (H.strobe) H.strobe.set(S.master.strobe);
  if (H.bpm)    H.bpm.set(S.master.bpm);
  id("lv-bpm").textContent = S.master.bpm;
  id("m-scene-tempo").checked = !!S.settings.scene_tempo;
  press(id("m-black"), S.master.blackout);
  press(id("m-freeze"), S.master.freeze);
  id("sh-name").value = S.name;
  document.title = "Lyspult · " + S.name;
  if (liveOn) buildLive();
  if (id("v-layout").className.indexOf("active") >= 0) drawStage();
  if (id("v-pat").className.indexOf("active") >= 0) drawPattern();
  updateGrpInfo();
  if (id("v-afvikling").className.indexOf("active") >= 0) { buildAfIcons(); drawAfStage(); }
  if (id("v-enkel").className.indexOf("active") >= 0) buildEnkel();
}
/* Hvert refresh faar et loebenummer. To refresh() der er i luften
   samtidig kan svare i omvendt raekkefoelge, og et gammelt svar ville
   saa overskrive et nyere med forældet state - fx lagenes farver lige
   efter at en scene er kaldt frem. Kun det nyeste svar faar lov. */
var refreshSeq = 0, refreshSeen = 0;
function refresh(cb) {
  /* api(..., refresh) giver serverens svar med som argument - det er
     ikke en callback og skal ignoreres */
  if (typeof cb !== "function") cb = null;
  var mySeq = ++refreshSeq;
  req("GET", "/state", null, function (d) {
    if (!d) return;
    if (mySeq < refreshSeen) { if (cb) cb(); return; }
    refreshSeen = mySeq;
    S = d.show; META = d.meta; rev = d.rev;
    if (patIdx >= S.patterns.length) patIdx = 0;
    if (layer >= S.layers.length) layer = 0;
    rebuild();
    if (cb) cb();
  });
}

/* ---------------------------------------------------------- live-loop */
function poll() {
  req("GET", "/frame", null, function (d) {
    if (d) {
      id("st-fps").textContent = d.fps;
      var outs = [], k;
      for (k in d.out) if (S && S.outputs[k] && S.outputs[k].on)
        outs.push(k + " " + d.out[k]);
      id("st-out").textContent = outs.length ? outs.join(" · ") : "kun simulering";
      press(id("dmxarm"), armed());
      ltFrame(d.lt);
      ctlFrameIn(d);
      if (liveOn) {
        var fb = id("lv-fade");
        fb.style.width = (d.fade === null || d.fade === undefined)
          ? "0" : Math.round(d.fade * 100) + "%";
        press(id("lv-black"), S.master.blackout);
        if (H.lvgrand) H.lvgrand.set(S.master.grand);
      }
      if (S) {
        lastFrame = d.px;
        drawStrips(d.px, d.meta);
        if (id("v-layout").className.indexOf("active") >= 0) drawStage();
        if (id("v-afvikling").className.indexOf("active") >= 0) drawAfStage();
        if (id("v-enkel").className.indexOf("active") >= 0) ekPaint(d.px);
        var pk = "", u;
        for (u in d.dmx) pk += "U" + u + "  " + d.dmx[u].join(" ") + "<br>";
        var pe = id("dmxpeek"); if (pe) pe.innerHTML = pk;
      var eb = id("o-enttec-errbar");
      if (eb) {
        var ee = (d.out && d.out.enttec) || "";
        if (ee.indexOf("FEJL") === 0 && S.outputs.enttec.on) {
          eb.textContent = ee; eb.style.display = "block";
        } else {
          eb.style.display = "none";
        }
      }
      }
      if (d.rev !== rev && !busy) refresh();
    }
    setTimeout(poll, S && S.settings.perf ? 120 : 45);
  });
}
function drawStrips(px, meta) {
  if (!px) return;
  for (var i = 0; i < stripCv.length && i < px.length; i++) {
    var cv = stripCv[i];
    if (!cv.width || cv._w !== cv.clientWidth) {
      cv.width = cv.clientWidth; cv.height = 22; cv._w = cv.clientWidth;
    }
    var g = cv.getContext("2d"), hexs = px[i];
    var n = hexs.length / 6, w = cv.width / n;
    for (var j = 0; j < n; j++) {
      g.fillStyle = "#" + hexs.substr(j * 6, 6);
      g.fillRect(j * w, 0, Math.ceil(w), cv.height);
    }
  }
}

/* --------------------------------------------------------------- init */
function armed() {
  if (!S) return false;
  var o = S.outputs;
  return !!(o.artnet.on || o.sacn.on || o.enttec.on);
}
function setArm(on) {
  /* Husker hvad der var taendt, saa "DMX ud" kan slaa det samme til igen. */
  var items = [];
  if (on) {
    var any = armMemory.length ? armMemory : ["artnet"];
    any.forEach(function (k) { items.push({ path: ["outputs", k, "on"], value: true }); });
  } else {
    armMemory = [];
    ["artnet", "sacn", "enttec"].forEach(function (k) {
      if (S.outputs[k].on) armMemory.push(k);
      items.push({ path: ["outputs", k, "on"], value: false });
    });
  }
  api({ op: "patch", items: items }, refresh);
}

/* ------------------------------------------------------------ tempo */
/* Tap: gennemsnit af de seneste op til 8 slag. Pause over 2 s starter en
   ny maaling, og et slag der ligger mere end 40 % ved siden af de andre
   ogsaa - saa et enkelt fejltap ikke traekker tempoet skaevt. */
var beatAnchor = Date.now(), beatOn = false;
function curBpm() {
  var v = parseInt(id("m-bpm").value, 10);
  return isNaN(v) ? ((S && S.master.bpm) || 120) : v;
}
function setBpm(v) {
  v = Math.max(40, Math.min(220, Math.round(v)));
  if (!S) return;
  S.master.bpm = v;
  if (H.bpm) H.bpm.set(v);
  id("lv-bpm").textContent = v;
  flushSetv("master.bpm", ["master", "bpm"], v);
}
function tapTempo() {
  var now = Date.now(), n = taps.length;
  if (n && now - taps[n - 1] > 2000) taps = [];
  n = taps.length;
  if (n >= 2) {
    var avg0 = (taps[n - 1] - taps[0]) / (n - 1), gap = now - taps[n - 1];
    if (Math.abs(gap - avg0) > avg0 * 0.4) taps = [taps[n - 1]];
  }
  taps.push(now);
  if (taps.length > 8) taps.shift();
  beatAnchor = now;
  beatTick();
  if (taps.length >= 2) {
    var avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    var bpm = Math.round(60000 / avg);
    if (bpm >= 40 && bpm <= 220) setBpm(bpm);
  }
}
function wireTap(btn) {
  /* touchstart/mousedown i stedet for click: et tap skal tælle i det
     øjeblik fingeren rammer, ikke når den slippes */
  btn.addEventListener("touchstart", function (e) { e.preventDefault(); tapTempo(); }, false);
  btn.addEventListener("mousedown", function (e) { if (e.button === 0) tapTempo(); }, false);
  btn.addEventListener("click", function (e) { if (e.detail === 0) tapTempo(); }, false);
}
function typingIn(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  var tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  var ty = (t.type || "text").toLowerCase();
  return ["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].indexOf(ty) < 0;
}
/* Slaglampen i tap-knapperne blinker i det tempo der staar nu, regnet
   fra sidste tap - saa man kan se om tempoet sidder */
function beatTick() {
  var bpm = curBpm(), per = 60000 / bpm;
  var ph = ((Date.now() - beatAnchor) % per) / per;
  var on = ph < 0.18;
  var lb = id("lv-bpm");
  if (lb && lb.textContent !== String(bpm)) lb.textContent = bpm;
  if (on === beatOn) return;
  beatOn = on;
  var b = document.querySelectorAll(".tapbtn .beat");
  for (var i = 0; i < b.length; i++) b[i].className = on ? "beat on" : "beat";
}

var H = {};   /* handles til de faste skydere, saa rebuild kan saette dem */

function wire() {
  id("dmxarm").onclick = function () { setArm(!armed()); };
  H.grand  = slider(id("m-grand"), id("m-grand-v"), ["master", "grand"]);
  H.strobe = slider(id("m-strobe"), id("m-strobe-v"), ["master", "strobe"], strobeTxt);
  H.bpm    = slider(id("m-bpm"), id("m-bpm-v"), ["master", "bpm"]);
  id("m-black").onclick = function () {
    S.master.blackout = !S.master.blackout;
    press(id("m-black"), S.master.blackout);
    setv(["master", "blackout"], S.master.blackout);
  };
  id("m-freeze").onclick = function () {
    S.master.freeze = !S.master.freeze;
    press(id("m-freeze"), S.master.freeze);
    setv(["master", "freeze"], S.master.freeze);
  };
  wireTap(id("m-tap"));
  wireTap(id("lv-tap"));
  id("m-bpm-dn").onclick = function () { setBpm(curBpm() - 1); };
  id("m-bpm-up").onclick = function () { setBpm(curBpm() + 1); };
  id("m-bpm-half").onclick = function () { setBpm(Math.round(curBpm() / 2)); };
  id("m-bpm-dbl").onclick = function () { setBpm(curBpm() * 2); };
  id("m-scene-tempo").onchange = function () {
    S.settings.scene_tempo = this.checked;
    setv(["settings", "scene_tempo"], this.checked);
  };
  id("m-sync-all").onclick = function () {
    if (!confirm("Slå Følg tempo til på alle lag — både nu og i alle gemte scener?\n\n" +
                 "Farten regnes om, så intet ser anderledes ud før du tapper.")) return;
    api({ op: "sync_all" }, function (d) {
      refresh();
      toast((d && d.changed ? d.changed : 0) + " lag følger nu tempoet");
    });
  };
  /* T tapper tempo overalt - i alle faner og i live-matrixen - men ikke
     mens man skriver i et felt */
  document.addEventListener("keydown", function (e) {
    if (e.keyCode !== 84 || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!S || typingIn(e.target)) return;
    e.preventDefault();
    tapTempo();
  }, false);
  setInterval(beatTick, 25);
  id("m-full").onclick = function () {
    var items = S.modules.map(function (m, i) { m.level = 255; return { path: ["modules", i, "level"], value: 255 }; });
    api({ op: "patch", items: items }, refresh);
  };
  id("m-zero").onclick = function () {
    var items = S.modules.map(function (m, i) { m.level = 0; return { path: ["modules", i, "level"], value: 0 }; });
    api({ op: "patch", items: items }, refresh);
  };

  id("lay-add").onclick = function () {
    api({ op: "layers_set", count: S.layers.length + 1 }, refresh);
  };
  id("lay-rem").onclick = function () {
    api({ op: "layers_set", count: Math.max(1, S.layers.length - 1) }, function () {
      if (layer >= S.layers.length - 1) layer = 0;
      refresh();
    });
  };
  id("lay-alloff").onclick = function () {
    var items = S.layers.map(function (L, i) {
      return { path: ["layers", i, "on"], value: false };
    });
    S.layers.forEach(function (L, i) { items.push({ path: ["layers", i, "solo"], value: false }); });
    api({ op: "patch", items: items }, refresh);
  };
  id("pat-erase").onclick = function () {
    eraser = !eraser; press(id("pat-erase"), eraser);
  };

  /* layout */
  var st = id("stage");
  st.addEventListener("mousedown", stageDown);
  st.addEventListener("mousemove", stageMove);
  window.addEventListener("mouseup", stageUp);
  st.addEventListener("touchstart", stageDown, false);
  st.addEventListener("touchmove", stageMove, false);
  st.addEventListener("touchend", stageUp, false);
  id("lay-scale").value = scale;
  H.scale = localPair(id("lay-scale"), id("lay-scale-v"), function (v) {
    scale = v; drawStage();
  });
  H.rot = localPair(id("lay-rot"), id("lay-rot-v"), function (v) {
    if (!S || !S.modules[lastMod]) return;
    S.modules[lastMod].rot = v; drawStage();
    markBusy(); setv(["modules", lastMod, "rot"], v);
  });
  id("lay-auto").onclick = function () { api({ op: "autolayout" }, function () { refresh(drawStage); }); };
  id("lay-grid").onclick = function () {
    var items = [], n = S.modules.length, cols = Math.ceil(Math.sqrt(n));
    S.modules.forEach(function (m, i) {
      var gx = (i % cols) - (cols - 1) / 2, gy = (cols - 1) / 2 - Math.floor(i / cols);
      items.push({ path: ["modules", i, "x"], value: gx * 1.4 });
      items.push({ path: ["modules", i, "y"], value: gy * 1.0 });
    });
    api({ op: "patch", items: items }, function () { refresh(drawStage); });
  };
  id("lay-arc").onclick = function () {
    var items = [], n = S.modules.length;
    S.modules.forEach(function (m, i) {
      var t = n > 1 ? i / (n - 1) : 0.5;
      items.push({ path: ["modules", i, "x"], value: Math.round((-5 + 10 * t) * 100) / 100 });
      items.push({ path: ["modules", i, "y"], value: Math.round((2.4 - 1.2 * Math.sin(t * Math.PI)) * 100) / 100 });
    });
    api({ op: "patch", items: items }, function () { refresh(drawStage); });
  };
  id("lay-snap").onclick = function () {
    var items = [];
    S.modules.forEach(function (m, i) {
      m.x = Math.round(m.x * 2) / 2; m.y = Math.round(m.y * 2) / 2;
      items.push({ path: ["modules", i, "x"], value: m.x });
      items.push({ path: ["modules", i, "y"], value: m.y });
    });
    api({ op: "patch", items: items }, function () { refresh(drawStage); });
  };

  /* Layout scene-editor knapper */
  var _leMap = { "le-lamp":"lamp", "le-pan":"pan", "le-rect":"rect",
                 "le-circ":"circle", "le-tri":"tri", "le-sel":"sel", "le-grpsel":"grpsel" };
  var _leIds = ["le-lamp","le-pan","le-grpsel","le-rect","le-circ","le-tri","le-sel"];
  function layEdSet(tool){
    layEdTool = tool;
    _leIds.forEach(function(bid){ var b = id(bid); if (b) press(b, _leMap[bid] === tool); });
  }
  _leIds.forEach(function(bid){
    var b = id(bid); if (b) b.onclick = function(){ layEdSet(_leMap[bid]); };
  });
  /* grupper */
  id("le-grpadd").onclick = function(){ if (laySel.length + laySelG.length) openGroupDialog(null); };
  id("le-grpedit").onclick = function(){ if (laySelG.length === 1 && laySel.length === 0) openGroupDialog(laySelG[0]); };
  id("le-grpdel").onclick = function(){
    if (!laySelG.length) return;
    var names = laySelG.map(function(gid){ var g = groupById(gid); return g ? g.name : ""; }).join(", ");
    if (!confirm("Slet gruppen “" + names + "”? (lamperne bevares, kun gruppen fjernes)")) return;
    var todo = laySelG.slice();
    (function next(){
      if (!todo.length) { laySelG = []; refresh(function(){ updateGrpInfo(); drawStage(); }); return; }
      api({ op: "glabel_del", id: todo.shift() }, next);
    })();
  };
  id("grpdlg-close").onclick = closeGroupDialog;
  document.addEventListener("keydown", function(e){ if (e.keyCode === 27 && id("grpdlg").className === "on") closeGroupDialog(); }, false);

  /* Afvikling */
  var af = id("afstage");
  if (af) {
    af.addEventListener("mousedown", afDown);
    af.addEventListener("mousemove", afMove);
    window.addEventListener("mouseup", afUp);
    af.addEventListener("touchstart", afDown, false);
    af.addEventListener("touchmove", afMove, false);
    af.addEventListener("touchend", afUp, false);
    af.addEventListener("wheel", function(e){
      e.preventDefault();
      var r = af.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      var wx = afSX2L(mx), wy = afSY2L(my);
      afScale = Math.max(10, Math.min(200, afScale * (e.deltaY < 0 ? 1.12 : 0.893)));
      afPanX += mx - (af.width / 2 + afPanX + wx * afScale);
      afPanY += my - (af.height / 2 + afPanY - wy * afScale);
      drawAfStage();
    }, false);
    id("af-zin").onclick = function(){ afScale = Math.min(200, afScale * 1.25); drawAfStage(); };
    id("af-zout").onclick = function(){ afScale = Math.max(10, afScale * 0.8); drawAfStage(); };
    id("af-zfit").onclick = afFit;
    id("af-pan").onclick = function(){ afPanMode = !afPanMode; press(id("af-pan"), afPanMode); };
    id("af-clearsel").onclick = function(){ afSel = []; afSelG = []; afSelChanged(); };
    /* 1-9 og 0 vælger en gruppe direkte. Virker kun mens Afvikling er
       fremme, ikke i live-matrixen (den har tallene til scener) og ikke
       mens man skriver i et felt. Shift lægger gruppen til markeringen. */
    document.addEventListener("keydown", function (e) {
      if (liveOn || !S) return;
      if (id("v-afvikling").className.indexOf("active") < 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      var k = e.keyCode, idx = -1;
      if (k >= 49 && k <= 57) idx = k - 49;
      else if (k === 48) idx = 9;
      else return;
      var gs = S.group_labels || [];
      if (!gs[idx]) return;
      e.preventDefault();
      if (e.shiftKey) toggleArr(afSelG, gs[idx].id);
      else { afSelG = [gs[idx].id]; afSel = []; }
      afSelChanged();
    }, false);
    /* Palette-genvejstaster: A S D F G H J Z X C V B N M vælger farve
       fra den aktive palette. Virker kun i Afvikling med palet-tilstand. */
    document.addEventListener("keydown", function (e) {
      if (liveOn || !S) return;
      if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      var ch = String.fromCharCode(e.keyCode);
      var pi = PAL_KEYS.indexOf(ch);
      if (pi < 0) return;
      /* Enkel: farven går til de valgte lamper */
      if (id("v-enkel").className.indexOf("active") >= 0) {
        var pe = activePalette();
        if (pi >= pe.length) return;
        e.preventDefault();
        ekColour(pe[pi]);
        return;
      }
      /* Afvikling: palet-mode og noget er valgt */
      if (id("v-afvikling").className.indexOf("active") >= 0) {
        if (afPicker !== "palet" || !afHasSel()) return;
        var pal = activePalette();
        if (pi >= pal.length) return;
        e.preventDefault();
        var c = pal[pi];
        var chip = id("af-chip");
        if (chip) chip.style.background = hex(c);
        afSetColour(c, true);
        return;
      }
      /* Pult: når Programmér→Pult er aktiv og et lag har fast farve */
      if (id("v-pult") && id("v-pult").className.indexOf("active") >= 0) {
        var pal2 = activePalette();
        if (pi >= pal2.length) return;
        var L2 = S && S.layers && S.layers[layer];
        if (!L2 || L2.colour_mode !== "fast") return;
        e.preventDefault();
        var col = pal2[pi];
        setv(["layers", layer, "colour"], col, buildLayerForm);
      }
    }, false);
    id("af-savescene").onclick = function(){
      var n = prompt("Navn på scenen", afHasSel() ? afTitle() : ("Scene " + (S.scenes.length + 1)));
      if (!n) return;
      /* en scene gemmer hele billedet - alle gruppe-looks, Pultens lag,
         master og lampeniveauer - og lander i det viste scene-faneblad */
      api({ op: "scene_store", name: n, tab: curTabId() }, function(){
        refresh(function(){ toast("Gemt som scene “" + n + "”"); });
      });
    };
    id("af-blackall").onclick = function(){
      if (!confirm("Nulstil alle gruppe-looks i Afvikling? Alt styret herfra slukkes.")) return;
      api({ op: "live_clear" }, function(){ refresh(function(){ afDraft = afDefaultDraft(); buildAfCtrl(); drawAfStage(); }); });
    };
  }
  id("le-del").onclick = function(){
    if (layEdSel >= 0 && S.stage_objects && S.stage_objects[layEdSel]){
      S.stage_objects.splice(layEdSel, 1); layEdSel = -1; drawStage(); pushStageObjs();
    }
  };
  layEdSet("lamp");

  /* zoom med musehjul over scenegulvet */
  st.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = st.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var wx = S2LX(mx), wy = S2LY(my);
    var ns = Math.max(8, Math.min(240, scale * (e.deltaY < 0 ? 1.12 : 0.893)));
    scale = ns;
    /* hold punktet under musen på plads */
    panX += mx - (st.width / 2 + panX + wx * scale);
    panY += my - (st.height / 2 + panY - wy * scale);
    if (H.scale) H.scale.set(Math.round(scale));
    drawStage();
  }, false);

  /* stråler og navne */
  function layToggle(bid, key) {
    id(bid).onclick = function () {
      var V = viewCfg(); var nv = {}; nv[key] = !V[key];
      pushView(nv); press(id(bid), !!viewCfg()[key]);
    };
  }
  layToggle("le-beams", "beams");
  layToggle("le-labels", "labels");
  id("le-lblall").onclick = function () {
    var items = [];
    S.modules.forEach(function (m, i) { m.lbl = true; items.push({ path: ["modules", i, "lbl"], value: true }); });
    if (!viewCfg().labels) pushView({ labels: true });
    api({ op: "patch", items: items }, function () { refresh(function(){ buildPatch(); drawStage(); }); });
  };
  id("le-lblnone").onclick = function () {
    var items = [];
    S.modules.forEach(function (m, i) { m.lbl = false; items.push({ path: ["modules", i, "lbl"], value: false }); });
    api({ op: "patch", items: items }, function () { refresh(function(){ buildPatch(); drawStage(); }); });
  };
  id("le-lblreset").onclick = function () {
    var items = [];
    S.modules.forEach(function (m, i) {
      m.lx = 0; m.ly = 0;
      items.push({ path: ["modules", i, "lx"], value: 0 });
      items.push({ path: ["modules", i, "ly"], value: 0 });
    });
    api({ op: "patch", items: items }, function () { refresh(drawStage); });
  };
  id("le-zin").onclick = function () {
    scale = Math.min(240, scale * 1.25); if (H.scale) H.scale.set(Math.round(scale)); drawStage();
  };
  id("le-zout").onclick = function () {
    scale = Math.max(8, scale * 0.8); if (H.scale) H.scale.set(Math.round(scale)); drawStage();
  };
  id("le-zfit").onclick = function () { layFit(); };

  /* visningsskydere - deles med simulatoren */
  function vwSlider(sid, key, vid) {
    var inp = id(sid), out = id(vid);
    if (!inp) return;
    inp.oninput = function () {
      var v = parseInt(this.value, 10);
      if (out) out.textContent = v;
      S.view = S.view || {}; S.view[key] = v; drawStage();
    };
    inp.onchange = function () {
      var o = {}; o[key] = parseInt(this.value, 10); pushView(o);
    };
  }
  vwSlider("vw-pool", "pool", "vw-pool-v");
  vwSlider("vw-beam", "beam", "vw-beam-v");
  vwSlider("vw-bang", "bang", "vw-bang-v");
  vwSlider("vw-lblop", "label_opacity", "vw-lblop-v");
  id("vw-lblcol").onchange = function () { pushView({ label_color: this.value }); };

  /* fold værktøjerne i Layout sammen, så scenegulvet fylder mere */
  var layToolsOpen = true;
  try { layToolsOpen = localStorage.getItem("layTools") !== "0"; } catch (e) {}
  function applyLayTools() {
    id("laytools").style.display = layToolsOpen ? "" : "none";
    id("lay-tools-tgl").textContent = layToolsOpen ? "▾ Skjul værktøjer" : "▸ Vis værktøjer";
    id("lay-tools-note").style.display = layToolsOpen ? "" : "none";
    id("stage").className = layToolsOpen ? "" : "tall";
    id("stage")._w = 0;          /* tving ny opmaaling af laerredet */
    drawStage();
  }
  id("lay-tools-tgl").onclick = function () {
    layToolsOpen = !layToolsOpen;
    try { localStorage.setItem("layTools", layToolsOpen ? "1" : "0"); } catch (e) {}
    applyLayTools();
  };
  applyLayTools();

  /* kompakt lampevisning */
  try { stripsCompact = localStorage.getItem("stripsCompact") === "1"; } catch (e) {}
  press(id("st-compact"), stripsCompact);
  id("st-compact").onclick = function () {
    stripsCompact = !stripsCompact;
    press(id("st-compact"), stripsCompact);
    try { localStorage.setItem("stripsCompact", stripsCompact ? "1" : "0"); } catch (e) {}
    buildStrips();
  };

  /* patch */
  id("pa-renum-now").onclick = function () {
    api({ op: "renumber_all" }, function () { refresh(function () { buildPatch(); drawStage(); }); });
  };
  id("pa-add").onclick = function () {
    api({
      op: "fixture_add",
      type: id("pa-type").value,
      qty: Math.max(1, parseInt(id("pa-qty").value, 10) || 1),
      universe: Math.max(1, parseInt(id("pa-uni").value, 10) || 1),
      address: Math.max(1, parseInt(id("pa-addr").value, 10) || 1)
    }, function () {
      var span = profilesAll()[id("pa-type").value];
      var n = span ? span.channels.length : 1;
      var q = Math.max(1, parseInt(id("pa-qty").value, 10) || 1);
      id("pa-addr").value = (parseInt(id("pa-addr").value, 10) || 1) + q * n;
      refresh(updatePatchHint);
    });
  };
  id("pa-auto").onclick = function () { api({ op: "auto_address" }, refresh); };
  id("pa-newtype").onclick = newProfileDialog;
  id("pa-reset").onclick = openResetDialog;
  /* Enkel */
  id("ek-all").onclick = function () {
    ekSel = S.modules.map(function (m, i) { return i; }); buildEnkel();
  };
  id("ek-none").onclick = function () { ekSel = []; buildEnkel(); };
  id("ek-dark").onclick = function () {
    S.live.looks.forEach(function (lk) { lk.on = false; });
    ekMirror(S.modules.map(function (m, i) { return i; }), { on: false });
    markBusy(); clearBusy();
    api({ op: "live_dark" });
    ekInfo();
  };
  id("ek-scene").onclick = function () {
    var n = prompt("Navn på scenen", "Scene " + (S.scenes.length + 1));
    if (!n) return;
    api({ op: "scene_store", name: n, tab: curTabId() }, function () {
      refresh(function () { toast("Gemt som scene “" + n + "”"); });
    });
  };
  (function () {
    var r = id("ek-level");
    r.oninput = function () {
      id("ek-levelv").textContent = Math.round(r.value / 2.55) + " %";
      if (!ekLevelT) ekLevelT = setTimeout(function () { ekLevelT = null; ekLevel(parseInt(r.value, 10)); }, 70);
    };
    r.onchange = function () { ekLevel(parseInt(r.value, 10)); };
  })();
  id("sh-reset").onclick = openResetDialog;
  /* Lampetest: ← → skifter opsætning mens testen kører */
  document.addEventListener("keydown", function (e) {
    if (!LT.on || liveOn) return;
    if (id("v-patch").className.indexOf("active") < 0) return;
    if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
    if (e.target && e.target.type === "range") return;   /* piletasterne flytter skyderen */
    if (id("rstdlg").className === "on") return;
    if (e.keyCode === 37) { e.preventDefault(); ltCycle(-1); }
    else if (e.keyCode === 39) { e.preventDefault(); ltCycle(1); }
  }, false);
  id("pa-lib").onclick = openLib;
  id("lib-close").onclick = closeLib;
  id("lib-search").oninput = function () { buildLibList(this.value); };
  id("pa-import").onclick = function () { id("pa-file").click(); };
  id("pa-file").onchange = function () {
    var f = this.files[0]; if (f) importFixtureFile(f); this.value = "";
  };
  document.addEventListener("keydown", function (e) {
    if (e.keyCode === 27 && id("lib").className === "on") closeLib();
  }, false);

  id("ed-lamp").onchange = function () { edLamp = parseInt(this.value, 10) || 0; buildEditor(); };
  id("ed-type").onchange = function () { buildEdChans(); };
  id("ed-apply").onclick = function () { edApplyType(id("ed-type").value); };
  id("ed-prev").onclick = function () { edCycle(-1); };
  id("ed-next").onclick = function () { edCycle(1); };
  id("ed-custom").onclick = newProfileDialog;
  id("ed-del").onclick = function () {
    if (S.modules.length <= 1) { toast("Kan ikke fjerne den sidste lampe"); return; }
    api({ op: "fixture_del", index: edLamp }, function () {
      if (edLamp > 0) edLamp--;
      refresh(buildEditor);
    });
  };
  id("pa-type").onchange = updatePatchHint;
  id("pa-qty").onchange = updatePatchHint;
  id("pa-addr").onchange = updatePatchHint;
  id("pa-uni").onchange = updatePatchHint;

  /* moenstre */
  var pc = id("patcv");
  pc.addEventListener("mousedown", function (e) { patDown = true; patPaint(e, eraser || e.shiftKey); });
  pc.addEventListener("mousemove", function (e) { if (patDown) patPaint(e, eraser || e.shiftKey); });
  window.addEventListener("mouseup", function () { if (patDown) { patDown = false; pushPattern(); } });
  pc.addEventListener("touchstart", function (e) { e.preventDefault(); patDown = true; patPaint(e, eraser); }, false);
  pc.addEventListener("touchmove", function (e) { e.preventDefault(); patPaint(e, eraser); }, false);
  pc.addEventListener("touchend", function () { patDown = false; pushPattern(); }, false);
  id("pat-pick").onchange = function () { patIdx = parseInt(this.value, 10); buildPatternPick(); drawPattern(); };
  id("pat-new").onclick = function () {
    var n = prompt("Navn", "Eget " + (S.patterns.length + 1));
    if (n) api({ op: "pattern_new", name: n }, function () { refresh(function () { patIdx = S.patterns.length - 1; buildPatternPick(); drawPattern(); }); });
  };
  id("pat-del").onclick = function () { api({ op: "pattern_del", index: patIdx }, function () { patIdx = 0; refresh(drawPattern); }); };
  id("pat-clear").onclick = function () {
    var p = S.patterns[patIdx];
    p.steps = p.steps.map(function (r) { return r.map(function () { return 0; }); });
    pushPattern(); drawPattern();
  };
  id("pat-inv").onclick = function () {
    var p = S.patterns[patIdx];
    p.steps = p.steps.map(function (r) { return r.map(function (v) { return 1 - v; }); });
    pushPattern(); drawPattern();
  };
  H.steps = localPair(id("pat-steps"), id("pat-steps-v"), function (v, done) {
    if (done) api({ op: "pattern_resize", index: patIdx, steps: v },
                  function () { refresh(drawPattern); });
  });
  H.brush = localPair(id("pat-brush"), id("pat-brush-v"), function (v) {
    brush = v / 100;
  });
  id("pat-smooth").onchange = function () { setv(["patterns", patIdx, "smooth"], this.checked); };

  /* scener */
  id("sc-store").onclick = function () {
    var n = prompt("Navn på scenen", "Scene " + (S.scenes.length + 1));
    /* den nye scene lander i det faneblad man kigger paa */
    if (n) api({ op: "scene_store", name: n, tab: curTabId() }, refresh);
  };
  id("sc-live").onclick = function () {
    if (sceneView !== "matrix") setSceneView("matrix");
    setLive(!liveOn);
  };
  id("lv-exit").onclick = function () { setLive(false); };
  id("pt-sel").onchange = function () {
    if (PT.dirty && !confirm("Du har ændringer der ikke er gemt. Kassér dem?")) { this.value = PT.sel; return; }
    ptSelect(this.value);
  };
  id("pt-new").onclick = ptNew;
  id("pt-copy").onclick = function () {
    api({ op: "profile_copy", from: PT.sel }, function (r) {
      if (!r || !r.ok) return;
      if (PT.testOn) ptTestStop();
      PT.sel = r.id; PT.dirty = false;
      refresh(function () { buildProfileEditor(); toast("Kopi oprettet — nu kan du rette i den"); });
    });
  };
  id("pt-del").onclick = function () {
    var p = profilesAll()[PT.sel]; if (!p) return;
    if (!confirm("Slet lampetypen \u201c" + p.name + "\u201d?")) return;
    api({ op: "profile_del", id: PT.sel }, function (r) {
      if (!r || !r.ok) { toast("Kan ikke slette: " + ((r && r.err) || "")); return; }
      if (PT.testOn) ptTestStop();
      PT.sel = null; PT.dirty = false; refresh();
    });
  };
  id("lv-tab").onchange = function () { setLiveTab(this.value); buildLive(); };
  id("wz-back").onclick = function () { if (WZ) wzGo(WZ.step - 1); };
  id("wz-next").onclick = function () { if (WZ) wzGo(WZ.step + 1); };
  id("wz-restart").onclick = function () {
    if (confirm("Start guiden forfra?\n\nDine valg i guiden nulstilles. Scener der allerede er oprettet, bliver liggende."))
      wzOpen(true);
  };
  id("lv-black").onclick = function () {
    S.master.blackout = !S.master.blackout;
    press(id("lv-black"), S.master.blackout);
    press(id("m-black"), S.master.blackout);
    setv(["master", "blackout"], S.master.blackout);
  };
  id("lv-go").onclick = function () { cueGo(1); };
  id("lv-back").onclick = function () { cueGo(-1); };
  H.lvgrand = slider(id("lv-grand"), id("lv-grand-v"), ["master", "grand"]);
  id("lv-animall").onchange = function () {
    liveAnimateAll = this.checked;
    try { window.localStorage.setItem("pixelpult.liveAnimAll", liveAnimateAll ? "1" : "0"); } catch (e) {}
    if (liveOn) buildLive();
  };
  document.addEventListener("keydown", liveKeys, false);
  window.addEventListener("resize", function () { if (liveOn) buildLive(); });

  document.addEventListener("mousemove", function (e) { if (dragCard.idx >= 0) cardDragMove(e.clientX, e.clientY); });
  document.addEventListener("mouseup", function () { if (dragCard.idx >= 0) cardDragEnd(); });
  document.addEventListener("touchmove", function (e) {
    if (dragCard.idx >= 0) { var t = e.touches[0]; cardDragMove(t.clientX, t.clientY); if (dragCard.active && e.cancelable) e.preventDefault(); }
  }, false);
  document.addEventListener("touchend", function () { if (dragCard.idx >= 0) cardDragEnd(); }, false);

  id("sc-list").onclick = function () { setSceneView("liste"); };
  id("sc-matrix").onclick = function () { setSceneView("matrix"); };

  /* faneblade med grupper af scener */
  id("tab-add").onclick = function () {
    var nm = prompt("Navn på det nye faneblad:", "Gruppe " + (sceneTabs().length + 1));
    if (nm === null) return;
    api({ op: "tab_add", name: nm }, function (d) {
      if (d && d.id) sceneTab = d.id;
      refresh();
    });
  };
  id("tab-ren").onclick = function () {
    var tid = curTabId();
    var cur = sceneTabs().filter(function (t) { return t.id === tid; })[0];
    if (!cur) return;
    var nm = prompt("Nyt navn til fanebladet:", cur.name);
    if (nm === null || !nm) return;
    api({ op: "tab_rename", id: tid, name: nm }, refresh);
  };
  id("tab-del").onclick = function () {
    var tid = curTabId();
    var cur = sceneTabs().filter(function (t) { return t.id === tid; })[0];
    if (!cur) return;
    if (sceneTabs().length <= 1) { toast("Det sidste faneblad kan ikke fjernes"); return; }
    var n = S.scenes.filter(function (s) { return (s.tab || sceneTabs()[0].id) === tid; }).length;
    var msg = "Fjern fanebladet " + cur.name + "?";
    if (n) msg += "\n\nDe " + n + " scener i det flyttes til det første faneblad — de slettes ikke.";
    if (!confirm(msg)) return;
    api({ op: "tab_del", id: tid }, function () { sceneTab = null; refresh(); });
  };
  id("sc-prev").onclick = function () {
    scenePrev = !scenePrev;
    try { window.localStorage.setItem("pixelpult.scenePrev", scenePrev ? "1" : "0"); } catch (e) {}
    buildScenes();
  };
  id("cue-go").onclick = function () { cueGo(1); };
  id("cue-back").onclick = function () { cueGo(-1); };
  id("cue-auto").onclick = function () {
    cueAuto = !cueAuto; press(id("cue-auto"), cueAuto);
    if (!cueAuto && cueTimer) { clearTimeout(cueTimer); cueTimer = null; }
  };

  /* output */
  function bindChk(elid, path) {
    id(elid).onchange = function () { setv(path, this.checked); };
  }
  function bindTxt(elid, path, num) {
    id(elid).onchange = function () { setv(path, num ? parseFloat(this.value) : this.value); };
  }
  bindChk("o-artnet", ["outputs", "artnet", "on"]);
  bindTxt("o-artnet-host", ["outputs", "artnet", "host"]);
  bindChk("o-artnet-bc", ["outputs", "artnet", "broadcast"]);
  bindChk("o-sacn", ["outputs", "sacn", "on"]);
  bindTxt("o-sacn-host", ["outputs", "sacn", "host"]);
  bindTxt("o-sacn-prio", ["outputs", "sacn", "priority"], true);
  bindChk("o-enttec", ["outputs", "enttec", "on"]);
  id("o-enttec-port").onchange = function () { setv(["outputs", "enttec", "port"], this.value); };
  id("o-enttec-uni").onchange = function () {
    setv(["outputs", "enttec", "universe"], parseInt(this.value, 10) || 0);
  };
  id("o-enttec-scan").onclick = function () {
    refresh(function () { enttecHint(); fillEnttecPorts(); toast("Søgte efter enheder"); });
  };
  H.fps    = slider(id("s-fps"), id("s-fps-v"), ["settings", "fps"]);
  H.bright = slider(id("s-bright"), id("s-bright-v"), ["settings", "bright"]);
  bindChk("s-perf", ["settings", "perf"]);
  bindTxt("s-abase", ["settings", "artnet_base"], true);

  /* show */
  id("sh-name").onchange = function () { setv(["name"], this.value); document.title = "Lyspult · " + this.value; };
  id("sh-save").onclick = function () {
    api({ op: "save", name: id("sh-name").value }, function (d) {
      toast(d && d.ok ? "Gemt" : "Kunne ikke gemme"); loadShowList();
    });
  };
  id("sh-new").onclick = function () {
    if (confirm("Nyt show? Alt ugemt går tabt.")) api({ op: "new" }, refresh);
  };
  id("sh-export").onclick = function () {
    var blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.name || "show") + ".json";
    a.click();
  };
  id("sh-import").onclick = function () { id("sh-file").click(); };
  id("sh-file").onchange = function () {
    var f = this.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { api({ op: "import", show: JSON.parse(r.result) }, function () { refresh(); toast("Importeret"); }); }
      catch (e) { toast("Filen kunne ikke læses"); }
    };
    r.readAsText(f);
  };

  window.addEventListener("resize", function () {
    fitTabs();
    id("stage")._w = 0; id("patcv")._w = 0;
    stripCv.forEach(function (c) { c._w = 0; });
    drawStage(); drawPattern();
  });
}

detectFlexGap();
detectColourInput();
loadScenePrefs();
loadLiveAnimatePrefs();
buildTabs();
initTheme();
/* Panelerne saettes op FOER wire(), saa de aldrig kan ryge med i faldet
   hvis noget i wire() skulle fejle. */
initPultPanels();
initOtherPanels();
wireTabDrag();
initHelp();
wire();
refresh(function () {
  /* den fane der er aaben ved start skal have sin opsaetning koert, nu
     hvor showet er hentet (fx Afviklings tilpas-zoom) */
  enterView(viewCur);
  poll(); scenePoll();
});

/* ---- kollapsible og flytbare paneler i Pult ---- */
function initPultPanels() {
  makePanels(id("v-pult"), "pultPanelOrder");
}
/* Rammer der kan klappes sammen (klik på overskriften) og trækkes rundt
   (træk i overskriften). Rækkefølge og sammenklapning huskes i browseren
   pr. fane. Bruges i Pult, Patch, Output, Scener og Show. */
function initOtherPanels() {
  makePanels(id("v-patch"), "patchPanelOrder");
  makePanels(id("out-panels"), "outPanelOrder");
  makePanels(id("v-scene"), "scenePanelOrder");
  makePanels(id("v-show"), "showPanelOrder");
}
function makePanels(box, key) {
  if (!box) return;
  function list() { return [].filter.call(box.children, function (c) { return c.dataset && c.dataset.panel; }); }
  var panels = list();
  if (!panels.length) return;

  /* gendan gemt rækkefølge og kollaps-tilstand. Rammer der er kommet til
     siden, beholder deres plads bagerst; ukendte navne springes over. */
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch (e) {}
  if (saved && saved.length) {
    var order = [], seen = {};
    saved.forEach(function (sv) {
      var p = panels.filter(function (c) { return c.dataset.panel === sv.id; })[0];
      if (p && !seen[sv.id]) {
        seen[sv.id] = 1; order.push(p);
        if (sv.collapsed) p.classList.add("collapsed");
      }
    });
    panels.forEach(function (p) { if (!seen[p.dataset.panel]) order.push(p); });
    var mark = document.createComment("paneler");
    box.insertBefore(mark, panels[0]);
    order.forEach(function (p) { box.insertBefore(p, mark); });
    box.removeChild(mark);
    panels = list();
  }

  function savePanelState() {
    var state = list().map(function (p) { return { id: p.dataset.panel, collapsed: p.classList.contains("collapsed") }; });
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
  }

  /* kollaps ved klik på h2 */
  panels.forEach(function (pan) {
    var h = pan.querySelector("h2");
    if (!h) return;
    h.addEventListener("click", function (e) {
      if (e.target.closest("button,input,select,a")) return;
      pan.classList.toggle("collapsed");
      savePanelState();
    });
  });

  /* drag-reorder: KUN overskriften er håndtaget. Gør aldrig hele panelet
     draggable - så griber browseren et skydertræk (eller et hvilket som
     helst træk i kroppen) som start på et panel-træk. */
  var dragSrc = null;
  panels.forEach(function (pan) {
    var h = pan.querySelector("h2");
    if (h) {
      h.setAttribute("draggable", "true");
      h.addEventListener("dragstart", function (e) {
        dragSrc = pan;
        pan.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", pan.dataset.panel);
        }
      });
      h.addEventListener("dragend", function () {
        pan.classList.remove("dragging");
        [].forEach.call(box.querySelectorAll(".dragover"), function (el) { el.classList.remove("dragover"); });
        dragSrc = null;
        savePanelState();
      });
    }
    pan.addEventListener("dragover", function (e) {
      if (!dragSrc || dragSrc === pan) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      [].forEach.call(box.querySelectorAll(".dragover"), function (el) { el.classList.remove("dragover"); });
      pan.classList.add("dragover");
    });
    pan.addEventListener("dragleave", function () {
      pan.classList.remove("dragover");
    });
    pan.addEventListener("drop", function (e) {
      e.preventDefault();
      pan.classList.remove("dragover");
      if (!dragSrc || dragSrc === pan) return;
      box.insertBefore(dragSrc, pan);
      savePanelState();
    });
  });
}
})();
