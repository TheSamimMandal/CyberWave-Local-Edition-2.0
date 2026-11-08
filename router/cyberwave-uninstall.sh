#!/bin/sh
# ==============================================================================
# CyberWave Agent Safe Rollback & Uninstaller
# Target: TP-Link Archer C6 v3.2 (OpenWrt 25.12.6)
# ==============================================================================
set -eu

printf "Starting CyberWave safe rollback and removal...\n"

# 1. Stop and disable service
if [ -f /etc/init.d/cyberwave-agent ]; then
    /etc/init.d/cyberwave-agent stop 2>/dev/null || true
    /etc/init.d/cyberwave-agent disable 2>/dev/null || true
    rm -f /etc/init.d/cyberwave-agent
fi

# 2. Terminate running process
killall -q cyberwave-agent.sh 2>/dev/null || true
killall -9 -q cyberwave-agent.sh 2>/dev/null || true

# 3. Clean up blocked MAC firewall rules if any
if [ -f /etc/cyberwave/blocked_macs ]; then
    while read -r _mac; do
        [ -n "$_mac" ] && iptables -D FORWARD -m mac --mac-source "$_mac" -j DROP 2>/dev/null || true
    done < /etc/cyberwave/blocked_macs
fi

# 4. Remove binaries and state files
rm -f /usr/bin/cyberwave-agent.sh /usr/bin/cyberwave-uninstall.sh
rm -rf /var/run/cyberwave
rm -f /etc/cyberwave/agent.conf /etc/cyberwave/blocked_macs

printf "\n[OK] CyberWave Agent has been completely removed from this Archer C6.\n"
printf "[NOTE] Primary WAN, LAN and main Wi-Fi settings were safely preserved.\n"
printf "Configuration backups remain in /etc/cyberwave/backups/ if needed.\n"
