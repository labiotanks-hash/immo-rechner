#!/usr/bin/env bash
# A²O Immo-Rechner auf einem frischen Hetzner-Server (Ubuntu 24.04) einrichten oder aktualisieren.
# Als root in der Hetzner-Konsole (Server → >_ Console) ausführen:
#
#   curl -fsSL https://raw.githubusercontent.com/labiotanks-hash/immo-rechner/main/deploy/einrichten.sh | bash
#
# Ohne Terminal (neuer Server, Feld „Cloud config“ bei Hetzner):
#   #cloud-config
#   runcmd:
#     - 'curl -fsSL https://raw.githubusercontent.com/labiotanks-hash/immo-rechner/main/deploy/einrichten.sh | ADMIN_EMAILS=du@beispiel.de bash > /var/log/immo-rechner.log 2>&1'
#   Den Anthropic-Schlüssel trägt dann ein Admin nach dem ersten Login unter „Einstellungen“ ein.
#
# Mehrfach ausführbar: beim zweiten Mal holt es nur den neuen Stand und startet neu.
# Geheimnisse landen ausschließlich in /opt/immo-rechner/.env (chmod 600).
set -euo pipefail

REPO="${REPO:-https://github.com/labiotanks-hash/immo-rechner.git}"
ZWEIG="${ZWEIG:-main}"
BASIS=/opt/immo-rechner
ENVDATEI="$BASIS/.env"
DOMAIN_STANDARD=immo-rechner.a2o-architekten.de

schritt() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
hinweis() { printf '\033[0;33m  %s\033[0m\n' "$*"; }
abbruch() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
INTERAKTIV=0
if [ "${NICHT_INTERAKTIV:-0}" != 1 ] && { : </dev/tty; } 2>/dev/null; then INTERAKTIV=1; fi
frage() { # frage VAR "Text" [geheim]
  local antwort
  if [ "${3:-}" = geheim ]; then read -rsp "  $2: " antwort </dev/tty; echo; else read -rp "  $2: " antwort </dev/tty; fi
  printf -v "$1" '%s' "$antwort"
}
env_hat() { grep -qE "^$1=.+" "$ENVDATEI" 2>/dev/null; }
env_setze() { # nur ergänzen, nie überschreiben
  env_hat "$1" && return 0
  sed -i "/^$1=\$/d" "$ENVDATEI" 2>/dev/null || true
  printf '%s=%s\n' "$1" "$2" >> "$ENVDATEI"
}

[ "$(id -u)" = 0 ] || abbruch "Bitte als root ausführen."
. /etc/os-release
[ "${ID:-}" = ubuntu ] || [ "${ID:-}" = debian ] || abbruch "Getestet für Ubuntu/Debian, gefunden: ${PRETTY_NAME:-unbekannt}."

schritt "Prüfe, ob die Ports 80/443 frei sind"
if ss -ltnpH '( sport = :80 or sport = :443 )' | grep -vq docker-proxy; then
  ss -ltnp '( sport = :80 or sport = :443 )'
  abbruch "Auf diesem Server läuft schon ein Webserver (siehe oben). Nichts verändert — bitte melden, dann binden wir den Immo-Rechner daneben ein."
fi

schritt "Pakete (Docker, Git)"
export DEBIAN_FRONTEND=noninteractive
APT="apt-get -y -q -o DPkg::Lock::Timeout=900"  # beim ersten Start läuft oft noch ein automatisches Update
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  $APT update
  $APT install docker.io docker-compose-v2 git ca-certificates curl
  systemctl enable --now docker
else
  command -v git >/dev/null || { $APT update; $APT install git; }
  hinweis "Docker ist schon da: $(docker --version)"
fi

schritt "Auslagerungsdatei (Puffer für Whisper + PDF-Druck)"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-immo-rechner.conf && sysctl -q -p /etc/sysctl.d/90-immo-rechner.conf
  hinweis "4 GB angelegt."
else
  hinweis "Schon vorhanden: $(swapon --show --noheadings | awk '{print $1, $3}')"
fi

schritt "Programm holen ($REPO, $ZWEIG)"
mkdir -p "$BASIS"
if [ -d "$BASIS/app/.git" ]; then
  git -C "$BASIS/app" fetch -q origin "$ZWEIG"
  git -C "$BASIS/app" checkout -q "$ZWEIG"
  git -C "$BASIS/app" reset -q --hard "origin/$ZWEIG"
else
  git clone -q --branch "$ZWEIG" "$REPO" "$BASIS/app"
fi
hinweis "Stand: $(git -C "$BASIS/app" log -1 --format='%h %s')"

schritt "Einstellungen in $ENVDATEI"
touch "$ENVDATEI" && chmod 600 "$ENVDATEI"
if ! env_hat ANTHROPIC_API_KEY && [ "$INTERAKTIV" = 1 ]; then
  frage KEY "Anthropic-API-Schlüssel einfügen (unsichtbar; leer lassen = später in der App unter Einstellungen)" geheim
  [ -n "$KEY" ] && env_setze ANTHROPIC_API_KEY "$KEY"
  unset KEY
fi
if ! env_hat ADMIN_EMAILS; then
  ADMINS="${ADMIN_EMAILS:-}"
  if [ -z "$ADMINS" ] && [ "$INTERAKTIV" = 1 ]; then
    frage ADMINS "E-Mail-Adresse(n) der Admins, Komma-getrennt (wie beim BauDoc-Login)"
  fi
  [ -n "$ADMINS" ] || abbruch "Mindestens eine Admin-Adresse nötig (ADMIN_EMAILS=…)."
  env_setze ADMIN_EMAILS "$(echo "$ADMINS" | tr -d ' ' | tr 'A-Z' 'a-z')"
fi
env_setze SESSION_SECRET "$(openssl rand -hex 32)"
env_setze DOMAIN "$DOMAIN_STANDARD"
DOMAIN=$(grep -E '^DOMAIN=' "$ENVDATEI" | tail -1 | cut -d= -f2-)
env_setze PUBLIC_URL "https://$DOMAIN"
env_setze SUPABASE_URL https://mispnnkryqemhvngopnx.supabase.co
env_setze SUPABASE_PUBLISHABLE_KEY sb_publishable_C4Tb1Bkj0WOk7JuNDuSS2g_IFaReIND
env_setze WA_GRUPPEN "Objekte Immo"
ln -sfn "$ENVDATEI" "$BASIS/app/.env"
hinweis "Gesetzt: $(grep -oE '^[A-Z_]+=' "$ENVDATEI" | tr -d = | tr '\n' ' ')"

schritt "DNS prüfen"
IP=$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DNS=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ "$DNS" = "$IP" ]; then
  hinweis "$DOMAIN → $IP ✓"
else
  hinweis "⚠ $DOMAIN zeigt auf „${DNS:-nichts}“, der Server hat $IP."
  hinweis "  Bei SiteGround (DNS-Zone a2o-architekten.de) einen A-Record „immo-rechner“ → $IP anlegen."
  hinweis "  Caddy holt das HTTPS-Zertifikat automatisch, sobald der Eintrag gilt."
fi

schritt "Bauen und starten (beim ersten Mal 5–10 Minuten)"
cd "$BASIS/app"
docker compose build --pull
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

schritt "Fertig"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
cat <<TEXT

  1. https://$DOMAIN öffnen und mit deiner E-Mail anmelden (Link/Code kommt per Mail).
     Fehlt der Anthropic-Schlüssel noch: Einstellungen → „Anthropic-API-Schlüssel“ einfügen.
  2. Oben „Zugang“ → QR-Code mit dem Firmen-Handy scannen:
     WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen.
  3. Whisper lädt beim ersten Start das Sprachmodell (~1,6 GB), das dauert ein paar Minuten:
     docker compose -f $BASIS/app/docker-compose.yml logs -f whisper

  Aktualisieren: dieses Skript noch einmal ausführen.
  Logs:          cd $BASIS/app && docker compose logs -f app bridge
TEXT
