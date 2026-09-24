// Der Port muss exakt die Zahlen der ORIGINALEN berechneFixFlip() liefern.
// Referenzfall und Skalierung: siehe test/referenz.js — erwartet werden die Originalbeträge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berechneFixFlip, rechnePlan, rechnePlanZeile, verkaufspreisFuerMarge, mitBearbeitungsgebuehr,
} from "../lib/fixflip.js";
import { REFERENZ_PLAN } from "./referenz.js";

const rund = (x) => Math.round(x);
const eins = (x) => Math.round(x * 10) / 10;

test("Rechenweg beim Hauptkaufpreis, Szenario real (beide Exits)", () => {
  const a = rechnePlanZeile(REFERENZ_PLAN, 600000, "A", "real");
  const b = rechnePlanZeile(REFERENZ_PLAN, 600000, "B", "real");
  assert.equal(rund(a.grest), 30000);
  assert.equal(rund(a.notar), 12000);
  assert.equal(rund(a.bearbeitung), 7200);
  assert.equal(rund(a.gik), 649200);
  assert.equal(rund(b.gik), 681700);
  assert.equal(rund(a.darlehen), 480000);
  assert.equal(rund(a.ekBedarf), 169200);
  assert.equal(rund(b.ekBedarf), 201700);
  assert.equal(rund(a.vk), 745000);
  assert.equal(rund(b.vk), 951250);
  assert.equal(rund(a.mieteNetto), 25500);
  assert.equal(rund(b.mieteNetto), 34000);
  assert.equal(rund(a.zinsen), 21600);
  assert.equal(rund(b.zinsen), 28800);
  assert.equal(rund(a.vnk), 3725);
  assert.equal(rund(b.vnk), 38716);
  assert.equal(rund(a.gewinn), 95975);
  assert.equal(rund(b.gewinn), 236034);
  assert.equal(eins(a.marge), 14.2);
  assert.equal(eins(b.marge), 31.5);
  assert.equal(eins(a.umsatzrendite), 12.5);
  assert.equal(eins(b.umsatzrendite), 24.0);
  assert.equal(rund(a.ekRendite), 57);
  assert.equal(rund(b.ekRendite), 117);
  assert.equal(eins(a.faktorVK), 17.5);
});

test("Ergebnismatrix beider Kaufpreise", () => {
  const erg = rechnePlan(REFERENZ_PLAN);
  const z = (kp, ex, sz) => erg.zeilen.find((r) => r.kaufpreis === kp && r.exit === ex && r.szenario === sz);
  const gewinne = (kp, ex) => ["worst", "real", "best"].map((s) => rund(z(kp, ex, s).gewinn));
  const margen = (kp, ex) => ["worst", "real", "best"].map((s) => eins(z(kp, ex, s).marge));
  assert.deepEqual(gewinne(550000, "A"), [77748, 151875, 226003]);
  assert.deepEqual(margen(550000, "A"), [12.6, 24.6, 36.5]);
  assert.deepEqual(gewinne(550000, "B"), [166146, 292534, 435470]);
  assert.deepEqual(margen(550000, "B"), [24.2, 42.2, 62.3]);
  assert.equal(rund(z(550000, "A", "real").ekBedarf), 155100);
  assert.equal(rund(z(550000, "B", "real").ekBedarf), 187600);
  assert.deepEqual(gewinne(600000, "A"), [21848, 95975, 170103]);
  assert.deepEqual(margen(600000, "A"), [3.2, 14.2, 25.2]);
  assert.deepEqual(gewinne(600000, "B"), [109646, 236034, 378970]);
  assert.deepEqual(margen(600000, "B"), [14.7, 31.5, 50.2]);
});

test("Abbruchkriterium und Break-even", () => {
  const erg = rechnePlan(REFERENZ_PLAN);
  assert.deepEqual(erg.abbruch.A, { worst: { 15: 535000, 20: 515000 }, real: { 15: 595000, 20: 570000 } });
  assert.deepEqual(erg.abbruch.B, { worst: { 15: 595000, 20: 570000 }, real: { 15: 695000, 20: 660000 } });
  assert.equal(erg.breakEven.A[600000], 1750);
  assert.equal(erg.breakEven.B[600000], 1900);
  assert.equal(erg.breakEven.A[550000], 1600);
  assert.equal(erg.breakEven.B[550000], 1740);
});

test("Verkaufspreis für Zielmarge ist algebraisch exakt", () => {
  const inp = {
    kaufpreis: 300000, wohnflaeche: 80, maklerKaufSatz: 3.57, renovierungAktiv: true,
    renovierungPauschale: 40000, haltedauerMonate: 8, finanzierungsdauerMonate: 8,
    hausgeldProMonat: 300, mieteNettoProMonat: 0,
  };
  const profil = { ekVerfuegbar: 100000, kkRahmen: 50000, kkZins: 9, objektdarlehenLtv: 80, objektdarlehenZins: 5 };
  for (const m of [0, 15, 20]) {
    const vk = verkaufspreisFuerMarge(inp, profil, m);
    const e = berechneFixFlip({ ...inp, zielverkaufspreis: vk }, profil);
    assert.ok(Math.abs(e.roiGesamt - m) < 1e-9, `Marge ${m}: ${e.roiGesamt}`);
  }
});

test("Kontokorrent springt ein, Deckungslücke wird ausgewiesen", () => {
  const e = berechneFixFlip(
    { kaufpreis: 400000, wohnflaeche: 100, haltedauerMonate: 12, finanzierungsdauerMonate: 12, zielverkaufspreis: 600000 },
    { ekVerfuegbar: 50000, kkRahmen: 20000, kkZins: 10, objektdarlehenLtv: 80, objektdarlehenZins: 5 });
  assert.equal(Math.round(e.ekEinsatz), 50000);
  assert.equal(Math.round(e.kkInanspruchnahme), 20000);
  assert.ok(!e.finanzierbar);
  assert.equal(Math.round(e.zinsenKK), 2000);
});

test("Bearbeitungsgebühr-Wrapper wie im Standalone", () => {
  const rechne = mitBearbeitungsgebuehr(berechneFixFlip, 0.015);
  const i = { kaufpreis: 600000, wohnflaeche: 372.5, maklerKaufSatz: 0, haltedauerMonate: 9,
    finanzierungsdauerMonate: 9, zielverkaufspreis: 745000, maklerkosten: 0, notarVerkauf: 0.5,
    mieteNettoProMonat: 2833.335 };
  const e = rechne(i, { ekVerfuegbar: 450000, objektdarlehenLtv: 80, objektdarlehenZins: 6 });
  assert.equal(Math.round(e.bearbeitungsgebuehr), 7200);
  // gleiches Ergebnis wie mit der Gebühr als Provision in der GIK (Rechenweg-Test oben)
  assert.equal(Math.round(e.bruttogewinn), 95975);
});
