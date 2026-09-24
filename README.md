# A²O Immo-Rechner — Ankaufskalkulation & FixFlip Pro als Web-App

Die App übernimmt den Ablauf, den ihr bisher im Claude-Chat macht, und stellt ihn unter `immo-rechner.a2o-architekten.de` bereit. Dahinter steht die Claude API:

**Unterlagen hochladen oder aus der WhatsApp-Gruppe „Objekte Immo“ auswählen** (Exposés, Mappen, Fotos, Notizen, Sprachnachrichten)
→ **Claude liest, recherchiert den Markt im Web und rechnet mit FixFlip Pro**
→ **dieselben Dokumente wie im Objektordner:**

| Datei | Inhalt |
|---|---|
| `Ankaufskalkulation_<Objekt>_gelb.pdf/.html` | interne Fassung: Geschätztes ist gelb markiert, dazu Methode und Quellen |
| `Ankaufskalkulation_<Objekt>_ohne_Markierung.pdf/.html` | Fassung für die Bank, ohne Markierungen und interne Verweise, mit Absenderzeile |
| `FixFlipPro_Rechner_<Objekt>_<Exit>.html` | interaktiver Rechner je Exit, mit Kompakt-Mappe, Bankvorlage und Verhandlungsgrundlage |
| `_fixflip/expose.json, plan.json, ergebnis.json, inputs_*.json, profil.json` | Rechengrundlagen, reproduzierbar |
| `Quellen/Quellen-Uebersicht.md` | WhatsApp-Verlauf mit Transkripten der Sprachnachrichten |

Rückfragen wie „rechne zusätzlich mit 950.000 €“ oder „was, wenn die Miete 10 % niedriger ist?“ laufen im selben Verlauf weiter, wie im Chat. Die Dokumente werden danach neu erzeugt. Über „Objektordner als ZIP“ holt ihr alles in der Dropbox-Struktur ab.

## Was dieselbe Qualität wie im Claude-Chat sichert

- **Modell:** Claude Opus 5 mit adaptivem Denken, einstellbar über `CLAUDE_MODEL` und `CLAUDE_EFFORT`.
- **Werkzeuge:** Websuche und Web-Fetch, damit Claude Portalpreise, Gutachterausschuss, Kündigungssperrfristen und Infrastruktur selbst recherchieren kann.
- **Rechnen ohne Modell:** Claude rechnet nie selbst. Jede Zahl kommt aus `berechneFixFlip()`.
  - Liegt eure echte `fixflip-pro/index.html` auf dem Server (`FIXFLIP_DIR`), zieht die App die Funktion direkt daraus, genau wie `kalkulation.mjs`.
  - Sonst rechnet der eingebaute Port. Er ist gegen eine echte Ankaufskalkulation getestet (`test/fixflip.test.js`): Matrix, Rechenweg, Abbruchkriterium und Break-even stimmen auf den Euro.
- **Layout:** Die Ankaufskalkulation übernimmt Layout und CSS 1:1 aus `kalkulation_pdf.py`. Das PDF druckt Chromium, wie auf dem Mac.
- **Rechner:**
  - Liegt eure `standalone/build.py` im `FIXFLIP_DIR`, ruft die App sie genauso auf wie „Rechner erstellen.command“.
  - Sonst nimmt sie die eingebaute Vorlage. Diese enthält denselben Rechenkern, die Bearbeitungsgebühr, die Kompakt-Mappe, Bankvorlage und Verhandlungsgrundlage aus `build.py`.
- **Hausannahmen:** Sie stehen unter „Einstellungen“ und entsprechen den Projektanweisungen in Claude, also Standardsätzen, Zielmarge, Ampel und Investorenprofil.

## Anmeldung

Wie bei BauDoc: E-Mail eingeben, Link oder Code aus der Mail, fertig. Die Konten liegen im Supabase-Projekt `hilfezumselberbauen`, eine Selbstregistrierung gibt es nicht.

- **Admins** stehen in `.env` unter `ADMIN_EMAILS`. Sie schalten unter „Zugang“ weitere Personen frei (Team und Partner) und koppeln WhatsApp.
- **Alle Freigeschalteten sehen alle Objekte.** Wer von der Liste genommen wird, ist sofort abgemeldet.
- Wer noch kein Supabase-Konto hat: im Supabase-Dashboard unter *Authentication → Users → Invite user* einladen.
- **Einmalig in Supabase** (Projekt `hilfezumselberbauen` → *Authentication → URL Configuration*): `https://immo-rechner.a2o-architekten.de/**` zu den Redirect-URLs hinzufügen.
- Auf dem iPhone als Homescreen-App den **Code** aus der Mail eintippen statt den Link zu öffnen, denn der Link öffnet Safari, nicht die App. Dafür muss die Mail-Vorlage „Magic Link“ `{{ .Token }}` enthalten.

## WhatsApp-Gruppe „Objekte Immo“

Die Bridge (`bridge/`) hängt als **verknüpftes Gerät** an der Firmennummer, wie WhatsApp Web, und liest mit:

- Gespeichert wird **nur** die Gruppe aus `WA_GRUPPEN`. Andere Chats der Nummer landen nicht auf dem Server.
- Texte, Standorte, Fotos, PDFs und Sprachnachrichten werden **sofort** heruntergeladen, weil WhatsApp-Links nach einiger Zeit ablaufen. Sprachnachrichten werden gleich im Hintergrund transkribiert.
- Bearbeitete Nachrichten werden aktualisiert, „für alle gelöschte“ auch hier gelöscht.
- Die Bridge **kann nichts senden** und hat keinen offenen Port.

In der App auf „Aus „Objekte Immo“ übernehmen“ klicken, einen Zeitraum wählen und die Nachrichten anhaken. Die Auswahl zeigt Fotos, PDFs und Sprachnachrichten mit Transkript. Daraus wird ein neues Objekt, oder die Nachrichten kommen als Quelle ins bestehende.

**Koppeln:** Als Admin „Zugang“ öffnen und den QR-Code mit dem Firmen-Handy scannen (*WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen*). Voraussetzungen und Grenzen:

- Die Firmennummer muss **Mitglied der Gruppe** sein.
- WhatsApp erlaubt höchstens vier verknüpfte Geräte pro Nummer.
- Beim Koppeln überträgt WhatsApp einen Teil des Verlaufs. Ältere Medien sind dann oft nicht mehr ladbar, die Auswahl zeigt sie als „nicht mehr ladbar“.
- Das Handy der Firmennummer muss ab und zu online sein, sonst trennt WhatsApp verknüpfte Geräte nach etwa 14 Tagen.

**Risiko offen gesagt:** Die Bridge nutzt whatsmeow, eine inoffizielle Umsetzung des WhatsApp-Web-Protokolls. Das verstößt gegen die WhatsApp-Nutzungsbedingungen, und WhatsApp kann die Nummer im schlimmsten Fall sperren. Reines Mitlesen ohne Senden fällt erfahrungsgemäß kaum auf, ausschließen lässt sich eine Sperre aber nicht. Die Mitglieder der Gruppe sollten wissen, dass ihre Nachrichten in den Immo-Rechner übernommen werden.

Weiter möglich: Chat-Export als ZIP hochladen (*Chat exportieren → Medien anhängen*). Unter Android geht das auch direkt über „Teilen → Immo-Rechner“.

## Sprachnachrichten

Die Claude API nimmt kein Audio an. Die Transkription läuft deshalb **lokal auf dem Server** (`whisper/`): faster-whisper mit `large-v3-turbo`, demselben Modell wie auf dem Mac, als int8 auf der CPU.

- Beim ersten Start lädt Whisper das Modell (ca. 1,6 GB).
- Auf 2 Kernen braucht eine Minute Sprachnachricht etwa 1–2 Minuten. Das läuft im Hintergrund, sobald die Nachricht in der Gruppe ankommt.
- Transkripte werden nach Inhalt gespeichert, jede Aufnahme wird nur einmal transkribiert.

Alternativ geht jeder Whisper-kompatible Dienst über `TRANSCRIBE_URL`, zum Beispiel Groq. Dann verlassen die Aufnahmen aber den Server.

## Auf den Server bringen (Hetzner CX23)

1. **DNS bei SiteGround:** A-Record `immo-rechner` → IP des Servers.
2. **Supabase:** Redirect-URL eintragen (siehe *Anmeldung*).
3. **Hetzner-Konsole → Server → `>_` Console**, als root:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/labiotanks-hash/immo-rechner/main/deploy/einrichten.sh | bash
   ```
   Das Skript macht Folgendes:
   - installiert Docker und legt 4 GB Swap an;
   - fragt **unsichtbar** nach dem Anthropic-Schlüssel und nach den Admin-Adressen und legt `/opt/immo-rechner/.env` an (nur root lesbar);
   - prüft die DNS und startet App, Bridge, Whisper und Caddy (HTTPS automatisch);
   - bricht ab, ohne etwas zu ändern, wenn auf 80/443 schon ein anderer Webserver läuft.

   Ein zweiter Aufruf aktualisiert auf den neuesten Stand.
4. **Hetzner-Backups einschalten.** Auf dem Server liegen die WhatsApp-Kopplung und alle Objekte.

Speicherbedarf: App mit Chromium ca. 1 GB, Whisper ca. 1,5–2,5 GB, Bridge und Caddy wenig. Wird es eng, in der Hetzner-Konsole auf CX33 skalieren.

Optional, eure echte FixFlip Pro: `fixflip-pro/` mit `index.html` und `standalone/build.py` nach `/opt/immo-rechner/app/` legen. Dann in `docker-compose.yml` die Zeile `./fixflip-pro:/fixflip-pro:ro` einkommentieren und in `.env` `FIXFLIP_DIR=/fixflip-pro` setzen.

**Lokal ausprobieren:**
```bash
npm install
UNSICHER_OHNE_LOGIN=1 ANTHROPIC_API_KEY=… npm start   # → http://localhost:8080, ohne Anmeldung
```

## Kosten

Claude Opus 5 kostet 5 $ je Million Eingabe-Tokens und 25 $ je Million Ausgabe-Tokens. Wiederholte Anteile laufen über den Prompt-Cache deutlich günstiger. Wie viele Tokens eine Analyse braucht, hängt von den Unterlagen und der Recherche ab. Den tatsächlichen Verbrauch je Lauf speichert die App in `meta.json` unter `laeufe[].usage`, dazu kommen die Abrechnungen von Websuche und Transkription. Mit `CLAUDE_EFFORT=medium` wird es günstiger, allerdings mit weniger Tiefe.

## Datenschutz und Sicherheit

- **Anmeldung:** per E-Mail-Link über Supabase, dazu eine eigene Zugangsliste auf dem Server. Die Sitzung gilt 30 Tage.
- **Was an Anthropic geht:** Exposés, ausgewählte Chats und Transkripte laufen zur Verarbeitung über die Anthropic API. PDFs und Bilder liegen dort über die Files API. Beim Löschen eines Objekts werden sie auch bei Anthropic gelöscht.
- **Was auf dem Server bleibt:** WhatsApp-Nachrichten der Gruppe und die Sprachaufnahmen. Die Transkription läuft lokal. An Claude geht nur, was ihr für ein Objekt auswählt.
- **Daten Dritter:** WhatsApp-Verläufe enthalten Daten Dritter. Deshalb die Auftragsverarbeitung mit Anthropic prüfen und die Gruppe informieren.
- **Isolierte Dokumente:** Rechner, Kalkulationen und WhatsApp-Anhänge laufen im Browser in einer Sandbox, ohne Zugriff auf Anmeldung und API der App.
- **Keine Geheimnisse ins Repo:** `.env`, API-Schlüssel und eure FixFlip-Pro-Quelldateien gehören nicht hinein. `.gitignore` schließt `.env`, `daten/` und `fixflip-pro/` aus.

## Entwicklung

```bash
npm test                      # Rechenkern, WhatsApp-Parser und -Live-Import, Anmeldung, ganzer Lauf gegen eine nachgebaute Claude-API
cd bridge && go test ./...    # Bridge: Speicher, Texte, Dateinamen
```

| Datei | Aufgabe |
|---|---|
| `lib/fixflip.js` | Rechenkern (Port von `berechneFixFlip`), Kalkulationsplan, Max-Kaufpreis, Break-even |
| `lib/engine.js` | echte `index.html` bevorzugen, sonst Port |
| `lib/agent.js`, `lib/prompt.js`, `lib/werkzeuge.js` | Claude-Lauf, Systemprompt, Werkzeuge |
| `lib/ingest.js`, `lib/whatsapp.js`, `lib/transcribe.js` | Eingänge |
| `lib/whatsapp-live.js`, `bridge/` | WhatsApp-Gruppe live |
| `lib/auth.js`, `lib/zugang.js` | Anmeldung (Supabase) und Zugangsliste |
| `whisper/` | lokale Spracherkennung |
| `deploy/einrichten.sh`, `docker-compose.yml`, `Caddyfile` | Server |
| `lib/dokumente.js`, `lib/render/*` | Ankaufskalkulation, Rechner, PDF |
| `vorlagen/rechner.html` | eingebaute Rechner-Vorlage |
| `server.js`, `public/*` | Web-App |
