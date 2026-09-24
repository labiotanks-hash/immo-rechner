import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "a2o-auth-"));
process.env.SESSION_SECRET = "test-geheimnis";
process.env.SUPABASE_URL = "https://beispiel.supabase.co/";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.ADMIN_EMAILS = "Chef@Example.de, zweite@example.de";

const { config } = await import("../lib/config.js");
const auth = await import("../lib/auth.js");
const zugang = await import("../lib/zugang.js");

before(async () => { await zugang.ladeZugang(); });

// Antwort-Attrappe für res.cookie → gibt das Cookie als Request-Header zurück
function cookieVon(email) {
  let wert;
  auth.setzeSitzung({ cookie: (_n, w) => { wert = w; } }, email);
  return { headers: { cookie: `a2o_sitzung=${encodeURIComponent(wert)}` } };
}

test("Konfiguration normiert Admins und URL", () => {
  assert.deepEqual(config.adminEmails, ["chef@example.de", "zweite@example.de"]);
  assert.equal(config.supabaseUrl, "https://beispiel.supabase.co");
});

test("Supabase-Token wird geprüft, nur bestätigte E-Mails zählen", async () => {
  let aufruf;
  const holen = async (url, o) => { aufruf = { url, o }; return { ok: true, json: async () => ({ email: "Partner@Example.de", email_confirmed_at: "2026-01-01" }) }; };
  assert.equal(await auth.emailAusSupabaseToken("x".repeat(40), { fetch: holen }), "partner@example.de");
  assert.equal(aufruf.url, "https://beispiel.supabase.co/auth/v1/user");
  assert.equal(aufruf.o.headers.apikey, "sb_publishable_test");
  assert.equal(aufruf.o.headers.Authorization, `Bearer ${"x".repeat(40)}`);

  const unbestaetigt = async () => ({ ok: true, json: async () => ({ email: "a@b.de" }) });
  assert.equal(await auth.emailAusSupabaseToken("x".repeat(40), { fetch: unbestaetigt }), null);
  const abgelehnt = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await auth.emailAusSupabaseToken("x".repeat(40), { fetch: abgelehnt }), null);
  assert.equal(await auth.emailAusSupabaseToken("kurz", { fetch: holen }), null);
});

test("Sitzung gilt nur, solange die Person auf der Liste steht", async () => {
  assert.equal(auth.angemeldet(cookieVon("chef@example.de")), "chef@example.de");
  assert.equal(auth.angemeldet(cookieVon("partner@example.de")), null);

  await zugang.fuegeHinzu("Partner@Example.de", "Partner", "chef@example.de");
  assert.equal(auth.angemeldet(cookieVon("partner@example.de")), "partner@example.de");
  assert.equal(zugang.istAdmin("partner@example.de"), false);

  // Liste übersteht einen Neustart
  await zugang.ladeZugang();
  assert.ok(zugang.darfRein("partner@example.de"));

  await zugang.entferne("partner@example.de");
  assert.equal(auth.angemeldet(cookieVon("partner@example.de")), null);
  await assert.rejects(zugang.entferne("chef@example.de"), /ADMIN_EMAILS/);
  await assert.rejects(zugang.fuegeHinzu("keine-adresse", "", "x"), /gültige/);
});

test("Gefälschte oder abgelaufene Cookies werden abgelehnt", () => {
  const echt = cookieVon("chef@example.de").headers.cookie;
  const [bis, email64, sig] = decodeURIComponent(echt.split("=")[1]).split(".");
  const fremd = Buffer.from("zweite@example.de").toString("base64url");
  const req = (w) => ({ headers: { cookie: `a2o_sitzung=${encodeURIComponent(w)}` } });
  assert.equal(auth.angemeldet(req(`${bis}.${fremd}.${sig}`)), null);
  assert.equal(auth.angemeldet(req(`${Number(bis) + 1}.${email64}.${sig}`)), null);
  assert.equal(auth.angemeldet(req(`${bis}.${email64}`)), null);
  assert.equal(auth.angemeldet({ headers: {} }), null);
});
