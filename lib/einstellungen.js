// Hausannahmen und Absender — gelten für jede Analyse, im Browser unter „Einstellungen“ änderbar.
import { join } from "node:path";
import { config } from "./config.js";
import { leseJson, schreibeJson } from "./store.js";

export const STANDARD = {
  firma: "A²O Architekten, Stuttgart",
  absender: "Fix-and-Flip Objektrechner A2O Architekten, Stuttgart",
  investorenprofil: { ekVerfuegbar: 450000, kkRahmen: 0, kkZins: 9.0 },
  hausannahmen: [
    "Region: Großraum Stuttgart / Baden-Württemberg.",
    "Grunderwerbsteuer BW 5,0 %, Notar/Grundbuch 2,0 % vom Kaufpreis.",
    "Makler beim Kauf laut Exposé (üblich 3,57 % inkl. MwSt.), beim Verkauf 3,57 % + Notar 0,5 %; Globalverkauf an Investoren: Käufer zahlt die Courtage, nur 0,5 % Notar.",
    "Projektfinanzierung: Darlehen 80 % vom Kaufpreis (Nebenkosten finanziert die Bank nicht), 6,0 % variabel, Bearbeitungsgebühr 1,5 % vom Darlehen.",
    "Zinsen konservativ: Darlehen ab Tag 1 voll gezogen. Beim Aufteiler sinkt das Darlehen mit jedem Verkauf — dann Vollmonate ansetzen (z. B. 6 Mon. voll + 12 Mon. Ø 50 % = 12 Vollmonate).",
    "Vermietete Objekte: Miete netto nach 20 % nicht umlagefähiger Bewirtschaftung, als Ø über die Haltedauer.",
    "Zielmarge 20 % auf die Gesamtkosten (GIK + Zinsen + Verkaufsnebenkosten); Ampel unter 15 % rot, 15–20 % gelb, ab 20 % grün.",
    "Alles vor Steuern; wenn nach Steuern gefragt: 30 % gewerblich auf Gesellschaftsebene.",
    "Verkaufspreise immer in drei Szenarien worst / real / best (€/m² Wohnfläche). Portalwerte sind Angebots-, keine Abschlusspreise.",
  ].join("\n"),
};

const PFAD = () => join(config.dataDir, "einstellungen.json");

export async function ladeEinstellungen() {
  const e = await leseJson(PFAD(), {});
  return {
    ...STANDARD, ...e,
    investorenprofil: { ...STANDARD.investorenprofil, ...(e.investorenprofil || {}) },
  };
}

export async function speichereEinstellungen(neu) {
  const alt = await ladeEinstellungen();
  const e = {
    firma: String(neu.firma ?? alt.firma).slice(0, 200),
    absender: String(neu.absender ?? alt.absender).slice(0, 200),
    hausannahmen: String(neu.hausannahmen ?? alt.hausannahmen).slice(0, 8000),
    investorenprofil: {
      ekVerfuegbar: Number(neu.investorenprofil?.ekVerfuegbar ?? alt.investorenprofil.ekVerfuegbar) || 0,
      kkRahmen: Number(neu.investorenprofil?.kkRahmen ?? alt.investorenprofil.kkRahmen) || 0,
      kkZins: Number(neu.investorenprofil?.kkZins ?? alt.investorenprofil.kkZins) || 0,
    },
  };
  await schreibeJson(PFAD(), e);
  return e;
}
