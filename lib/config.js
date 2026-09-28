// Alle Einstellungen kommen aus der Umgebung (siehe .env.example).
import { resolve } from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  dataDir: resolve(env.DATA_DIR || "./daten"),
  sessionSecret: env.SESSION_SECRET || "",
  publicUrl: env.PUBLIC_URL || "",
  ohneLogin: env.UNSICHER_OHNE_LOGIN === "1", // nur lokal zum Entwickeln

  // Anmeldung über Supabase (wie BauDoc). Publishable Key ist öffentlich — nie den service_role-Key eintragen.
  supabaseUrl: (env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || "",
  adminEmails: (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),

  // Claude
  model: env.CLAUDE_MODEL || "claude-opus-5",
  effort: env.CLAUDE_EFFORT || "high",
  maxTokens: Number(env.CLAUDE_MAX_TOKENS || 64000),
  fallbacks: env.CLAUDE_FALLBACKS !== "off",
  webSearchMaxUses: Number(env.WEB_SEARCH_MAX_USES || 20),
  webFetchMaxUses: Number(env.WEB_FETCH_MAX_USES || 15),

  // Sprachnachrichten: jeder Whisper-kompatible Endpunkt (OpenAI, Groq, lokaler whisper.cpp-Server)
  transcribeUrl: env.TRANSCRIBE_URL || "",
  transcribeKey: env.TRANSCRIBE_API_KEY || "",
  transcribeModel: env.TRANSCRIBE_MODEL || "whisper-large-v3-turbo",

  // WhatsApp-Bridge: gemeinsames Volume mit nachrichten.db, medien/, status.json, qr.png
  waStore: env.WA_STORE ? resolve(env.WA_STORE) : "",

  // Mit dem Server geteilter Ordner für „Nach Updates suchen“ (siehe lib/aktualisierung.js)
  auftragDir: env.AUFTRAG_DIR ? resolve(env.AUFTRAG_DIR) : "",

  // Optional: echte FixFlip-Pro-Dateien (index.html + standalone/build.py)
  fixflipDir: env.FIXFLIP_DIR ? resolve(env.FIXFLIP_DIR) : "",

  chromePath: env.CHROME_PATH || "",
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 300),
};
