// Wer darf rein? Admins stehen in ADMIN_EMAILS (.env), alle anderen in DATA_DIR/zugang.json
// und werden in der App unter „Zugang“ gepflegt. Alle Zugelassenen sehen alle Objekte.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { schreibeJson } from "./store.js";

const DATEI = () => join(config.dataDir, "zugang.json");
let liste = []; // [{ email, name, seit, von }]

export const normiere = (email) => String(email || "").trim().toLowerCase();
export const gueltigeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

export async function ladeZugang() {
  try { liste = JSON.parse(await readFile(DATEI(), "utf8")).personen || []; }
  catch (e) { if (e.code !== "ENOENT") throw e; liste = []; }
  return liste;
}

export const istAdmin = (email) => config.adminEmails.includes(normiere(email));
export const darfRein = (email) => {
  const e = normiere(email);
  return Boolean(e) && (istAdmin(e) || liste.some((p) => p.email === e));
};

export function zugangsliste() {
  const admins = config.adminEmails.map((email) => ({ email, admin: true }));
  return [...admins, ...liste.filter((p) => !istAdmin(p.email)).map((p) => ({ ...p, admin: false }))];
}

async function speichere() { await schreibeJson(DATEI(), { personen: liste }); }

export async function fuegeHinzu(email, name, von) {
  const e = normiere(email);
  if (!gueltigeEmail(e)) throw Object.assign(new Error("Keine gültige E-Mail-Adresse."), { status: 400 });
  if (!darfRein(e)) {
    liste.push({ email: e, name: String(name || "").trim().slice(0, 120), seit: new Date().toISOString(), von });
    await speichere();
  }
  return zugangsliste();
}

export async function entferne(email) {
  const e = normiere(email);
  if (istAdmin(e)) throw Object.assign(new Error("Admins stehen in ADMIN_EMAILS auf dem Server."), { status: 400 });
  liste = liste.filter((p) => p.email !== e);
  await speichere();
  return zugangsliste();
}
