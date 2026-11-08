#!/bin/sh
# ==============================================================================
# CyberWave Complete Uninstallation & System Cleanup Script
# Target: TP-Link Archer C6 US V3.2 / OpenWrt 25.12.6
# Removes CyberWave agent, guest wifi, and captive portal hooks
# Preserves WAN, LAN, and Main Wi-Fi settings completely
# ==============================================================================
set -eu

echo "[CyberWave-Uninstall] Starting CyberWave uninstallation and cleanup..."

# 1. Stop and disable CyberWave services
if [ -f /etc/init.d/cyberwave-agent ]; then
  echo "[CyberWave-Uninstall] Stopping cyberwave-agent service..."
  /etc/init.d/cyberwave-agent stop 2>/dev/null || true
  /etc/init.d/cyberwave-agent disable 2>/dev/null || true
  rm -f /etc/init.d/cyberwave-agent
fi

# 2. Stop and disable openNDS if configured by CyberWave
if [ -f /etc/init.d/opennds ]; then
  if [ "$(uci -q get opennds.@opennds[0].gatewayinterface || true)" = "guest" ]; then
    echo "[CyberWave-Uninstall] Disabling openNDS guest portal..."
    uci -q set opennds.@opennds[0].enabled='0' || true
    uci -q commit opennds || true
    /etc/init.d/opennds stop 2>/dev/null || true
    /etc/init.d/opennds disable 2>/dev/null || true
  fi
fi

# 3. Clean up Guest Wireless Interfaces (preserve main Wi-Fi!)
echo "[CyberWave-Uninstall] Removing CyberWave Guest Wi-Fi interfaces..."
uci -q delete wireless.guest_2g || true
uci -q delete wireless.guest_5g || true
uci -q commit wireless || true

# 4. Clean up Guest Network & DHCP
echo "[CyberWave-Uninstall] Removing Guest network interface & DHCP pool..."
uci -q delete network.guest || true
uci -q commit network || true

uci -q delete dhcp.guest || true
uci -q commit dhcp || true

# 5. Clean up Guest Firewall Zone & Rules
echo "[CyberWave-Uninstall] Cleaning up Guest firewall zone and rules..."
# Remove guest zone
idx=0
while true; do
  zname="$(uci -q get firewall.@zone[$idx].name || true)"
  if [ -z "$zname" ]; then
    break
  fi
  if [ "$zname" = "guest" ]; then
    uci -q delete firewall.@zone["$idx"] || true
    break
  fi
  idx=$((idx + 1))
done

# Remove guest forwardings
idx=0
while true; do
  src="$(uci -q get firewall.@forwarding[$idx].src || true)"
  if [ -z "$src" ]; then
    break
  fi
  if [ "$src" = "guest" ]; then
    uci -q delete firewall.@forwarding["$idx"] || true
    idx=0 # restart scan
    continue
  fi
  idx=$((idx + 1))
done

# Remove guest rules
idx=0
while true; do
  rname="$(uci -q get firewall.@rule[$idx].name || true)"
  if [ -z "$rname" ]; then
    break
  fi
  if [ "$rname" = "Allow-Guest-DHCP" ] || [ "$rname" = "Allow-Guest-DNS" ]; then
    uci -q delete firewall.@rule["$idx"] || true
    idx=0
    continue
  fi
  idx=$((idx + 1))
done
uci -q commit firewall || true

# 6. Remove binaries, configuration, and logs
rm -f /usr/bin/cyberwave-agent.sh
rm -f /usr/bin/cyberwave-binauth.sh
rm -f /usr/bin/cyberwave-uninstall.sh
rm -f /etc/cyberwave/agent.conf
rm -rf /var/run/cyberwave
rm -f /var/log/cyberwave-agent.log

# 7. Reload system services to restore pristine state
echo "[CyberWave-Uninstall] Reloading network, firewall, and wireless subsystems..."
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

echo "[CyberWave-Uninstall] CyberWave components successfully removed. Main router settings are intact."
exit 0
