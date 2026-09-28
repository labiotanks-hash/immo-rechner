#!/usr/bin/env bash
# Aktualisierung auf Befehl: Ein Admin klickt in der App „Nach Updates suchen“ → die App legt
# /opt/immo-rechner/auftrag/aktualisieren an → systemd (immo-rechner-update.path) startet dieses
# Skript. Es holt neue Commits von GitHub (Zweig main), baut und startet neu — aber nicht während
# einer laufenden Analyse. Startet die neue Version nicht sauber, geht es automatisch auf den
# letzten funktionierenden Stand zurück. Das Ergebnis steht danach in auftrag/status.json (die App
# zeigt es unter Einstellungen → System).
#
# Von Hand: systemctl start immo-rechner-update   ·   Protokoll: journalctl -u immo-rechner-update
set -euo pipefail
export HOME="${HOME:-/root}"

BASIS="${BASIS:-/opt/immo-rechner}"
APP="$BASIS/app"
ZWEIG="${ZWEIG:-main}"
OK_DATEI="$BASIS/stand-ok"        # zuletzt erfolgreich laufender Commit
FEHL_DATEI="$BASIS/stand-fehler"  # Commit, der beim letzten Versuch nicht lief (nicht blind wiederholen)
AUFTRAG="$BASIS/auftrag"

log() { echo "[aktualisieren] $*"; }
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
status() { # status ERGEBNIS MELDUNG — für die Anzeige in der App
  [ -d "$AUFTRAG" ] || return 0
  printf '{"zeit":"%s","ergebnis":"%s","meldung":"%s","stand":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$(json "$2")" "$(json "${STAND_ANZEIGE:-}")" > "$AUFTRAG/status.json.tmp"
  chmod 644 "$AUFTRAG/status.json.tmp" && mv "$AUFTRAG/status.json.tmp" "$AUFTRAG/status.json"
}
cd "$APP"

exec 9>"$BASIS/.update.lock"
flock -n 9 || { log "läuft schon"; exit 0; }

# Auftrag aus der App abholen (sonst startet systemd gleich wieder); ein bewusster Klick
# darf auch einen früher gescheiterten Stand noch einmal versuchen.
if [ -e "$AUFTRAG/aktualisieren" ]; then
  rm -f "$AUFTRAG/aktualisieren"
  ERZWINGEN=1
fi
STAND_ANZEIGE="$(git log -1 --format='%h · %cd' --date=format:'%d.%m.%Y %H:%M' 2>/dev/null || true)"
trap 'status fehler "Aktualisierung abgebrochen (Protokoll: journalctl -u immo-rechner-update)"' ERR

git fetch -q origin "$ZWEIG"
NEU=$(git rev-parse "origin/$ZWEIG")
AKTUELL=$(cat "$OK_DATEI" 2>/dev/null || git rev-parse HEAD)
if [ "$NEU" = "$AKTUELL" ]; then status aktuell "Schon auf dem neuesten Stand."; exit 0; fi
if [ "$(cat "$FEHL_DATEI" 2>/dev/null)" = "$NEU" ] && [ "${ERZWINGEN:-0}" != 1 ]; then
  status aktuell "Neuester Stand ist schon einmal gescheitert — übersprungen."; exit 0
fi

# Nicht mitten in eine Analyse hinein neu starten
if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  LAUFEND=$(docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:8080/intern/zustand').then(r=>r.json()).then(j=>console.log(j.laufend)).catch(()=>console.log(0))" 2>/dev/null || echo 0)
  if [ "${LAUFEND:-0}" != 0 ]; then
    log "Analyse läuft ($LAUFEND) — später"
    status verschoben "Gerade läuft eine Analyse — bitte danach noch einmal auf „Nach Updates suchen“."
    exit 0
  fi
fi

log "Neuer Stand: $(git log -1 --format='%h %s' "$NEU")"
git reset -q --hard "$NEU"
export STAND="$(git log -1 --format='%h · %cd' --date=format:'%d.%m.%Y %H:%M' "$NEU")"

gesund() { # wartet bis zu 4 Minuten, bis der App-Container „healthy“ meldet
  local id status
  for _ in $(seq 1 48); do
    id=$(docker compose ps -q app 2>/dev/null || true)
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo fehlt)
    [ "$status" = healthy ] && return 0
    [ "$status" = unhealthy ] && return 1
    sleep 5
  done
  return 1
}

if docker compose build && docker compose up -d --remove-orphans && gesund; then
  echo "$NEU" > "$OK_DATEI"
  rm -f "$FEHL_DATEI"
  docker image prune -f >/dev/null
  STAND_ANZEIGE="$STAND"
  status aktualisiert "Neuer Stand läuft: $(git log -1 --format='%s' "$NEU")"
  log "Fertig: $STAND"
  exit 0
fi

log "Neuer Stand läuft nicht — zurück auf $(git log -1 --format='%h' "$AKTUELL" 2>/dev/null || echo "$AKTUELL")"
echo "$NEU" > "$FEHL_DATEI"
git reset -q --hard "$AKTUELL"
export STAND="$(git log -1 --format='%h · %cd' --date=format:'%d.%m.%Y %H:%M' "$AKTUELL")"
docker compose build && docker compose up -d --remove-orphans
trap - ERR
STAND_ANZEIGE="$STAND"
status zurueckgerollt "Neuer Stand startete nicht sauber — alter Stand läuft weiter. Bitte Claude Bescheid geben."
exit 1
