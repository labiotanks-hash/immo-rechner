// Sprachnachrichten → Text. Die Claude-API nimmt kein Audio an, deshalb läuft das
// über einen Whisper-kompatiblen Endpunkt (POST multipart /audio/transcriptions):
//   Groq:   https://api.groq.com/openai/v1/audio/transcriptions  (whisper-large-v3-turbo)
//   OpenAI: https://api.openai.com/v1/audio/transcriptions        (whisper-1)
//   lokal:  whisper.cpp-Server / faster-whisper-server im selben Docker-Netz
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "./config.js";

export function transkriptionAktiv() {
  return Boolean(config.transcribeUrl);
}

// WhatsApp-Sprachnachrichten sind Ogg/Opus mit Endung .opus — viele Endpunkte
// kennen die Endung nicht, den Container aber schon.
function uploadName(pfad) {
  const b = basename(pfad);
  return /\.opus$/i.test(b) ? b.replace(/\.opus$/i, ".ogg") : b;
}

const MIME = { ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac",
  wav: "audio/wav", webm: "audio/webm", amr: "audio/amr" };

export async function transkribiere(pfad) {
  if (!transkriptionAktiv()) return null;
  const name = uploadName(pfad);
  const ext = name.split(".").pop().toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([await readFile(pfad)], { type: MIME[ext] || "application/octet-stream" }), name);
  form.append("model", config.transcribeModel);
  form.append("language", "de");
  form.append("response_format", "json");
  const antwort = await fetch(config.transcribeUrl, {
    method: "POST",
    headers: config.transcribeKey ? { Authorization: `Bearer ${config.transcribeKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!antwort.ok) {
    const text = await antwort.text().catch(() => "");
    throw new Error(`Transkription fehlgeschlagen (${antwort.status}): ${text.slice(0, 300)}`);
  }
  const daten = await antwort.json();
  return String(daten.text || "").trim();
}
