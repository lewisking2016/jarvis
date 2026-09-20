#!/usr/bin/env bash
# JARVIS VPS PROVISIONER — run on the Azure VM (Ubuntu 24.04) as root, from /opt/jarvis.
# Sets up swap (the box has 1 GiB RAM), the systemd service, and starts it.
# Uses the STANDALONE bundle: no npm install needed on the VPS.
set -euo pipefail

echo "── [1/3] Swap (B2ats_v2 has only 1 GiB RAM)"
if ! swapon --show 2>/dev/null | grep -q swap; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=20 >/dev/null
echo "vm.swappiness=20" > /etc/sysctl.d/99-jarvis.conf
free -h | head -2

echo "── [2/3] Permissions"
mkdir -p /opt/jarvis
chown -R jarvis:jarvis /opt/jarvis
chmod +x /opt/jarvis/.next/standalone/server.js 2>/dev/null || true

echo "── [3/3] systemd service"
cp /opt/jarvis/deploy/jarvis.service /etc/systemd/system/jarvis.service
systemctl daemon-reload
systemctl enable jarvis >/dev/null
systemctl restart jarvis
sleep 3
systemctl --no-pager status jarvis | head -10

echo "PROVISIONING COMPLETE — app on :8080"
