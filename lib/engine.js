// Welche Rechenfunktion gilt? Liegt FixFlip Pro auf dem Server (FIXFLIP_DIR mit
// index.html), wird berechneFixFlip() zur Laufzeit aus der echten index.html
// gezogen — derselbe Weg wie kalkulation.mjs, also kein Code-Fork. Sonst gilt der
// Port aus lib/fixflip.js.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { berechneFixFlip as port, DEFAULT_INPUTS, DEFAULT_PROFIL } from "./fixflip.js";
import { config } from "./config.js";

function extrahiere(html) {
  const start = html.indexOf("function berechneFixFlip(");
  const ende = html.indexOf("\n}\n", start);
  if (start < 0 || ende < 0) throw new Error("berechneFixFlip nicht in index.html gefunden");
  let kfw = {};
  const m = html.match(/const KFW_FOERDERUNG\s*=\s*(\{[\s\S]*?\n\});/);
  if (m) {
    try { kfw = new Function(`return (${m[1]});`)(); } catch { kfw = {}; }
  }
  // Die App hat PROFIL als Default-Parameter; wir übergeben das Profil immer explizit.
  const fn = new Function("KFW_FOERDERUNG", "PROFIL",
    html.slice(start, ende + 2) + "\nreturn berechneFixFlip;")(kfw, {});
  return fn;
}

let geladen = null;

export function engine() {
  if (geladen) return geladen;
  const index = config.fixflipDir && join(config.fixflipDir, "index.html");
  if (index && existsSync(index)) {
    try {
      const original = extrahiere(readFileSync(index, "utf8"));
      // Rauchtest: braucht die Funktion weitere Globals aus index.html, fällt das hier auf
      const probe = original({ ...DEFAULT_INPUTS, kaufpreis: 300000, wohnflaeche: 80, zielverkaufspreis: 400000 }, DEFAULT_PROFIL);
      if (typeof probe?.bruttogewinn !== "number") throw new Error("liefert kein bruttogewinn");
      geladen = { rechne: original, quelle: "original", pfad: index };
      return geladen;
    } catch (err) {
      console.warn(`[engine] ${index}: ${err.message} — nutze den eingebauten Port`);
    }
  }
  geladen = { rechne: port, quelle: "port", pfad: null };
  return geladen;
}
