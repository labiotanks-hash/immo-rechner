# A²O Ankauf — Ankaufskalkulation & FixFlip Pro als Web-App

Die App übernimmt den Ablauf, den ihr bisher im Claude-Chat macht, und stellt ihn auf einer eigenen Subdomain bereit, zum Beispiel `rechner.a2o-architekten.de`. Dahinter steht die Claude API:

**Unterlagen hochladen** (Exposés, Mappen, Fotos, Notizen, Sprachnachrichten, WhatsApp-Export)
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

## WhatsApp-Gruppe importieren

1. In der Gruppe: **⋮ / Gruppenname → Chat exportieren → Medien anhängen**.
   - **Android:** Die installierte App (siehe unten) als Ziel wählen. Das Objekt wird mit dem ZIP automatisch angelegt.
   - **iPhone:** „In Dateien sichern“ wählen, dann in der App unter „Quellen“ das ZIP auswählen. iOS erlaubt Web-Apps kein Teilen-Ziel.
2. Die App entpackt das ZIP und liest den Chat, iOS- und Android-Format, deutsch und englisch. Sprachnachrichten werden transkribiert, PDFs und Fotos gehen als Dokumente an Claude.
3. Große Gruppen: Unter „Quellen“ einen **Zeitraum** setzen, dann gehen nur diese Nachrichten samt Anhängen mit.

**App aufs Handy:** Seite in Chrome öffnen → Menü → „Zum Startbildschirm hinzufügen“. Danach steht „A²O Ankauf“ im Teilen-Menü von WhatsApp. Einmal vorher anmelden.

Einen Bot, der die Gruppe automatisch mitliest, gibt es bewusst nicht. WhatsApp erlaubt das offiziell nur für Business-Nummern, und inoffizielle Brücken verstoßen gegen die Nutzungsbedingungen. Die Nummer könnte dann gesperrt werden. Der Export dauert zehn Sekunden und ist sicher.

## Sprachnachrichten

Die Claude API nimmt kein Audio an. Die App schickt Sprachnachrichten deshalb an einen Whisper-kompatiblen Dienst:
- **Standard:** Groq mit `whisper-large-v3-turbo`, dasselbe Modell wie lokal auf dem Mac. Nötig ist ein Schlüssel unter console.groq.com.
- **Alternative:** OpenAI oder ein eigener whisper.cpp-Server.

Ist `TRANSCRIBE_URL` leer, bekommt Claude nur den Hinweis „Sprachnachricht, nicht transkribiert“. Die Transkripte könnt ihr in der App aufklappen und prüfen.

## Auf die Subdomain bringen

Ihr braucht einen kleinen Linux-Server mit Docker, zum Beispiel Hetzner CX22 für ca. 5 €/Monat.

1. **DNS:** Beim Domain-Anbieter einen A-Record `rechner` auf die IP des Servers anlegen.
2. **Server einrichten:**
   ```bash
   git clone <dieses Repo> && cd <repo>/ankauf-app
   cp .env.example .env      # ANTHROPIC_API_KEY, APP_PASSWORD, SESSION_SECRET, DOMAIN, TRANSCRIBE_* ausfüllen
   docker compose up -d --build
   ```
   Caddy holt das HTTPS-Zertifikat automatisch. Die Daten liegen im Docker-Volume `daten`.
3. **Optional, eure echte FixFlip Pro:** Den Ordner `fixflip-pro` mit `index.html` und `standalone/build.py` neben `docker-compose.yml` legen. Dann in `docker-compose.yml` die Zeile `./fixflip-pro:/fixflip-pro:ro` einkommentieren und in `.env` `FIXFLIP_DIR=/fixflip-pro` setzen. Unter „Einstellungen → System“ steht danach „Original“.

Statt eines eigenen Servers geht auch jede Plattform, die ein Dockerfile mit dauerhaftem Volume betreibt, zum Beispiel Render, Railway oder Fly.io. Dort legt ihr die Subdomain als Custom Domain an und setzt beim Domain-Anbieter einen CNAME auf die Plattform. Serverless-Funktionen wie Vercel oder Netlify passen nicht, denn eine Analyse läuft mehrere Minuten.

**Lokal ausprobieren:**
```bash
cd ankauf-app && npm install
ANTHROPIC_API_KEY=… APP_PASSWORD=test SESSION_SECRET=$(openssl rand -hex 32) npm start
# → http://localhost:8080
```

## Kosten

Claude Opus 5 kostet 5 $ je Million Eingabe-Tokens und 25 $ je Million Ausgabe-Tokens. Wiederholte Anteile laufen über den Prompt-Cache deutlich günstiger. Wie viele Tokens eine Analyse braucht, hängt von den Unterlagen und der Recherche ab. Den tatsächlichen Verbrauch je Lauf speichert die App in `meta.json` unter `laeufe[].usage`, dazu kommen die Abrechnungen von Websuche und Transkription. Mit `CLAUDE_EFFORT=medium` wird es günstiger, allerdings mit weniger Tiefe.

## Datenschutz und Sicherheit

- **Anmeldung:** Zugang nur mit Team-Passwort. Die Anmeldung gilt 30 Tage, nach 10 Fehlversuchen wird 15 Minuten gesperrt.
- **Was an Anthropic geht:** Exposés, Chats und Transkripte laufen zur Verarbeitung über die Anthropic API. PDFs und Bilder liegen dort über die Files API. Beim Löschen eines Objekts werden sie auch bei Anthropic gelöscht. WhatsApp-Verläufe enthalten Daten Dritter, deshalb vorher eure Auftragsverarbeitung prüfen.
- **Isolierte Dokumente:** Rechner und Kalkulationen laufen im Browser in einer Sandbox, ohne Zugriff auf Anmeldung und API der App.
- **Keine Geheimnisse ins Repo:** `.env`, API-Schlüssel und eure FixFlip-Pro-Quelldateien gehören nicht hinein. `.gitignore` schließt `.env`, `daten/` und `fixflip-pro/` aus.

## Entwicklung

```bash
npm test     # Rechenkern gegen Referenzzahlen, WhatsApp-Parser, ganzer Lauf gegen eine nachgebaute Claude-API
```

| Datei | Aufgabe |
|---|---|
| `lib/fixflip.js` | Rechenkern (Port von `berechneFixFlip`), Kalkulationsplan, Max-Kaufpreis, Break-even |
| `lib/engine.js` | echte `index.html` bevorzugen, sonst Port |
| `lib/agent.js`, `lib/prompt.js`, `lib/werkzeuge.js` | Claude-Lauf, Systemprompt, Werkzeuge |
| `lib/ingest.js`, `lib/whatsapp.js`, `lib/transcribe.js` | Eingänge |
| `lib/dokumente.js`, `lib/render/*` | Ankaufskalkulation, Rechner, PDF |
| `vorlagen/rechner.html` | eingebaute Rechner-Vorlage |
| `server.js`, `public/*` | Web-App |
