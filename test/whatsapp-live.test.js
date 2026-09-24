import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import JSZip from "jszip";
import { baueWaStore, GRUPPE } from "./wa-fixture.js";

const wa = mkdtempSync(join(tmpdir(), "wa-store-"));
baueWaStore(wa);
process.env.WA_STORE = wa;
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "wa-daten-"));

let aufrufe = 0;
const whisper = http.createServer((req, res) => { aufrufe++; req.resume(); req.on("end", () => res.end(JSON.stringify({ text: "Das Dach ist neu, Heizung von 2019." }))); });
await new Promise((r) => whisper.listen(0, r));
process.env.TRANSCRIBE_URL = `http://127.0.0.1:${whisper.address().port}/v1/audio/transcriptions`;

const live = await import("../lib/whatsapp-live.js");
const { parseWhatsApp } = await import("../lib/whatsapp.js");
const { transkribiere } = await import("../lib/transcribe.js");

test("Status und Gruppen aus dem Bridge-Speicher", async () => {
  const s = await live.waStatus();
  assert.equal(s.zustand, "verbunden");
  assert.equal(s.gruppen.length, 1);
  assert.equal(s.gruppen[0].name, "Objekte Immo");
  assert.equal(s.gruppen[0].anzahl, 7);
  assert.equal(s.qr, false);
});

test("Zeitraum gilt in Berliner Kalendertagen", async () => {
  const n = await live.waNachrichten({ chat: GRUPPE, von: "2026-09-21", bis: "2026-09-22" });
  assert.deepEqual(n.map((x) => x.id), ["M1", "M2", "M3", "M4", "M5", "M6"]); // M1: 01:30 Uhr am 21.
  assert.equal(n.find((x) => x.id === "M3").absender, "+4917000000002");
  assert.equal(n.find((x) => x.id === "M6").datei, null);
});

test("Export ist ein WhatsApp-Export, den der Parser versteht", async () => {
  const exp = await live.exportiereAlsZip({ chat: GRUPPE, ids: ["M5", "M1", "M2", "M3", "M4", "M6"], gruppe: "Objekte Immo" });
  assert.equal(exp.name, "WhatsApp Chat - Objekte Immo (2026-09-21 bis 2026-09-22).zip");
  assert.deepEqual([exp.nachrichten, exp.medien, exp.fehlend], [6, 3, 1]);
  const zip = await JSZip.loadAsync(exp.puffer);
  const chat = await zip.file("_chat.txt").async("string");
  const n = parseWhatsApp(chat);
  assert.equal(n[0].zeit, "2026-09-21T01:30:00");
  assert.equal(n[0].absender, "Makler Muster");
  assert.equal(n[1].anhang, "00000001-Exposé MFH.pdf");
  assert.ok(zip.file("00000001-Exposé MFH.pdf"));
  assert.equal(n[2].text, "Exposé anbei");
  assert.match(n[3].anhang, /^00000002-AUDIO-2026-09-21-11-15-00\.opus$/);
  const m4 = n.find((x) => x.text.startsWith("Zeile eins"));
  assert.equal(m4.absender, "Partner Zwei");
  assert.match(m4.text, /sieht aus wie ein Kopf/); // nicht als eigene Nachricht erkannt
  assert.ok(n.some((x) => x.weggelassen), "fehlende Datei als weggelassen");
  assert.equal(n.length, 8);
});

test("Pfade außerhalb von medien/ werden verweigert", () => {
  assert.equal(live.medienPfad("../nachrichten.db"), null);
  assert.equal(live.medienPfad("medien/../status.json"), null);
  assert.ok(live.medienPfad("medien/120363000000000001/x.jpg"));
});

test("Transkript wird zwischengespeichert und in der Auswahl angezeigt", async () => {
  const p = live.medienPfad("medien/120363000000000001/20260921-091500_M3.opus");
  assert.equal(await transkribiere(p), "Das Dach ist neu, Heizung von 2019.");
  assert.equal(await transkribiere(p), "Das Dach ist neu, Heizung von 2019.");
  assert.equal(aufrufe, 1);
  const n = await live.waNachrichten({ chat: GRUPPE, von: "2026-09-21", bis: "2026-09-21" });
  assert.equal(n.find((x) => x.id === "M3").transkript, "Das Dach ist neu, Heizung von 2019.");
  whisper.close();
  assert.ok(existsSync(join(process.env.DATA_DIR, "transkripte")));
});
