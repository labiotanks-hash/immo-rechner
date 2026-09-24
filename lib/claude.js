import Anthropic from "@anthropic-ai/sdk";

let client = null;

// Liest ANTHROPIC_API_KEY aus der Umgebung (nie im Code oder Repo ablegen).
export function claude() {
  if (!client) client = new Anthropic({ timeout: 20 * 60 * 1000, maxRetries: 3 });
  return client;
}
