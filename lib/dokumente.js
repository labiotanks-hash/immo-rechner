// Aus Exposé-JSON, Kalkulationsplan und Textbausteinen alle Dokumente bauen —
// dieselben Dateien, die der Claude-Workflow im Objektordner ablegt:
//   Ankaufskalkulation_<Objekt>_gelb.{html,pdf}             interne Fassung
//   Ankaufskalkulation_<Objekt>_ohne_Markierung.{html,pdf}  Fassung für die Bank
//   FixFlipPro_Rechner_<Objekt>_<Exit>.html                 interaktiver Rechner je Exit
//   _fixflip/expose.json, plan.json, ergebnis.json, inputs_<Exit>.json, profil.json
import { writeFile, mkdir, rm } from "node:fs/promises";
import { rechnePlan, planInputs, planProfil } from "./fixflip.js";
import { engine } from "./engine.js";
import { objektPfad, schreibeJson, aendereMeta, slug } from "./store.js";
import { renderAnkaufskalkulation } from "./render/ankaufskalkulation.js";
import { druckePdf } from "./render/pdf.js";
import { rechnerEingebaut, rechnerOriginal, originalBuildVorhanden } from "./render/rechner.js";
import { ladeEinstellungen } from "./einstellungen.js";

function rund(x, d = 0) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

// inputs_<Exit>.json im Format der bisherigen _fixflip-Dateien (Rechner startet beim Hauptkaufpreis, Szenario real).
export function rechnerInputs(plan, exit, expose) {
  const kp = plan.hauptkaufpreis || plan.kaufpreise[plan.kaufpreise.length - 1];
  const i = planInputs(plan, kp, exit, "real");
  const wf = i.wohnflaeche;
  const vk = (sz) => rund(wf * Number(typeof exit.preiseM2 === "object" ? exit.preiseM2[sz] ?? exit.preiseM2.real : exit.preiseM2));
  const adr = expose?.objekt?.adresse || {};
  const ort = [adr.strasse, adr.ort].filter(Boolean).join(", ") || plan.objektname || "Objekt";
  return {
    ...i,
    provisionenSonstige: 0, // die Bearbeitungsgebühr rechnet der Rechner selbst auf die Finanzierung
    frischstellung: false,
    objektReferenz: `${ort} — ${exit.id} ${exit.name}`,
    mieteNettoProMonat: rund(i.mieteNettoProMonat, 2),
    zielverkaufspreis: vk("real"),
    vkGering: vk("worst"),
    vkMitte: vk("real"),
    vkHoch: vk("best"),
    zielverkaufspreisQuelle: exit.vkQuelle || "",
    _geschaetzt: plan.geschaetzt || [],
  };
}

export async function erstelleDokumente(id, { expose, plan, doc }) {
  const { rechne, quelle } = engine();
  const einst = await ladeEinstellungen();
  const ergebnis = rechnePlan(plan, rechne);
  const stand = new Date().toISOString().slice(0, 10);
  const name = slug(doc.dateiname || plan.objektname || expose?.objekt?.adresse?.strasse || "Objekt", 60);
  const ff = (...t) => objektPfad(id, "_fixflip", ...t);
  await mkdir(ff(), { recursive: true });

  const profil = {
    ...planProfil(plan),
    ekVerfuegbar: einst.investorenprofil.ekVerfuegbar,
    kkRahmen: einst.investorenprofil.kkRahmen,
    kkZins: einst.investorenprofil.kkZins,
  };
  await schreibeJson(ff("expose.json"), expose);
  await schreibeJson(ff("plan.json"), plan);
  await schreibeJson(ff("dokument.json"), doc);
  await schreibeJson(ff("ergebnis.json"), { stand, rechenkern: quelle, plan, ...ergebnis });
  await schreibeJson(ff("profil.json"), profil);

  const dateien = [];
  const warnungen = [];

  // Ankaufskalkulation in zwei Fassungen
  for (const extern of [false, true]) {
    const basis = `Ankaufskalkulation_${name}_${extern ? "ohne_Markierung" : "gelb"}`;
    const html = renderAnkaufskalkulation({ plan, ergebnis, doc, stand, extern, absender: einst.absender, rechenquelle: quelle });
    const htmlPfad = objektPfad(id, `${basis}.html`);
    await writeFile(htmlPfad, html);
    dateien.push({ datei: `${basis}.html`, art: "ankaufskalkulation", fassung: extern ? "extern" : "intern" });
    try {
      await druckePdf(htmlPfad, objektPfad(id, `${basis}.pdf`));
      dateien.push({ datei: `${basis}.pdf`, art: "ankaufskalkulation", fassung: extern ? "extern" : "intern" });
    } catch (err) {
      warnungen.push(`PDF ${basis}: ${err.message}`);
    }
  }

  // Rechner je Exit
  const original = originalBuildVorhanden();
  for (const exit of plan.exits) {
    const inputs = rechnerInputs(plan, exit, expose);
    const kurz = slug((exit.kurz || exit.name).replace(/^[A-Z]\s+/, ""), 24);
    const inputsPfad = ff(`inputs_${exit.id}_${kurz}.json`);
    await schreibeJson(inputsPfad, inputs);
    const datei = `FixFlipPro_Rechner_${name}_${exit.id}_${kurz}.html`;
    let gebaut = false;
    if (original) {
      await rm(objektPfad(id, datei), { force: true }); // sonst gälte eine alte Datei als Erfolg
      const r = await rechnerOriginal({ exposePfad: ff("expose.json"), inputsPfad, profilPfad: ff("profil.json"), ziel: objektPfad(id, datei) });
      gebaut = r.ok;
      if (!r.ok) warnungen.push(`Original-build.py für ${exit.id}: ${r.meldung || "fehlgeschlagen"} — eingebaute Vorlage genutzt`);
    }
    if (!gebaut) {
      const html = await rechnerEingebaut({
        expose, inputs, profil, titel: inputs.objektReferenz, exitName: exit.name,
        bearbeitungsgebuehrProzent: plan.finanzierung?.bearbeitungsgebuehrProzent ?? 1.5,
      });
      await writeFile(objektPfad(id, datei), html);
    }
    dateien.push({ datei, art: "rechner", exit: exit.id });
  }

  await aendereMeta(id, (m) => {
    m.dokumente = dateien.map((d) => ({ ...d, erstellt: new Date().toISOString() }));
    m.status = "fertig";
    if (plan.objektname && (!m.name || m.name === "Neues Objekt")) m.name = plan.objektname;
  });
  return { dateien, warnungen, ergebnis, rechenkern: quelle };
}
