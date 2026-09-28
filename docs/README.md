# A²O Immo-Rechner — Dokumentation

Stand: September 2026 · Architekturbild: [`architektur/architektur.html`](architektur/architektur.html) (im Browser öffnen)

| Dokument | Inhalt |
|---|---|
| diese Seite | Was die App macht, woraus sie besteht, wie die Daten fließen |
| [`betrieb.md`](betrieb.md) | Server, Updates, Protokolle, Backups, Fehlerbilder — für den Alltag |
| [`architektur/architektur.html`](architektur/architektur.html) | Architekturbild mit Komponenten und Datenfluss |
| [`../README.md`](../README.md) | Kurzüberblick, Kosten, Entwicklung |

---

## 1. Wozu

Der Immo-Rechner bildet den Ablauf „Ankaufskalkulation + FixFlip Pro“ aus dem Claude-Chat als eigene Web-App ab:

**Unterlagen** (Exposés, Mappen, Fotos, Notizen, Sprachnachrichten — hochgeladen oder aus der WhatsApp-Gruppe „Objekte Immo“ ausgewählt)
→ **Claude** liest, recherchiert den Markt im Web und rechnet ausschließlich mit dem FixFlip-Pro-Rechenkern
→ **Dokumente wie im Objektordner**: Ankaufskalkulation gelb (intern) und ohne Markierung (Bank) als HTML und PDF, FixFlipPro-Rechner je Exit, Rechengrundlagen als JSON, Quellen-Übersicht.

Adresse: **https://immo-rechner.a2o-architekten.de** · Zugang nur auf Einladung (Team und Partner, alle sehen alle Objekte).

---

## 2. Bausteine

| Baustein | Technik | Aufgabe | Erreichbar |
|---|---|---|---|
| **Caddy** | caddy:2 | HTTPS mit automatischem Let's-Encrypt-Zertifikat, leitet an die App weiter (ohne Puffer für den Live-Fortschritt) | **einziger offener Zugang**, Port 80/443 |
| **App** | Node 22, Express, Chromium | Anmeldung, Objekte, Uploads, Claude-Lauf, FixFlip-Rechenkern, Dokumente/PDF, WhatsApp-Auswahl, Hintergrund-Transkription | nur intern (8080) |
| **WhatsApp-Bridge** | Go, whatsmeow | hängt als verknüpftes Gerät an der Firmennummer, speichert **nur** die Gruppe(n) aus `WA_GRUPPEN`, lädt Medien sofort, **kann nichts senden** | kein Port |
| **Whisper** | Python, faster-whisper `large-v3-turbo` (int8, CPU) | Sprachnachrichten → Text, lokal auf dem Server | nur intern (9000) |
| **Aktualisierung** | systemd auf dem Server | spielt auf Knopfdruck („Nach Updates suchen“) den neuesten Stand von GitHub ein, mit automatischem Rückfall | — |

Externe Dienste:

| Dienst | Wofür | Was dort liegt |
|---|---|---|
| **Supabase** Projekt `hilfezumselberbauen` | Anmeldung per E-Mail-Link oder 6-stelligem Code (wie BauDoc) | die Konten (E-Mail). Keine Objektdaten. |
| **Anthropic API** | Claude Opus 5 mit Websuche/Web-Fetch, Files API für PDFs und Bilder | ausgewählte Unterlagen zur Verarbeitung; beim Löschen eines Objekts werden die Dateien dort mitgelöscht |
| **GitHub** `labiotanks-hash/immo-rechner` | Quellcode; der Server holt sich daraus neue Stände (auf Knopfdruck) | Code, **keine** Schlüssel oder Daten |
| **SiteGround** | DNS der Domain `a2o-architekten.de` | A-Record `immo-rechner` → `188.245.24.185` |
| **Hetzner Cloud** | Server `immo-rechner` (CPX22, Nürnberg, Ubuntu 24.04, Backups an) | alles Übrige: Objekte, WhatsApp-Kopplung und -Nachrichten, Transkripte |

Der Bau-App-Server (`ubuntu-4gb-nbg1-2`, 2.28.51.197) ist davon **getrennt** und bleibt unverändert.

---

## 3. Datenfluss

### 3.1 Anmelden
1. Browser fragt bei **Supabase** Link und Code an (`create_user: false` — nur bestehende Konten).
2. Nach Klick auf den Link oder Eingabe des Codes schickt der Browser das Supabase-Token einmal an die App (`POST /api/sitzung`).
3. Die App prüft das Token bei Supabase (`/auth/v1/user`), gleicht die **Zugangsliste** ab (Admins aus `ADMIN_EMAILS`, weitere Personen aus `zugang.json`) und setzt ein eigenes signiertes Cookie (30 Tage).
4. Die Zugangsliste wird bei **jeder** Anfrage geprüft — wer entfernt wird, ist sofort draußen.

### 3.2 Unterlagen sammeln
- **Hochladen**: PDFs, Fotos, Text, DOCX, Sprachnachrichten, WhatsApp-Export-ZIP. Unter Android auch über „Teilen → Immo-Rechner“.
- **Aus der Gruppe „Objekte Immo“**: Die Bridge speichert jede neue Nachricht sofort in `nachrichten.db` und lädt Fotos/PDFs/Sprachnachrichten nach `medien/`. In der App wählt man Zeitraum und Nachrichten aus; die Auswahl wird als normaler WhatsApp-Export übernommen.
- **Sprachnachrichten** werden schon beim Eintreffen im Hintergrund transkribiert (Whisper) und nach Inhalt zwischengespeichert — jede Aufnahme nur einmal.

### 3.3 Analyse
1. Quellen werden aufbereitet: ZIPs entpacken, Chat lesen, Transkripte einsetzen, PDFs und Bilder zur Anthropic Files API hochladen (einmal, dann per `file_id`).
2. **Claude Opus 5** (adaptives Denken, Effort `high`) bekommt Systemprompt mit der A²O-Methode + Hausannahmen, die Quellen und den Auftrag.
3. Claude recherchiert (Websuche/Web-Fetch) und ruft die Werkzeuge der App:
   - `kalkulation_rechnen` / `fixflip_rechnen` → **FixFlip-Pro-Rechenkern** (Claude rechnet nie selbst),
   - `dokumente_erstellen` → Ankaufskalkulation (HTML + PDF über Chromium), FixFlipPro-Rechner je Exit, JSON-Grundlagen.
4. Fortschritt und Zwischentext laufen live per Server-Sent Events in den Browser.
5. Rückfragen („rechne mit 950.000 €“) hängen sich an denselben Verlauf an; die Dokumente werden neu erzeugt. „Objektordner als ZIP“ liefert alles in der Dropbox-Struktur.

---

## 4. Wo was liegt (auf dem Server)

| Ort | Inhalt |
|---|---|
| `/opt/immo-rechner/.env` | Einstellungen (Domain, Supabase, `ADMIN_EMAILS`, `WA_GRUPPEN`, Sitzungsschlüssel) — nur root, `chmod 600` |
| `/opt/immo-rechner/app/` | Programmstand aus GitHub |
| `/opt/immo-rechner/auftrag/` | Knopf „Nach Updates suchen“: Auftrag der App an den Server + Ergebnis (`status.json`) |
| Volume `daten` → `/daten` | `objekte/<id>/` (meta.json, Quellen/, _fixflip/, Dokumente), `einstellungen.json`, `zugang.json`, `geheim.json` (Anthropic-Schlüssel, 0600), `transkripte/` |
| Volume `wa` → `/wa` (App) = `/store` (Bridge) | `whatsapp.db` (Kopplung), `nachrichten.db`, `medien/`, `status.json`, `qr.png` |
| Volume `whisper_modelle` | Sprachmodell (~1,6 GB, einmal geladen) |
| Volume `caddy_data` | HTTPS-Zertifikate |

Der **Anthropic-Schlüssel** wird in der App unter *Einstellungen* eingetragen (nur Admins), dort bei Anthropic geprüft und nur in `geheim.json` gespeichert. Er wird nie wieder angezeigt.

---

## 5. Sicherheit und Datenschutz

- Von außen erreichbar ist nur Caddy (HTTPS). App, Bridge und Whisper haben keine offenen Ports.
- Anmeldung nur mit Einladung; Partner-Konten sehen in anderen Tools des Supabase-Projekts nichts (dort gelten `@a2o-architekten.de`-Regeln).
- Die Bridge speichert **nur** die Gruppe aus `WA_GRUPPEN`, übernimmt Bearbeiten und „Für alle löschen“ und kann **nicht senden**.
- Transkription läuft lokal; an Anthropic geht nur, was für ein Objekt ausgewählt wird.
- Rechner, Kalkulationen und WhatsApp-Anhänge werden im Browser in einer Sandbox angezeigt.
- **WhatsApp-Risiko**: Die Bridge nutzt eine inoffizielle Schnittstelle (whatsmeow). Das verstößt gegen die WhatsApp-Bedingungen; eine Sperre der Nummer ist unwahrscheinlich, aber nicht ausgeschlossen. Die Gruppenmitglieder sollten wissen, dass Nachrichten übernommen werden.
- Das Repo ist öffentlich und enthält keine Geheimnisse und keine Objektdaten.

---

## 6. Konfiguration (`/opt/immo-rechner/.env`)

| Variable | Bedeutung |
|---|---|
| `DOMAIN`, `PUBLIC_URL` | `immo-rechner.a2o-architekten.de` |
| `SESSION_SECRET` | Zufallswert für die Cookies (vom Einrichtungsskript erzeugt) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | öffentliche Werte des Projekts `hilfezumselberbauen` (nie den service_role-Key) |
| `ADMIN_EMAILS` | Admins, Komma-getrennt — dürfen Zugang vergeben, WhatsApp koppeln, API-Schlüssel setzen |
| `WA_GRUPPEN` | Name(n) der WhatsApp-Gruppe(n), Standard „Objekte Immo“ |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT` | Standard `claude-opus-5`, `high` |
| `ANTHROPIC_API_KEY` | optional — sonst in der App eintragen |
| `TRANSCRIBE_URL` | optional — Standard ist das lokale Whisper |

Nach Änderungen: `cd /opt/immo-rechner/app && docker compose up -d`.
