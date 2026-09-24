// A²O Immo-Rechner — Web-App für Ankaufskalkulation und FixFlip-Pro-Rechner über die Claude API.
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./lib/config.js";
import {
  listeObjekte, neuesObjekt, ladeMeta, aendereMeta, loescheObjekt, objektPfad, kanal,
} from "./lib/store.js";
import { nimmDateiAuf } from "./lib/ingest.js";
import { starteLauf, laeuft, gespraech, markiereUnterbrocheneLaeufe } from "./lib/agent.js";
import { ladeEinstellungen, speichereEinstellungen } from "./lib/einstellungen.js";
import { engine } from "./lib/engine.js";
import { transkriptionAktiv } from "./lib/transcribe.js";
import { originalBuildVorhanden } from "./lib/render/rechner.js";
import { chromePfad } from "./lib/render/pdf.js";
import { claude } from "./lib/claude.js";
import {
  angemeldet, nurAngemeldet, nurAdmin, emailAusSupabaseToken, setzeSitzung, beendeSitzung, loginGesperrt, loginFehlversuch,
} from "./lib/auth.js";
import { ladeZugang, darfRein, zugangsliste, fuegeHinzu, entferne } from "./lib/zugang.js";
import { waStatus, waNachrichten, waMedium, qrPfad, exportiereAlsZip, starteHintergrund } from "./lib/whatsapp-live.js";

if (config.ohneLogin) {
  console.warn("⚠ Ohne Login gestartet (UNSICHER_OHNE_LOGIN=1) — nur lokal verwenden.");
  config.sessionSecret ||= "lokal";
} else {
  const fehlt = [
    ["SESSION_SECRET", config.sessionSecret], ["SUPABASE_URL", config.supabaseUrl],
    ["SUPABASE_PUBLISHABLE_KEY", config.supabaseKey], ["ADMIN_EMAILS", config.adminEmails.length],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (fehlt.length) {
    console.error(`Bitte in .env setzen: ${fehlt.join(", ")} (siehe .env.example).`);
    process.exit(1);
  }
}
await ladeZugang();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 200 },
});

// multer liefert Dateinamen als latin1 — WhatsApp-Namen mit Umlauten sonst kaputt
const dateiname = (f) => Buffer.from(f.originalname, "latin1").toString("utf8");

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Anmeldung ───────────────────────────────────────────────────────────────
// Für den Browser: womit er sich bei Supabase meldet (alles öffentliche Werte)
app.get("/api/konfig", (req, res) => {
  res.json({ supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey, ohneLogin: config.ohneLogin });
});

// Supabase-Token gegen eigenes Sitzungs-Cookie tauschen
app.post("/api/sitzung", asyncRoute(async (req, res) => {
  if (loginGesperrt(req.ip)) return res.status(429).json({ fehler: "Zu viele Versuche — bitte 15 Minuten warten." });
  const email = await emailAusSupabaseToken(req.body?.token);
  if (!email) {
    loginFehlversuch(req.ip);
    return res.status(401).json({ fehler: "Der Anmeldelink ist abgelaufen oder ungültig. Bitte neu anfordern." });
  }
  if (!darfRein(email)) {
    loginFehlversuch(req.ip);
    return res.status(403).json({ fehler: `${email} hat noch keinen Zugang zum Immo-Rechner. Bitte bei A²O melden.` });
  }
  setzeSitzung(res, email);
  res.json({ ok: true, email });
}));
app.post("/api/logout", (req, res) => { beendeSitzung(res); res.json({ ok: true }); });

app.use("/api", nurAngemeldet);

app.get("/api/ich", (req, res) => res.json(req.nutzer));

// ── Zugang (nur Admins) ─────────────────────────────────────────────────────
app.get("/api/zugang", nurAdmin, (req, res) => res.json(zugangsliste()));
app.post("/api/zugang", nurAdmin, asyncRoute(async (req, res) => {
  res.json(await fuegeHinzu(req.body?.email, req.body?.name, req.nutzer.email));
}));
app.delete("/api/zugang/:email", nurAdmin, asyncRoute(async (req, res) => {
  res.json(await entferne(req.params.email));
}));


app.get("/api/status", asyncRoute(async (req, res) => {
  res.json({
    modell: config.model, effort: config.effort, rechenkern: engine().quelle,
    transkription: transkriptionAktiv(), originalBuild: originalBuildVorhanden(), pdf: Boolean(chromePfad()),
    apiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  });
}));

// ── Objekte ─────────────────────────────────────────────────────────────────
app.get("/api/objekte", asyncRoute(async (req, res) => res.json(await listeObjekte())));

app.post("/api/objekte", asyncRoute(async (req, res) => {
  const meta = await neuesObjekt(String(req.body?.name || "").slice(0, 160), String(req.body?.notizen || "").slice(0, 20000));
  res.status(201).json(meta);
}));

function oeffentlich(meta) {
  return {
    ...meta,
    laeuft: laeuft(meta.id),
    quellen: meta.quellen.map(({ fileId, ...q }) => ({ ...q, hochgeladenZuClaude: Boolean(fileId) })),
  };
}

app.get("/api/objekte/:id", asyncRoute(async (req, res) => {
  const meta = await ladeMeta(req.params.id);
  res.json({ ...oeffentlich(meta), gespraech: await gespraech(req.params.id) });
}));

app.patch("/api/objekte/:id", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const meta = await aendereMeta(req.params.id, (m) => {
    if (typeof b.name === "string") m.name = b.name.slice(0, 160);
    if (typeof b.notizen === "string") m.notizen = b.notizen.slice(0, 20000);
    if (b.zeitraum === null) m.zeitraum = null;
    else if (b.zeitraum && typeof b.zeitraum === "object") {
      const d = (x) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
      m.zeitraum = { von: d(b.zeitraum.von), bis: d(b.zeitraum.bis) };
      if (!m.zeitraum.von && !m.zeitraum.bis) m.zeitraum = null;
    }
  });
  res.json(oeffentlich(meta));
}));

app.delete("/api/objekte/:id", asyncRoute(async (req, res) => {
  if (laeuft(req.params.id)) return res.status(409).json({ fehler: "Analyse läuft noch." });
  const meta = await ladeMeta(req.params.id);
  // Bei Claude hochgeladene Dateien mitlöschen (Datenschutz), Fehler dabei nicht fatal
  await Promise.allSettled(meta.quellen.filter((q) => q.fileId).map((q) => claude().files.delete(q.fileId)));
  await loescheObjekt(req.params.id);
  res.json({ ok: true });
}));

app.post("/api/objekte/:id/dateien", upload.array("dateien"), asyncRoute(async (req, res) => {
  await ladeMeta(req.params.id);
  const neu = [];
  for (const f of req.files || []) neu.push(await nimmDateiAuf(req.params.id, dateiname(f), f.buffer));
  res.status(201).json(neu);
}));

app.delete("/api/objekte/:id/quellen/:qid", asyncRoute(async (req, res) => {
  let geloescht = null;
  await aendereMeta(req.params.id, (m) => {
    const q = m.quellen.find((x) => x.id === req.params.qid);
    if (!q) return;
    if (q.gesendet) throw Object.assign(new Error("Quelle wurde schon an Claude übergeben."), { status: 409 });
    geloescht = q;
    m.quellen = m.quellen.filter((x) => x.id !== q.id && x.herkunft !== q.id);
  });
  if (geloescht?.fileId) await claude().files.delete(geloescht.fileId).catch(() => {});
  res.json({ ok: Boolean(geloescht) });
}));

app.post("/api/objekte/:id/analyse", asyncRoute(async (req, res) => {
  await ladeMeta(req.params.id);
  await starteLauf(req.params.id, { nachricht: req.body?.nachricht ? String(req.body.nachricht).slice(0, 20000) : undefined });
  res.status(202).json({ ok: true });
}));

// Live-Fortschritt als Server-Sent Events (erst der Puffer, dann neue Ereignisse)
app.get("/api/objekte/:id/ereignisse", asyncRoute(async (req, res) => {
  await ladeMeta(req.params.id);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.flushHeaders();
  const k = kanal(req.params.id);
  const senden = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  for (const e of k.puffer) senden(e);
  k.emitter.on("e", senden);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { clearInterval(ping); k.emitter.off("e", senden); });
}));

// Dokumente ausliefern — nur, was zum Objekt gehört
const MIME = { ".html": "text/html; charset=utf-8", ".pdf": "application/pdf", ".json": "application/json", ".md": "text/markdown; charset=utf-8" };
app.get("/api/objekte/:id/datei/*pfad", asyncRoute(async (req, res) => {
  const meta = await ladeMeta(req.params.id);
  const rel = [].concat(req.params.pfad).join("/");
  const erlaubt = meta.dokumente.some((d) => d.datei === rel)
    || /^_fixflip\/[^/]+\.json$/.test(rel) || rel === "Quellen/Quellen-Uebersicht.md";
  const pfad = objektPfad(req.params.id, rel);
  if (!erlaubt || !existsSync(pfad)) return res.status(404).json({ fehler: "Datei nicht gefunden." });
  res.type(MIME[extname(pfad)] || "application/octet-stream");
  if (req.query.download) res.attachment(rel.split("/").pop());
  // Rechner und Kalkulation laufen isoliert, ohne Zugriff auf Cookies und API der App
  // (PDFs nicht — Chromes PDF-Ansicht verweigert sandboxed Dokumente)
  if (extname(pfad) === ".html") res.set("Content-Security-Policy", "sandbox allow-scripts allow-modals allow-popups allow-downloads");
  res.send(await readFile(pfad));
}));

// Ganzer Objektordner als ZIP — Struktur wie im Dropbox-Ordner
app.get("/api/objekte/:id/zip", asyncRoute(async (req, res) => {
  const meta = await ladeMeta(req.params.id);
  const wurzel = objektPfad(req.params.id);
  const zip = new JSZip();
  async function sammle(ordner) {
    for (const e of await readdir(ordner, { withFileTypes: true })) {
      const p = join(ordner, e.name);
      const rel = relative(wurzel, p).split(sep).join("/");
      if (e.isDirectory()) await sammle(p);
      else if (!["meta.json", "verlauf.json"].includes(rel) && !e.name.endsWith(".tmp")) zip.file(rel, await readFile(p));
    }
  }
  await sammle(wurzel);
  const puffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.attachment(`${meta.name.replace(/[^\p{L}\p{N} ._-]+/gu, "_").slice(0, 80) || "Objekt"}.zip`);
  res.type("application/zip").send(puffer);
}));

// ── Einstellungen ───────────────────────────────────────────────────────────
app.get("/api/einstellungen", asyncRoute(async (req, res) => res.json(await ladeEinstellungen())));
app.put("/api/einstellungen", asyncRoute(async (req, res) => res.json(await speichereEinstellungen(req.body || {}))));

// ── WhatsApp-Gruppe live (Bridge) ──────────────────────────────────────────
app.get("/api/whatsapp", asyncRoute(async (req, res) => {
  const s = await waStatus();
  if (!req.nutzer.admin) delete s.nummer;
  res.json(s);
}));

app.get("/api/whatsapp/qr.png", nurAdmin, asyncRoute(async (req, res) => {
  const p = await qrPfad();
  if (!p) return res.status(404).json({ fehler: "Gerade kein QR-Code — die Bridge ist schon gekoppelt oder startet neu." });
  res.set("Cache-Control", "no-store").sendFile(p);
}));

const tagOderNull = (x) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);

app.get("/api/whatsapp/nachrichten", asyncRoute(async (req, res) => {
  const chat = String(req.query.chat || "");
  if (!/^[\d-]+@g\.us$/.test(chat)) return res.status(400).json({ fehler: "Gruppe fehlt." });
  res.json(await waNachrichten({ chat, von: tagOderNull(req.query.von), bis: tagOderNull(req.query.bis) }));
}));

app.get("/api/whatsapp/medien/:chat/:mid", asyncRoute(async (req, res) => {
  const m = await waMedium(req.params.chat, req.params.mid);
  if (!m) return res.status(404).json({ fehler: "Datei nicht (mehr) vorhanden." });
  // Vorschau im Browser, aber nie als aktive Seite (HTML/SVG aus dem Chat)
  res.set({ "Content-Security-Policy": "sandbox", "Cache-Control": "private, max-age=86400" });
  if (m.name) res.attachment(m.name);
  if (/^(image\/(jpeg|png|webp|gif)|audio\/|video\/|application\/pdf)/.test(m.mime || "")) res.set("Content-Disposition", "inline");
  res.type(m.mime || "application/octet-stream").sendFile(m.pfad);
}));

// Ausgewählte Nachrichten als Quelle ins Objekt übernehmen (neues oder bestehendes)
async function uebernimmWhatsApp(objektId, body) {
  const chat = String(body?.chat || "");
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!/^[\d-]+@g\.us$/.test(chat) || !ids.length) throw Object.assign(new Error("Bitte Nachrichten auswählen."), { status: 400 });
  const gruppe = (await waStatus()).gruppen?.find((g) => g.jid === chat)?.name;
  const exp = await exportiereAlsZip({ chat, ids, gruppe });
  await nimmDateiAuf(objektId, exp.name, exp.puffer);
  return { nachrichten: exp.nachrichten, medien: exp.medien, fehlend: exp.fehlend };
}

app.post("/api/objekte/:id/whatsapp", asyncRoute(async (req, res) => {
  if (laeuft(req.params.id)) return res.status(409).json({ fehler: "Analyse läuft noch." });
  await ladeMeta(req.params.id);
  const ergebnis = await uebernimmWhatsApp(req.params.id, req.body);
  res.json({ ...ergebnis, objekt: oeffentlich(await ladeMeta(req.params.id)) });
}));

app.post("/api/whatsapp/objekt", asyncRoute(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 160) || "Aus WhatsApp";
  const meta = await neuesObjekt(name, String(req.body?.notizen || "").slice(0, 20000));
  try {
    const ergebnis = await uebernimmWhatsApp(meta.id, req.body);
    res.status(201).json({ ...ergebnis, id: meta.id });
  } catch (err) {
    await loescheObjekt(meta.id);
    throw err;
  }
}));

// ── Teilen aus WhatsApp (Android: App installieren, dann „Teilen → A²O Immo-Rechner“) ──
app.post("/teilen", (req, res, next) => (angemeldet(req) ? next() : res.redirect(303, "/?geteilt=anmelden")),
  upload.array("dateien"), asyncRoute(async (req, res) => {
  const text = [req.body?.title, req.body?.text, req.body?.url].filter(Boolean).join("\n").trim();
  const dateien = req.files || [];
  const erste = dateien[0] ? dateiname(dateien[0]) : "";
  const name = erste.replace(/^WhatsApp Chat( - | mit )?/i, "").replace(/\.(zip|txt)$/i, "") || "Geteilt aus WhatsApp";
  const meta = await neuesObjekt(name, text);
  for (const f of dateien) await nimmDateiAuf(meta.id, dateiname(f), f.buffer);
  res.redirect(303, `/#/objekt/${meta.id}`);
}));

// ── Oberfläche ──────────────────────────────────────────────────────────────
const PUBLIC = fileURLToPath(new URL("./public", import.meta.url));
app.use(express.static(PUBLIC, { index: "index.html", maxAge: "1h" }));

app.use((err, req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ fehler: status >= 500 ? "Interner Fehler" : err.message });
});

await markiereUnterbrocheneLaeufe((await listeObjekte()).map((o) => o.id));
starteHintergrund();

app.listen(config.port, () => {
  console.log(`A²O Immo-Rechner läuft auf http://localhost:${config.port}`);
  console.log(`  Modell ${config.model} · Rechenkern ${engine().quelle} · Transkription ${transkriptionAktiv() ? "an" : "aus"} · PDF ${chromePfad() ? "an" : "AUS (Chromium fehlt)"}`);
});

