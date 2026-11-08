#!/bin/sh
# ==============================================================================
# CyberWave Automatic Guest Mode & Dual-Band Wi-Fi Setup Script
# Target: TP-Link Archer C6 US V3.2 / OpenWrt 25.12.6
# MIPS ramips/mt7621 • Idempotent & Non-Destructive
# ==============================================================================
set -eu

GUEST_SSID_2G="${1:-CyberWave_Guest_2.4G}"
GUEST_KEY_2G="${2:-}"
GUEST_SSID_5G="${3:-CyberWave_Guest_5G}"
GUEST_KEY_5G="${4:-}"
CLIENT_LIMIT="${5:-20}"

echo "[CyberWave-Guest] Starting Automatic Guest Wi-Fi & Network Isolation..."

# 1. Detect hardware wireless radios
RADIO_2G=""
RADIO_5G=""

for r in radio0 radio1 radio2; do
  if uci get wireless."$r" >/dev/null 2>&1; then
    hwmode="$(uci -q get wireless."$r".hwmode || true)"
    band="$(uci -q get wireless."$r".band || true)"
    channel="$(uci -q get wireless."$r".channel || true)"
    htmode="$(uci -q get wireless."$r".htmode || true)"

    if [ "$band" = "2g" ] || [ "$hwmode" = "11g" ] || [ "$hwmode" = "11bgn" ] || [ "$band" = "2.4ghz" ]; then
      RADIO_2G="$r"
    elif [ "$band" = "5g" ] || [ "$hwmode" = "11a" ] || [ "$hwmode" = "11ac" ] || [ "$band" = "5ghz" ] || [ "$htmode" = "VHT80" ]; then
      RADIO_5G="$r"
    elif [ -n "$channel" ] && [ "$channel" -ge 36 ] 2>/dev/null; then
      RADIO_5G="$r"
    elif [ -n "$channel" ] && [ "$channel" -le 14 ] 2>/dev/null; then
      RADIO_2G="$r"
    fi
  fi
done

# Fallback: if detection by band failed, assign radio0 and radio1
if [ -z "$RADIO_2G" ] && uci get wireless.radio0 >/dev/null 2>&1; then
  RADIO_2G="radio0"
fi
if [ -z "$RADIO_5G" ] && uci get wireless.radio1 >/dev/null 2>&1; then
  RADIO_5G="radio1"
fi

echo "[CyberWave-Guest] Detected radios: 2.4GHz=${RADIO_2G:-none}, 5GHz=${RADIO_5G:-none}"

# 2. Configure Guest Network Interface in /etc/config/network
if ! uci -q get network.guest >/dev/null; then
  uci set network.guest=interface
fi
uci set network.guest.proto='static'
uci set network.guest.ipaddr='192.168.9.1'
uci set network.guest.netmask='255.255.255.0'
uci commit network
echo "[CyberWave-Guest] Configured network.guest (192.168.9.1/24)"

# 3. Configure Guest DHCP Pool in /etc/config/dhcp
if ! uci -q get dhcp.guest >/dev/null; then
  uci set dhcp.guest=dhcp
fi
uci set dhcp.guest.interface='guest'
uci set dhcp.guest.start='100'
uci set dhcp.guest.limit="$CLIENT_LIMIT"
uci set dhcp.guest.leasetime='1h'
uci commit dhcp
echo "[CyberWave-Guest] Configured dhcp.guest (Pool: 192.168.9.100 - limit $CLIENT_LIMIT)"

# 4. Configure Wireless Interfaces (preserve main Wi-Fi!)
# 4a. 2.4 GHz Guest Wi-Fi
if [ -n "$RADIO_2G" ]; then
  if ! uci -q get wireless.guest_2g >/dev/null; then
    uci set wireless.guest_2g=wifi-iface
  fi
  uci set wireless.guest_2g.device="$RADIO_2G"
  uci set wireless.guest_2g.mode='ap'
  uci set wireless.guest_2g.network='guest'
  uci set wireless.guest_2g.ssid="$GUEST_SSID_2G"
  uci set wireless.guest_2g.isolate='1'
  if [ -n "$GUEST_KEY_2G" ] && [ "${#GUEST_KEY_2G}" -ge 8 ]; then
    uci set wireless.guest_2g.encryption='psk2'
    uci set wireless.guest_2g.key="$GUEST_KEY_2G"
  else
    uci set wireless.guest_2g.encryption='none'
    uci -q delete wireless.guest_2g.key || true
  fi
  uci set wireless.guest_2g.disabled='0'
  echo "[CyberWave-Guest] Configured 2.4GHz Guest SSID: $GUEST_SSID_2G on $RADIO_2G"
else
  echo "[CyberWave-Guest] NOTICE: 2.4 GHz radio not found; skipping 2.4G guest interface."
fi

# 4b. 5 GHz Guest Wi-Fi
if [ -n "$RADIO_5G" ]; then
  if ! uci -q get wireless.guest_5g >/dev/null; then
    uci set wireless.guest_5g=wifi-iface
  fi
  uci set wireless.guest_5g.device="$RADIO_5G"
  uci set wireless.guest_5g.mode='ap'
  uci set wireless.guest_5g.network='guest'
  uci set wireless.guest_5g.ssid="$GUEST_SSID_5G"
  uci set wireless.guest_5g.isolate='1'
  if [ -n "$GUEST_KEY_5G" ] && [ "${#GUEST_KEY_5G}" -ge 8 ]; then
    uci set wireless.guest_5g.encryption='psk2'
    uci set wireless.guest_5g.key="$GUEST_KEY_5G"
  else
    uci set wireless.guest_5g.encryption='none'
    uci -q delete wireless.guest_5g.key || true
  fi
  uci set wireless.guest_5g.disabled='0'
  echo "[CyberWave-Guest] Configured 5GHz Guest SSID: $GUEST_SSID_5G on $RADIO_5G"
else
  echo "[CyberWave-Guest] NOTICE: 5 GHz radio not found; skipping 5G guest interface."
fi
uci commit wireless

# 5. Configure Firewall Isolation in /etc/config/firewall
# Check if guest zone already exists
GUEST_ZONE_INDEX=""
idx=0
while true; do
  zname="$(uci -q get firewall.@zone[$idx].name || true)"
  if [ -z "$zname" ]; then
    break
  fi
  if [ "$zname" = "guest" ]; then
    GUEST_ZONE_INDEX="$idx"
    break
  fi
  idx=$((idx + 1))
done

if [ -z "$GUEST_ZONE_INDEX" ]; then
  uci add firewall zone >/dev/null
  GUEST_ZONE_INDEX="$idx"
fi

uci set firewall.@zone["$GUEST_ZONE_INDEX"].name='guest'
uci set firewall.@zone["$GUEST_ZONE_INDEX"].network='guest'
uci set firewall.@zone["$GUEST_ZONE_INDEX"].input='REJECT'
uci set firewall.@zone["$GUEST_ZONE_INDEX"].output='ACCEPT'
uci set firewall.@zone["$GUEST_ZONE_INDEX"].forward='REJECT'

# Guest-to-WAN forwarding (Allow internet access)
FWD_EXISTS=0
idx=0
while true; do
  src="$(uci -q get firewall.@forwarding[$idx].src || true)"
  dest="$(uci -q get firewall.@forwarding[$idx].dest || true)"
  if [ -z "$src" ]; then
    break
  fi
  if [ "$src" = "guest" ] && [ "$dest" = "wan" ]; then
    FWD_EXISTS=1
    break
  fi
  idx=$((idx + 1))
done

if [ "$FWD_EXISTS" -eq 0 ]; then
  uci add firewall forwarding >/dev/null
  uci set firewall.@forwarding[-1].src='guest'
  uci set firewall.@forwarding[-1].dest='wan'
fi

# Allow Guest DHCP (UDP 67)
DHCP_RULE_EXISTS=0
idx=0
while true; do
  rname="$(uci -q get firewall.@rule[$idx].name || true)"
  if [ -z "$rname" ]; then
    break
  fi
  if [ "$rname" = "Allow-Guest-DHCP" ]; then
    DHCP_RULE_EXISTS=1
    break
  fi
  idx=$((idx + 1))
done

if [ "$DHCP_RULE_EXISTS" -eq 0 ]; then
  uci add firewall rule >/dev/null
  uci set firewall.@rule[-1].name='Allow-Guest-DHCP'
  uci set firewall.@rule[-1].src='guest'
  uci set firewall.@rule[-1].proto='udp'
  uci set firewall.@rule[-1].dest_port='67'
  uci set firewall.@rule[-1].target='ACCEPT'
fi

# Allow Guest DNS (UDP & TCP 53)
DNS_RULE_EXISTS=0
idx=0
while true; do
  rname="$(uci -q get firewall.@rule[$idx].name || true)"
  if [ -z "$rname" ]; then
    break
  fi
  if [ "$rname" = "Allow-Guest-DNS" ]; then
    DNS_RULE_EXISTS=1
    break
  fi
  idx=$((idx + 1))
done

if [ "$DNS_RULE_EXISTS" -eq 0 ]; then
  uci add firewall rule >/dev/null
  uci set firewall.@rule[-1].name='Allow-Guest-DNS'
  uci set firewall.@rule[-1].src='guest'
  uci set firewall.@rule[-1].proto='tcp udp'
  uci set firewall.@rule[-1].dest_port='53'
  uci set firewall.@rule[-1].target='ACCEPT'
fi

uci commit firewall
echo "[CyberWave-Guest] Configured firewall isolation: guest -> WAN allowed, guest -> LAN blocked"

# 6. Apply configurations safely
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

echo "[CyberWave-Guest] Guest Wi-Fi & network isolation successfully applied."
exit 0
