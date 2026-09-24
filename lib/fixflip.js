// FixFlip-Pro-Rechenkern — Port von berechneFixFlip() aus fixflip-pro/index.html.
//
// Diese Datei läuft zweimal: auf dem Server (Ankaufskalkulation, Tools für Claude)
// und eingebettet im Standalone-Rechner (render/rechner.js schneidet die
// "export "-Präfixe ab und setzt den Text in ein <script>). Deshalb: keine
// Imports, keine Node-APIs, nur reine Funktionen.
//
// Liegt die echte index.html auf dem Server (FIXFLIP_DIR), nimmt lib/engine.js
// stattdessen die Originalfunktion — dieser Port ist die Rückfallebene und
// muss dieselben Zahlen liefern (test/fixflip.test.js prüft das an einem Referenzfall).

export const KFW_FOERDERUNG = { basic: 0 };

export const DEFAULT_INPUTS = {
  kaufpreis: 0,
  wohnflaeche: 0,
  grunderwerbsteuerSatz: 5.0,
  notarGrundbuchSatz: 2.0,
  maklerKaufSatz: 3.57,
  provisionenSonstige: 0,
  hausgeldProMonat: 0,
  objektkostenProMonat: 0,
  sonderumlage: 0,
  sanierungAktiv: false,
  sanierungskostenM2: 700,
  sanierungsstandard: "basic",
  kfwFoerderungProzent: 0,
  renovierungAktiv: false,
  renovierungPauschale: 25000,
  baunebenkostenProzent: 0,
  unvorhergesehenesProzent: 0,
  mieteNettoProMonat: 0,
  haltedauerMonate: 12,
  finanzierungsdauerMonate: 12,
  maklerkosten: 3.57,
  notarVerkauf: 0.5,
  zielverkaufspreis: 0,
  garageMitverkauf: false,
  garagenpreis: 0,
  frischstellung: false,
};

export const DEFAULT_PROFIL = {
  ekVerfuegbar: 450000,
  kkRahmen: 0,
  kkZins: 9.0,
  objektdarlehenAktiv: true,
  objektdarlehenLtv: 80,
  objektdarlehenZins: 6.0,
};

const n = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

// Rechenweg wie in Berechnungslogik-Uebersicht.md:
//   GIK = Kaufpreis + Kaufnebenkosten + Provisionen + Sanierung (nach KfW) + Renovierung
//         + Baunebenkosten + Unvorhergesehenes + Hausgeld + Objektkosten + Sonderumlage
//   Darlehen deckt nur den Kaufpreis (LTV), Rest erst EK, dann Kontokorrent.
//   Zinsen konservativ: beide Linien ab Tag 1 voll, über min(Finanzierung, Haltedauer).
//   Ergebnis = Verkaufserlös + Miete − GIK − Zinsen − Verkaufsnebenkosten.
export function berechneFixFlip(inp, profil = DEFAULT_PROFIL) {
  const i = { ...DEFAULT_INPUTS, ...inp };
  const p = { ...DEFAULT_PROFIL, ...profil };
  const kp = n(i.kaufpreis);
  const wf = n(i.wohnflaeche);
  const monate = Math.max(0, n(i.haltedauerMonate));

  const grunderwerbsteuer = kp * n(i.grunderwerbsteuerSatz) / 100;
  const notarGrundbuch = kp * n(i.notarGrundbuchSatz) / 100;
  const maklerKauf = kp * n(i.maklerKaufSatz) / 100;
  const kaufnebenkosten = grunderwerbsteuer + notarGrundbuch + maklerKauf;
  const provisionenSonstige = n(i.provisionenSonstige);

  const hausgeldGesamt = n(i.hausgeldProMonat) * monate;
  const objektkostenGesamt = n(i.objektkostenProMonat) * monate;
  const sonderumlage = n(i.sonderumlage);

  const sanierungBrutto = i.sanierungAktiv ? wf * n(i.sanierungskostenM2) : 0;
  const kfwProzent = i.sanierungsstandard in KFW_FOERDERUNG && i.sanierungsstandard !== "basic"
    ? n(KFW_FOERDERUNG[i.sanierungsstandard])
    : n(i.kfwFoerderungProzent);
  const kfwFoerderung = sanierungBrutto * kfwProzent / 100;
  const sanierungNetto = sanierungBrutto - kfwFoerderung;
  const renovierungskosten = i.renovierungAktiv ? n(i.renovierungPauschale) : 0;
  const bausumme = sanierungBrutto + renovierungskosten;
  const baunebenkosten = bausumme * n(i.baunebenkostenProzent) / 100;
  const unvorhergesehenes = (bausumme + baunebenkosten) * n(i.unvorhergesehenesProzent) / 100;

  const gesamtinvestition = kp + kaufnebenkosten + provisionenSonstige + sanierungNetto
    + renovierungskosten + baunebenkosten + unvorhergesehenes
    + hausgeldGesamt + objektkostenGesamt + sonderumlage;

  const objektdarlehen = p.objektdarlehenAktiv ? kp * n(p.objektdarlehenLtv) / 100 : 0;
  const restbedarf = Math.max(0, gesamtinvestition - objektdarlehen);
  const ekEinsatz = Math.min(restbedarf, Math.max(0, n(p.ekVerfuegbar)));
  const kkInanspruchnahme = Math.min(restbedarf - ekEinsatz, Math.max(0, n(p.kkRahmen)));
  const deckungsluecke = Math.max(0, restbedarf - ekEinsatz - kkInanspruchnahme);
  const finanzierbar = deckungsluecke < 0.5;
  const gebundenesKapital = ekEinsatz + kkInanspruchnahme;

  const zinsMonate = Math.min(n(i.finanzierungsdauerMonate), monate);
  const zinsenObjektdarlehen = objektdarlehen * n(p.objektdarlehenZins) / 100 * zinsMonate / 12;
  const zinsenKK = kkInanspruchnahme * n(p.kkZins) / 100 * zinsMonate / 12;
  const zinsenGesamt = zinsenObjektdarlehen + zinsenKK;

  const garage = i.garageMitverkauf ? n(i.garagenpreis) : 0;
  const verkaufserloesGesamt = n(i.zielverkaufspreis) + garage;
  const verkaufsnebenkosten = verkaufserloesGesamt * (n(i.maklerkosten) + n(i.notarVerkauf)) / 100;
  const mieteGesamt = n(i.mieteNettoProMonat) * monate;

  const gesamtkosten = gesamtinvestition + zinsenGesamt + verkaufsnebenkosten;
  const bruttogewinn = verkaufserloesGesamt + mieteGesamt - gesamtkosten;
  const erloesInklMiete = verkaufserloesGesamt + mieteGesamt;

  return {
    grunderwerbsteuer, notarGrundbuch, maklerKauf, kaufnebenkosten, provisionenSonstige,
    hausgeldGesamt, objektkostenGesamt, sonderumlage,
    sanierungBrutto, kfwFoerderung, sanierungNetto, renovierungskosten,
    baunebenkosten, unvorhergesehenes, gesamtinvestition,
    objektdarlehen, ekEinsatz, kkInanspruchnahme, deckungsluecke, finanzierbar, gebundenesKapital,
    zinsenObjektdarlehen, zinsenKK, zinsenGesamt,
    verkaufserloesGesamt, verkaufsnebenkosten, mieteGesamt,
    gesamtkosten, bruttogewinn,
    roiGesamt: gesamtkosten > 0 ? bruttogewinn / gesamtkosten * 100 : 0,
    gewinnmarge: erloesInklMiete > 0 ? bruttogewinn / erloesInklMiete * 100 : 0,
    gewinnProM2: wf > 0 ? bruttogewinn / wf : 0,
    ekQuote: gesamtinvestition > 0 ? gebundenesKapital / gesamtinvestition * 100 : 0,
    renditeGebundenesKapitalPA: gebundenesKapital > 0 && monate > 0
      ? bruttogewinn / gebundenesKapital * (12 / monate) * 100 : null,
  };
}

// Break-even-Verkaufspreis (Ergebnis = 0) bzw. Verkaufspreis für eine Zielmarge auf
// die Gesamtkosten — algebraisch, weil Zinsen und GIK nicht vom Verkaufspreis abhängen.
//   (VK+G)·(1 − v·(1+m)) = (1+m)·(GIK+Z) − Miete
export function verkaufspreisFuerMarge(inp, profil, margeProzent = 0, rechne = berechneFixFlip) {
  const m = margeProzent / 100;
  const e = rechne({ ...inp, zielverkaufspreis: 0 }, profil);
  const i = { ...DEFAULT_INPUTS, ...inp };
  const v = (n(i.maklerkosten) + n(i.notarVerkauf)) / 100;
  const garage = i.garageMitverkauf ? n(i.garagenpreis) : 0;
  const nenner = 1 - v * (1 + m);
  if (nenner <= 0) return null;
  return ((1 + m) * (e.gesamtinvestition + e.zinsenGesamt) - e.mieteGesamt) / nenner - garage;
}

// Bearbeitungsgebühr auf die gezogene Finanzierung als Wrapper — genau wie
// standaloneGebuehrEinhaengen() im FixFlip-Standalone (build.py).
export function mitBearbeitungsgebuehr(rechne, satz) {
  return function (inp, profil) {
    const e = rechne(inp, profil);
    const gebuehr = (e.objektdarlehen + e.kkInanspruchnahme) * satz;
    const monate = (inp && inp.haltedauerMonate) || 0;
    e.bearbeitungsgebuehr = gebuehr;
    e.zinsenGesamt += gebuehr;
    e.gesamtkosten += gebuehr;
    e.bruttogewinn -= gebuehr;
    e.roiGesamt = e.gesamtkosten > 0 ? e.bruttogewinn / e.gesamtkosten * 100 : 0;
    e.gewinnmarge = e.verkaufserloesGesamt > 0 ? e.bruttogewinn / e.verkaufserloesGesamt * 100 : 0;
    e.renditeGebundenesKapitalPA = e.gebundenesKapital > 0 && monate > 0
      ? e.bruttogewinn / e.gebundenesKapital * (12 / monate) * 100 : null;
    return e;
  };
}

export function ampel(margeProzent, gruen = 20, gelb = 15) {
  return margeProzent >= gruen ? "gruen" : (margeProzent >= gelb ? "gelb" : "rot");
}

// ── Kalkulationsplan ─────────────────────────────────────────────────────────
// Ein Plan beschreibt die Ankaufskalkulation so, wie kalkulation.mjs sie
// von Hand aufgebaut hat: mehrere Kaufpreise × Exits × Szenarien (worst/real/best),
// Miete netto über die Haltedauer, Bearbeitungsgebühr als Provision in der GIK.

export const SZENARIEN = ["worst", "real", "best"];

function szenarioWert(wert, sz) {
  if (wert && typeof wert === "object") return n(wert[sz] ?? wert.real);
  return n(wert);
}

export function planInputs(plan, kaufpreis, exit, sz) {
  const o = plan.objekt || {};
  const f = plan.finanzierung || {};
  const wf = n(o.wohnflaeche);
  const mietePa = n(o.mieteNettoKaltPa);
  const bwk = n(o.bewirtschaftungProzent) / 100;
  const halte = n(exit.haltedauerMonate);
  const mietMonate = exit.mietMonate == null ? halte : n(exit.mietMonate);
  const ltv = f.objektdarlehenAktiv === false ? 0 : n(f.objektdarlehenLtv ?? 80);
  const darlehen = kaufpreis * ltv / 100;
  const garage = szenarioWert(exit.garage, sz);
  const renovierung = n(exit.renovierungPauschale);
  const vkM2 = szenarioWert(exit.preiseM2, sz);
  return {
    ...(plan.basis || {}),
    ...(exit.inputs || {}),
    kaufpreis,
    wohnflaeche: wf,
    provisionenSonstige: darlehen * n(f.bearbeitungsgebuehrProzent ?? 1.5) / 100,
    haltedauerMonate: halte,
    finanzierungsdauerMonate: exit.finanzierungsdauerMonate == null ? halte : n(exit.finanzierungsdauerMonate),
    renovierungAktiv: renovierung > 0 || !!(exit.inputs && exit.inputs.renovierungAktiv),
    renovierungPauschale: renovierung,
    maklerkosten: n(exit.maklerkosten ?? 3.57),
    notarVerkauf: n(exit.notarVerkauf ?? 0.5),
    zielverkaufspreis: wf * vkM2,
    garageMitverkauf: garage > 0,
    garagenpreis: garage,
    mieteNettoProMonat: halte > 0 ? mietePa * (1 - bwk) * mietMonate / 12 / halte : 0,
  };
}

export function planProfil(plan) {
  const f = plan.finanzierung || {};
  return {
    ekVerfuegbar: f.ekVerfuegbar ?? 10_000_000,
    kkRahmen: n(f.kkRahmen),
    kkZins: n(f.kkZins),
    objektdarlehenAktiv: f.objektdarlehenAktiv !== false,
    objektdarlehenLtv: n(f.objektdarlehenLtv ?? 80),
    objektdarlehenZins: n(f.objektdarlehenZins ?? 6.0),
  };
}

export function rechnePlanZeile(plan, kaufpreis, exitId, sz, rechne = berechneFixFlip) {
  const exit = (plan.exits || []).find((x) => x.id === exitId);
  if (!exit) throw new Error(`Exit ${exitId} nicht im Plan`);
  const i = planInputs(plan, kaufpreis, exit, sz);
  const e = rechne(i, planProfil(plan));
  const wf = n(plan.objekt && plan.objekt.wohnflaeche);
  const mietePa = n(plan.objekt && plan.objekt.mieteNettoKaltPa);
  const vkM2 = szenarioWert(exit.preiseM2, sz);
  return {
    exit: exitId, szenario: sz, kaufpreis, vkM2,
    vk: e.verkaufserloesGesamt,
    faktorVK: mietePa > 0 ? wf * vkM2 / mietePa : null,
    grest: e.grunderwerbsteuer, notar: e.notarGrundbuch, maklerKauf: e.maklerKauf,
    bearbeitung: i.provisionenSonstige,
    bau: e.renovierungskosten + e.sanierungNetto + e.baunebenkosten + e.unvorhergesehenes,
    halten: e.hausgeldGesamt + e.objektkostenGesamt + e.sonderumlage,
    gik: e.gesamtinvestition, darlehen: e.objektdarlehen,
    ekBedarf: e.ekEinsatz + e.kkInanspruchnahme, finanzierbar: e.finanzierbar,
    zinsen: e.zinsenGesamt, vnk: e.verkaufsnebenkosten,
    mieteNetto: e.mieteGesamt, mieteMonat: i.mieteNettoProMonat,
    gewinn: e.bruttogewinn, gesamtkosten: e.gesamtkosten,
    marge: e.roiGesamt,
    umsatzrendite: e.gewinnmarge,
    ekRendite: e.ekEinsatz + e.kkInanspruchnahme > 0
      ? e.bruttogewinn / (e.ekEinsatz + e.kkInanspruchnahme) * 100 : null,
  };
}

// Höchster Kaufpreis, bei dem das Szenario die Ziel-Marge auf GIK noch erreicht
// (Bisektion wie maxKaufpreis() in kalkulation.mjs, auf 5.000 € abgerundet).
export function planMaxKaufpreis(plan, exitId, sz, zielMarge, rechne = berechneFixFlip) {
  const ref = n(plan.hauptkaufpreis) || n((plan.kaufpreise || [])[0]) || 1_000_000;
  let lo = 0, hi = Math.max(ref * 4, 1_000_000);
  if (rechnePlanZeile(plan, lo + 1000, exitId, sz, rechne).marge < zielMarge) return 0;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (rechnePlanZeile(plan, mid, exitId, sz, rechne).marge >= zielMarge) lo = mid; else hi = mid;
  }
  return Math.floor(lo / 5000) * 5000;
}

// Verkaufspreis €/m², bei dem das Ergebnis genau 0 ist (auf 10 € aufgerundet).
// Ohne Stellplatz-Erlös, wie breakEvenVK() in kalkulation.mjs — konservativ.
export function planBreakEvenM2(plan, exitId, kaufpreis, rechne = berechneFixFlip) {
  const exit = (plan.exits || []).find((x) => x.id === exitId);
  let lo = 0, hi = 50_000;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const test = { ...plan, exits: [{ ...exit, garage: 0, preiseM2: { real: mid } }] };
    if (rechnePlanZeile(test, kaufpreis, exitId, "real", rechne).gewinn >= 0) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 10) * 10;
}

export function rechnePlan(plan, rechne = berechneFixFlip) {
  const kaufpreise = (plan.kaufpreise || []).map(n).filter((x) => x > 0);
  const exits = plan.exits || [];
  const zeilen = [];
  for (const kp of kaufpreise)
    for (const ex of exits)
      for (const sz of SZENARIEN)
        zeilen.push(rechnePlanZeile(plan, kp, ex.id, sz, rechne));
  const zm = plan.zielMargen || [20, 15];
  const abbruch = {}, breakEven = {};
  for (const ex of exits) {
    abbruch[ex.id] = {};
    for (const sz of ["worst", "real"]) {
      abbruch[ex.id][sz] = {};
      for (const m of zm) abbruch[ex.id][sz][m] = planMaxKaufpreis(plan, ex.id, sz, m, rechne);
    }
    breakEven[ex.id] = {};
    for (const kp of kaufpreise) breakEven[ex.id][kp] = planBreakEvenM2(plan, ex.id, kp, rechne);
  }
  return { zeilen, abbruch, breakEven, zielMargen: zm };
}
