# Betrieb — Server, Updates, Fehlerbilder

## Server

| | |
|---|---|
| Name | `immo-rechner` (Hetzner Cloud, Projekt **a2o-apps**) |
| Typ | CPX22 · 2 vCPU AMD · 4 GB RAM · 80 GB · Nürnberg |
| System | Ubuntu 24.04, Docker, 4 GB Swap |
| IP | `188.245.24.185` — DNS `immo-rechner.a2o-architekten.de` bei SiteGround |
| Backups | Hetzner-Backups an (täglich, 7 Stände) |
| Kosten | 19,49 € Server + 3,90 € Backups + 0,50 € IPv4 = **23,89 €/Monat** (zzgl. Anthropic-Verbrauch) |
| Einrichtung | beim Anlegen per „Cloud config“ (`deploy/cloud-config.yaml`) → `deploy/einrichten.sh` |

Der Bau-App-Server `ubuntu-4gb-nbg1-2` (2.28.51.197) ist ein eigener Server und wird hier nicht angefasst.

**Einloggen** (nur für Wartung nötig), vom Mac mit dem Schlüssel „Mac Hetzner“:

```bash
ssh -i ~/.ssh/hetzner root@188.245.24.185
```

---

## Updates

Neue Stände kommen über GitHub (`labiotanks-hash/immo-rechner`, Zweig `main`) — **nur auf Knopfdruck**, nichts läuft im Hintergrund:

1. Code ändern und nach `main` pushen.
2. In der App als Admin: *Einstellungen → Aktualisierung → „Nach Updates suchen“*.
3. Die App legt einen Auftrag in `/opt/immo-rechner/auftrag/` ab; auf dem Server startet systemd (`immo-rechner-update.path`) daraufhin `deploy/aktualisieren.sh`. Das Skript
   - wartet nicht, sondern meldet „verschoben“, falls gerade eine Analyse läuft,
   - holt den neuen Stand, baut und startet neu (die App ist dabei ca. 1 Minute weg),
   - prüft, ob die App gesund startet — **wenn nicht, geht es automatisch auf den letzten funktionierenden Stand zurück**,
   - schreibt das Ergebnis zurück; die App zeigt es unter dem Knopf an (aktuell / aktualisiert / verschoben / zurückgerollt).
4. Der laufende Programmstand steht in der App unter *Einstellungen → System → Programmstand*.

Von Hand auf dem Server:

```bash
systemctl start immo-rechner-update          # wie der Knopf
journalctl -u immo-rechner-update -n 50      # was die letzten Updates gemacht haben
```

Einmalig nötig, falls der Knopf-Mechanismus auf dem Server noch fehlt (Server vor dieser Funktion angelegt) — vom Mac:

```bash
ssh -i ~/.ssh/hetzner root@188.245.24.185 "curl -fsSL https://raw.githubusercontent.com/labiotanks-hash/immo-rechner/main/deploy/einrichten.sh | bash"
```

---

## Protokolle und Zustand

```bash
cd /opt/immo-rechner/app
docker compose ps                      # laufen alle vier Dienste?
docker compose logs -f app             # App (Anmeldungen, Analysen, Fehler)
docker compose logs -f bridge          # WhatsApp (neue Nachrichten, Downloads, Kopplung)
docker compose logs -f whisper         # Spracherkennung (erster Start: Modell-Download)
docker compose logs -f caddy           # HTTPS-Zertifikat
tail -f /var/log/immo-rechner.log      # Protokoll der Ersteinrichtung
```

---

## Zugang verwalten

- **Partner/Team freischalten**: in der App unter *Zugang* (nur Admins). Wer noch kein Supabase-Konto hat: Supabase → Projekt `hilfezumselberbauen` → Authentication → Users → *Invite user*.
- **Admins**: `ADMIN_EMAILS` in `/opt/immo-rechner/.env`, danach `cd /opt/immo-rechner/app && docker compose up -d`.
- **Anthropic-Schlüssel wechseln**: *Einstellungen → Anthropic-API-Schlüssel* (nur Admins).

## WhatsApp koppeln / neu koppeln

*Zugang → WhatsApp-Gruppe*: QR-Code mit dem **Firmen-Handy** scannen (WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen). Der QR-Code muss auf einem anderen Bildschirm stehen als dem Firmen-Handy.

- Die Firmennummer muss Mitglied von „Objekte Immo“ sein.
- Höchstens vier verknüpfte Geräte pro Nummer (die Bau-App-Bridge belegt eins).
- Das Firmen-Handy muss ab und zu online sein, sonst trennt WhatsApp verknüpfte Geräte nach etwa 14 Tagen → dann erscheint unter *Zugang* wieder ein QR-Code.

---

## Fehlerbilder

| Symptom | Ursache / Abhilfe |
|---|---|
| Browser zeigt „Awesome Site in The Making“ | alter DNS-Eintrag (SiteGround) im Cache des Rechners/Routers — bis zu 1 h warten, am Handy über Mobilfunk testen |
| „Noch kein Anthropic-API-Schlüssel eingetragen“ | Admin: *Einstellungen → Anthropic-API-Schlüssel* |
| Anmeldelink führt ins Leere | Redirect-URL `https://immo-rechner.a2o-architekten.de/**` in Supabase → Authentication → URL Configuration prüfen; alternativ den 6-stelligen Code nutzen |
| „… hat noch keinen Zugang“ | Person unter *Zugang* freischalten (und ggf. in Supabase einladen) |
| Sprachnachrichten „Transkript folgt …“ | Whisper lädt beim ersten Start das Modell (einige Minuten) — `docker compose logs whisper` |
| WhatsApp „getrennt“ / QR erscheint wieder | Firmen-Handy war lange offline oder das Gerät wurde entfernt → neu koppeln |
| Update kommt nicht an | Ergebnis unter dem Knopf lesen; Details: `journalctl -u immo-rechner-update -n 50`. Ein zurückgerollter Stand wird beim nächsten Klick erneut versucht. |

---

## Entwicklungs-Todos

- [ ] **WhatsApp koppeln** und ersten echten Import aus „Objekte Immo“ testen.
- [ ] **Knopf „Nach Updates suchen“** auf dem aktuellen Server einmalig einrichten (Befehl oben unter *Updates*).
- [ ] **Wechsel auf Claude Opus 5.5** (`claude-opus-5-5`): pro Token ca. 20 % günstiger (4 $/20 $ statt 5 $/25 $ je Mio. Tokens Ein-/Ausgabe, Cache-Lesen 0,20 $). Vorher prüfen:
  - Effort ausdrücklich setzen — Standard ist bei 5.5 `medium`, die App setzt bereits `CLAUDE_EFFORT=high`.
  - Denken lässt sich nicht abschalten (die App nutzt ohnehin adaptives Denken), erzwungenes `tool_choice` gibt es nicht mehr (nutzt die App nicht).
  - Gesprächsverlauf nur anhängen, nie nachträglich ändern („preserved thinking“) — Rückfragen-Logik darauf prüfen.
  - Einen echten Lauf mit einem bekannten Objekt vergleichen (Qualität, Tokens, Kosten je Kalkulation), dann `CLAUDE_MODEL=claude-opus-5-5` in `.env` setzen.
- [ ] Optional: Bau-App auf den CPX22 umziehen, wenn der Speicher reicht (nach einigen Wochen Betrieb messen).
- [ ] Optional: eigene FixFlip-Pro-Dateien (`index.html`, `standalone/build.py`) einbinden (`FIXFLIP_DIR`), damit Rechenkern und Rechner exakt aus dem Original kommen.
