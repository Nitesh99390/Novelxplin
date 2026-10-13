#!/usr/bin/env bash
# =========================================================
# Novelxplin – one-shot setup for Oracle Ubuntu VM (1 GB RAM)
# Run on the server:  bash deploy/setup-oracle.sh
# =========================================================
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"

echo "==> Installing Node.js 20 (if missing)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Adding 1 GB swap (helps a 1 GB RAM box)"
if [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Opening port 80/${PORT} in the VM firewall (also open them in OCI Security List!)"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true

echo "==> Creating systemd service"
sudo tee /etc/systemd/system/novelxplin.service >/dev/null <<UNIT
[Unit]
Description=Novelxplin web novel server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=NODE_ENV=production
# Telegram upload bot (optional): fill in and run  sudo systemctl daemon-reload && sudo systemctl restart novelxplin
Environment=TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
Environment=TELEGRAM_ADMIN_IDS=${TELEGRAM_ADMIN_IDS:-}
Environment=SITE_URL=${SITE_URL:-http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}
# Public domain used in robots.txt / sitemap.xml URLs (SEO). Set to your real domain.
Environment=PUBLIC_URL=${PUBLIC_URL:-https://novelxplin.in}
Environment=NX_SECRET=${NX_SECRET:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n")}
Environment=TRUST_PROXY=${TRUST_PROXY:-0}
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=3
MemoryMax=400M

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now novelxplin
sleep 1
sudo systemctl --no-pager status novelxplin | head -5

echo "==> Optional: forward port 80 -> $PORT (no nginx needed)"
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port "$PORT" || true
sudo netfilter-persistent save 2>/dev/null || true

echo
echo "Done. Open:  http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')/"
echo "Logs:        sudo journalctl -u novelxplin -f"
echo "Backup:      bash deploy/backup.sh"
