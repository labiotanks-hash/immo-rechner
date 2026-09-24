// Zahlen und Text wie in kalkulation_pdf.py: deutsche Tausenderpunkte, "T€".

// Rundet wie Pythons Formatierung in kalkulation_pdf.py: exakt ,5 geht zur geraden
// Ziffer (1.902,5 T€ → 1.902 T€), sonst kaufmännisch.
function rundeWiePython(v, d) {
  const f = 10 ** d;
  const x = v * f;
  const unten = Math.floor(x);
  if (x - unten === 0.5) return (unten % 2 === 0 ? unten : unten + 1) / f;
  return Math.round(x) / f;
}

export function num(v, d = 0) {
  if (v == null || !isFinite(v)) return "–";
  return rundeWiePython(Number(v), d).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function eur(v, tausend = false) {
  if (v == null || !isFinite(v)) return "–";
  return tausend ? `${num(v / 1000)} T€` : `${num(v)} €`;
}

export function mio(v, d = 2) {
  return `${num(v / 1e6, d)} Mio`;
}

export function pct(v, d = 1) {
  return `${num(v, d)} %`;
}

export function datumDE(iso = new Date().toISOString()) {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
}

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Auszeichnung in Texten, die Claude schreibt (vorher HTML-escaped, also sicher):
//   ==text==             gelb markiert = geschätzt / nicht belegt (nur interne Fassung)
//   **text**             fett
//   [[intern: text]]     erscheint nur in der internen Fassung
//   [[extern: text]]     erscheint nur in der externen Fassung (Bank)
export function markup(text, { extern = false } = {}) {
  let s = esc(text);
  s = s.replace(/\[\[(intern|extern):\s?([\s\S]*?)\]\]/g, (_, art, inhalt) =>
    (art === "extern") === extern ? inhalt : "\u0000");
  s = s.replace(/ ?\u0000(?=[,.;:)])/g, "").replace(/\u0000/g, "");
  s = s.replace(/==([^=\n][\s\S]*?)==/g, (_, inhalt) => (extern ? inhalt : `<mark>${inhalt}</mark>`));
  s = s.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, "<b>$1</b>");
  return s.replace(/ {2,}/g, " ").trim();
}
