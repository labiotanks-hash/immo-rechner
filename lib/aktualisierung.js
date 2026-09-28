// Update auf Befehl: Ein Admin klickt „Nach Updates suchen“ → die App legt eine Auftragsdatei in
// den mit dem Server geteilten Ordner (/auftrag). Auf dem Server wartet eine systemd-Path-Unit auf
// genau diese Datei und startet deploy/aktualisieren.sh. Das Skript schreibt sein Ergebnis nach
// /auftrag/status.json zurück. Die App selbst kann auf dem Server nichts ausführen.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

export const aktualisierungMoeglich = () => Boolean(config.auftragDir) && existsSync(config.auftragDir);

export async function aktualisierungStatus() {
  if (!aktualisierungMoeglich()) return { moeglich: false };
  let letzter = null;
  try { letzter = JSON.parse(await readFile(join(config.auftragDir, "status.json"), "utf8")); } catch {}
  return {
    moeglich: true,
    wartet: existsSync(join(config.auftragDir, "aktualisieren")),
    letzter, // { zeit, ergebnis, meldung, stand }
    stand: process.env.STAND || null,
  };
}

export async function aktualisierungAnfordern(von) {
  if (!aktualisierungMoeglich()) throw Object.assign(new Error("Auf diesem Server ist die Aktualisierung nicht eingerichtet."), { status: 400 });
  await writeFile(join(config.auftragDir, "aktualisieren"), JSON.stringify({ von, zeit: new Date().toISOString() }));
  return aktualisierungStatus();
}
