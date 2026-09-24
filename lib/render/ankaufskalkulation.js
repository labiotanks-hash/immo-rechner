// Ankaufskalkulation als A4-HTML — Layout und CSS 1:1 aus kalkulation_pdf.py,
// verallgemeinert auf beliebig viele Kaufpreise und Exits.
//
// Zwei Fassungen aus demselben Rechenstand:
//   intern  (…_gelb):             gelb markiert, was geschätzt oder nicht belegt ist,
//                                  mit Methode, Quellen und internen Verweisen
//   extern  (…_ohne_Markierung):  für die Bank — ohne Marker, ohne interne Verweise,
//                                  mit Absenderzeile
import { eur, num, esc, markup, datumDE } from "./format.js";
import { SZENARIEN } from "../fixflip.js";

const CSS = `
@page { size: A4; margin: 11mm 12mm 10mm 12mm; }
* { box-sizing: border-box; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font: 9.2pt/1.38 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1d232a; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 2px; letter-spacing: -.2px; }
.sub { color: #5b6570; font-size: 9pt; margin-bottom: 10px; }
h2 { font-size: 11pt; margin: 11px 0 4px; padding-bottom: 3px; border-bottom: 2px solid #1d4e6b; color: #1d4e6b; }
h3 { font-size: 9.6pt; margin: 9px 0 3px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-weight: 600; font-size: 8.3pt; color: #5b6570; border-bottom: 1px solid #c9d1d8; padding: 3px 5px; }
td { padding: 2.2px 5px; border-bottom: 1px solid #edf0f2; vertical-align: top; }
.r { text-align: right; white-space: nowrap; }
.n { color: #6b7580; font-size: 8pt; }
td.exit { font-weight: 600; width: 27%; background: #f6f8f9; }
tr.real td { background: #eef5f9; }
tr.sum td { font-weight: 600; border-top: 1px solid #9aa6b1; }
tr.sub td { color: #5b6570; font-size: 8.4pt; }
tr.total td { font-weight: 700; font-size: 10pt; border-top: 2px solid #1d4e6b; background: #eef5f9; }
.pill { padding: 1px 6px; border-radius: 8px; font-weight: 600; font-size: 8.2pt; }
.gruen { background: #d9f0e0; color: #17622f; } .gelb { background: #fbefcf; color: #7a5600; } .rot { background: #f8dcdc; color: #8f1d1d; }
.box { border: 1.5px solid #1d4e6b; border-radius: 6px; padding: 8px 11px; background: #f5f9fb; }
.box ol { margin: 3px 0 0 16px; padding: 0; } .box li { margin: 2px 0; }
.kv td:first-child { color: #5b6570; width: 50%; }
.kv td.kh { color: #1d232a; font-weight: 600; padding-top: 5px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
ol.pp { margin: 3px 0 0 16px; padding: 0; } ol.pp li { margin: 1px 0; }
.fuss { margin-top: 6px; color: #6b7580; font-size: 7.3pt; line-height: 1.35; }
.brk { break-before: page; }
mark { background: linear-gradient(transparent 10%, #fff176 10%, #fff176 90%, transparent 90%); color: inherit; padding: 0 2px; }
@media screen { body { max-width: 190mm; margin: 12mm auto; padding: 0 12px; } }
`;

function ampelKlasse(marge) {
  return marge < 15 ? "rot" : (marge < 20 ? "gelb" : "gruen");
}

export function ampelWort(marge) {
  return marge < 15 ? "rot" : (marge < 20 ? "gelb" : "grün");
}

function kpKurz(kp) {
  return kp % 100000 === 0 ? `${num(kp / 1e6, kp % 1e6 === 0 ? 0 : 1)} Mio` : eur(kp);
}

export function renderAnkaufskalkulation({ plan, ergebnis, doc, stand, extern = false, absender, rechenquelle }) {
  const g = (x) => (extern ? x : `<mark>${x}</mark>`);
  const m = (t) => markup(t, { extern });
  const x = (intern, ext = "") => (extern ? ext : intern);
  const geschaetzt = new Set(plan.geschaetzt || []);
  const gs = (key, text) => (geschaetzt.has(key) ? g(text) : text);

  const o = plan.objekt || {};
  const f = plan.finanzierung || {};
  const wf = Number(o.wohnflaeche) || 0;
  const miete = Number(o.mieteNettoKaltPa) || 0;
  const exits = plan.exits || [];
  const kaufpreise = plan.kaufpreise || [];
  const hkp = plan.hauptkaufpreis || kaufpreise[kaufpreise.length - 1];
  const zeile = (kp, ex, sz) => ergebnis.zeilen.find((z) => z.kaufpreis === kp && z.exit === ex && z.szenario === sz);
  const exName = (ex) => `${esc(ex.name)} · ${num(ex.haltedauerMonate)} Mon.`;
  const exKurz = (ex) => esc(ex.kurz ? ex.kurz.replace(/^[A-Z]\s+/, "") : ex.name);

  // ── 2 · Ergebnismatrix je Kaufpreis ──
  function matrix(kp) {
    const rows = [];
    for (const ex of exits) {
      SZENARIEN.forEach((sz, i) => {
        const z = zeile(kp, ex.id, sz);
        if (!z) return;
        const first = i === 0 ? `<td rowspan="3" class="exit">${exName(ex)}</td>` : "";
        rows.push(`<tr class='${sz === "real" ? "real" : ""}'>${first}<td>${sz}</td>`
          + `<td class='r'>${gs("preiseM2", num(z.vkM2))}</td><td class='r'>${z.faktorVK == null ? "–" : num(z.faktorVK, 1)}</td>`
          + `<td class='r'>${eur(z.vk, true)}</td>`
          + `<td class='r'><b>${eur(z.gewinn, true)}</b></td>`
          + `<td class='r'><span class='pill ${ampelKlasse(z.marge)}'>${num(z.marge, 1)} %</span></td>`
          + `<td class='r'>${eur(z.ekBedarf, true)}</td></tr>`);
      });
    }
    const kopf = [`Kaufpreis ${gs("kaufpreis", eur(kp))}`];
    if (wf) kopf.push(`${num(kp / wf)} €/m²`);
    if (miete) kopf.push(`Faktor ${num(kp / miete, 1)}`);
    return `<h3>${kopf.join(" &nbsp;·&nbsp; ")}</h3>`
      + "<table class='m'><tr><th>Exit</th><th>Szenario</th><th class='r'>VK €/m²</th><th class='r'>Faktor VK</th>"
      + "<th class='r'>Erlös</th><th class='r'>Ergebnis v. St.</th><th class='r'>Marge GIK</th><th class='r'>EK-Bedarf</th></tr>"
      + rows.join("") + "</table>";
  }

  // ── 3 · Rechenweg beim Hauptkaufpreis, Szenario real ──
  function rechenweg(kp) {
    const sp = exits.map((ex) => ({ ex, z: zeile(kp, ex.id, "real") })).filter((s) => s.z);
    const notiz = doc.rechenwegNotizen || {};
    const b = plan.basis || {};
    const proExit = (fn) => sp.map(({ ex, z }) => `${esc(ex.id)}: ${fn(ex, z)}`).join(" · ");
    const L = [];
    const add = (titel, key, werte, opts = {}) => L.push({ titel, key, werte, ...opts });

    add("Kaufpreis", "kaufpreis", sp.map((s) => s.z.kaufpreis), { mark: geschaetzt.has("kaufpreis") });
    add(`+ Grunderwerbsteuer ${num(b.grunderwerbsteuerSatz ?? 5, 1)} %`, "grunderwerbsteuer", sp.map((s) => s.z.grest));
    add(`+ Notar / Grundbuch ${gs("notarGrundbuchSatz", `${num(b.notarGrundbuchSatz ?? 2, 1)} %`)}`, "notar", sp.map((s) => s.z.notar));
    add(`+ Makler Kauf${b.maklerKaufSatz ? ` ${gs("maklerKaufSatz", `${num(b.maklerKaufSatz, 2)} %`)}` : ""}`, "makler_kauf",
      sp.map((s) => s.z.maklerKauf), { mark: geschaetzt.has("maklerKaufSatz") && !b.maklerKaufSatz });
    if (sp.some((s) => s.z.bearbeitung))
      add(`+ Bearbeitung ${gs("bearbeitungsgebuehrProzent", `${num(f.bearbeitungsgebuehrProzent ?? 1.5, 1)} %`)} vom Darlehen`, "bearbeitung", sp.map((s) => s.z.bearbeitung));
    if (sp.some((s) => s.z.bau))
      add(`+ ${esc(plan.massnahmeLabel || "Maßnahme / Renovierung")}`, "massnahme", sp.map((s) => s.z.bau),
        { markWenn: (i) => geschaetzt.has("renovierungPauschale") && sp[i].z.bau > 0 });
    if (sp.some((s) => s.z.halten)) add("+ Hausgeld / Objektkosten", "halten", sp.map((s) => s.z.halten));
    add("= Gesamtinvestition (GIK)", null, sp.map((s) => s.z.gik), { cls: "sum" });
    add(`davon Darlehen ${gs("objektdarlehenLtv", `${num(f.objektdarlehenLtv ?? 80)} %`)} vom KP`, null, sp.map((s) => s.z.darlehen), { cls: "sub" });
    add(f.kkRahmen ? "davon Eigenkapital + Kontokorrent" : "davon Eigenkapital", null, sp.map((s) => s.z.ekBedarf), { cls: "sub" });
    add("Verkaufserlös", "verkaufserloes", sp.map((s) => s.z.vk), {
      auto: proExit((ex, z) => `${gs("preiseM2", `${num(z.vkM2)} €/m²`)}${z.vk - z.vkM2 * wf > 1 ? ` + ${gs("garage", eur(z.vk - z.vkM2 * wf, true))} Stellplätze` : ""}`),
    });
    if (sp.some((s) => s.z.mieteNetto))
      add(`+ Miete netto (${gs("bewirtschaftungProzent", `− ${num(o.bewirtschaftungProzent ?? 0)} % BWK`)})`, "miete", sp.map((s) => s.z.mieteNetto), {
        mark: geschaetzt.has("miete"),
        auto: proExit((ex, z) => {
          const mm = ex.mietMonate ?? ex.haltedauerMonate;
          return mm === ex.haltedauerMonate ? `${num(mm)} Mon.` : `${num(mm)} Vollmonate = Ø ${num(z.mieteMonat)} €/Mon. über ${num(ex.haltedauerMonate)} Mon.`;
        }),
      });
    add("− Gesamtinvestition", null, sp.map((s) => -s.z.gik));
    add(`− Zinsen ${gs("objektdarlehenZins", `${num(f.objektdarlehenZins ?? 6, 1)} %`)}`, "zinsen", sp.map((s) => -s.z.zinsen), {
      auto: proExit((ex) => {
        const fm = ex.finanzierungsdauerMonate ?? ex.haltedauerMonate;
        return fm === ex.haltedauerMonate ? `${num(fm)} Mon.` : `${num(fm)} Vollmonate`;
      }),
    });
    add("− Verkaufsnebenkosten", "vnk", sp.map((s) => -s.z.vnk), {
      auto: proExit((ex) => ex.maklerkosten ? gs("vnk", `${num(ex.maklerkosten, 2)} % + ${num(ex.notarVerkauf ?? 0.5, 1)} %`) : gs("vnk", `${num(ex.notarVerkauf ?? 0.5, 1)} %`)),
    });
    add("= Ergebnis vor Steuern", null, sp.map((s) => s.z.gewinn), { cls: "total" });

    const out = L.map((r) => {
      const note = r.cls ? "" : (r.key && notiz[r.key] != null ? m(notiz[r.key]) : (r.auto || ""));
      const zellen = r.werte.map((v, i) => {
        const t = eur(v);
        return `<td class='r'>${r.mark || (r.markWenn && r.markWenn(i)) ? g(t) : t}</td>`;
      }).join("");
      return `<tr class='${r.cls || ""}'><td>${r.titel}</td>${zellen}<td class='n'>${note}</td></tr>`;
    });
    const kz = (titel, werte, d, note = "") => `<tr><td>${titel}</td>${werte.map((v) => `<td class='r'>${v == null ? "–" : `${num(v, d)} %`}</td>`).join("")}<td class='n'>${note}</td></tr>`;
    out.push(kz("<b>Marge auf GIK</b>", sp.map((s) => s.z.marge), 1, "Gesamtaufwand = GIK + Zinsen + Verkaufsnebenkosten"));
    out.push(kz(sp.some((s) => s.z.mieteNetto) ? "Umsatzrendite (inkl. Miete)" : "Umsatzrendite", sp.map((s) => s.z.umsatzrendite), 1));
    out.push(kz("Rendite auf das Eigenkapital (Projekt)", sp.map((s) => s.z.ekRendite), 0));
    return "<table class='w'><tr><th>Position</th>" + sp.map(({ ex }) => `<th class='r'>${esc(ex.kurz || `${ex.id} ${ex.name}`)}</th>`).join("")
      + "<th>Annahme</th></tr>" + out.join("") + "</table>";
  }

  // ── 4 · Abbruchkriterium ──
  function abbruch() {
    const zm = ergebnis.zielMargen || [20, 15];
    const zeilen = [];
    for (const ex of exits) for (const sz of ["real", "worst"]) {
      const a = (ergebnis.abbruch[ex.id] || {})[sz] || {};
      zeilen.push(`<tr><td>${exKurz(ex)}, ${sz}</td>${zm.map((mz, i) => `<td class="r">${i === 0 ? "<b>" : ""}${a[mz] ? eur(a[mz]) : "–"}${i === 0 ? "</b>" : ""}</td>`).join("")}</tr>`);
    }
    const be = kaufpreise.slice().reverse().map((kp) =>
      `<tr><td>${kpKurz(kp)}: ${exits.map(exKurz).join(" / ")}</td><td class="r" colspan="${zm.length}">${exits.map((ex) => num((ergebnis.breakEven[ex.id] || {})[kp])).join(" / ")} €/m²</td></tr>`);
    return `<table class="kv"><tr><td class='kh'>Max. Kaufpreis bei Marge GIK</td>${zm.map((mz) => `<td class='r kh'>${num(mz)} %</td>`).join("")}</tr>`
      + zeilen.join("")
      + `<tr><td colspan='${zm.length + 1}' class='kh'>Break-even Verkaufspreis (Ergebnis = 0)</td></tr>` + be.join("") + "</table>";
  }

  const liste = (punkte, cls) => `<ol${cls ? ` class="${cls}"` : ""}>${(punkte || []).map((p) => `<li>${m(p)}</li>`).join("")}</ol>`;
  const markt = doc.markt || {};
  const zusatz = doc.zusatzabschnitte || [];
  const stark = (t) => `<div>${m(t)}</div>`;
  let nr = 6;
  const zusatzHtml = zusatz.map((z) => `<h2>${nr++} · ${m(z.ueberschrift)}</h2>${(z.absaetze || [z.text]).filter(Boolean).map(stark).join("")}`).join("\n");

  const methode = x(`<b>Methode.</b> Komplett mit <i>berechneFixFlip()</i> ${rechenquelle === "original"
    ? "aus FixFlip Pro gerechnet (unverändert aus index.html geladen)"
    : "gerechnet (Port der FixFlip-Pro-Formel, gegen die Originalzahlen getestet)"}, inkl. Feld „Mieteinnahmen netto / Monat“. Identische Zahlen im interaktiven Rechner (FixFlipPro_Rechner_*.html). Reproduzierbar: <i>_fixflip/plan.json</i>.${doc.methode ? ` ${m(doc.methode)}` : ""}\n`
    + (doc.quellen ? `<b>Quellen.</b> ${m(doc.quellen)}` : ""));

  const sub = [esc(doc.untertitel || ""), `Stand ${datumDE(stand)}`].filter(Boolean).join(" · ")
    + ` ${x(" · gerechnet mit FixFlip Pro")}, vor Steuern${extern ? "" : ` · ${g("gelb = geschätzt / nicht belegt")}`}`;

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${esc(doc.dokumenttitel || "Ankaufskalkulation")}</title>
<style>${CSS}</style></head><body>

<h1>${esc(doc.titel || "Ankaufskalkulation")}</h1>
<div class="sub">${sub}</div>

<div class="box"><b>${m(doc.kurzantwort?.ueberschrift || "Kurzantwort")}</b>
${liste(doc.kurzantwort?.punkte)}</div>

<h2>1 · ${m(markt.ueberschrift || "Was verkauft sich zu welchem Preis?")}</h2>
<table>
<tr><th>Markt</th><th class="r">€/m²</th><th>Herleitung</th></tr>
${(markt.zeilen || []).map((z) => `<tr${z.hervorheben ? ' class="real"' : ""}><td>${m(z.markt)}</td><td class="r">${m(z.preis)}</td><td class="n">${m(z.herleitung || "")}</td></tr>`).join("\n")}
</table>
${markt.anmerkung ? `<div class="n" style="margin-top:4px">${m(markt.anmerkung)}</div>` : ""}

<h2>2 · Ergebnis in ${kaufpreise.length === 1 ? "einem Kaufpreis" : `${kaufpreise.length === 2 ? "zwei" : kaufpreise.length === 3 ? "drei" : kaufpreise.length} Kaufpreisen`}</h2>
${kaufpreise.map(matrix).join("\n")}
<div class="n" style="margin-top:3px">Ampel${x(" wie FixFlip Pro")}: Marge auf GIK = Ergebnis / Gesamtaufwand bis Verkauf. Unter 15 % rot, 15–20 % gelb, ab 20 % grün (${x("FixFlip-Zielmarge", "Zielmarge")}).</div>

<h2 class="brk">3 · Rechenweg bei ${kpKurz(hkp)}, Szenario real</h2>
${rechenweg(hkp)}

<div class="grid">
<div>
<h2>4 · Abbruchkriterium</h2>
${abbruch()}
${zusatzHtml}
</div>
<div>
<h2>5 · ${m(doc.pruefpunkte?.ueberschrift || "Vor dem Notar klären")}</h2>
${liste(doc.pruefpunkte?.punkte, "pp")}
</div>
</div>

<div class="fuss"><b>Annahmen.</b> ${m(doc.annahmen || "")}
${methode}</div>
${extern && absender ? `<div class="fuss" style="margin-top:10px;font-size:8.2pt;color:#1d4e6b"><b>${esc(absender)}</b></div>` : ""}
</body></html>`;
}
