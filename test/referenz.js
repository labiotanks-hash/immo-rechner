// Referenzfall aus einer echten Ankaufskalkulation (MFH, zwei Exits), die mit der
// ORIGINALEN berechneFixFlip() aus FixFlip Pro gerechnet wurde. Für das öffentliche Repo
// anonymisiert: Geldbeträge und Fläche mit einem festen Faktor skaliert (die Formel ist
// linear-homogen, Margen und €/m²-Werte bleiben unverändert). Die erwarteten Werte in
// test/fixflip.test.js sind die ebenso skalierten Originalergebnisse.
export const REFERENZ_PLAN = {
  objekt: { wohnflaeche: 372.5, mieteNettoKaltPa: 42500, bewirtschaftungProzent: 20 },
  finanzierung: {
    ekVerfuegbar: 10_000_000, kkRahmen: 0, kkZins: 0, objektdarlehenAktiv: true,
    objektdarlehenLtv: 80, objektdarlehenZins: 6.0, bearbeitungsgebuehrProzent: 1.5,
  },
  basis: {
    grunderwerbsteuerSatz: 5.0, notarGrundbuchSatz: 2.0, maklerKaufSatz: 0,
    hausgeldProMonat: 0, objektkostenProMonat: 0, sonderumlage: 0,
    sanierungAktiv: false, sanierungskostenM2: 0, sanierungsstandard: "basic", kfwFoerderungProzent: 0,
    baunebenkostenProzent: 0, unvorhergesehenesProzent: 0,
  },
  kaufpreise: [550000, 600000],
  hauptkaufpreis: 600000,
  exits: [
    { id: "A", name: "Globalverkauf", haltedauerMonate: 9, finanzierungsdauerMonate: 9, mietMonate: 9,
      renovierungPauschale: 0, maklerkosten: 0, notarVerkauf: 0.5, garage: 0,
      preiseM2: { worst: 1800, real: 2000, best: 2200 } },
    { id: "B", name: "Aufteilung + Einzelverkauf", haltedauerMonate: 18, finanzierungsdauerMonate: 12, mietMonate: 12,
      renovierungPauschale: 32500, maklerkosten: 3.57, notarVerkauf: 0.5,
      garage: { worst: 0, real: 20000, best: 20000 },
      preiseM2: { worst: 2200, real: 2500, best: 2900 } },
  ],
};
