// Anmeldung wie bei BauDoc: Supabase schickt einen E-Mail-Link (nur an bestehende Konten,
// keine Selbstregistrierung). Der Browser reicht das Supabase-Token einmal an /api/sitzung,
// der Server prüft es bei Supabase, gleicht die Zugangsliste ab und setzt ein eigenes,
// signiertes Cookie (30 Tage). Die Zugangsliste wird bei jeder Anfrage geprüft — wer
// entfernt wird, ist sofort draußen.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { darfRein, istAdmin, normiere } from "./zugang.js";

const COOKIE = "a2o_sitzung";
const DAUER_MS = 30 * 24 * 3600 * 1000;

function signatur(wert) {
  return createHmac("sha256", config.sessionSecret).update(wert).digest("base64url");
}

function gleich(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Supabase-Token prüfen: liefert die bestätigte E-Mail oder null
export async function emailAusSupabaseToken(token, { fetch: holen = fetch } = {}) {
  if (typeof token !== "string" || token.length < 20 || token.length > 8192) return null;
  const r = await holen(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.supabaseKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const nutzer = await r.json();
  if (!nutzer?.email || !(nutzer.email_confirmed_at || nutzer.confirmed_at)) return null;
  return normiere(nutzer.email);
}

export function setzeSitzung(res, email) {
  const wert = `${Date.now() + DAUER_MS}.${Buffer.from(normiere(email)).toString("base64url")}`;
  res.cookie(COOKIE, `${wert}.${signatur(wert)}`, {
    httpOnly: true, sameSite: "lax", secure: config.publicUrl.startsWith("https://"), maxAge: DAUER_MS, path: "/",
  });
}

export function beendeSitzung(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function leseCookie(req) {
  const roh = req.headers.cookie || "";
  for (const teil of roh.split(/;\s*/)) {
    const i = teil.indexOf("=");
    if (i > 0 && teil.slice(0, i) === COOKIE) return decodeURIComponent(teil.slice(i + 1));
  }
  return null;
}

// E-Mail der angemeldeten Person oder null
export function angemeldet(req) {
  if (config.ohneLogin) return "lokal@localhost";
  const wert = leseCookie(req);
  if (!wert) return null;
  const [bis, email64, sig] = wert.split(".");
  if (!bis || !email64 || !sig || !gleich(sig, signatur(`${bis}.${email64}`)) || Number(bis) <= Date.now()) return null;
  const email = Buffer.from(email64, "base64url").toString("utf8");
  return darfRein(email) ? email : null;
}

export function nurAngemeldet(req, res, next) {
  const email = angemeldet(req);
  if (!email) return res.status(401).json({ fehler: "Bitte anmelden." });
  req.nutzer = { email, admin: config.ohneLogin || istAdmin(email) };
  next();
}

export function nurAdmin(req, res, next) {
  if (req.nutzer?.admin) return next();
  res.status(403).json({ fehler: "Nur für Admins." });
}

// Bremse gegen Durchprobieren: 20 Fehlversuche je IP in 15 Minuten
const versuche = new Map();
export function loginGesperrt(ip) {
  const v = versuche.get(ip);
  if (!v) return false;
  if (Date.now() - v.seit > 15 * 60 * 1000) { versuche.delete(ip); return false; }
  return v.anzahl >= 20;
}
export function loginFehlversuch(ip) {
  const v = versuche.get(ip) || { anzahl: 0, seit: Date.now() };
  v.anzahl++;
  versuche.set(ip, v);
}
