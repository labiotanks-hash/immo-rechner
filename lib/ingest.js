// Hochgeladene Dateien für Claude aufbereiten:
//   ZIP (WhatsApp-Export oder Mappe)  → entpacken, Chat lesen, Medien als eigene Quellen
//   Sprachnachrichten                 → Transkript (Whisper-kompatibler Endpunkt)
//   PDF / Bilder                      → Files API (einmal hochladen, file_id merken)
//   Text / DOCX                       → Text
// Ergebnis: die Content-Blöcke der ersten Nachricht an Claude + Quellen/Quellen-Uebersicht.md.
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { toFile } from "@anthropic-ai/sdk";
import { claude } from "./claude.js";
import { aendereMeta, ladeMeta, legeQuelleAb, melde, objektPfad } from "./store.js";
import { transkribiere, transkriptionAktiv } from "./transcribe.js";
import {
  parseWhatsApp, istWhatsAppExport, gruppenname, chatAlsText, imZeitraum, medienart,
} from "./whatsapp.js";

const MAX_BILDER = 60;
const MAX_TEXT = 400_000;
const BILD_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export function artVon(datei) {
  const e = extname(datei).toLowerCase();
  if (e === ".zip") return "zip";
  if (e === ".docx") return "docx";
  const a = medienart(datei);
  return a === "sonstig" ? "sonstig" : a;
}

export function neueQuelle(abgelegt, extra = {}) {
  return {
    id: randomBytes(5).toString("hex"),
    datei: abgelegt.datei, pfad: abgelegt.pfad, groesse: abgelegt.groesse,
    art: artVon(abgelegt.datei), hochgeladen: new Date().toISOString(), ...extra,
  };
}

async function docxText(puffer) {
  const zip = await JSZip.loadAsync(puffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// ZIP entpacken. Ist ein WhatsApp-Chat drin, wird die ZIP-Quelle zur Chat-Quelle
// und alle Medien hängen als Kinder daran (herkunft = id der ZIP).
async function entpacke(id, q, melden) {
  const zip = await JSZip.loadAsync(await readFile(objektPfad(id, q.pfad)));
  const ordner = `${basename(q.datei, extname(q.datei)).slice(0, 60)}_${q.id}`;
  const kinder = [];
  let chat = null;
  for (const eintrag of Object.values(zip.files)) {
    if (eintrag.dir) continue;
    const name = basename(eintrag.name);
    if (!name || name.startsWith(".") || eintrag.name.startsWith("__MACOSX")) continue;
    const puffer = await eintrag.async("nodebuffer");
    if (/\.txt$/i.test(name) && !chat) {
      const text = puffer.toString("utf8");
      if (istWhatsAppExport(text)) {
        const abgelegt = await legeQuelleAb(id, name, puffer, ordner);
        chat = { pfad: abgelegt.pfad, gruppe: gruppenname(q.datei) || gruppenname(name) };
        continue;
      }
    }
    const abgelegt = await legeQuelleAb(id, name, puffer, ordner);
    kinder.push(neueQuelle(abgelegt, { herkunft: q.id, anhangName: name }));
  }
  melden(`${q.datei}: ${kinder.length} Dateien entpackt${chat ? `, WhatsApp-Chat „${chat.gruppe || "ohne Namen"}“ erkannt` : ""}`);
  return { chat, kinder };
}

async function hochladen(id, q) {
  const puffer = await readFile(objektPfad(id, q.pfad));
  const ext = extname(q.datei).slice(1).toLowerCase();
  const type = q.art === "pdf" ? "application/pdf" : BILD_MIME[ext];
  const datei = await claude().files.upload({ file: await toFile(puffer, q.datei, { type }) });
  return datei.id;
}

// Alle noch unverarbeiteten Quellen durchlaufen. Idempotent: Transkripte und
// file_ids stehen danach in meta.json und werden beim nächsten Lauf wiederverwendet.
export async function verarbeiteQuellen(id) {
  const melden = (text) => melde(id, { typ: "status", text });

  // 1. ZIPs und Text-Exporte aufschlüsseln
  await aendereMeta(id, async (meta) => {
    for (const q of [...meta.quellen]) {
      if (q.art === "zip" && !q.entpackt) {
        const { chat, kinder } = await entpacke(id, q, melden);
        q.entpackt = true;
        if (chat) { q.art = "whatsapp"; q.chatPfad = chat.pfad; q.gruppe = chat.gruppe; }
        meta.quellen.push(...kinder);
      } else if (q.art === "text" && q.whatsapp === undefined) {
        const text = await readFile(objektPfad(id, q.pfad), "utf8");
        q.whatsapp = istWhatsAppExport(text);
        if (q.whatsapp) { q.art = "whatsapp"; q.chatPfad = q.pfad; q.gruppe = gruppenname(q.datei); }
      }
    }
  });

  // 2. Sprachnachrichten transkribieren, PDFs und Bilder hochladen
  const meta0 = await ladeMeta(id);
  const offen = meta0.quellen.filter((q) =>
    (q.art === "audio" && q.transkript == null && !q.transkriptFehler) ||
    ((q.art === "pdf" || (q.art === "bild" && BILD_MIME[extname(q.datei).slice(1).toLowerCase()])) && !q.fileId));
  for (const q of offen) {
    try {
      if (q.art === "audio") {
        if (!transkriptionAktiv()) continue;
        melden(`Transkribiere ${q.datei} …`);
        const text = await transkribiere(objektPfad(id, q.pfad));
        await aendereMeta(id, (m) => { m.quellen.find((x) => x.id === q.id).transkript = text; });
      } else {
        melden(`Lade ${q.datei} zu Claude hoch …`);
        const fileId = await hochladen(id, q);
        await aendereMeta(id, (m) => { m.quellen.find((x) => x.id === q.id).fileId = fileId; });
      }
    } catch (err) {
      melden(`⚠ ${q.datei}: ${err.message}`);
      await aendereMeta(id, (m) => {
        const x = m.quellen.find((y) => y.id === q.id);
        if (q.art === "audio") x.transkriptFehler = err.message; else x.uploadFehler = err.message;
      });
    }
  }
  return ladeMeta(id);
}

function deDatum(iso) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
}

function audioZeile(q) {
  if (q.transkript) return `🎤 Sprachnachricht (${q.anhangName || q.datei}) — Transkript (automatisch, Whisper):\n„${q.transkript}“`;
  if (q.transkriptFehler) return `🎤 Sprachnachricht (${q.anhangName || q.datei}) — Transkription fehlgeschlagen`;
  return `🎤 Sprachnachricht (${q.anhangName || q.datei}) — nicht transkribiert (kein Transkriptionsdienst eingerichtet)`;
}

// Content-Blöcke für die erste Nachricht an Claude + Quellen-Übersicht als Markdown.
// `nur`: Menge von Quellen-IDs (Rückfrage mit neu hochgeladenen Dateien).
export async function quellenBloecke(meta, { nur } = {}) {
  const bloecke = [];
  const uebersicht = [`# Quellen — ${meta.name}`, ""];
  const hinweise = [];
  let bilder = 0;

  const medienBlock = (q, kontext) => {
    if (q.art === "pdf" && q.fileId) {
      return { type: "document", source: { type: "file", file_id: q.fileId }, title: q.anhangName || q.datei, ...(kontext ? { context: kontext } : {}) };
    }
    if (q.art === "bild" && q.fileId) {
      if (bilder >= MAX_BILDER) { hinweise.push(`Bild ${q.datei} nicht übergeben (mehr als ${MAX_BILDER} Bilder)`); return null; }
      bilder++;
      return { type: "image", source: { type: "file", file_id: q.fileId } };
    }
    return null;
  };

  const kinderVon = (qid) => meta.quellen.filter((k) => k.herkunft === qid);

  for (const q of meta.quellen.filter((x) => !x.herkunft && (!nur || nur.has(x.id)))) {
    if (q.art === "whatsapp") {
      const text = await readFile(objektPfad(meta.id, q.chatPfad), "utf8");
      const alle = parseWhatsApp(text);
      const nachrichten = alle.filter((n) => imZeitraum(n, meta.zeitraum));
      const kinder = kinderVon(q.id);
      const referenziert = new Set(nachrichten.map((n) => n.anhang).filter(Boolean));
      const beschreibung = {};
      const anhangBloecke = [];
      for (const k of kinder) {
        const n = nachrichten.find((x) => x.anhang === k.anhangName);
        if (meta.zeitraum && !referenziert.has(k.anhangName)) continue;
        const wann = n ? `${n.absender || "?"}, ${n.zeit.replace("T", " ").slice(0, 16)}` : "ohne Zuordnung im Chat";
        if (k.art === "audio") beschreibung[k.anhangName] = audioZeile(k);
        else if (k.art === "pdf" || k.art === "bild") {
          const b = medienBlock(k, `WhatsApp-Anhang (${wann})`);
          if (b) {
            anhangBloecke.push({ type: "text", text: `WhatsApp-Anhang „${k.anhangName}“ (${wann}):` }, b);
            beschreibung[k.anhangName] = k.art === "pdf" ? `📄 Dokument „${k.anhangName}“ (liegt unten als Dokument bei)` : `🖼 Bild „${k.anhangName}“ (liegt unten bei)`;
          } else beschreibung[k.anhangName] = `Anhang „${k.anhangName}“ (${k.uploadFehler ? "Upload fehlgeschlagen" : "nicht übergeben"})`;
        } else if (k.art === "text") {
          const t = await readFile(objektPfad(meta.id, k.pfad), "utf8");
          beschreibung[k.anhangName] = `Textdatei „${k.anhangName}“:\n${t.slice(0, 20000)}`;
        } else {
          beschreibung[k.anhangName] = `Anhang „${k.anhangName}“ (${k.art}, nicht auswertbar)`;
        }
      }
      const chat = chatAlsText(nachrichten, { titel: q.gruppe || q.datei, medien: beschreibung });
      bloecke.push({ type: "text", text: `<quelle art="whatsapp" datei="${q.datei}">\n${chat}\n</quelle>` }, ...anhangBloecke);
      uebersicht.push(`## WhatsApp: ${q.gruppe || q.datei}`, "", "```", chat, "```", "");
      if (meta.zeitraum) hinweise.push(`WhatsApp „${q.gruppe || q.datei}“: ${nachrichten.length} von ${alle.length} Nachrichten im gewählten Zeitraum`);
      continue;
    }
    if (q.art === "zip") {
      for (const k of kinderVon(q.id)) {
        const b = await einzelBlock(meta, k, medienBlock, hinweise);
        if (b) bloecke.push(...b);
        uebersicht.push(`- ${q.datei} → ${k.datei}`);
      }
      continue;
    }
    const b = await einzelBlock(meta, q, medienBlock, hinweise);
    if (b) bloecke.push(...b);
    uebersicht.push(q.art === "audio" ? `## ${q.datei}\n\n${audioZeile(q)}\n` : `- ${q.datei} (${q.art})`);
  }

  if (hinweise.length) uebersicht.push("", "## Hinweise", ...hinweise.map((h) => `- ${h}`));
  if (!nur) await writeFile(objektPfad(meta.id, "Quellen", "Quellen-Uebersicht.md"), uebersicht.join("\n"));
  return { bloecke, hinweise };
}

async function einzelBlock(meta, q, medienBlock, hinweise) {
  const label = { type: "text", text: `Quelle „${q.datei}“ (hochgeladen ${deDatum(q.hochgeladen)}):` };
  if (q.art === "pdf" || q.art === "bild") {
    const b = medienBlock(q, null);
    if (!b) { hinweise.push(`${q.datei} konnte nicht übergeben werden${q.uploadFehler ? `: ${q.uploadFehler}` : ""}`); return null; }
    return [label, b];
  }
  if (q.art === "audio") return [{ type: "text", text: `<quelle art="sprachnachricht" datei="${q.datei}">\n${audioZeile(q)}\n</quelle>` }];
  if (q.art === "text" || q.art === "docx") {
    const puffer = await readFile(objektPfad(meta.id, q.pfad));
    let text = q.art === "docx" ? await docxText(puffer) : puffer.toString("utf8");
    if (text.length > MAX_TEXT) {
      hinweise.push(`${q.datei} ist sehr lang — nur die ersten ${MAX_TEXT.toLocaleString("de-DE")} Zeichen übergeben`);
      text = text.slice(0, MAX_TEXT);
    }
    return [{ type: "text", text: `<quelle art="text" datei="${q.datei}">\n${text}\n</quelle>` }];
  }
  hinweise.push(`${q.datei}: Dateityp wird nicht ausgewertet`);
  return null;
}

// Nach Upload: Datei ablegen und als Quelle registrieren.
export async function nimmDateiAuf(id, name, puffer) {
  const abgelegt = await legeQuelleAb(id, name, puffer);
  const q = neueQuelle(abgelegt);
  await aendereMeta(id, (m) => { m.quellen.push(q); });
  return q;
}
