// Anthropic-API-Schlüssel: kommt aus .env (ANTHROPIC_API_KEY) oder wird einmal von einem
// Admin in der App eingegeben und dann nur hier gespeichert (DATA_DIR/geheim.json, 0600).
// Er wird nie wieder an den Browser geschickt — nur „gesetzt“ und die letzten 4 Zeichen.
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { setzeClaudeZurueck } from "./claude.js";

const DATEI = () => join(config.dataDir, "geheim.json");
const ausEnv = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function ladeApiSchluessel() {
  if (ausEnv) return;
  try {
    const { anthropicApiKey } = JSON.parse(await readFile(DATEI(), "utf8"));
    if (anthropicApiKey) process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  } catch (e) { if (e.code !== "ENOENT") throw e; }
}

export function apiSchluesselStatus() {
  const k = process.env.ANTHROPIC_API_KEY || "";
  return { gesetzt: Boolean(k || process.env.ANTHROPIC_AUTH_TOKEN), ende: k ? k.slice(-4) : null, ausEnv };
}

// Prüft den Schlüssel mit einer kostenlosen Anfrage (Modellliste) und speichert ihn dann
export async function speichereApiSchluessel(schluessel, { pruefen = true } = {}) {
  const k = String(schluessel || "").trim();
  if (ausEnv) throw Object.assign(new Error("Der Schlüssel steht in der .env auf dem Server und wird dort geändert."), { status: 400 });
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw Object.assign(new Error("Das sieht nicht wie ein Anthropic-Schlüssel aus (beginnt mit sk-ant-)."), { status: 400 });
  if (pruefen) {
    try {
      await new Anthropic({ apiKey: k, maxRetries: 1, timeout: 20000 }).models.list({ limit: 1 });
    } catch (err) {
      const status = err?.status;
      if (status === 401 || status === 403) throw Object.assign(new Error("Anthropic lehnt diesen Schlüssel ab. Bitte in der Console prüfen."), { status: 400 });
      throw Object.assign(new Error(`Schlüssel konnte gerade nicht geprüft werden (${err.message}). Bitte gleich noch einmal.`), { status: 400 });
    }
  }
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(DATEI(), JSON.stringify({ anthropicApiKey: k, gesetzt: new Date().toISOString() }), { mode: 0o600 });
  await chmod(DATEI(), 0o600);
  process.env.ANTHROPIC_API_KEY = k;
  setzeClaudeZurueck();
  return apiSchluesselStatus();
}
