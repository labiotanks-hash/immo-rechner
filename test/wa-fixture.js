// Nachgebauter Bridge-Speicher (gleiches Schema wie bridge/main.go) für Tests
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GRUPPE = "120363000000000001@g.us";

export function baueWaStore(dir) {
  mkdirSync(join(dir, "medien", "120363000000000001"), { recursive: true });
  const db = new DatabaseSync(join(dir, "nachrichten.db"));
  db.exec(`
    CREATE TABLE gruppen (jid TEXT PRIMARY KEY, name TEXT, aktualisiert INTEGER);
    CREATE TABLE nachrichten (
      id TEXT NOT NULL, chat TEXT NOT NULL, absender TEXT, absender_name TEXT, von_mir INTEGER DEFAULT 0,
      zeit INTEGER NOT NULL, text TEXT, art TEXT, dateiname TEXT, mime TEXT, groesse INTEGER,
      datei TEXT, datei_status TEXT, versuche INTEGER DEFAULT 0, medien_proto BLOB, bearbeitet INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat));`);
  db.prepare("INSERT INTO gruppen VALUES (?,?,?)").run(GRUPPE, "Objekte Immo", 0);
  const ins = db.prepare(`INSERT INTO nachrichten (id, chat, absender, absender_name, zeit, text, art, dateiname, mime, groesse, datei, datei_status, bearbeitet)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const t = (iso) => Math.floor(Date.parse(iso) / 1000);
  const datei = (name, inhalt) => { writeFileSync(join(dir, "medien", "120363000000000001", name), inhalt); return `medien/120363000000000001/${name}`; };
  // 23:30 UTC am 20.09. = 01:30 Berliner Zeit am 21.09.
  ins.run("M1", GRUPPE, "4917000000001", "Makler Muster", t("2026-09-20T23:30:00Z"), "Neues Objekt: MFH mit 8 WE, KP 950.000", "text", null, null, null, null, null, 0);
  ins.run("M2", GRUPPE, "4917000000001", "Makler Muster", t("2026-09-21T08:00:05Z"), "Exposé anbei", "dokument", "Exposé MFH.pdf", "application/pdf", 9, datei("20260921-080005_M2.pdf", "%PDF-1.4\n"), "ok", 0);
  ins.run("M3", GRUPPE, "4917000000002", "", t("2026-09-21T09:15:00Z"), "", "audio", null, "audio/ogg; codecs=opus", 5, datei("20260921-091500_M3.opus", "OggS1"), "ok", 0);
  ins.run("M4", GRUPPE, "4917000000002", "Partner: Zwei", t("2026-09-21T09:20:00Z"), "Zeile eins\n21.09.26, 10:00 - sieht aus wie ein Kopf", "text", null, null, null, null, null, 1);
  ins.run("M5", GRUPPE, "4917000000001", "Makler Muster", t("2026-09-22T12:00:00Z"), "", "bild", null, "image/jpeg", 4, datei("20260922-120000_M5.jpg", "JPEG"), "ok", 0);
  ins.run("M6", GRUPPE, "4917000000001", "Makler Muster", t("2026-09-22T12:01:00Z"), "Grundriss folgt", "bild", null, "image/jpeg", null, null, "fehler", 0);
  ins.run("M7", GRUPPE, "4917000000001", "Makler Muster", t("2026-09-25T12:00:00Z"), "anderes Objekt", "text", null, null, null, null, null, 0);
  db.close();
  writeFileSync(join(dir, "status.json"), JSON.stringify({ zustand: "verbunden", nummer: "4971000000", gruppen: [{ jid: GRUPPE, name: "Objekte Immo" }] }));
}
