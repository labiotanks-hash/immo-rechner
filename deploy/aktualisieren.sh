#!/usr/bin/env bash
# Automatische Aktualisierung: läuft alle 10 Minuten (systemd-Timer immo-rechner-update.timer,
# eingerichtet von einrichten.sh). Holt neue Commits von GitHub (Zweig main), baut neu und startet
# neu — aber nicht während einer laufenden Analyse. Startet die neue Version nicht sauber, geht es
# automatisch auf den letzten funktionierenden Stand zurück.
#
# Von Hand: systemctl start immo-rechner-update   ·   Protokoll: journalctl -u immo-rechner-update
set -euo pipefail
export HOME="${HOME:-/root}"

BASIS="${BASIS:-/opt/immo-rechner}"
APP="$BASIS/app"
ZWEIG="${ZWEIG:-main}"
OK_DATEI="$BASIS/stand-ok"        # zuletzt erfolgreich laufender Commit
FEHL_DATEI="$BASIS/stand-fehler"  # Commit, der beim letzten Versuch nicht lief (nicht endlos wiederholen)

log() { echo "[aktualisieren] $*"; }
cd "$APP"

exec 9>"$BASIS/.update.lock"
flock -n 9 || { log "läuft schon"; exit 0; }

git fetch -q origin "$ZWEIG"
NEU=$(git rev-parse "origin/$ZWEIG")
AKTUELL=$(cat "$OK_DATEI" 2>/dev/null || git rev-parse HEAD)
[ "$NEU" = "$AKTUELL" ] && exit 0
if [ "$(cat "$FEHL_DATEI" 2>/dev/null)" = "$NEU" ] && [ "${ERZWINGEN:-0}" != 1 ]; then
  exit 0  # dieser Stand ist schon einmal gescheitert — erst ein neuer Commit wird wieder versucht
fi

# Nicht mitten in eine Analyse hinein neu starten
if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  LAUFEND=$(docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:8080/intern/zustand').then(r=>r.json()).then(j=>console.log(j.laufend)).catch(()=>console.log(0))" 2>/dev/null || echo 0)
  if [ "${LAUFEND:-0}" != 0 ]; then log "Analyse läuft ($LAUFEND) — später"; exit 0; fi
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
  log "Fertig: $STAND"
  exit 0
fi

log "Neuer Stand läuft nicht — zurück auf $(git log -1 --format='%h' "$AKTUELL" 2>/dev/null || echo "$AKTUELL")"
echo "$NEU" > "$FEHL_DATEI"
git reset -q --hard "$AKTUELL"
export STAND="$(git log -1 --format='%h · %cd' --date=format:'%d.%m.%Y %H:%M' "$AKTUELL")"
docker compose build && docker compose up -d --remove-orphans
exit 1
