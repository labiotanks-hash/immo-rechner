// Live-Anbindung an die WhatsApp-Gruppe über die Bridge (bridge/). Die Bridge schreibt
// WA_STORE/nachrichten.db und WA_STORE/medien/, die App liest nur. Ausgewählte Nachrichten
// werden als ganz normaler WhatsApp-Export („mit Medien“) ins Objekt übernommen — damit
// laufen Transkription, Medien-Upload und Zeitraum-Filter wie beim ZIP aus dem Handy.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";
import JSZip from "jszip";
import { config } from "./config.js";
import { transkribiere, transkriptAusCache, transkriptionAktiv } from "./transcribe.js";

const DB = () => join(config.waStore, "nachrichten.db");
let sqlite = null; // node:sqlite erst bei Bedarf laden (in Node 22 noch experimentell)

export function liveAktiv() {
  return Boolean(config.waStore) && existsSync(DB());
}

async function db() {
  sqlite ||= await import("node:sqlite");
  // Nur lesen; die Bridge schreibt im WAL-Modus, Lesen stört sie nicht
  return new sqlite.DatabaseSync(DB(), { readOnly: true });
}

async function mitDb(fn) {
  const d = await db();
  try { return fn(d); } finally { d.close(); }
}

export async function waStatus() {
  if (!config.waStore) return { eingerichtet: false };
  let s = {};
  try { s = JSON.parse(await readFile(join(config.waStore, "status.json"), "utf8")); } catch {}
  const antwort = {
    eingerichtet: true,
    zustand: s.zustand || "unbekannt", // koppeln | verbunden | getrennt | abgemeldet | abgelaufen
    nummer: s.nummer || null,
    gruppeFehlt: Boolean(s.gruppeFehlt),
    qr: existsSync(join(config.waStore, "qr.png")),
    aktualisiert: s.aktualisiert || null,
    gruppen: [],
  };
  if (liveAktiv()) {
    antwort.gruppen = await mitDb((d) => d.prepare(`
      SELECT g.jid, g.name, COUNT(n.id) AS anzahl, MAX(n.zeit) AS letzte
      FROM gruppen g LEFT JOIN nachrichten n ON n.chat = g.jid GROUP BY g.jid ORDER BY letzte DESC`).all()
      .map((g) => ({ jid: g.jid, name: g.name, anzahl: Number(g.anzahl), letzte: g.letzte ? new Date(Number(g.letzte) * 1000).toISOString() : null })));
  }
  return antwort;
}

export async function qrPfad() {
  const p = join(config.waStore, "qr.png");
  return existsSync(p) ? p : null;
}

const berlinTag = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d); // YYYY-MM-DD
function tagesgrenzeUnix(tag, ende) {
  // Tagesgrenze in Berliner Zeit → Unix-Sekunden (±1 Tag Puffer, danach genau filtern)
  const t = Date.parse(`${tag}T00:00:00Z`) / 1000;
  return ende ? t + 2 * 86400 : t - 86400;
}

function zeile(r) {
  return {
    id: r.id, chat: r.chat,
    zeit: new Date(Number(r.zeit) * 1000).toISOString(),
    absender: r.absender_name || (r.absender ? `+${r.absender}` : "?"),
    vonMir: Boolean(r.von_mir),
    text: r.text || "",
    art: r.art, dateiname: r.dateiname || null, mime: r.mime || null,
    groesse: r.groesse == null ? null : Number(r.groesse),
    datei: r.datei_status === "ok" ? r.datei : null,
    dateiStatus: r.datei_status || null,
    bearbeitet: Boolean(r.bearbeitet),
  };
}

// Nachrichten einer Gruppe im Zeitraum (Berliner Kalendertage, beide inklusive)
export async function waNachrichten({ chat, von, bis, grenze = 3000 }) {
  if (!liveAktiv()) return [];
  const unten = von ? tagesgrenzeUnix(von, false) : 0;
  const oben = bis ? tagesgrenzeUnix(bis, true) : 32503680000;
  const rows = await mitDb((d) => d.prepare(`
    SELECT * FROM nachrichten WHERE chat = ? AND zeit BETWEEN ? AND ? ORDER BY zeit ASC, id ASC LIMIT ?`)
    .all(chat, unten, oben, grenze));
  const liste = rows.map(zeile).filter((n) => {
    const tag = berlinTag(new Date(n.zeit));
    return (!von || tag >= von) && (!bis || tag <= bis);
  });
  for (const n of liste) if (n.art === "audio" && n.datei) n.transkript = await transkriptVon(n.datei);
  return liste;
}

// Mediendateien ändern sich nie → gefundene Transkripte im Speicher merken
const transkripte = new Map();
async function transkriptVon(datei) {
  if (transkripte.has(datei)) return transkripte.get(datei);
  const p = medienPfad(datei);
  const t = p ? await transkriptAusCache(p) : null;
  if (t != null) transkripte.set(datei, t);
  return t;
}

// Sprachnachrichten der letzten 60 Tage im Hintergrund transkribieren, sobald sie da sind
const fehlversuche = new Map();
async function hintergrundDurchlauf() {
  if (!liveAktiv() || !transkriptionAktiv()) return;
  const seit = Math.floor(Date.now() / 1000) - 60 * 86400;
  const offen = await mitDb((d) => d.prepare(`
    SELECT datei FROM nachrichten WHERE art = 'audio' AND datei_status = 'ok' AND zeit > ? ORDER BY zeit DESC LIMIT 100`).all(seit));
  for (const { datei } of offen) {
    if (transkripte.has(datei) || (fehlversuche.get(datei) || 0) >= 3) continue;
    const p = medienPfad(datei);
    if (!p || !existsSync(p)) continue;
    try {
      transkripte.set(datei, await transkribiere(p));
    } catch (err) {
      // Whisper startet noch (lädt beim ersten Mal das Modell) → später weiter, kein Fehlversuch
      if (err.message === "fetch failed" || err.cause?.code === "ECONNREFUSED" || err.cause?.code === "ENOTFOUND") return;
      fehlversuche.set(datei, (fehlversuche.get(datei) || 0) + 1);
      console.warn(`Transkription ${datei}: ${err.message}`);
    }
  }
}

export function starteHintergrund(intervallMs = 60_000) {
  let laeuft = false;
  const tick = async () => {
    if (laeuft) return;
    laeuft = true;
    try { await hintergrundDurchlauf(); } catch (err) { console.warn(`WhatsApp-Hintergrund: ${err.message}`); }
    finally { laeuft = false; }
  };
  const t = setInterval(tick, intervallMs);
  t.unref();
  setTimeout(tick, 5000).unref();
}

async function nachrichtenNachId(chat, ids) {
  const set = [...new Set(ids.map(String))].slice(0, 5000);
  if (!set.length) return [];
  const rows = await mitDb((d) => {
    const q = d.prepare("SELECT * FROM nachrichten WHERE chat = ? AND id = ?");
    return set.map((id) => q.get(chat, id)).filter(Boolean);
  });
  return rows.map(zeile).sort((a, b) => a.zeit.localeCompare(b.zeit) || a.id.localeCompare(b.id));
}

// Pfad einer Mediendatei — nur innerhalb von WA_STORE/medien
export function medienPfad(datei) {
  if (!datei) return null;
  const basis = resolve(config.waStore, "medien");
  const p = resolve(config.waStore, datei);
  return p.startsWith(basis + sep) ? p : null;
}

export async function waMedium(chat, id) {
  const [n] = await nachrichtenNachId(chat, [id]);
  const p = medienPfad(n?.datei);
  if (!p || !existsSync(p)) return null;
  return { pfad: p, mime: n.mime, name: n.dateiname };
}

// ── Export im Format „Chat exportieren“ (iOS, deutsch) ─────────────────────
const TEIL = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function iosZeit(iso) {
  const t = Object.fromEntries(TEIL.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { kopf: `[${t.day}.${t.month}.${t.year}, ${t.hour}:${t.minute}:${t.second}]`, datei: `20${t.year}-${t.month}-${t.day}-${t.hour}-${t.minute}-${t.second}` };
}

const ART_WA = { bild: "PHOTO", video: "VIDEO", audio: "AUDIO", dokument: "DOCUMENT" };
const WEGGELASSEN = { bild: "Bild weggelassen", video: "Video weggelassen", audio: "Audio weggelassen", dokument: "Dokument weggelassen" };

// Zeilen, die selbst wie ein Zeitstempel aussehen, einrücken — sonst hielte der Parser sie für neue Nachrichten
const entschaerfe = (text) => text.split(/\r?\n/).map((z) => (/^\s*\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/.test(z) ? ` ${z}` : z)).join("\n");

export async function exportiereAlsZip({ chat, ids, gruppe }) {
  const nachrichten = await nachrichtenNachId(chat, ids);
  if (!nachrichten.length) throw Object.assign(new Error("Keine der ausgewählten Nachrichten gefunden."), { status: 400 });
  const zip = new JSZip();
  const zeilen = [];
  let nr = 0, medien = 0, fehlend = 0;
  for (const n of nachrichten) {
    const { kopf, datei } = iosZeit(n.zeit);
    const name = n.absender.replace(/:\s/g, " ");
    if (n.art !== "text") {
      const p = medienPfad(n.datei);
      if (p && existsSync(p)) {
        nr++;
        const ext = extname(n.datei);
        const anhang = n.art === "dokument" && n.dateiname
          ? `${String(nr).padStart(8, "0")}-${n.dateiname.replace(/[<>]/g, "_")}`
          : `${String(nr).padStart(8, "0")}-${ART_WA[n.art]}-${datei}${ext}`;
        zip.file(anhang, await readFile(p));
        zeilen.push(`${kopf} ${name}: <Anhang: ${anhang}>`);
        medien++;
      } else {
        zeilen.push(`${kopf} ${name}: ${WEGGELASSEN[n.art] || "Medien ausgeschlossen"}`);
        fehlend++;
      }
    }
    if (n.text) zeilen.push(`${kopf} ${name}: ${entschaerfe(n.text)}${n.bearbeitet ? " <Diese Nachricht wurde bearbeitet.>" : ""}`);
  }
  zip.file("_chat.txt", zeilen.join("\n") + "\n");
  const puffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  const tage = [...new Set(nachrichten.map((n) => berlinTag(new Date(n.zeit))))];
  const spanne = tage.length > 1 ? `${tage[0]} bis ${tage.at(-1)}` : tage[0];
  return {
    name: `WhatsApp Chat - ${String(gruppe || "Gruppe").replace(/[\\/:*?"<>|]/g, "_")} (${spanne}).zip`,
    puffer, nachrichten: nachrichten.length, medien, fehlend,
  };
}
