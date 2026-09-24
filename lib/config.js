// Alle Einstellungen kommen aus der Umgebung (siehe .env.example).
import { resolve } from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  dataDir: resolve(env.DATA_DIR || "./daten"),
  appPassword: env.APP_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  publicUrl: env.PUBLIC_URL || "",

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

  // Optional: echte FixFlip-Pro-Dateien (index.html + standalone/build.py)
  fixflipDir: env.FIXFLIP_DIR ? resolve(env.FIXFLIP_DIR) : "",

  chromePath: env.CHROME_PATH || "",
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 300),
};
