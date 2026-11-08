#!/bin/sh
# ==============================================================================
# CyberWave Safe Rollback Script
# Restores router configuration from the pre-installation backup
# Target: TP-Link Archer C6 US V3.2 / OpenWrt 25.12.6
# ==============================================================================
set -eu

BACKUP_DIR="/etc/cyberwave/backups"

echo "[CyberWave-Rollback] Starting configuration rollback..."

if [ ! -d "$BACKUP_DIR" ]; then
  echo "[CyberWave-Rollback] ERROR: Backup directory $BACKUP_DIR does not exist."
  exit 1
fi

# Find the latest backup archive
LATEST_BACKUP="$(ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | head -n 1 || true)"

if [ -z "$LATEST_BACKUP" ] || [ ! -f "$LATEST_BACKUP" ]; then
  echo "[CyberWave-Rollback] ERROR: No backup archive found in $BACKUP_DIR."
  exit 1
fi

echo "[CyberWave-Rollback] Found backup archive: $LATEST_BACKUP"

# 1. Stop cyberwave services
if [ -f /etc/init.d/cyberwave-agent ]; then
  /etc/init.d/cyberwave-agent stop || true
fi

# 2. Extract backup configs to /etc/config/
echo "[CyberWave-Rollback] Restoring configuration files to /etc/config/..."
tar -xzf "$LATEST_BACKUP" -C /etc/config/

# 3. Reload system services
echo "[CyberWave-Rollback] Reloading network, firewall, and wireless subsystems..."
if command -v /etc/init.d/network >/dev/null 2>&1; then
  /etc/init.d/network reload || true
fi
if command -v /etc/init.d/dnsmasq >/dev/null 2>&1; then
  /etc/init.d/dnsmasq reload || true
fi
if command -v /etc/init.d/firewall >/dev/null 2>&1; then
  /etc/init.d/firewall reload || true
fi
if command -v wifi >/dev/null 2>&1; then
  wifi reload || true
fi
if [ -f /etc/init.d/opennds ]; then
  /etc/init.d/opennds restart || true
fi

echo "[CyberWave-Rollback] Configuration rollback completed successfully."
exit 0
