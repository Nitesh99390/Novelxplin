#!/usr/bin/env bash
# Pull the latest code, rebuild the frontend (dist/) and restart the service.
# Run on the server:  bash deploy/update.sh
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git pull --ff-only
NODE_ENV=development npm ci --no-audit --no-fund 2>/dev/null || NODE_ENV=development npm install --no-audit --no-fund
npm run build
[ -f dist/index.html ] || { echo "!! Build failed - dist/index.html not found" >&2; exit 1; }
# Production (Oracle VPS) runs the app under root PM2, not systemd.
sudo pm2 restart novelxplin || sudo pm2 restart all
sleep 1
sudo pm2 status
