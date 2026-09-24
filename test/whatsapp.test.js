import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhatsApp, istWhatsAppExport, gruppenname, chatAlsText, imZeitraum, medienart } from "../lib/whatsapp.js";

const IOS_DE = [
  "‎[24.09.26, 17:30:00] Ankauf Team: ‎Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.",
  "[24.09.26, 17:35:12] Partner A: ‎<Anhang: 00000012-AUDIO-2026-09-24-17-35-12.opus>",
  "[24.09.26, 17:45:03] Partner A: sagt meine KI",
  "sanierter Altbau 3.000–3.400 €/m²",
  "[24.09.26, 17:46:10] Partner A: ‎<Anhang: 00000015-Exposé aktuell.pdf>",
  "[25.09.26, 08:01:00] Partner B: ‎Bild weggelassen",
].join("\r\n");

const ANDROID_DE = [
  "24.09.26, 17:35 - Partner A: PTT-20260924-WA0003.opus (Datei angehängt)",
  "24.09.26, 17:45 - Partner A: Einstand 1.450 wäre klasse",
  "24.09.26, 17:46 - Partner A hat Partner B hinzugefügt",
  "24.09.2026, 17:47 - Partner B: Exposé.pdf (Datei angehängt)",
  "Seite 3 beachten",
].join("\n");

const IOS_EN = [
  "[9/24/26, 5:35:12 PM] Partner A: ‎<attached: 00000012-AUDIO-2026-09-24-17-35-12.opus>",
  "[9/24/26, 12:05:00 AM] Partner A: late note",
].join("\n");

test("iOS deutsch: Zeit, Absender, Anhänge, Folgezeilen", () => {
  const n = parseWhatsApp(IOS_DE);
  assert.equal(n.length, 5);
  assert.equal(n[1].zeit, "2026-09-24T17:35:12");
  assert.equal(n[1].absender, "Partner A");
  assert.equal(n[1].anhang, "00000012-AUDIO-2026-09-24-17-35-12.opus");
  assert.equal(n[2].text, "sagt meine KI\nsanierter Altbau 3.000–3.400 €/m²");
  assert.equal(n[3].anhang, "00000015-Exposé aktuell.pdf");
  assert.equal(n[4].weggelassen, true);
});

test("Android deutsch: Anhänge, Systemzeile, vierstelliges Jahr", () => {
  const n = parseWhatsApp(ANDROID_DE);
  assert.equal(n.length, 4);
  assert.equal(n[0].anhang, "PTT-20260924-WA0003.opus");
  assert.equal(n[0].zeit, "2026-09-24T17:35:00");
  assert.equal(n[2].system, true);
  assert.equal(n[3].anhang, "Exposé.pdf");
  assert.equal(n[3].text, "Seite 3 beachten");
  assert.equal(n[3].zeit.slice(0, 4), "2026");
});

test("iOS englisch: US-Datum und AM/PM", () => {
  const n = parseWhatsApp(IOS_EN);
  assert.equal(n[0].zeit, "2026-09-24T17:35:12");
  assert.equal(n[1].zeit, "2026-09-24T00:05:00");
});

test("Erkennung, Gruppenname, Zeitraum, Medienart", () => {
  assert.ok(istWhatsAppExport(IOS_DE));
  assert.ok(istWhatsAppExport(ANDROID_DE));
  assert.ok(!istWhatsAppExport("Kaufpreis 480.000 €\nWohnfläche 120 m²"));
  assert.equal(gruppenname("WhatsApp Chat - Ankauf Team.zip"), "Ankauf Team");
  assert.equal(gruppenname("WhatsApp Chat mit Ankauf Team.txt"), "Ankauf Team");
  const n = parseWhatsApp(IOS_DE);
  assert.equal(n.filter((x) => imZeitraum(x, { von: "2026-09-25" })).length, 1);
  assert.equal(medienart("PTT-20260924-WA0003.opus"), "audio");
  assert.equal(medienart("x.JPG"), "bild");
});

test("Chat als Text mit Transkript", () => {
  const n = parseWhatsApp(IOS_DE);
  const t = chatAlsText(n, {
    titel: "Ankauf Team",
    medien: { "00000012-AUDIO-2026-09-24-17-35-12.opus": "🎤 Sprachnachricht — Transkript: „Hallo“" },
  });
  assert.match(t, /\[24\.09\.2026 17:35\] Partner A: 🎤 Sprachnachricht — Transkript: „Hallo“/);
  assert.match(t, /Anhang „00000015-Exposé aktuell\.pdf“ \(nicht im Export enthalten\)/);
});
