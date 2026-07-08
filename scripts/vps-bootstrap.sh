#!/usr/bin/env bash
# BARTOK VPS bootstrap (Ubuntu 24.04, arm64 or x86_64). Run as root ON the server
# AFTER the code+state have been rsynced to /opt/bartok and /opt/bartok-guardian
# (see scripts/deploy-vps.sh, which does the rsync and invokes this).
#
# Installs toolchains, builds everything, installs systemd services:
#   bartok-guardian  → Bartok-Guardian (:3300 / :50052)
#   bartok-bridge    → the bridge (:8787)
#   bartok-tunnel    → ngrok static domain → :8787
# Nothing listens publicly except SSH; ngrok tunnels outbound.
set -euo pipefail

echo "=== packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -qy build-essential clang pkg-config libssl-dev git curl lsof ufw tmux \
  protobuf-compiler cmake   # protoc: guardian gRPC + miden RPC bins; cmake: crypto crates

echo "=== firewall: ssh only (ngrok is outbound) ==="
ufw allow OpenSSH >/dev/null; yes | ufw enable >/dev/null || true

echo "=== swap (the tlsn compile can spike; a box with 0 swap OOM-kills the build) ==="
if ! swapon --show | grep -q swap; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== node 20 ==="
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -qy nodejs
fi
node -v

echo "=== rust ==="
if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q
fi
source "$HOME/.cargo/env"

echo "=== ngrok ==="
if ! command -v ngrok >/dev/null; then
  ARCH=$(dpkg --print-architecture)   # arm64 or amd64
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ARCH}.tgz" | tar -xz -C /usr/local/bin
fi
ngrok version

echo "=== build Bartok-Guardian ==="
cd /opt/bartok-guardian && cargo build --release -p guardian-server

echo "=== build miden bins ==="
cd /opt/bartok/miden/integration
cargo build --release -p integration --bin settle_session --bin fund_buyer --bin build_escrow --bin joao_sweep --bin smoke_escrow --bin setup_multisigs --bin new_faucet

echo "=== build zkTLS pipeline ==="
cd /opt/bartok/zktls-spike/tlsn
cargo build --release --example openrouter_prove --example openrouter_present --example openrouter_oracle

echo "=== systemd services ==="
cat > /etc/systemd/system/bartok-guardian.service <<'UNIT'
[Unit]
Description=Bartok-Guardian
After=network-online.target
[Service]
ExecStart=/opt/bartok/guardian/run.sh
WorkingDirectory=/opt/bartok/guardian
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=BARTOK_GUARDIAN_SRC=/opt/bartok-guardian
Environment=PATH=/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/bartok-bridge.service <<'UNIT'
[Unit]
Description=BARTOK bridge
After=bartok-guardian.service
Requires=bartok-guardian.service
[Service]
ExecStart=/usr/bin/node /opt/bartok/ux-prototype/server.js
WorkingDirectory=/opt/bartok
Restart=always
RestartSec=5
Environment=HOME=/root
Environment=PATH=/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/bartok-tunnel.service <<'UNIT'
[Unit]
Description=BARTOK ngrok tunnel
After=bartok-bridge.service
[Service]
ExecStart=/usr/local/bin/ngrok http --url=quote-escargot-headache.ngrok-free.dev 8787 --log=stdout
Restart=always
RestartSec=5
Environment=HOME=/root
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now bartok-guardian
sleep 3
systemctl enable --now bartok-bridge
systemctl enable --now bartok-tunnel

echo "=== health ==="
sleep 8
curl -s --max-time 5 http://localhost:3300/pubkey | head -c 60; echo
curl -s -o /dev/null -w "bridge: %{http_code}\n" --max-time 5 http://localhost:8787/api/config
echo "bootstrap complete"
