#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu Lightsail (or EC2) instance.
# Installs Node 22 and Caddy, downloads the game, and runs it behind HTTPS.
# Safe to run again: it updates the code and restarts instead of failing.
#
#   sudo bash lightsail-setup.sh [domain] [branch]
#
#   domain  The name pointed at this instance's static IP, e.g. play.example.com.
#           Leave it out to use a free <ip>.sslip.io name (no domain needed; the
#           certificate can be refused if that shared name is rate-limited).
#   branch  Git branch to run (default: main).
set -euo pipefail

DOMAIN="${1:-}"
BRANCH="${2:-main}"
REPO="https://github.com/jubeii89-design/pyramids.git"
APP_USER="${SUDO_USER:-ubuntu}"
APP_DIR="/home/${APP_USER}/pyramids"

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash $0 $*" >&2; exit 1; fi
if ! id "$APP_USER" >/dev/null 2>&1; then echo "User $APP_USER does not exist." >&2; exit 1; fi

if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  DOMAIN="${IP//./-}.sslip.io"
  echo "No domain given - using ${DOMAIN}"
fi
case "$DOMAIN" in *[!A-Za-z0-9.-]*|"") echo "Bad domain: $DOMAIN" >&2; exit 1;; esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# A small instance can run out of memory during npm install: add 1 GB of swap once.
if ! swapon --show | grep -q . && [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node.js 22 LTS from NodeSource (Ubuntu's own package is older).
if ! node -v 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy from its official repository; it fetches and renews the HTTPS certificate.
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# The game itself, owned by the app user.
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
  sudo -u "$APP_USER" git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"

# systemd unit, from the template in the repo with this machine's paths and address.
sed -e "s#^User=.*#User=${APP_USER}#" \
    -e "s#/home/ubuntu/pyramids#${APP_DIR}#g" \
    -e "s#^Environment=PUBLIC_ORIGIN=.*#Environment=PUBLIC_ORIGIN=https://${DOMAIN}#" \
    "$APP_DIR/deploy/pyramids.service" > /etc/systemd/system/pyramids.service

# Caddy: HTTPS for the domain, proxying to the game on port 3000.
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	reverse_proxy localhost:3000
}
EOF

systemctl daemon-reload
systemctl enable pyramids >/dev/null
systemctl restart pyramids
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for _ in $(seq 1 20); do
  if curl -fsS localhost:3000/health >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS localhost:3000/health; then
  echo; echo "The game did not start. Last log lines:" >&2
  journalctl -u pyramids -n 30 --no-pager >&2
  exit 1
fi
echo
echo "Game is running. Waiting for the HTTPS certificate..."
for _ in $(seq 1 30); do
  if curl -fsS "https://${DOMAIN}/health" >/dev/null 2>&1; then
    echo "Ready: https://${DOMAIN}/host.html"
    exit 0
  fi
  sleep 3
done
echo "HTTPS is not answering yet. Check that port 443 is open in the Lightsail"
echo "firewall and that ${DOMAIN} points at this instance, then: journalctl -u caddy -n 50"
exit 1
