// Ein Team-Passwort, danach ein signiertes Cookie (30 Tage). Reicht für ein kleines
// Büro-Team; wer mehr will, setzt Cloudflare Access o. ä. davor.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const COOKIE = "a2o_sitzung";
const DAUER_MS = 30 * 24 * 3600 * 1000;

function signatur(wert) {
  return createHmac("sha256", config.sessionSecret).update(wert).digest("base64url");
}

function gleich(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwortRichtig(eingabe) {
  // Hash vergleichen, damit die Länge des Passworts nicht über die Laufzeit durchsickert
  return gleich(signatur(`pw:${eingabe}`), signatur(`pw:${config.appPassword}`));
}

export function setzeSitzung(res) {
  const bis = String(Date.now() + DAUER_MS);
  res.cookie(COOKIE, `${bis}.${signatur(bis)}`, {
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

export function angemeldet(req) {
  if (!config.appPassword) return true; // nur lokal mit UNSICHER_OHNE_LOGIN=1 erreichbar
  const wert = leseCookie(req);
  if (!wert) return false;
  const [bis, sig] = wert.split(".");
  return Boolean(bis && sig && gleich(sig, signatur(bis)) && Number(bis) > Date.now());
}

export function nurAngemeldet(req, res, next) {
  if (angemeldet(req)) return next();
  res.status(401).json({ fehler: "Bitte anmelden." });
}

// Einfache Bremse gegen Passwort-Raten: 10 Fehlversuche je IP in 15 Minuten.
const versuche = new Map();
export function loginGesperrt(ip) {
  const v = versuche.get(ip);
  if (!v) return false;
  if (Date.now() - v.seit > 15 * 60 * 1000) { versuche.delete(ip); return false; }
  return v.anzahl >= 10;
}
export function loginFehlversuch(ip) {
  const v = versuche.get(ip) || { anzahl: 0, seit: Date.now() };
  v.anzahl++;
  versuche.set(ip, v);
}
