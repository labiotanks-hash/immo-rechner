// Oberfläche ohne Build-Schritt: Hash-Routing, DOM-Bausteine, Server-Sent Events.
const app = document.getElementById("app");
let offeneQuelle = null; // laufende EventSource der Objektseite
let ich = null; // { email, admin }

// ── Helfer ──────────────────────────────────────────────────────────────────
// replaceChildren ohne null/false und mit verschachtelten Listen
function setze(knoten, ...kinder) {
  knoten.replaceChildren(...kinder.flat(Infinity).filter((k) => k != null && k !== false));
}

function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kinder.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

async function api(pfad, optionen = {}) {
  const o = { ...optionen, headers: { ...(optionen.body && !(optionen.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...optionen.headers } };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== "string") o.body = JSON.stringify(o.body);
  const r = await fetch(pfad, o);
  if (r.status === 401 && pfad !== "/api/sitzung") { zeigeLogin(); throw new Error("Bitte anmelden."); }
  const daten = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(daten?.fehler || `Fehler ${r.status}`);
  return daten;
}

function hochladen(id, dateien, fortschritt) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of dateien) fd.append("dateien", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/objekte/${id}/dateien`);
    xhr.upload.onprogress = (e) => e.lengthComputable && fortschritt(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(JSON.parse(xhr.responseText || "{}").fehler || `Fehler ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Netzwerkfehler beim Hochladen"));
    xhr.send(fd);
  });
}

const groesse = (b) => (b > 1e6 ? `${(b / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const datum = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
const SYMBOL = { pdf: "📄", bild: "🖼", audio: "🎤", whatsapp: "💬", zip: "🗜", text: "📝", docx: "📝", video: "🎞", sonstig: "📎" };
const STATUS = { neu: "neu", laeuft: "läuft", fertig: "fertig", beantwortet: "beantwortet", fehler: "Fehler" };

function fehlerbox(text) { return el("div", { class: "fehlerbox", role: "alert" }, text); }

function navAktiv() {
  const h = location.hash || "#/";
  document.querySelectorAll(".kopf nav a").forEach((a) => a.classList.toggle("aktiv", a.getAttribute("href") === h || (h.startsWith("#/objekt") && a.getAttribute("href") === "#/")));
}

// ── Anmeldung ───────────────────────────────────────────────────────────────
// Wie bei BauDoc: Supabase schickt Link + Code per E-Mail, nur an eingeladene Adressen.
// Das Supabase-Token geht einmal an /api/sitzung, danach gilt unser eigenes Cookie.
let konfig = null;
async function ladeKonfig() { return (konfig ||= await (await fetch("/api/konfig")).json()); }

async function supabase(pfad, body) {
  const k = await ladeKonfig();
  const r = await fetch(`${k.supabaseUrl}/auth/v1/${pfad}`, {
    method: "POST", headers: { apikey: k.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const daten = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = daten.error_code || daten.code || "";
    if (code === "otp_disabled" || code === "signup_disabled" || /signups? not allowed/i.test(daten.msg || daten.message || ""))
      throw new Error("Für diese Adresse gibt es noch keinen Zugang. Bitte bei A²O melden.");
    if (code === "over_email_send_rate_limit" || r.status === 429) throw new Error("Gerade wurden zu viele E-Mails verschickt — bitte in einer Minute noch einmal.");
    if (code === "otp_expired") throw new Error("Der Code ist abgelaufen oder falsch. Bitte neu anfordern.");
    throw new Error(daten.msg || daten.message || daten.error_description || `Anmeldung fehlgeschlagen (${r.status})`);
  }
  return daten;
}

async function tauscheToken(token) {
  await api("/api/sitzung", { method: "POST", body: { token } });
}

// Rückkehr über den Link aus der E-Mail: #access_token=… bzw. #error=…
async function linkAusEmail() {
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  if (h.has("error")) {
    zeigeLogin(h.get("error_code") === "otp_expired" ? "Der Link ist abgelaufen oder wurde schon benutzt — bitte neu anfordern." : (h.get("error_description") || "Anmeldung fehlgeschlagen."), true);
    return;
  }
  try { await tauscheToken(h.get("access_token")); history.replaceState(null, "", "/#/"); route(); }
  catch (err) { zeigeLogin(err.message, true); }
}

function zeigeLogin(meldung, istFehler = false) {
  ich = null;
  document.getElementById("nav-zugang").hidden = true;
  if (offeneQuelle) { offeneQuelle.close(); offeneQuelle = null; }
  document.getElementById("abmelden").hidden = true;
  const fehler = el("div", {}, istFehler && meldung ? fehlerbox(meldung) : null);
  const email = el("input", { type: "email", id: "email", autocomplete: "email", inputmode: "email", required: true });
  try { email.value = localStorage.getItem("a2o_email") || ""; } catch {}
  const knopf = el("button", { class: "knopf", type: "submit" }, "Anmeldelink schicken");
  const form = el("form", { class: "karte login", onsubmit: async (e) => {
    e.preventDefault();
    setze(fehler);
    knopf.disabled = true;
    const adresse = email.value.trim().toLowerCase();
    try {
      await supabase(`otp?redirect_to=${encodeURIComponent(location.origin + "/")}`, { email: adresse, create_user: false });
      try { localStorage.setItem("a2o_email", adresse); } catch {}
      zeigeCode(adresse);
    } catch (err) { fehler.append(fehlerbox(err.message)); knopf.disabled = false; }
  } },
  el("h1", {}, "Anmelden"),
  el("p", { class: "unter" }, !istFehler && meldung ? meldung : "Mit deiner E-Mail-Adresse — du bekommst einen Anmeldelink. Zugang nur auf Einladung."),
  fehler,
  el("label", { class: "feld", for: "email" }, "E-Mail"), email,
  el("div", { style: "margin-top:14px" }, knopf));
  setze(app, form);
  email.focus();
}

// Nach dem Versand: Link in der E-Mail anklicken — oder den Code eintippen
// (nötig z. B. in der Homescreen-App auf dem iPhone, die ihre eigenen Cookies hat)
function zeigeCode(adresse) {
  const fehler = el("div");
  const code = el("input", { id: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6,10}", maxlength: "10", required: true });
  const form = el("form", { class: "karte login", onsubmit: async (e) => {
    e.preventDefault();
    setze(fehler);
    try {
      const s = await supabase("verify", { type: "email", email: adresse, token: code.value.trim() });
      await tauscheToken(s.access_token);
      history.replaceState(null, "", "/#/");
      route();
    } catch (err) { fehler.append(fehlerbox(err.message)); }
  } },
  el("h1", {}, "E-Mail ist unterwegs"),
  el("p", { class: "unter" }, `An ${adresse}. Öffne den Link in der E-Mail — oder gib hier den Code aus der E-Mail ein.`),
  fehler,
  el("label", { class: "feld", for: "code" }, "Code"), code,
  el("div", { class: "zeile", style: "margin-top:14px" },
    el("button", { class: "knopf", type: "submit" }, "Anmelden"),
    el("button", { class: "leise", type: "button", onclick: () => zeigeLogin() }, "Andere Adresse")));
  setze(app, form);
  code.focus();
}

// ── Objektliste ─────────────────────────────────────────────────────────────
async function zeigeListe() {
  const [objekte, wa, st] = await Promise.all([api("/api/objekte"), api("/api/whatsapp").catch(() => ({})), api("/api/status").catch(() => ({}))]);
  const ohneSchluessel = st.apiKey === false
    ? el("div", { class: "fehlerbox", role: "alert" }, ich?.admin
      ? ["Noch kein Anthropic-API-Schlüssel eingetragen. ", el("a", { href: "#/einstellungen" }, "Jetzt unter Einstellungen eintragen →")]
      : "Die App ist noch nicht fertig eingerichtet (API-Schlüssel fehlt). Bitte bei A²O melden.")
    : null;
  const name = el("input", { type: "text", id: "neuName", placeholder: "z. B. Musterstraße 1, Musterstadt" });
  const notiz = el("textarea", { id: "neuNotiz", placeholder: "Was wollt ihr wissen? z. B. „Einstand über die Bank 0,9–1,0 Mio — was bleibt bei Aufteilung, was bei Globalverkauf? Bankgespräch morgen.“" });
  const neu = el("form", { class: "karte", onsubmit: async (e) => {
    e.preventDefault();
    const m = await api("/api/objekte", { method: "POST", body: { name: name.value, notizen: notiz.value } });
    location.hash = `#/objekt/${m.id}`;
  } },
  el("h2", {}, "Neues Objekt"),
  el("label", { class: "feld", for: "neuName" }, "Objekt"), name,
  el("label", { class: "feld", for: "neuNotiz" }, "Frage an Claude (optional)"), notiz,
  el("div", { style: "margin-top:12px" }, el("button", { class: "knopf", type: "submit" }, "Anlegen und Unterlagen hochladen")));

  const liste = objekte.length
    ? el("ul", { class: "liste" }, objekte.map((o) => el("li", {},
        el("a", { class: "objekt-link", href: `#/objekt/${o.id}` },
          el("div", { class: "symbol" }, "🏠"),
          el("div", { class: "inhalt" }, el("div", { class: "titel" }, o.name),
            el("div", { class: "info" }, `${datum(o.erstellt)} · ${o.quellen} Quellen · ${o.dokumente} Dokumente`))),
        el("span", { class: `marke-status ${o.status}` }, STATUS[o.status] || o.status))))
    : el("div", { class: "leer" }, "Noch keine Objekte. Lege oben das erste an.");

  let waKarte = null;
  if (wa.gruppen?.length) {
    const panel = el("div");
    const waName = el("input", { type: "text", id: "waName", placeholder: "z. B. Musterstraße 1, Musterstadt" });
    waKarte = el("section", { class: "karte" },
      el("h2", {}, `Neu aus „${wa.gruppen[0].name}“`),
      el("p", { class: "hinweis" }, "Nachrichten, Exposés und Sprachnachrichten aus der Gruppe auswählen — daraus wird ein neues Objekt."),
      el("button", { class: "knopf zweit", type: "button", onclick: () => {
        if (panel.childNodes.length) { setze(panel); return; }
        setze(panel, waAuswahl(wa, {
          knopfText: "Objekt anlegen",
          extra: [el("label", { class: "feld", for: "waName" }, "Objekt"), waName],
          uebernehmen: async (auswahl) => {
            const r = await api("/api/whatsapp/objekt", { method: "POST", body: { ...auswahl, name: waName.value } });
            location.hash = `#/objekt/${r.id}`;
          },
        }));
      } }, "Nachrichten auswählen"),
      panel);
  }

  setze(app, 
    ohneSchluessel,
    el("h1", {}, "Objekte"),
    el("p", { class: "unter" }, "Exposés, Mappen, WhatsApp-Verläufe und Sprachnachrichten hochladen — Claude recherchiert den Markt, rechnet mit FixFlip Pro und erstellt Ankaufskalkulation und Rechner."),
    el("div", { class: "raster" }, el("div", { class: "karte" }, el("h2", {}, "Alle Objekte"), liste), el("div", { class: "stapel" }, waKarte, neu)));
}

// ── Auswahl aus der WhatsApp-Gruppe ────────────────────────────────────────
const tagIso = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const uhrzeit = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const tagTitel = (iso) => new Date(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });
const WA_SYMBOL = { text: "💬", bild: "🖼", audio: "🎤", video: "🎞", dokument: "📄" };

// wa: Antwort von /api/whatsapp; uebernehmen({ chat, ids }) → Promise
function waAuswahl(wa, { knopfText, uebernehmen, extra = null }) {
  const gruppe = el("select", { id: "wa-gruppe" }, wa.gruppen.map((g) => el("option", { value: g.jid }, `${g.name} (${g.anzahl})`)));
  const heute = new Date();
  const von = el("input", { type: "date", value: tagIso(new Date(heute.getTime() - 2 * 86400000)) });
  const bis = el("input", { type: "date", value: tagIso(heute) });
  const liste = el("div", { class: "wa-liste" });
  const fuss = el("div", { class: "zeile wa-fuss" });
  const fehler = el("div");
  let nachrichten = [];
  const gewaehlt = new Set();

  const zaehler = el("span", { class: "hinweis" });
  const knopf = el("button", { class: "knopf", type: "button", onclick: async () => {
    setze(fehler);
    knopf.disabled = true;
    try { await uebernehmen({ chat: gruppe.value, ids: nachrichten.filter((n) => gewaehlt.has(n.id)).map((n) => n.id) }); }
    catch (err) { fehler.append(fehlerbox(err.message)); knopf.disabled = false; }
  } }, knopfText);
  const aktualisiere = () => {
    zaehler.textContent = `${gewaehlt.size} von ${nachrichten.length} ausgewählt`;
    knopf.disabled = !gewaehlt.size;
  };

  function inhalt(n) {
    const url = `/api/whatsapp/medien/${encodeURIComponent(n.chat)}/${encodeURIComponent(n.id)}`;
    const teile = [];
    if (n.art === "bild" && n.datei) teile.push(el("a", { href: url, target: "_blank", rel: "noopener" }, el("img", { src: url, loading: "lazy", alt: "Foto", class: "wa-bild" })));
    else if (n.art === "audio" && n.datei) {
      teile.push(el("audio", { controls: true, preload: "none", src: url }));
      teile.push(el("div", { class: "wa-transkript" }, n.transkript ? `„${n.transkript}“` : "Transkript folgt …"));
    } else if (n.art !== "text") {
      teile.push(n.datei ? el("a", { href: url, target: "_blank", rel: "noopener" }, n.dateiname || n.art)
        : el("span", { class: "hinweis" }, `${n.dateiname || n.art} — ${n.dateiStatus === "fehler" ? "nicht mehr ladbar" : "wird noch geladen"}`));
    }
    if (n.text) teile.push(el("div", { class: "wa-text" }, n.text));
    return teile;
  }

  function zeichne() {
    if (!nachrichten.length) { setze(liste, el("div", { class: "leer" }, "Keine Nachrichten in diesem Zeitraum.")); setze(fuss); return; }
    let tag = null;
    const zeilen = [];
    for (const n of nachrichten) {
      const t = tagIso(new Date(n.zeit));
      if (t !== tag) {
        tag = t;
        const dieses = nachrichten.filter((x) => tagIso(new Date(x.zeit)) === t);
        zeilen.push(el("div", { class: "wa-tag" }, tagTitel(n.zeit),
          el("button", { class: "leise klein", type: "button", onclick: () => {
            const alle = dieses.every((x) => gewaehlt.has(x.id));
            dieses.forEach((x) => (alle ? gewaehlt.delete(x.id) : gewaehlt.add(x.id)));
            zeichne();
          } }, "Tag an/aus")));
      }
      const box = el("input", { type: "checkbox", id: `wa-${n.id}` });
      box.checked = gewaehlt.has(n.id);
      box.addEventListener("change", () => { box.checked ? gewaehlt.add(n.id) : gewaehlt.delete(n.id); aktualisiere(); });
      zeilen.push(el("label", { class: "wa-nachricht", for: `wa-${n.id}` }, box,
        el("div", { class: "wa-inhalt" },
          el("div", { class: "wa-kopf" }, `${WA_SYMBOL[n.art] || "📎"} ${uhrzeit(n.zeit)} · ${n.absender}`),
          inhalt(n))));
    }
    setze(liste, zeilen);
    setze(fuss,
      el("button", { class: "leise", type: "button", onclick: () => { nachrichten.forEach((n) => gewaehlt.add(n.id)); zeichne(); } }, "Alle"),
      el("button", { class: "leise", type: "button", onclick: () => { gewaehlt.clear(); zeichne(); } }, "Keine"),
      zaehler);
    aktualisiere();
  }

  async function lade() {
    setze(fehler);
    setze(liste, el("div", { class: "hinweis" }, "Lade Nachrichten …"));
    try {
      const q = new URLSearchParams({ chat: gruppe.value, von: von.value, bis: bis.value });
      nachrichten = await api(`/api/whatsapp/nachrichten?${q}`);
      gewaehlt.clear();
      zeichne();
    } catch (err) { setze(liste); fehler.append(fehlerbox(err.message)); }
  }
  [gruppe, von, bis].forEach((f) => f.addEventListener("change", lade));
  lade();

  return el("div", { class: "wa-auswahl" },
    wa.gruppen.length > 1 ? [el("label", { class: "feld", for: "wa-gruppe" }, "Gruppe"), gruppe] : null,
    el("label", { class: "feld" }, "Zeitraum"),
    el("div", { class: "zeile" }, von, el("span", {}, "bis"), bis),
    fehler, liste, fuss, extra,
    el("div", { style: "margin-top:12px" }, knopf),
    el("div", { class: "hinweis" }, "Fotos, PDFs und Sprachnachrichten kommen mit; Sprachnachrichten werden transkribiert."));
}

function waHinweis(wa) {
  if (!wa?.eingerichtet) return null;
  if (wa.zustand === "verbunden" && wa.gruppen?.length) return null;
  if (wa.zustand === "verbunden" && wa.gruppeFehlt) return "WhatsApp verbunden, aber die Firmennummer ist nicht in der Gruppe.";
  if (wa.zustand === "koppeln" || wa.zustand === "abgemeldet" || wa.zustand === "abgelaufen") return "WhatsApp ist noch nicht gekoppelt (Admin: Seite „Zugang“).";
  if (wa.zustand === "getrennt") return "WhatsApp-Verbindung gerade getrennt — verbindet sich selbst neu.";
  return null;
}

// ── Objekt ──────────────────────────────────────────────────────────────────
async function zeigeObjekt(id) {
  let o = await api(`/api/objekte/${id}`);
  const status = await api("/api/status").catch(() => ({}));
  const wa = await api("/api/whatsapp").catch(() => ({}));
  const waPanel = el("div");
  let waMeldung = "";

  const kopf = el("div");
  const quellenKarte = el("section", { class: "karte" });
  const auftragKarte = el("section", { class: "karte" });
  const fortschrittKarte = el("section", { class: "karte" });
  const dokumenteKarte = el("section", { class: "karte dokumente" });
  const gespraechKarte = el("section", { class: "karte" });

  function zeichneKopf() {
    setze(kopf, 
      el("div", { class: "zeile" },
        el("h1", { class: "wachsen" }, o.name),
        el("span", { class: `marke-status ${o.laeuft ? "laeuft" : o.status}` }, o.laeuft ? "läuft" : (STATUS[o.status] || o.status))),
      el("p", { class: "unter" }, `Angelegt ${datum(o.erstellt)}`));
  }

  function zeichneQuellen() {
    const eingabe = el("input", { type: "file", multiple: true, accept: ".pdf,.zip,.txt,.md,.docx,.jpg,.jpeg,.png,.webp,.opus,.ogg,.m4a,.mp3,.aac,.wav,.amr,application/pdf,application/zip,image/*,audio/*,text/plain" });
    const info = el("div", { class: "hinweis" }, waMeldung);
    waMeldung = "";
    const ablage = el("label", { class: "ablage" },
      eingabe,
      el("div", {}, el("b", {}, "Dateien hierher ziehen oder antippen")),
      el("div", { class: "hinweis" }, "Exposés und Mappen (PDF), Fotos, Sprachnachrichten, Text, WhatsApp-Export (ZIP „mit Medien“)"));
    const senden = async (dateien) => {
      if (!dateien.length) return;
      info.textContent = `Lade ${dateien.length} Datei(en) hoch …`;
      try {
        await hochladen(id, dateien, (p) => { info.textContent = `Hochladen … ${Math.round(p * 100)} %`; });
        info.textContent = "";
        o = await api(`/api/objekte/${id}`);
        zeichneQuellen();
      } catch (err) { setze(info, fehlerbox(err.message)); }
    };
    eingabe.addEventListener("change", () => senden([...eingabe.files]));
    ablage.addEventListener("dragover", (e) => { e.preventDefault(); ablage.classList.add("drueber"); });
    ablage.addEventListener("dragleave", () => ablage.classList.remove("drueber"));
    ablage.addEventListener("drop", (e) => { e.preventDefault(); ablage.classList.remove("drueber"); senden([...e.dataTransfer.files]); });

    const oben = o.quellen.filter((q) => !q.herkunft);
    const kinder = (q) => o.quellen.filter((k) => k.herkunft === q.id);
    const zeile = (q) => {
      const k = kinder(q);
      const teile = [q.art === "whatsapp" ? `WhatsApp${q.gruppe ? ` „${q.gruppe}“` : ""}` : q.art, groesse(q.groesse)];
      if (k.length) {
        const n = (a) => k.filter((x) => x.art === a).length;
        teile.push([n("audio") && `${n("audio")} Sprachnachr.`, n("pdf") && `${n("pdf")} PDF`, n("bild") && `${n("bild")} Bilder`].filter(Boolean).join(", "));
      }
      if (q.gesendet) teile.push("an Claude übergeben");
      const transkripte = [q, ...k].filter((x) => x.art === "audio" && (x.transkript || x.transkriptFehler));
      return el("li", {},
        el("div", { class: "symbol" }, SYMBOL[q.art] || "📎"),
        el("div", { class: "inhalt" },
          el("div", { class: "titel" }, q.datei),
          el("div", { class: "info" }, teile.filter(Boolean).join(" · ")),
          transkripte.length ? el("details", { class: "transkript" }, el("summary", {}, `${transkripte.length} Transkript(e) ansehen`),
            transkripte.map((t) => el("p", {}, `${t.anhangName || t.datei}: ${t.transkript || `⚠ ${t.transkriptFehler}`}`))) : null,
          (q.uploadFehler || q.transkriptFehler) && !transkripte.length ? el("div", { class: "info gefahr" }, q.uploadFehler || q.transkriptFehler) : null),
        !q.gesendet ? el("button", { class: "leise", title: "Entfernen", "aria-label": `${q.datei} entfernen`, onclick: async () => {
          await api(`/api/objekte/${id}/quellen/${q.id}`, { method: "DELETE" });
          o = await api(`/api/objekte/${id}`); zeichneQuellen();
        } }, "✕") : null);
    };

    const hatChat = o.quellen.some((q) => q.art === "whatsapp" || (q.art === "zip" && !q.entpackt) || /whatsapp/i.test(q.datei));
    const von = el("input", { type: "date", value: o.zeitraum?.von || "" });
    const bis = el("input", { type: "date", value: o.zeitraum?.bis || "" });
    const zeitraum = hatChat ? el("div", {},
      el("label", { class: "feld" }, "WhatsApp: nur Nachrichten aus diesem Zeitraum (leer = alle)"),
      el("div", { class: "zeile" }, von, el("span", {}, "bis"), bis,
        el("button", { class: "knopf zweit klein", onclick: async () => {
          o = { ...o, ...(await api(`/api/objekte/${id}`, { method: "PATCH", body: { zeitraum: { von: von.value, bis: bis.value } } })) };
        } }, "Übernehmen"))) : null;

    const waKnopf = wa.gruppen?.length && !o.laeuft ? el("button", { class: "knopf zweit", type: "button", onclick: () => {
      if (waPanel.childNodes.length) { setze(waPanel); return; }
      setze(waPanel, waAuswahl(wa, { knopfText: "Ins Objekt übernehmen", uebernehmen: async (auswahl) => {
        const r = await api(`/api/objekte/${id}/whatsapp`, { method: "POST", body: auswahl });
        o = { ...o, ...r.objekt };
        setze(waPanel);
        waMeldung = `${r.nachrichten} Nachrichten übernommen${r.medien ? `, davon ${r.medien} mit Datei` : ""}${r.fehlend ? ` — ${r.fehlend} Datei(en) nicht mehr ladbar` : ""}.`;
        zeichneQuellen();
      } }));
    } }, `💬 Aus „${wa.gruppen[0].name}“ übernehmen`) : null;
    const waText = waHinweis(wa);

    setze(quellenKarte, 
      el("h2", {}, "Quellen"),
      ablage, info,
      waKnopf ? el("div", { style: "margin-top:10px" }, waKnopf) : null,
      waText ? el("div", { class: "hinweis" }, `⚠ ${waText}`) : null,
      waPanel,
      oben.length ? el("ul", { class: "liste" }, oben.map(zeile)) : null,
      zeitraum,
      status.transkription === false && o.quellen.some((q) => q.art === "audio" || q.art === "whatsapp" || q.art === "zip")
        ? el("div", { class: "hinweis" }, "⚠ Sprachnachrichten werden nicht transkribiert: TRANSCRIBE_URL ist nicht eingerichtet (siehe README).") : null);
  }

  function zeichneAuftrag() {
    if (o.laeufe.length) { auftragKarte.hidden = true; return; }
    auftragKarte.hidden = false;
    const notiz = el("textarea", { id: "notiz" }, o.notizen || "");
    const fehler = el("div");
    const start = el("button", { class: "knopf", disabled: o.laeuft || !o.quellen.length && !o.notizen, onclick: async () => {
      setze(fehler);
      start.disabled = true;
      try {
        await api(`/api/objekte/${id}`, { method: "PATCH", body: { notizen: notiz.value } });
        await api(`/api/objekte/${id}/analyse`, { method: "POST", body: {} });
        o.laeuft = true; zeichneAlles();
      } catch (err) { fehler.append(fehlerbox(err.message)); start.disabled = false; }
    } }, "Ankaufskalkulation erstellen");
    notiz.addEventListener("input", () => { start.disabled = o.laeuft || (!o.quellen.length && !notiz.value.trim()); });
    setze(auftragKarte, 
      el("h2", {}, "Auftrag an Claude"), fehler,
      el("label", { class: "feld", for: "notiz" }, "Was sollen Kalkulation und Kurzantwort beantworten? Zahlen und Aussagen aus Telefonaten gern dazuschreiben."),
      notiz,
      el("div", { class: "zeile", style: "margin-top:12px" }, start,
        el("span", { class: "hinweis" }, `${status.modell || "Claude"} mit Websuche · rechnet mit FixFlip Pro (${status.rechenkern === "original" ? "Original" : "Port"}) · Dauer meist 3–10 Minuten`)));
  }

  let aktuellerText = null, aktuelleGedanken = null;
  const protokoll = el("div", { class: "protokoll" });
  function ereignis(e) {
    const unten = protokoll.scrollHeight - protokoll.scrollTop - protokoll.clientHeight < 40;
    if (e.typ === "text") {
      if (!aktuellerText) { aktuellerText = el("div", { class: "claude" }); protokoll.append(aktuellerText); }
      aktuellerText.textContent += e.text;
    } else if (e.typ === "denken") {
      if (!aktuelleGedanken) {
        const inhalt = el("div");
        protokoll.append(el("details", {}, el("summary", {}, "Überlegungen"), inhalt));
        aktuelleGedanken = inhalt;
      }
      aktuelleGedanken.textContent += e.text;
    } else if (e.typ === "absatz") {
      aktuellerText = null; aktuelleGedanken = null;
    } else if (["status", "werkzeug", "fehler", "fertig", "dokumente"].includes(e.typ)) {
      aktuellerText = null; aktuelleGedanken = null;
      const z = { status: "·", werkzeug: e.name === "web_search" ? "🔎" : e.name === "web_fetch" ? "🌐" : "🧮", fehler: "⚠", fertig: "✓", dokumente: "📄" }[e.typ];
      const text = e.typ === "fertig" ? "Fertig." : e.typ === "dokumente" ? `${e.dateien.length} Dokumente erstellt` : e.text;
      protokoll.append(el("div", { class: `ereignis${e.typ === "fehler" ? " gefahr" : ""}` }, el("span", { class: "z" }, z), el("span", {}, text)));
    }
    if (unten) protokoll.scrollTop = protokoll.scrollHeight;
    if (e.typ === "fertig" || e.typ === "fehler" || e.typ === "dokumente") aktualisiere();
  }

  function zeichneFortschritt() {
    const zeigen = o.laeuft || protokoll.childElementCount;
    fortschrittKarte.hidden = !zeigen;
    setze(fortschrittKarte, el("h2", {}, "Fortschritt"), o.laeuft ? el("div", { class: "laeuft-balken" }) : null, protokoll);
  }

  function zeichneDokumente() {
    const d = o.dokumente;
    dokumenteKarte.hidden = !d.length;
    if (!d.length) return;
    const link = (datei, text, zweit) => el("a", { class: `knopf klein${zweit ? " zweit" : ""}`, href: `/api/objekte/${id}/datei/${encodeURIComponent(datei)}`, target: "_blank", rel: "noopener" }, text);
    const finde = (art, fassung, endung) => d.find((x) => x.art === art && x.fassung === fassung && x.datei.endsWith(endung));
    const gruppe = (titel, ...knoepfe) => knoepfe.some(Boolean) ? [el("div", { class: "gruppe-titel" }, titel), el("div", {}, knoepfe)] : [];
    const intPdf = finde("ankaufskalkulation", "intern", ".pdf"), intHtml = finde("ankaufskalkulation", "intern", ".html");
    const extPdf = finde("ankaufskalkulation", "extern", ".pdf"), extHtml = finde("ankaufskalkulation", "extern", ".html");
    setze(dokumenteKarte, 
      el("h2", {}, "Dokumente"),
      ...gruppe("Ankaufskalkulation intern (gelb markiert)", intPdf && link(intPdf.datei, "PDF"), intHtml && link(intHtml.datei, "HTML", true)),
      ...gruppe("Ankaufskalkulation für die Bank (ohne Markierung)", extPdf && link(extPdf.datei, "PDF"), extHtml && link(extHtml.datei, "HTML", true)),
      ...gruppe("FixFlip-Pro-Rechner", ...d.filter((x) => x.art === "rechner").map((x) => link(x.datei, `Exit ${x.exit}: ${x.datei.replace(/^FixFlipPro_Rechner_.*?_([A-Z])_/, "").replace(/\.html$/, "").replace(/_/g, " ")}`))),
      el("div", { class: "gruppe-titel" }, "Alles"),
      el("div", {}, el("a", { class: "knopf klein zweit", href: `/api/objekte/${id}/zip` }, "Objektordner als ZIP (für Dropbox)"),
        link("Quellen/Quellen-Uebersicht.md", "Quellen-Übersicht", true)),
      el("p", { class: "hinweis" }, `Stand ${datum(d[0].erstellt)}`));
  }

  function zeichneGespraech() {
    const g = o.gespraech.filter((x) => x.antwort || x.fehler || x.status === "laeuft");
    gespraechKarte.hidden = !o.laeufe.length;
    if (!o.laeufe.length) return;
    const frage = el("textarea", { id: "rueckfrage", placeholder: "z. B. „Rechne zusätzlich mit 950.000 € und einer Haltedauer von 24 Monaten für die Aufteilung.“ oder „Was passiert, wenn die Miete 10 % niedriger ist?“" });
    const fehler = el("div");
    const senden = el("button", { class: "knopf", disabled: o.laeuft, onclick: async () => {
      if (!frage.value.trim()) return frage.focus();
      setze(fehler);
      senden.disabled = true;
      try {
        await api(`/api/objekte/${id}/analyse`, { method: "POST", body: { nachricht: frage.value } });
        o.laeuft = true; setze(protokoll); zeichneAlles();
      } catch (err) { fehler.append(fehlerbox(err.message)); senden.disabled = false; }
    } }, "Senden");
    setze(gespraechKarte, 
      el("h2", {}, "Gespräch"),
      g.map((x) => [
        el("div", { class: "frage" }, x.frage ? `Rückfrage ${datum(x.start)}: ${x.frage}` : `Erste Analyse ${datum(x.start)}`),
        x.antwort ? el("div", { class: "antwort" }, x.antwort) : x.fehler ? fehlerbox(x.fehler) : el("div", { class: "hinweis" }, "läuft …"),
      ]),
      o.status === "fehler" && !o.laeuft ? el("div", { style: "margin:10px 0" }, el("button", { class: "knopf zweit klein", onclick: async (ev) => {
        ev.target.disabled = true;
        await api(`/api/objekte/${id}/analyse`, { method: "POST", body: { nachricht: "Der letzte Lauf wurde abgebrochen. Bitte mach dort weiter und erstelle die Dokumente." } });
        o.laeuft = true; setze(protokoll); zeichneAlles();
      } }, "Erneut versuchen")) : null,
      el("label", { class: "feld", for: "rueckfrage" }, "Rückfrage oder Änderung — neue Dateien oben hochladen, sie gehen mit"),
      frage, fehler,
      el("div", { class: "zeile", style: "margin-top:10px" }, senden,
        el("button", { class: "leise gefahr", style: "margin-left:auto", onclick: async () => {
          if (!confirm(`Objekt „${o.name}“ mit allen Dateien löschen?`)) return;
          await api(`/api/objekte/${id}`, { method: "DELETE" });
          location.hash = "#/";
        } }, "Objekt löschen")));
  }

  function zeichneAlles() {
    zeichneKopf(); zeichneQuellen(); zeichneAuftrag(); zeichneFortschritt(); zeichneDokumente(); zeichneGespraech();
  }

  async function aktualisiere() {
    o = await api(`/api/objekte/${id}`);
    zeichneAlles();
  }

  zeichneAlles();
  setze(app, kopf, el("div", { class: "raster" },
    el("div", {}, auftragKarte, fortschrittKarte, dokumenteKarte, gespraechKarte),
    el("div", {}, quellenKarte)));

  if (offeneQuelle) offeneQuelle.close();
  offeneQuelle = new EventSource(`/api/objekte/${id}/ereignisse`);
  offeneQuelle.onmessage = (m) => { ereignis(JSON.parse(m.data)); if (!fortschrittKarte.hidden || o.laeuft) zeichneFortschritt(); };
}

// ── Einstellungen ───────────────────────────────────────────────────────────
async function zeigeEinstellungen() {
  const [e, s] = await Promise.all([api("/api/einstellungen"), api("/api/status")]);
  const feld = (id, label, wert, typ = "text") => [el("label", { class: "feld", for: id }, label), el("input", { type: typ, id, value: wert })];
  const ha = el("textarea", { id: "hausannahmen", style: "min-height:260px" }, e.hausannahmen);
  const meldung = el("div", { class: "hinweis" });
  const form = el("form", { class: "karte", onsubmit: async (ev) => {
    ev.preventDefault();
    const v = (id) => document.getElementById(id).value;
    await api("/api/einstellungen", { method: "PUT", body: {
      firma: v("firma"), absender: v("absender"), hausannahmen: ha.value,
      investorenprofil: { ekVerfuegbar: Number(v("ek")), kkRahmen: Number(v("kk")), kkZins: Number(v("kkzins")) },
    } });
    meldung.textContent = "Gespeichert — gilt ab der nächsten Analyse.";
  } },
  el("h2", {}, "Hausannahmen"),
  el("p", { class: "hinweis" }, "Diese Sätze bekommt Claude bei jeder Analyse mit — wie die Projektanweisungen in Claude."),
  ha,
  ...feld("firma", "Firma", e.firma),
  ...feld("absender", "Absenderzeile der Bankfassung", e.absender),
  el("h2", { style: "margin-top:18px" }, "Investorenprofil (für die Rechner)"),
  ...feld("ek", "Eigenkapital verfügbar (€)", e.investorenprofil.ekVerfuegbar, "number"),
  ...feld("kk", "Kontokorrent-Rahmen (€)", e.investorenprofil.kkRahmen, "number"),
  ...feld("kkzins", "Kontokorrent-Zins (%)", e.investorenprofil.kkZins, "number"),
  el("div", { class: "zeile", style: "margin-top:14px" }, el("button", { class: "knopf", type: "submit" }, "Speichern"), meldung));
  const ja = (b) => el("span", { class: b ? "ok" : "nein" }, b ? "ja" : "nein");
  const statusKarte = el("section", { class: "karte status-liste" },
    el("h2", {}, "System"),
    el("div", {}, el("span", {}, "Modell"), el("span", {}, `${s.modell} · Effort ${s.effort}`)),
    el("div", {}, el("span", {}, "API-Schlüssel gesetzt"), ja(s.apiKey)),
    el("div", {}, el("span", {}, "Rechenkern"), el("span", {}, s.rechenkern === "original" ? "FixFlip Pro index.html (Original)" : "eingebauter Port")),
    el("div", {}, el("span", {}, "Rechner über eure build.py"), ja(s.originalBuild)),
    el("div", {}, el("span", {}, "Sprachnachrichten transkribieren"), ja(s.transkription)),
    el("div", {}, el("span", {}, "PDF-Erzeugung"), ja(s.pdf)),
    s.stand ? el("div", {}, el("span", {}, "Programmstand"), el("span", {}, s.stand)) : null);
  let schluesselKarte = null;
  if (ich?.admin) {
    const k = await api("/api/api-schluessel");
    const eingabe = el("input", { type: "password", id: "api-schluessel", autocomplete: "off", placeholder: "sk-ant-…" });
    const info = el("div");
    const knopf = el("button", { class: "knopf", type: "submit" }, "Prüfen und speichern");
    schluesselKarte = el("form", { class: `karte${k.gesetzt ? "" : " hervor"}`, onsubmit: async (ev) => {
      ev.preventDefault();
      setze(info);
      knopf.disabled = true;
      knopf.textContent = "Prüfe …";
      try {
        const r = await api("/api/api-schluessel", { method: "PUT", body: { schluessel: eingabe.value } });
        eingabe.value = "";
        setze(info, el("div", { class: "okbox" }, `Gespeichert ✓ (endet auf …${r.ende}). Claude ist startklar.`));
      } catch (err) { setze(info, fehlerbox(err.message)); }
      knopf.disabled = false;
      knopf.textContent = "Prüfen und speichern";
    } },
    el("h2", {}, "Anthropic-API-Schlüssel"),
    k.ausEnv ? el("p", { class: "hinweis" }, `Steht in der .env auf dem Server (endet auf …${k.ende || "?"}).`) : [
      el("p", { class: "hinweis" }, k.gesetzt
        ? `Gesetzt ✓ (endet auf …${k.ende}). Zum Ersetzen einen neuen einfügen.`
        : "Einmal einfügen — aus platform.claude.com → API Keys. Er bleibt nur auf dem Server und wird nicht wieder angezeigt."),
      info,
      el("label", { class: "feld", for: "api-schluessel" }, "Schlüssel"), eingabe,
      el("div", { style: "margin-top:12px" }, knopf),
    ]);
  }
  setze(app, el("h1", {}, "Einstellungen"), el("div", { class: "raster" }, form, el("div", { class: "stapel" }, schluesselKarte, statusKarte)));
}

// ── Zugang (nur Admins) ─────────────────────────────────────────────────────
async function zeigeZugang() {
  const liste = el("div", { class: "status-liste" });
  const fehler = el("div");
  const zeichne = (personen) => setze(liste, personen.map((p) => el("div", {},
    el("span", {}, p.name ? `${p.name} · ${p.email}` : p.email),
    p.admin ? el("span", { class: "hinweis" }, "Admin (.env)")
      : el("button", { class: "leise", type: "button", onclick: async () => {
        if (!confirm(`${p.email} den Zugang entziehen?`)) return;
        try { zeichne(await api(`/api/zugang/${encodeURIComponent(p.email)}`, { method: "DELETE" })); }
        catch (err) { setze(fehler, fehlerbox(err.message)); }
      } }, "Entfernen"))));
  zeichne(await api("/api/zugang"));
  const waKarte = el("section", { class: "karte" });
  let waTimer = null;
  async function zeichneWa() {
    const wa = await api("/api/whatsapp").catch((err) => ({ fehler: err.message }));
    const zustand = { verbunden: "verbunden ✓", koppeln: "wartet auf Koppeln", getrennt: "getrennt (verbindet neu)", abgemeldet: "abgemeldet — neu koppeln", abgelaufen: "QR abgelaufen — startet neu" };
    setze(waKarte,
      el("h2", {}, "WhatsApp-Gruppe"),
      !wa.eingerichtet ? el("p", { class: "hinweis" }, wa.fehler || "Die Bridge ist auf diesem Server nicht eingerichtet (WA_STORE fehlt).") : [
        el("div", { class: "status-liste" },
          el("div", {}, el("span", {}, "Zustand"), el("span", {}, zustand[wa.zustand] || wa.zustand)),
          wa.nummer ? el("div", {}, el("span", {}, "Nummer"), el("span", {}, `+${wa.nummer}`)) : null,
          (wa.gruppen || []).map((g) => el("div", {}, el("span", {}, g.name), el("span", {}, `${g.anzahl} Nachrichten${g.letzte ? ` · zuletzt ${datum(g.letzte)}` : ""}`)))),
        wa.gruppeFehlt ? el("p", { class: "hinweis" }, "⚠ Die Firmennummer ist in keiner passenden Gruppe (WA_GRUPPEN). Bitte zur Gruppe hinzufügen.") : null,
        wa.qr ? [
          el("p", {}, "Mit dem Firmen-Handy scannen: WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen."),
          el("img", { src: `/api/whatsapp/qr.png?t=${Date.now()}`, alt: "QR-Code zum Koppeln", class: "wa-qr" }),
        ] : null,
      ]);
    clearTimeout(waTimer);
    if (location.hash === "#/zugang" && wa.eingerichtet && wa.zustand !== "verbunden") waTimer = setTimeout(zeichneWa, 5000);
  }
  await zeichneWa();
  const email = el("input", { type: "email", id: "neu-email", required: true });
  const name = el("input", { id: "neu-name", placeholder: "optional" });
  const form = el("form", { class: "karte", onsubmit: async (e) => {
    e.preventDefault();
    setze(fehler);
    try { zeichne(await api("/api/zugang", { method: "POST", body: { email: email.value, name: name.value } })); email.value = ""; name.value = ""; }
    catch (err) { fehler.append(fehlerbox(err.message)); }
  } },
  el("h2", {}, "Person freischalten"),
  el("p", { class: "hinweis" }, "Alle Freigeschalteten sehen alle Objekte. Die Anmeldung läuft über das Supabase-Konto wie bei BauDoc — wer dort noch kein Konto hat, im Supabase-Dashboard unter Authentication → Users → „Invite user“ einladen."),
  fehler,
  el("label", { class: "feld", for: "neu-email" }, "E-Mail"), email,
  el("label", { class: "feld", for: "neu-name" }, "Name"), name,
  el("div", { style: "margin-top:14px" }, el("button", { class: "knopf", type: "submit" }, "Freischalten")));
  setze(app, el("h1", {}, "Zugang"), el("div", { class: "raster" }, el("div", { class: "stapel" }, form, waKarte), el("section", { class: "karte" }, el("h2", {}, "Wer hat Zugang"), liste)));
}

// ── Routing ─────────────────────────────────────────────────────────────────
async function route() {
  if (/(^#|&)(access_token|error)=/.test(location.hash)) return linkAusEmail();
  navAktiv();
  if (offeneQuelle && !location.hash.startsWith("#/objekt/")) { offeneQuelle.close(); offeneQuelle = null; }
  const h = location.hash || "#/";
  try {
    ich ||= await api("/api/ich");
    document.getElementById("abmelden").hidden = false;
    document.getElementById("abmelden").title = `Angemeldet als ${ich.email}`;
    document.getElementById("nav-zugang").hidden = !ich.admin;
    const m = h.match(/^#\/objekt\/([A-Za-z0-9_-]+)/);
    if (m) await zeigeObjekt(m[1]);
    else if (h === "#/einstellungen") await zeigeEinstellungen();
    else if (h === "#/zugang") await zeigeZugang();
    else await zeigeListe();
  } catch (err) {
    if (err.message !== "Bitte anmelden.") setze(app, fehlerbox(err.message));
  }
}

document.getElementById("abmelden").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); ich = null; zeigeLogin(); });
window.addEventListener("hashchange", route);
if (new URLSearchParams(location.search).get("geteilt") === "anmelden") zeigeLogin("Bitte anmelden und dann erneut aus WhatsApp teilen.");
else route();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
