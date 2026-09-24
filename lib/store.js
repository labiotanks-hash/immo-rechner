// Ablage je Objekt — dieselbe Struktur wie der Dropbox-Ordner eines Objekts:
//   objekte/<id>/meta.json        Name, Notizen, Quellenliste, Dokumentliste, Status
//   objekte/<id>/Quellen/         alles, was hochgeladen wurde (+ entpackte WhatsApp-Medien)
//   objekte/<id>/_fixflip/        expose.json, plan.json, ergebnis.json, inputs_*.json, profil.json
//   objekte/<id>/verlauf.json     Gespräch mit Claude (für Rückfragen)
//   objekte/<id>/*.html|*.pdf     die fertigen Dokumente
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep, basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "./config.js";

const OBJEKTE = () => join(config.dataDir, "objekte");

export function slug(text, max = 48) {
  return String(text || "objekt")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, max) || "objekt";
}

export function sichererDateiname(name) {
  const b = basename(String(name || "datei")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return (b && b !== "." && b !== "..") ? b.slice(0, 180) : "datei";
}

// Pfad innerhalb eines Objektordners; wirft bei Ausbruchsversuchen.
export function objektPfad(id, ...teile) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("ungültige Objekt-ID");
  const wurzel = resolve(OBJEKTE(), id);
  const ziel = resolve(wurzel, ...teile);
  if (ziel !== wurzel && !ziel.startsWith(wurzel + sep)) throw new Error("Pfad außerhalb des Objekts");
  return ziel;
}

async function schreibeAtomar(pfad, inhalt) {
  const tmp = `${pfad}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, inhalt);
  await rename(tmp, pfad);
}

export async function schreibeJson(pfad, daten) {
  await mkdir(resolve(pfad, ".."), { recursive: true });
  await schreibeAtomar(pfad, JSON.stringify(daten, null, 2));
}

export async function leseJson(pfad, standard = null) {
  try { return JSON.parse(await readFile(pfad, "utf8")); } catch { return standard; }
}

export async function neuesObjekt(name, notizen = "") {
  const heute = new Date().toISOString().slice(0, 10);
  const id = `${heute}-${slug(name, 36)}-${randomBytes(2).toString("hex")}`;
  const meta = {
    id, name: name || "Neues Objekt", notizen, zeitraum: null,
    erstellt: new Date().toISOString(), status: "neu",
    quellen: [], dokumente: [], laeufe: [],
  };
  await mkdir(objektPfad(id, "Quellen"), { recursive: true });
  await schreibeJson(objektPfad(id, "meta.json"), meta);
  return meta;
}

export async function ladeMeta(id) {
  const meta = await leseJson(objektPfad(id, "meta.json"));
  if (!meta) throw Object.assign(new Error("Objekt nicht gefunden"), { status: 404 });
  return meta;
}

// Meta-Änderungen laufen nacheinander (Upload und Analyse können gleichzeitig schreiben).
const sperren = new Map();
export async function aendereMeta(id, fn) {
  const vorher = sperren.get(id) || Promise.resolve();
  let fertig;
  const jetzt = new Promise((r) => { fertig = r; });
  sperren.set(id, vorher.then(() => jetzt));
  await vorher;
  try {
    const meta = await ladeMeta(id);
    const neu = (await fn(meta)) || meta;
    await schreibeJson(objektPfad(id, "meta.json"), neu);
    return neu;
  } finally {
    fertig();
    if (sperren.get(id) === jetzt) sperren.delete(id);
  }
}

export async function listeObjekte() {
  if (!existsSync(OBJEKTE())) return [];
  const ids = await readdir(OBJEKTE());
  const liste = [];
  for (const id of ids) {
    const meta = await leseJson(join(OBJEKTE(), id, "meta.json"));
    if (meta) liste.push({
      id: meta.id, name: meta.name, erstellt: meta.erstellt, status: meta.status,
      quellen: meta.quellen.filter((q) => !q.herkunft).length, dokumente: meta.dokumente.length,
    });
  }
  return liste.sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

export async function loescheObjekt(id) {
  await rm(objektPfad(id), { recursive: true, force: true });
}

// Datei in Quellen/ ablegen, ohne Vorhandenes zu überschreiben.
export async function legeQuelleAb(id, name, puffer, unterordner = "") {
  const ordner = objektPfad(id, "Quellen", unterordner);
  await mkdir(ordner, { recursive: true });
  let datei = sichererDateiname(name);
  const stamm = basename(datei, extname(datei));
  for (let k = 2; existsSync(join(ordner, datei)); k++) datei = `${stamm}_${k}${extname(name)}`;
  await writeFile(join(ordner, datei), puffer);
  const rel = unterordner ? `${unterordner}/${datei}` : datei;
  return { datei, pfad: `Quellen/${rel}`, groesse: (await stat(join(ordner, datei))).size };
}

// ── Live-Ereignisse je Objekt (für den Fortschritt im Browser) ──────────────
const kanaele = new Map();
export function kanal(id) {
  let k = kanaele.get(id);
  if (!k) {
    k = { emitter: new EventEmitter(), puffer: [] };
    k.emitter.setMaxListeners(50);
    kanaele.set(id, k);
  }
  return k;
}

export function melde(id, ereignis) {
  const k = kanal(id);
  const e = { t: new Date().toISOString(), ...ereignis };
  k.puffer.push(e);
  if (k.puffer.length > 800) k.puffer.splice(0, k.puffer.length - 800);
  k.emitter.emit("e", e);
}

export function leereKanal(id) {
  kanal(id).puffer = [];
}
