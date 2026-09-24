// Werkzeuge, die Claude aufrufen kann. Gerechnet wird ausschließlich hier —
// das Modell wählt Annahmen und schreibt Text, die Zahlen kommen aus berechneFixFlip().
import { rechnePlan, rechnePlanZeile, DEFAULT_PROFIL } from "./fixflip.js";
import { engine } from "./engine.js";
import { erstelleDokumente } from "./dokumente.js";

const zahl = { type: "number" };
const szenarioPreise = {
  type: "object",
  description: "€/m² Wohnfläche je Szenario",
  properties: { worst: zahl, real: zahl, best: zahl },
  required: ["worst", "real", "best"],
};

const PLAN_SCHEMA = {
  type: "object",
  description: "Kalkulationsplan: Kaufpreise × Exits × Szenarien",
  properties: {
    objektname: { type: "string", description: "Kurzname, z. B. „Musterstraße 1, Musterstadt“" },
    objekt: {
      type: "object",
      properties: {
        wohnflaeche: { type: "number", description: "m² Wohnfläche (verkaufbare Fläche)" },
        mieteNettoKaltPa: { type: "number", description: "Ist-Nettokaltmiete p. a. in €, 0 wenn leer" },
        bewirtschaftungProzent: { type: "number", description: "nicht umlagefähige Bewirtschaftung in % der Miete (Standard 20)" },
      },
      required: ["wohnflaeche"],
    },
    finanzierung: {
      type: "object",
      properties: {
        objektdarlehenAktiv: { type: "boolean" },
        objektdarlehenLtv: { type: "number", description: "% vom Kaufpreis" },
        objektdarlehenZins: { type: "number", description: "% p. a." },
        bearbeitungsgebuehrProzent: { type: "number", description: "% vom Darlehen" },
        ekVerfuegbar: { type: "number", description: "groß lassen (10000000), damit der EK-Bedarf ausgewiesen statt begrenzt wird" },
        kkRahmen: zahl, kkZins: zahl,
      },
    },
    basis: {
      type: "object",
      description: "gemeinsame FixFlip-Eingaben aller Exits",
      properties: {
        grunderwerbsteuerSatz: zahl, notarGrundbuchSatz: zahl, maklerKaufSatz: zahl,
        hausgeldProMonat: zahl, objektkostenProMonat: zahl, sonderumlage: zahl,
        sanierungAktiv: { type: "boolean" }, sanierungskostenM2: zahl, kfwFoerderungProzent: zahl,
        baunebenkostenProzent: zahl, unvorhergesehenesProzent: zahl,
      },
    },
    kaufpreise: { type: "array", items: zahl, description: "1–3 Kaufpreise in €, aufsteigend" },
    hauptkaufpreis: { type: "number", description: "Kaufpreis für den Rechenweg und die Rechner" },
    massnahmeLabel: { type: "string", description: "Zeilentitel der Maßnahme im Rechenweg, z. B. „Aufteilung / CapEx-Reserve“" },
    exits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "A, B, C …" },
          name: { type: "string", description: "z. B. „Aufteilung + Einzelverkauf“" },
          kurz: { type: "string", description: "Spaltenkopf, z. B. „B Aufteilung“" },
          haltedauerMonate: zahl,
          finanzierungsdauerMonate: { type: "number", description: "Vollmonate Zins (Aufteiler: Darlehen sinkt je Verkauf)" },
          mietMonate: { type: "number", description: "Vollmonate Miete während der Haltedauer" },
          renovierungPauschale: { type: "number", description: "Maßnahmenbudget € (Renovierung, Aufteilungskosten, CapEx-Reserve)" },
          maklerkosten: { type: "number", description: "% Makler beim Verkauf (Globalverkauf: 0)" },
          notarVerkauf: { type: "number", description: "% Notar beim Verkauf" },
          garage: { description: "Stellplatz-Erlös €, Zahl oder {worst, real, best}" },
          preiseM2: szenarioPreise,
          vkQuelle: { type: "string", description: "Herleitung des Verkaufspreises in einem Satz" },
          inputs: { type: "object", description: "weitere FixFlip-Felder nur für diesen Exit, z. B. sanierungAktiv, sanierungskostenM2, baunebenkostenProzent, unvorhergesehenesProzent, hausgeldProMonat" },
        },
        required: ["id", "name", "haltedauerMonate", "preiseM2"],
      },
    },
    geschaetzt: { type: "array", items: { type: "string" } },
  },
  required: ["objekt", "kaufpreise", "exits"],
};

const EXPOSE_SCHEMA = {
  type: "object",
  description: "Exposé im Schema a2o.expose.v1",
  properties: {
    schema: { type: "string", enum: ["a2o.expose.v1"] },
    schema_version: { type: "number" },
    extrahiert_am: { type: "string" },
    quelle: { type: "object", description: "datei, firma, makler, kontakt_email, kontakt_telefon, objektnummer, portal_id" },
    objekt: {
      type: "object",
      description: "titel, adresse{strasse, plz, ort, stadtteil}, objekttyp, baujahr, wohnflaeche_m2, nutzflaeche_m2, grundstuecksflaeche_m2, zimmer, wohneinheiten, etagen, zustand, letzte_modernisierung, heizung, energieausweis{typ, wert_kwh_m2a, klasse, energietraeger}, keller, stellplaetze, vermietet, mieteinnahmen_monat_eur, besonderheiten[]",
    },
    kaufdaten: { type: "object", description: "kaufpreis_eur, kaufpreis_auf_anfrage, provision_kaeufer_prozent, provisionsfrei, hausgeld_monat_eur, verfuegbar_ab" },
    a2o_check: { type: "object", description: "lage_eur_m2 (Ø Angebotspreis Wohnungen am Ort), lage_quelle" },
    extraktion: { type: "object", description: "fehlend[], notizen" },
  },
  required: ["schema", "objekt", "kaufdaten"],
};

const DOKUMENT_SCHEMA = {
  type: "object",
  description: "Texte der Ankaufskalkulation. Auszeichnung: ==geschätzt==, **fett**, [[intern: …]], [[extern: …]]",
  properties: {
    titel: { type: "string", description: "„Straße Nr, PLZ Ort — Ankaufskalkulation“" },
    dokumenttitel: { type: "string", description: "Browser-/PDF-Titel, z. B. „Ankaufskalkulation Musterstadt“" },
    dateiname: { type: "string", description: "Objektteil der Dateinamen, z. B. „Musterstrasse_1_Musterstadt“" },
    untertitel: { type: "string", description: "Objekttyp · Baujahr · Wohnfläche · Grundstück" },
    kurzantwort: {
      type: "object",
      properties: { ueberschrift: { type: "string" }, punkte: { type: "array", items: { type: "string" } } },
      required: ["punkte"],
    },
    markt: {
      type: "object",
      properties: {
        ueberschrift: { type: "string" },
        zeilen: {
          type: "array",
          items: {
            type: "object",
            properties: { markt: { type: "string" }, preis: { type: "string" }, herleitung: { type: "string" }, hervorheben: { type: "boolean" } },
            required: ["markt", "preis"],
          },
        },
        anmerkung: { type: "string" },
      },
      required: ["zeilen"],
    },
    rechenwegNotizen: {
      type: "object",
      description: "optionale Annahme-Spalte im Rechenweg; Schlüssel: kaufpreis, makler_kauf, bearbeitung, massnahme, verkaufserloes, miete, zinsen, vnk",
    },
    pruefpunkte: {
      type: "object",
      properties: { ueberschrift: { type: "string" }, punkte: { type: "array", items: { type: "string" } } },
      required: ["punkte"],
    },
    zusatzabschnitte: {
      type: "array",
      items: { type: "object", properties: { ueberschrift: { type: "string" }, text: { type: "string" } }, required: ["ueberschrift", "text"] },
    },
    annahmen: { type: "string" },
    methode: { type: "string", description: "nur intern, optionaler Zusatz zur Methode" },
    quellen: { type: "string", description: "nur intern: Quellenliste" },
  },
  required: ["titel", "kurzantwort", "markt", "pruefpunkte", "annahmen"],
};

export const WERKZEUGE = [
  {
    name: "kalkulation_rechnen",
    description: "Rechnet einen Kalkulationsplan mit der FixFlip-Pro-Formel: Ergebnis-Matrix (Kaufpreise × Exits × worst/real/best), Rechenweg beim Hauptkaufpreis, maximaler Kaufpreis für 20/15 % Marge auf GIK, Break-even-Verkaufspreis. Beliebig oft aufrufbar.",
    input_schema: { type: "object", properties: { plan: PLAN_SCHEMA }, required: ["plan"] },
    eager_input_streaming: true,
  },
  {
    name: "fixflip_rechnen",
    description: "Einzelrechnung mit berechneFixFlip() für eine Was-wäre-wenn-Frage. inputs sind FixFlip-Felder (kaufpreis, wohnflaeche, grunderwerbsteuerSatz, notarGrundbuchSatz, maklerKaufSatz, provisionenSonstige, hausgeldProMonat, objektkostenProMonat, sonderumlage, sanierungAktiv, sanierungskostenM2, kfwFoerderungProzent, renovierungAktiv, renovierungPauschale, baunebenkostenProzent, unvorhergesehenesProzent, mieteNettoProMonat, haltedauerMonate, finanzierungsdauerMonate, maklerkosten, notarVerkauf, zielverkaufspreis, garageMitverkauf, garagenpreis); profil: ekVerfuegbar, kkRahmen, kkZins, objektdarlehenAktiv, objektdarlehenLtv, objektdarlehenZins.",
    input_schema: {
      type: "object",
      properties: { inputs: { type: "object" }, profil: { type: "object" } },
      required: ["inputs"],
    },
    eager_input_streaming: true,
  },
  {
    name: "dokumente_erstellen",
    description: "Erzeugt die Ankaufskalkulation (intern gelb + extern ohne Markierung, je HTML und PDF), je Exit einen FixFlip-Pro-Rechner (HTML) und die JSON-Dateien. Die Tabellen rechnet das Werkzeug aus dem Plan; du lieferst Exposé-JSON und Texte. Erneut aufrufen, um Dokumente nach Änderungen neu zu erstellen.",
    input_schema: {
      type: "object",
      properties: { expose: EXPOSE_SCHEMA, plan: PLAN_SCHEMA, dokument: DOKUMENT_SCHEMA },
      required: ["expose", "plan", "dokument"],
    },
    eager_input_streaming: true,
  },
];

// ── Prüfen ────────────────────────────────────────────────────────────────
const istZahl = (v) => typeof v === "number" && isFinite(v);

export function pruefePlan(plan) {
  const f = [];
  if (!plan || typeof plan !== "object") return ["plan fehlt"];
  if (!istZahl(plan.objekt?.wohnflaeche) || plan.objekt.wohnflaeche <= 0) f.push("objekt.wohnflaeche muss > 0 sein");
  if (!Array.isArray(plan.kaufpreise) || !plan.kaufpreise.length || !plan.kaufpreise.every((k) => istZahl(k) && k > 0))
    f.push("kaufpreise: 1–3 positive Zahlen");
  else if (plan.kaufpreise.length > 3) f.push("höchstens 3 Kaufpreise");
  if (plan.hauptkaufpreis != null && !plan.kaufpreise?.includes(plan.hauptkaufpreis)) f.push("hauptkaufpreis muss in kaufpreise stehen");
  if (!Array.isArray(plan.exits) || !plan.exits.length) f.push("exits: mindestens ein Exit");
  else {
    if (plan.exits.length > 4) f.push("höchstens 4 Exits");
    const ids = new Set();
    for (const [n, ex] of plan.exits.entries()) {
      const w = `exits[${n}]`;
      if (!ex.id || typeof ex.id !== "string") f.push(`${w}.id fehlt`);
      else if (ids.has(ex.id)) f.push(`${w}.id doppelt`); else ids.add(ex.id);
      if (!ex.name) f.push(`${w}.name fehlt`);
      if (!istZahl(ex.haltedauerMonate) || ex.haltedauerMonate <= 0) f.push(`${w}.haltedauerMonate > 0`);
      for (const sz of ["worst", "real", "best"]) if (!istZahl(ex.preiseM2?.[sz])) f.push(`${w}.preiseM2.${sz} fehlt`);
      if (ex.garage != null && !istZahl(ex.garage) && typeof ex.garage !== "object") f.push(`${w}.garage: Zahl oder {worst, real, best}`);
    }
  }
  return f;
}

function pruefeDokument(doc) {
  const f = [];
  if (!doc || typeof doc !== "object") return ["dokument fehlt"];
  if (!doc.titel) f.push("dokument.titel fehlt");
  if (!Array.isArray(doc.kurzantwort?.punkte) || !doc.kurzantwort.punkte.length) f.push("dokument.kurzantwort.punkte fehlt");
  if (!Array.isArray(doc.markt?.zeilen)) f.push("dokument.markt.zeilen fehlt");
  if (!Array.isArray(doc.pruefpunkte?.punkte)) f.push("dokument.pruefpunkte.punkte fehlt");
  if (typeof doc.annahmen !== "string") f.push("dokument.annahmen fehlt");
  return f;
}

function pruefeExpose(ex) {
  const f = [];
  if (!ex || ex.schema !== "a2o.expose.v1") f.push("expose.schema muss „a2o.expose.v1“ sein");
  if (!ex?.objekt || typeof ex.objekt !== "object") f.push("expose.objekt fehlt");
  if (!ex?.kaufdaten || typeof ex.kaufdaten !== "object") f.push("expose.kaufdaten fehlt");
  return f;
}

// ── Ausführen ─────────────────────────────────────────────────────────────
const r0 = (x) => (istZahl(x) ? Math.round(x) : x);
const r1 = (x) => (istZahl(x) ? Math.round(x * 10) / 10 : x);

function planHinweise(plan, ergebnis) {
  const h = [];
  const wf = plan.objekt.wohnflaeche;
  for (const z of ergebnis.zeilen) {
    if (!z.finanzierbar) { h.push(`Kaufpreis ${z.kaufpreis}: nicht finanzierbar mit dem angegebenen EK/Kontokorrent`); break; }
  }
  for (const ex of plan.exits) {
    const p = ex.preiseM2;
    if (!(p.worst <= p.real && p.real <= p.best)) h.push(`Exit ${ex.id}: preiseM2 sollten worst ≤ real ≤ best sein`);
    if (p.real > 15000 || p.real < 300) h.push(`Exit ${ex.id}: ${p.real} €/m² wirkt unplausibel`);
  }
  if (plan.objekt.mieteNettoKaltPa && wf) {
    const mieteM2 = plan.objekt.mieteNettoKaltPa / wf / 12;
    if (mieteM2 > 30 || mieteM2 < 2) h.push(`Miete ${r1(mieteM2)} €/m² im Monat wirkt unplausibel`);
  }
  return h;
}

function kalkulation(plan) {
  const fehler = pruefePlan(plan);
  if (fehler.length) return { fehler };
  const { rechne, quelle } = engine();
  const erg = rechnePlan(plan, rechne);
  const hkp = plan.hauptkaufpreis || plan.kaufpreise[plan.kaufpreise.length - 1];
  const rechenweg = {};
  for (const ex of plan.exits) {
    const z = rechnePlanZeile(plan, hkp, ex.id, "real", rechne);
    rechenweg[ex.id] = {
      kaufpreis: z.kaufpreis, grunderwerbsteuer: r0(z.grest), notar: r0(z.notar), maklerKauf: r0(z.maklerKauf),
      bearbeitung: r0(z.bearbeitung), massnahme: r0(z.bau), halten: r0(z.halten), gik: r0(z.gik), darlehen: r0(z.darlehen),
      ekBedarf: r0(z.ekBedarf), verkaufserloes: r0(z.vk), mieteNetto: r0(z.mieteNetto), mieteMonat: r0(z.mieteMonat),
      zinsen: r0(z.zinsen), verkaufsnebenkosten: r0(z.vnk), ergebnis: r0(z.gewinn), margeGIK: r1(z.marge),
      umsatzrendite: r1(z.umsatzrendite), ekRendite: r0(z.ekRendite),
    };
  }
  return {
    rechenkern: quelle,
    hauptkaufpreis: hkp,
    matrix: erg.zeilen.map((z) => ({
      kaufpreis: z.kaufpreis, exit: z.exit, szenario: z.szenario, vkM2: z.vkM2, faktorVK: r1(z.faktorVK),
      erloes_T: Math.round(z.vk / 1000), ergebnis_T: Math.round(z.gewinn / 1000), margeGIK: r1(z.marge),
      ekBedarf_T: Math.round(z.ekBedarf / 1000), umsatzrendite: r1(z.umsatzrendite),
    })),
    rechenweg_hauptkaufpreis_real: rechenweg,
    abbruch_maxKaufpreis: erg.abbruch,
    breakEven_vkM2: erg.breakEven,
    hinweise: planHinweise(plan, erg),
  };
}

function einzelrechnung({ inputs, profil }) {
  if (!inputs || typeof inputs !== "object") return { fehler: ["inputs fehlt"] };
  const { rechne } = engine();
  const e = rechne(inputs, { ...DEFAULT_PROFIL, ...(profil || {}) });
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v]));
}

export async function fuehreAus(id, name, eingabe, melden) {
  if (name === "kalkulation_rechnen") {
    melden({ typ: "werkzeug", name, text: "Rechne Szenarien mit FixFlip Pro …" });
    return kalkulation(eingabe.plan);
  }
  if (name === "fixflip_rechnen") {
    melden({ typ: "werkzeug", name, text: "Einzelrechnung mit FixFlip Pro …" });
    return einzelrechnung(eingabe);
  }
  if (name === "dokumente_erstellen") {
    const fehler = [...pruefeExpose(eingabe.expose), ...pruefePlan(eingabe.plan), ...pruefeDokument(eingabe.dokument)];
    if (fehler.length) return { fehler };
    melden({ typ: "werkzeug", name, text: "Erstelle Ankaufskalkulation (PDF) und FixFlip-Rechner …" });
    const r = await erstelleDokumente(id, { expose: eingabe.expose, plan: eingabe.plan, doc: eingabe.dokument });
    melden({ typ: "dokumente", dateien: r.dateien });
    return {
      erstellt: r.dateien.map((d) => d.datei),
      warnungen: r.warnungen,
      rechenkern: r.rechenkern,
    };
  }
  return { fehler: [`Unbekanntes Werkzeug ${name}`] };
}
