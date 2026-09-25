import Anthropic from "@anthropic-ai/sdk";

let client = null;

// Liest ANTHROPIC_API_KEY aus der Umgebung (.env oder in der App eingegeben, siehe geheim.js).
export function claude() {
  if (!client) client = new Anthropic({ timeout: 20 * 60 * 1000, maxRetries: 3 });
  return client;
}

// Nach einem neuen Schlüssel den Client neu anlegen
export function setzeClaudeZurueck() { client = null; }
