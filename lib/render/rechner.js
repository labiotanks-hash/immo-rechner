// FixFlipPro-Rechner je Exit als Standalone-HTML.
//
// Weg 1 (identisch mit dem Mac-Workflow): FIXFLIP_DIR enthält eure echte
//   fixflip-pro/index.html + standalone/build.py → Aufruf wie „Rechner erstellen.command“:
//   python3 build.py expose.json --inputs inputs_X.json --profil profil.json --ziel …
// Weg 2 (Rückfall): eingebaute Vorlage vorlagen/rechner.html mit demselben Rechenkern
//   (lib/fixflip.js), Kompakt-Mappe, Bankvorlage und Verhandlungsgrundlage aus build.py.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const VORLAGE = join(HIER, "..", "..", "vorlagen", "rechner.html");
const ENGINE = join(HIER, "..", "fixflip.js");

// </script> in Freitextfeldern darf den Script-Block nicht sprengen.
function sicheresJson(daten) {
  return JSON.stringify(daten).replace(/</g, "\\u003c");
}

export async function rechnerEingebaut({ expose, inputs, profil, titel, exitName, bearbeitungsgebuehrProzent }) {
  const [vorlage, engine] = await Promise.all([readFile(VORLAGE, "utf8"), readFile(ENGINE, "utf8")]);
  const engineInline = engine.replace(/^export /gm, "").replace(/<\/script/gi, "<\\/script");
  const daten = {
    expose, inputs, profil, titel, exitName, bearbeitungsgebuehrProzent,
    datum: new Date().toLocaleDateString("de-DE"),
  };
  const titelHtml = String(titel || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return vorlage
    .replace("__TITEL__", () => titelHtml)
    .replace("__ENGINE__", () => engineInline)
    .replace("__DATUM__", () => new Date().toISOString().slice(0, 10))
    .replace("__DATEN_JSON__", () => sicheresJson(daten));
}

export function originalBuildVorhanden() {
  return Boolean(config.fixflipDir)
    && existsSync(join(config.fixflipDir, "index.html"))
    && existsSync(join(config.fixflipDir, "standalone", "build.py"));
}

// Ruft eure build.py unverändert auf. Gibt false zurück, wenn sie die Optionen
// --inputs/--profil (noch) nicht kennt oder scheitert — dann greift die Vorlage.
export function rechnerOriginal({ exposePfad, inputsPfad, profilPfad, ziel }) {
  const build = join(config.fixflipDir, "standalone", "build.py");
  return new Promise((resolve) => {
    execFile("python3", [build, exposePfad, "--inputs", inputsPfad, "--profil", profilPfad, "--ziel", ziel],
      { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err || !existsSync(ziel)) resolve({ ok: false, meldung: (stderr || err?.message || "").slice(0, 400) });
        else resolve({ ok: true, meldung: stdout.trim() });
      });
  });
}
