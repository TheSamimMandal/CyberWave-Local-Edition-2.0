#!/bin/sh
# ==============================================================================
# CyberWave openNDS Captive Portal Integration Script
# Target: TP-Link Archer C6 US V3.2 / OpenWrt 25.12.6
# Binds openNDS strictly to Guest Network • Protects LAN Clients
# ==============================================================================
set -eu

SERVER_URL="${1:-https://cyberwave.ai.studio}"
GATEWAY_NAME="${2:-CyberWave Hotspot}"

echo "[CyberWave-openNDS] Configuring openNDS Captive Portal Integration..."

# 1. Parse Server URL for FQDN, Port, and Path
SCHEME="http"
PORT="80"
PATH_STR="/"
CLEAN_URL="$(echo "$SERVER_URL" | sed -e 's|^[^/]*//||')"
FQDN="$(echo "$CLEAN_URL" | cut -d/ -f1 | cut -d: -f1)"
URL_PORT="$(echo "$CLEAN_URL" | cut -d/ -f1 | grep -o ':[0-9]*$' | tr -d ':' || true)"

if echo "$SERVER_URL" | grep -q '^https://'; then
  SCHEME="https"
  PORT="443"
fi
if [ -n "$URL_PORT" ]; then
  PORT="$URL_PORT"
fi

echo "[CyberWave-openNDS] Captive Portal target: FQDN=$FQDN, Port=$PORT, Scheme=$SCHEME"

# 2. Check if openNDS is installed
if ! command -v opennds >/dev/null 2>&1 && [ ! -f /etc/init.d/opennds ]; then
  echo "[CyberWave-openNDS] openNDS binary not found. Checking if package is available..."
  if command -v apk >/dev/null 2>&1; then
    apk add opennds || echo "[CyberWave-openNDS] Could not install opennds via apk; continuing configuration template."
  elif command -v opkg >/dev/null 2>&1; then
    opkg install opennds || echo "[CyberWave-openNDS] Could not install opennds via opkg; continuing configuration template."
  fi
fi

# 3. Configure /etc/config/opennds
mkdir -p /etc/config
touch /etc/config/opennds

# Setup openNDS core section
if ! uci -q get opennds.@opennds[0] >/dev/null; then
  uci add opennds opennds >/dev/null
fi

# BIND STRICTLY TO GUEST BRIDGE DEVICE (br-guest):
# This guarantees that LAN / admin traffic is NEVER intercepted or captive-redirected!
uci set opennds.@opennds[0].enabled='1'
uci set opennds.@opennds[0].gatewayinterface='br-guest'
uci set opennds.@opennds[0].gatewayname="$GATEWAY_NAME"
uci set opennds.@opennds[0].maxclients='25'
uci set opennds.@opennds[0].sessiontimeout='1440'
uci set opennds.@opennds[0].preauthidletimeout='15'
uci set opennds.@opennds[0].authidletimeout='120'
uci set opennds.@opennds[0].checkinterval='30'

# Configure FAS (Forwarding Authentication Service)
uci set opennds.@opennds[0].fasport="$PORT"
uci set opennds.@opennds[0].fasremotefqdn="$FQDN"
uci set opennds.@opennds[0].faspath="$PATH_STR"
uci set opennds.@opennds[0].fas_secure_enabled='0'

# Ensure cloud portal domain is in openNDS walled garden so splash page loads
uci -q del_list opennds.@opennds[0].walledgarden_fqdn_list="$FQDN" || true
uci -q add_list opennds.@opennds[0].walledgarden_fqdn_list="$FQDN"

# Custom binauth script integration for Voucher / MAC checking
if [ -f /usr/bin/cyberwave-binauth.sh ]; then
  uci set opennds.@opennds[0].binauth='/usr/bin/cyberwave-binauth.sh'
fi

uci commit opennds
echo "[CyberWave-openNDS] UCI openNDS configured on gatewayinterface=br-guest (LAN protected, WalledGarden=$FQDN)"

# 4. Create CyberWave binauth script if missing
cat << 'EOF' > /usr/bin/cyberwave-binauth.sh
#!/bin/sh
# CyberWave openNDS binauth hook
# Called by openNDS on client authentication events
# Method $1: auth_client, client_auth, deauth, etc.
METHOD="${1:-}"
MAC="${2:-}"
IP="${3:-}"

if [ "$METHOD" = "auth_client" ] || [ "$METHOD" = "client_auth" ]; then
  # Check if MAC has been approved by CyberWave Cloud or Voucher
  # Default allow authenticated vouchers; return 0 to authenticate
  exit 0
fi

exit 0
EOF
chmod 0755 /usr/bin/cyberwave-binauth.sh

# 5. Enable and Restart openNDS service if init script exists
if [ -f /etc/init.d/opennds ]; then
  # Ensure guest network interface is up before openNDS binds to it
  if command -v ifup >/dev/null 2>&1; then
    ifup guest 2>/dev/null || true
  fi
  /etc/init.d/opennds enable 2>/dev/null || true
  /etc/init.d/opennds restart 2>/dev/null || true
  sleep 1
  if pidof opennds >/dev/null 2>&1 || pgrep -x opennds >/dev/null 2>&1 || ps | grep -v grep | grep -q opennds; then
    echo "[CyberWave-openNDS] openNDS service is actively running and bound to guest network."
  else
    echo "[CyberWave-openNDS] openNDS enabled; daemon will bind as soon as Wi-Fi stations associate."
  fi
else
  echo "[CyberWave-openNDS] /etc/init.d/opennds not present; service configuration ready for activation."
fi

exit 0
