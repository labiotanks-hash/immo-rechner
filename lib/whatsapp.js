// WhatsApp-Export ("Chat exportieren" → mit Medien) lesen.
//
// iOS:     [24.09.26, 17:35:12] Name: ‎<Anhang: 00000012-AUDIO-2026-09-24-17-35-12.opus>
// Android: 24.09.26, 17:35 - Name: PTT-20260924-WA0003.opus (Datei angehängt)
// Englische Oberflächen: "<attached: …>", "(file attached)", Datum m/d/yy mit AM/PM.
// Folgezeilen ohne Zeitstempel gehören zur vorherigen Nachricht.

const UNSICHTBAR = /[‎‏‪-‮⁦-⁩﻿]/g;

const RE_IOS = /^\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]\s?(.*)$/;
const RE_ANDROID = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\s[-–]\s(.*)$/;
const RE_ANHANG_IOS = /<(?:Anhang|attached|Adjunto|Allegato|Pièce jointe)\s*:\s*([^>]+)>/i;
const RE_ANHANG_ANDROID = /^(.+?\.[A-Za-z0-9]{2,5})\s\((?:Datei angehängt|file attached|archivo adjunto|file allegato|fichier joint)\)/i;
const RE_WEGGELASSEN = /^(?:<Medien ausgeschlossen>|<Media omitted>|(?:Audio|Bild|Video|Dokument|Sticker|GIF|image|audio|video|document|sticker) (?:weggelassen|omitted))$/i;

export const MEDIENART = {
  audio: /\.(opus|ogg|oga|m4a|mp3|aac|wav|amr|webm)$/i,
  bild: /\.(jpe?g|png|webp|gif|heic)$/i,
  pdf: /\.pdf$/i,
  video: /\.(mp4|mov|3gp|mkv)$/i,
  text: /\.(txt|md|csv|json|vcf)$/i,
};

export function medienart(dateiname) {
  for (const [art, re] of Object.entries(MEDIENART)) if (re.test(dateiname)) return art;
  return "sonstig";
}

// Erkennt, ob ein Text ein WhatsApp-Export ist (mind. 2 Zeilen mit Zeitstempel-Kopf).
export function istWhatsAppExport(text) {
  let treffer = 0;
  for (const zeile of text.split(/\r?\n/, 50)) {
    const z = zeile.replace(UNSICHTBAR, "").trim();
    if (RE_IOS.test(z) || RE_ANDROID.test(z)) treffer++;
    if (treffer >= 2) return true;
  }
  return false;
}

function jahr4(j) {
  const y = Number(j);
  return y < 100 ? 2000 + y : y;
}

// Datum-Reihenfolge einmal für den ganzen Export bestimmen: Punkt = T.M.J,
// Schrägstrich = M/T/J (US) — außer eine Zeile hat an erster Stelle > 12.
function datumsFormat(zeilen) {
  let punkt = 0, strich = 0, ersteGroesser12 = false, zweiteGroesser12 = false, jahrZuerst = false;
  for (const z of zeilen) {
    const m = z.match(RE_IOS) || z.match(RE_ANDROID);
    if (!m) continue;
    const trenner = z.match(/\d[./-]/);
    if (trenner && trenner[0].endsWith(".")) punkt++; else strich++;
    if (Number(m[1]) > 31) jahrZuerst = true;
    if (Number(m[1]) > 12) ersteGroesser12 = true;
    if (Number(m[2]) > 12) zweiteGroesser12 = true;
  }
  if (jahrZuerst) return "jmt";
  if (punkt >= strich) return "tmj";
  if (ersteGroesser12) return "tmj";
  if (zweiteGroesser12) return "mtj";
  return "mtj";
}

function zeitstempel(m, format) {
  let [, a, b, c, hh, mm, ss, ampm] = m;
  let tag, monat, jahr;
  if (format === "jmt") { jahr = jahr4(a); monat = Number(b); tag = Number(c); }
  else if (format === "mtj") { monat = Number(a); tag = Number(b); jahr = jahr4(c); }
  else { tag = Number(a); monat = Number(b); jahr = jahr4(c); }
  let h = Number(hh);
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  const p = (x) => String(x).padStart(2, "0");
  return `${jahr}-${p(monat)}-${p(tag)}T${p(h)}:${p(mm)}:${p(ss || 0)}`;
}

export function parseWhatsApp(text) {
  const zeilen = text.replace(/\r\n?/g, "\n").split("\n")
    .map((z) => z.replace(UNSICHTBAR, "").replace(/[  ]/g, " "));
  const format = datumsFormat(zeilen.slice(0, 500));
  const nachrichten = [];
  for (const roh of zeilen) {
    const z = roh.trimEnd();
    const m = z.match(RE_IOS) || z.match(RE_ANDROID);
    if (!m) {
      if (nachrichten.length && z.trim()) {
        const letzte = nachrichten[nachrichten.length - 1];
        letzte.text = letzte.text ? `${letzte.text}\n${z}` : z;
      }
      continue;
    }
    const rest = m[8];
    const doppelpunkt = rest.indexOf(": ");
    let absender = null, inhalt = rest;
    if (doppelpunkt > 0 && doppelpunkt < 80) {
      absender = rest.slice(0, doppelpunkt).trim();
      inhalt = rest.slice(doppelpunkt + 2);
    }
    const n = { zeit: zeitstempel(m, format), absender, text: inhalt.trim(), anhang: null, weggelassen: false };
    const ios = n.text.match(RE_ANHANG_IOS);
    const android = n.text.match(RE_ANHANG_ANDROID);
    if (ios) {
      n.anhang = ios[1].trim();
      n.text = n.text.replace(RE_ANHANG_IOS, "").trim();
    } else if (android) {
      n.anhang = android[1].trim();
      n.text = n.text.slice(android[0].length).trim();
    } else if (RE_WEGGELASSEN.test(n.text)) {
      n.weggelassen = true;
    }
    if (!absender) n.system = true;
    nachrichten.push(n);
  }
  return nachrichten;
}

// Gruppenname aus dem Dateinamen: "WhatsApp Chat - Ankauf Team.zip",
// "WhatsApp Chat mit Ankauf Team.txt", "WhatsApp Chat with …".
export function gruppenname(dateiname) {
  const m = String(dateiname).match(/WhatsApp[ -]Chat(?:\s*[-–]\s*|\s+mit\s+|\s+with\s+)(.+?)(?:\.(?:zip|txt))?$/i);
  return m ? m[1].trim() : null;
}

export function imZeitraum(n, zeitraum) {
  if (!zeitraum) return true;
  const tag = n.zeit.slice(0, 10);
  if (zeitraum.von && tag < zeitraum.von) return false;
  if (zeitraum.bis && tag > zeitraum.bis) return false;
  return true;
}

function deZeit(iso) {
  const [d, t] = iso.split("T");
  const [j, mo, ta] = d.split("-");
  return `${ta}.${mo}.${j} ${t.slice(0, 5)}`;
}

// Chat als Text für Claude. `medien` liefert je Anhang-Dateiname eine Beschreibung
// (Transkript, "liegt als Dokument bei" …).
export function chatAlsText(nachrichten, { titel, medien = {} } = {}) {
  const teile = [];
  if (titel) teile.push(`# WhatsApp: ${titel}`);
  if (nachrichten.length) {
    teile.push(`Zeitraum: ${deZeit(nachrichten[0].zeit)} – ${deZeit(nachrichten[nachrichten.length - 1].zeit)}, ${nachrichten.length} Nachrichten`);
  }
  teile.push("");
  for (const n of nachrichten) {
    const wer = n.absender || "System";
    let inhalt = n.text;
    if (n.anhang) {
      const info = medien[n.anhang] || `Anhang „${n.anhang}“ (nicht im Export enthalten)`;
      inhalt = inhalt ? `${info}\n    Begleittext: ${inhalt}` : info;
    } else if (n.weggelassen) {
      inhalt = `(${n.text} — Medium beim Export nicht mitgenommen)`;
    }
    teile.push(`[${deZeit(n.zeit)}] ${wer}: ${inhalt.replace(/\n/g, "\n    ")}`);
  }
  return teile.join("\n");
}
