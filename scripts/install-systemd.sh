#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="$HOME/.config/systemd/user/github-copilot-jackhammer.service"
mkdir -p "$(dirname "$SERVICE")"
cat > "$SERVICE" <<SERVICE_EOF
[Unit]
Description=GitHub Copilot JackHammer Service
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v npm) run dev
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
SERVICE_EOF
systemctl --user daemon-reload
systemctl --user enable --now github-copilot-jackhammer.service
echo "Installed and started github-copilot-jackhammer.service"
