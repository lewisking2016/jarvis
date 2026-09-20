#!/usr/bin/env bash
# JARVIS VPS provisioner/update — idempotent; run after every `git pull` or once at setup:
#   bash ~/jarvis/deploy/provision-vps.sh
# Repo clone: /home/jarvis/jarvis · Secrets: /home/jarvis/.env (symlinked as repo .env)
# OmniRoute on :20128 (own autostart unit) · App on :8080 behind systemd (jarvis.service)
set -euo pipefail

REPO=/home/jarvis/jarvis
cd "$REPO"

echo "── [1/6] Dependencies"
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund 2>&1 | tail -1
fi

echo "── [2/6] Swap guard (B2ats_v2 has 1 GiB RAM)"
if ! swapon --show 2>/dev/null | grep -q .; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo "swap: $(swapon --show --noheadings | awk '{print $1, $3}' | head -1)"

echo "── [3/6] Secrets"
if [ ! -e .env ] && [ -f /home/jarvis/.env ]; then
  ln -s /home/jarvis/.env .env
  echo "linked /home/jarvis/.env → repo .env"
fi

echo "── [4/6] Persistent data dir"
mkdir -p /home/jarvis/.jarvis-data
# migrate any DB from a previous repo-root layout so nothing is lost
[ -f jarvis.data.sqlite ] && mv jarvis.data.sqlite* /home/jarvis/.jarvis-data/ 2>/dev/null || true

echo "── [5/6] Build"
npm run build 2>&1 | tail -3

echo "── [6/6] Service"
sudo cp deploy/jarvis.service /etc/systemd/system/jarvis.service
sudo systemctl daemon-reload
sudo systemctl enable jarvis >/dev/null 2>&1
sudo systemctl restart jarvis
sleep 4
systemctl is-active jarvis
curl -s -o /dev/null -w 'health /api/system → %{http_code}\n' http://localhost:8080/api/system
echo "DONE — JARVIS backend live on :8080"
