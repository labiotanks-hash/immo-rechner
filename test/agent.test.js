// Ganzer Lauf gegen eine nachgebaute Claude-API: Quellen (WhatsApp-Text + PDF) →
// kalkulation_rechnen → dokumente_erstellen → Antwort. Prüft Anfrageform und Ergebnisdateien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { starteMock } from "./mock-claude.js";
import { REFERENZ_PLAN } from "./referenz.js";

const EXPOSE = {
  schema: "a2o.expose.v1", schema_version: 1,
  quelle: { firma: "Makler GmbH" },
  objekt: { titel: "MFH", adresse: { strasse: "Musterweg 1", plz: "70000", ort: "Musterstadt" }, wohnflaeche_m2: 372.5, vermietet: true },
  kaufdaten: { kaufpreis_eur: 2580000 },
  a2o_check: { lage_eur_m2: 2890, lage_quelle: "Portale" },
  extraktion: { fehlend: [], notizen: "" },
};
const DOKUMENT = {
  titel: "Musterweg 1, Musterstadt — Ankaufskalkulation", dateiname: "Musterweg_1",
  kurzantwort: { punkte: ["**Aufteilung trägt:** real 472 T€."] },
  markt: { zeilen: [{ markt: "Wohnungen", preis: "==2.500==", herleitung: "Portale" }] },
  pruefpunkte: { punkte: ["**Miete belegen.**"] },
  annahmen: "Darlehen 80 %.",
};

test("Analyse-Lauf mit Werkzeugen erzeugt alle Dokumente", async () => {
  const plan = { ...REFERENZ_PLAN, geschaetzt: ["preiseM2"] };
  const mock = await starteMock([
    { stop: "tool_use", bloecke: [
      { type: "text", text: "Ich rechne zuerst die Szenarien." },
      { type: "tool_use", id: "toolu_1", name: "kalkulation_rechnen", input: { plan } },
    ] },
    { stop: "tool_use", bloecke: [
      { type: "tool_use", id: "toolu_2", name: "dokumente_erstellen", input: { expose: EXPOSE, plan, dokument: DOKUMENT } },
    ] },
    { stop: "end_turn", bloecke: [{ type: "text", text: "Aufteilung trägt, Globalverkauf knapp." }] },
    { stop: "end_turn", bloecke: [{ type: "text", text: "Mit 38.000 € Miete sinkt das Ergebnis." }] },
  ]);
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ankauf-"));
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "test";

  const { neuesObjekt, legeQuelleAb, aendereMeta, ladeMeta, objektPfad, kanal } = await import("../lib/store.js");
  const { neueQuelle } = await import("../lib/ingest.js");
  const { starteLauf } = await import("../lib/agent.js");

  const meta = await neuesObjekt("Musterweg 1", "Was ist der Einstand wert?");
  const chat = "[24.09.26, 17:35:12] Partner: Miete 42.500 netto\n[24.09.26, 17:36:00] Partner: <Anhang: Expose.pdf>\n";
  const q1 = neueQuelle(await legeQuelleAb(meta.id, "WhatsApp Chat - Team.txt", Buffer.from(chat)));
  const q2 = neueQuelle(await legeQuelleAb(meta.id, "Expose.pdf", Buffer.from("%PDF-1.4 test")));
  await aendereMeta(meta.id, (m) => { m.quellen.push(q1, q2); });

  const fertig = new Promise((resolve) => kanal(meta.id).emitter.on("e", (e) => { if (e.typ === "fertig" || e.typ === "fehler") resolve(e); }));
  await starteLauf(meta.id);
  const ende = await fertig;
  assert.equal(ende.typ, "fertig", ende.text);
  assert.equal(ende.text, "Aufteilung trägt, Globalverkauf knapp.");

  // Anfrageform
  assert.equal(mock.anfragen.length, 3);
  const erste = mock.anfragen[0];
  assert.match(erste.url, /\/v1\/messages/);
  assert.equal(erste.body.model, "claude-opus-5");
  assert.deepEqual(erste.body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(erste.body.fallbacks, "default");
  assert.match(erste.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.ok(erste.body.tools.some((t) => t.type === "web_search_20260209"));
  const inhalt = erste.body.messages[0].content;
  assert.ok(inhalt.some((b) => b.type === "document" && b.source.file_id === "file_1"), "PDF als file_id");
  assert.ok(inhalt.some((b) => b.type === "text" && b.text.includes("Miete 42.500 netto")), "WhatsApp-Text");
  // Werkzeug-Ergebnis der Kalkulation geht zurück an Claude
  const r1 = mock.anfragen[1].body.messages.at(-1).content[0];
  assert.equal(r1.type, "tool_result");
  const kalk = JSON.parse(r1.content);
  const bReal = kalk.matrix.find((z) => z.kaufpreis === 600000 && z.exit === "B" && z.szenario === "real");
  assert.equal(bReal.ergebnis_T, 236); // Referenzfall × 0,5

  // Dateien
  const m = await ladeMeta(meta.id);
  assert.equal(m.status, "fertig");
  const namen = m.dokumente.map((d) => d.datei);
  for (const n of ["Ankaufskalkulation_Musterweg_1_gelb.html", "Ankaufskalkulation_Musterweg_1_ohne_Markierung.html"]) assert.ok(namen.includes(n), n);
  assert.equal(namen.filter((n) => n.startsWith("FixFlipPro_Rechner_")).length, 2);
  for (const n of namen) assert.ok(existsSync(objektPfad(meta.id, n)), n);
  const extern = readFileSync(objektPfad(meta.id, "Ankaufskalkulation_Musterweg_1_ohne_Markierung.html"), "utf8");
  assert.ok(!extern.includes("<mark>"), "externe Fassung ohne Marker");
  assert.ok(existsSync(objektPfad(meta.id, "_fixflip", "ergebnis.json")));
  assert.ok(existsSync(objektPfad(meta.id, "Quellen", "Quellen-Uebersicht.md")));

  // Rückfrage im selben Verlauf, mit einer neu hochgeladenen Notiz
  const q3 = neueQuelle(await legeQuelleAb(meta.id, "Notiz.txt", Buffer.from("Mietliste: 38.000 € p. a.")));
  await aendereMeta(meta.id, (m) => { m.quellen.push(q3); });
  const fertig2 = new Promise((resolve) => kanal(meta.id).emitter.on("e", (e) => { if (e.typ === "fertig" || e.typ === "fehler") resolve(e); }));
  await starteLauf(meta.id, { nachricht: "Was, wenn die Miete nur 38.000 € beträgt?" });
  const ende2 = await fertig2;
  mock.schliessen();
  assert.equal(ende2.text, "Mit 38.000 € Miete sinkt das Ergebnis.");
  const folge = mock.anfragen[3].body.messages;
  assert.equal(folge.length, 7, "Verlauf: Auftrag, 2× Werkzeug hin/zurück, Antwort, Rückfrage");
  const letzte = folge.at(-1).content;
  assert.equal(letzte[0].text, "Was, wenn die Miete nur 38.000 € beträgt?");
  assert.ok(letzte.some((b) => b.type === "text" && b.text.includes("Mietliste: 38.000")), "neue Quelle geht mit");
  assert.ok(!letzte.some((b) => b.type === "document"), "alte Quellen nicht doppelt");
  assert.equal((await ladeMeta(meta.id)).laeufe.length, 2);
});
