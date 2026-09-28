// Der Lauf: Quellen aufbereiten → Claude (Websuche + Rechen-/Dokument-Werkzeuge) → Dokumente.
// Rückfragen der Partner hängen sich an denselben Verlauf an, wie im Chat mit Claude.
import Anthropic from "@anthropic-ai/sdk";
import { claude } from "./claude.js";
import { config } from "./config.js";
import { aendereMeta, ladeMeta, leseJson, schreibeJson, objektPfad, melde, leereKanal } from "./store.js";
import { verarbeiteQuellen, quellenBloecke } from "./ingest.js";
import { ladeEinstellungen } from "./einstellungen.js";
import { systemPrompt, auftragErsteNachricht } from "./prompt.js";
import { WERKZEUGE, fuehreAus } from "./werkzeuge.js";

const MAX_RUNDEN = 40;
const laufend = new Set();

export function laeuft(id) {
  return laufend.has(id);
}

export function anzahlLaufend() {
  return laufend.size;
}

function serverWerkzeuge() {
  return [
    {
      type: "web_search_20260209", name: "web_search", max_uses: config.webSearchMaxUses,
      user_location: { type: "approximate", city: "Stuttgart", region: "Baden-Württemberg", country: "DE", timezone: "Europe/Berlin" },
    },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: config.webFetchMaxUses },
  ];
}

function anfrage(system, messages) {
  const params = {
    model: config.model,
    max_tokens: config.maxTokens,
    system,
    messages,
    tools: [...serverWerkzeuge(), ...WERKZEUGE],
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: config.effort },
    cache_control: { type: "ephemeral" },
  };
  if (config.fallbacks) {
    // Lehnt ein Sicherheitsfilter eine Anfrage ab, rechnet die API sie serverseitig
    // mit dem empfohlenen Ersatzmodell neu, statt nur „refusal“ zurückzugeben.
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function textVon(inhalt) {
  return inhalt.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

function beschreibeServerWerkzeug(b) {
  const e = b.input || {};
  if (b.name === "web_search") return `Websuche: ${e.query || ""}`;
  if (b.name === "web_fetch") return `Seite lesen: ${e.url || ""}`;
  return b.name;
}

async function ersteNachricht(id) {
  const meta = await verarbeiteQuellen(id);
  const { bloecke, hinweise } = await quellenBloecke(meta);
  if (!bloecke.length && !meta.notizen) throw new Error("Keine auswertbaren Quellen — bitte Exposé, Chat oder Notiz hochladen.");
  await aendereMeta(id, (m) => { for (const q of m.quellen) q.gesendet = true; });
  const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
  return {
    role: "user",
    content: [{ type: "text", text: auftragErsteNachricht({ name: meta.name, notizen: meta.notizen, heute, hinweise }) }, ...bloecke],
  };
}

// Rückfrage: Text der Partner + Quellen, die seit dem letzten Lauf dazugekommen sind.
async function folgeNachricht(id, text) {
  const meta = await verarbeiteQuellen(id);
  const neue = new Set(meta.quellen.filter((q) => !q.gesendet && !q.herkunft).map((q) => q.id));
  const content = [{ type: "text", text }];
  if (neue.size) {
    const { bloecke } = await quellenBloecke(meta, { nur: neue });
    content.push({ type: "text", text: "Neu hochgeladene Quellen:" }, ...bloecke);
    await aendereMeta(id, (m) => { for (const q of m.quellen) q.gesendet = true; });
  }
  return { role: "user", content };
}

export async function starteLauf(id, { nachricht } = {}) {
  if (laufend.has(id)) throw Object.assign(new Error("Für dieses Objekt läuft bereits eine Analyse."), { status: 409 });
  laufend.add(id);
  leereKanal(id);
  const lauf = { start: new Date().toISOString(), nachricht: nachricht || null, status: "laeuft", usage: {} };
  await aendereMeta(id, (m) => { m.status = "laeuft"; m.laeufe.push(lauf); });
  lauflogik(id, nachricht)
    .catch(async (err) => {
      console.error(`[lauf ${id}]`, err);
      const text = err instanceof Anthropic.APIError ? `Claude-API: ${err.status} ${err.message}` : err.message;
      melde(id, { typ: "fehler", text });
      await aendereMeta(id, (m) => {
        m.status = "fehler";
        Object.assign(m.laeufe[m.laeufe.length - 1], { status: "fehler", fehler: text, ende: new Date().toISOString() });
      }).catch(() => {});
    })
    .finally(() => laufend.delete(id));
}

// Ein abgebrochener Lauf (Neustart, Absturz) kann den Verlauf mit offenen Werkzeugaufrufen
// hinterlassen — die API verlangt zu jedem tool_use ein tool_result.
function repariereVerlauf(messages) {
  const letzte = messages[messages.length - 1];
  if (letzte?.role !== "assistant" || !Array.isArray(letzte.content)) return;
  const offen = letzte.content.filter((b) => b.type === "tool_use");
  if (offen.length) {
    messages.push({ role: "user", content: offen.map((b) => ({
      type: "tool_result", tool_use_id: b.id, is_error: true, content: "Abgebrochen (Lauf wurde unterbrochen).",
    })) });
  }
}

async function lauflogik(id, nachricht) {
  const melden = (e) => melde(id, e);
  const verlaufPfad = objektPfad(id, "verlauf.json");
  let messages = await leseJson(verlaufPfad, []);
  // Ist der erste Lauf gescheitert, bevor Claude geantwortet hat, beginnt der nächste neu.
  if (!messages.some((m) => m.role === "assistant")) messages = [];
  repariereVerlauf(messages);
  const system = systemPrompt(await ladeEinstellungen());

  melden({ typ: "status", text: "Quellen werden aufbereitet …" });
  messages.push(messages.length ? await folgeNachricht(id, nachricht || "Bitte aktualisiere die Kalkulation.") : await ersteNachricht(id));
  await schreibeJson(verlaufPfad, messages);

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };
  let jsonFehler = 0;
  let letzteAntwort = "";

  for (let runde = 0; runde < MAX_RUNDEN; runde++) {
    melden({ typ: "status", text: runde === 0 ? "Claude liest die Quellen …" : "Claude arbeitet weiter …" });
    const stream = claude().beta.messages.stream(anfrage(system, messages));
    stream.on("text", (delta) => melden({ typ: "text", text: delta }));
    stream.on("thinking", (delta) => melden({ typ: "denken", text: delta }));
    stream.on("contentBlock", (b) => {
      if (b.type === "server_tool_use") melden({ typ: "werkzeug", name: b.name, text: beschreibeServerWerkzeug(b) });
      if (b.type === "text" || b.type === "thinking") melden({ typ: "absatz" });
    });

    let antwort;
    try {
      antwort = await stream.finalMessage();
      jsonFehler = 0;
    } catch (err) {
      // Nur eine nicht lesbare Werkzeug-Eingabe wird wiederholt; API-Fehler gehen nach oben.
      if (err instanceof Anthropic.APIError || ++jsonFehler > 2) throw err;
      melden({ typ: "status", text: "Werkzeug-Eingabe nicht lesbar — Runde wird wiederholt." });
      continue;
    }

    for (const k of Object.keys(usage)) {
      if (k === "web_search_requests") usage[k] += antwort.usage?.server_tool_use?.web_search_requests || 0;
      else usage[k] += antwort.usage?.[k] || 0;
    }

    if (antwort.stop_reason === "refusal") {
      throw new Error("Claude hat die Anfrage abgelehnt (Sicherheitsfilter). Bitte Quellen prüfen oder anders formulieren.");
    }

    messages.push({ role: "assistant", content: antwort.content });
    await schreibeJson(verlaufPfad, messages);
    const text = textVon(antwort.content);
    if (text) letzteAntwort = text;

    if (antwort.stop_reason === "pause_turn") continue;

    const aufrufe = antwort.content.filter((b) => b.type === "tool_use");
    if (!aufrufe.length) {
      if (antwort.stop_reason === "max_tokens") melden({ typ: "status", text: "⚠ Antwort wurde bei max_tokens abgeschnitten." });
      break;
    }
    if (antwort.stop_reason === "max_tokens") {
      throw new Error("Werkzeug-Eingabe bei max_tokens abgeschnitten — CLAUDE_MAX_TOKENS erhöhen.");
    }

    const ergebnisse = [];
    for (const b of aufrufe) {
      let inhalt, fehler = false;
      try {
        const r = await fuehreAus(id, b.name, b.input || {}, melden);
        fehler = Boolean(r && r.fehler);
        inhalt = JSON.stringify(r);
      } catch (err) {
        fehler = true;
        inhalt = JSON.stringify({ fehler: [err.message] });
        melden({ typ: "status", text: `⚠ ${b.name}: ${err.message}` });
      }
      ergebnisse.push({ type: "tool_result", tool_use_id: b.id, content: inhalt, ...(fehler ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: ergebnisse });
    await schreibeJson(verlaufPfad, messages);
  }

  await aendereMeta(id, (m) => {
    const l = m.laeufe[m.laeufe.length - 1];
    Object.assign(l, { status: "fertig", ende: new Date().toISOString(), antwort: letzteAntwort, usage, modell: config.model });
    m.status = m.dokumente.length ? "fertig" : "beantwortet";
  });
  melden({ typ: "fertig", text: letzteAntwort });
}

// Beim Start: Läufe, die ein Neustart unterbrochen hat, als Fehler markieren.
export async function markiereUnterbrocheneLaeufe(ids) {
  for (const id of ids) {
    await aendereMeta(id, (m) => {
      if (m.status !== "laeuft") return;
      m.status = "fehler";
      const l = m.laeufe[m.laeufe.length - 1];
      if (l && l.status === "laeuft") Object.assign(l, { status: "fehler", fehler: "Lauf wurde durch einen Neustart des Servers unterbrochen.", ende: new Date().toISOString() });
    }).catch(() => {});
  }
}

// Verlauf für die Anzeige: nur Nachrichten der Partner und Claudes Texte.
export async function gespraech(id) {
  const meta = await ladeMeta(id);
  return meta.laeufe.map((l) => ({ start: l.start, frage: l.nachricht, antwort: l.antwort, status: l.status, fehler: l.fehler, usage: l.usage }));
}
