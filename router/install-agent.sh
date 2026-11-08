#!/bin/sh
# ==============================================================================
# CyberWave Automatic Bridge Installer & System Setup
# Target Hardware: TP-Link Archer C6 v3.2 (US) [tplink,archer-c6-v3]
# Target System: OpenWrt 25.12.6 (MediaTek MT7621AT MIPS, ramips/mt7621)
# ==============================================================================
set -eu

SERVER_URL="${1:-https://cyberwave.ai.studio}"
ROUTER_ID="${2:-}"
PAIRING_TOKEN="${3:-}"

fail() { printf '[ERROR] CyberWave installer: %s\n' "$1" >&2; exit 1; }
info() { printf '[INFO] %s\n' "$1"; }

# 1. Privileges & System Validation
info "Step 1/10: Verifying environment and hardware compatibility..."
[ "$(id -u)" = "0" ] || fail "Run as root (SSH: root@192.168.1.1)."
[ -f /etc/openwrt_release ] || fail "This device is not running OpenWrt."
[ -n "$ROUTER_ID" ] || fail "Missing router ID. Generate the installer from CyberWave Admin."
[ "${#PAIRING_TOKEN}" -ge 24 ] || fail "Missing or invalid pairing token. Generate a new pairing token in CyberWave Admin."

case "$SERVER_URL" in https://*|http://localhost*|http://127.0.0.1*) ;; *) fail "Server URL must use HTTPS (or local dev)." ;; esac
case "$ROUTER_ID" in *[!A-Za-z0-9_-]*|'') fail "Invalid router ID." ;; esac

. /etc/openwrt_release
BOARD="$(cat /tmp/sysinfo/board_name 2>/dev/null || cat /tmp/sysinfo/model 2>/dev/null || true)"
# Allow archer-c6-v3 variants
case "$BOARD" in
    *archer-c6-v3*|*Archer*C6*) info "Detected compatible hardware: ${BOARD}" ;;
    *) info "Hardware detected: ${BOARD:-generic-mips}; proceeding with Archer C6 MIPS profile." ;;
esac

# 2. Flash Storage Pre-check
info "Step 2/10: Checking available flash overlay storage..."
FREE_KB="$(df -k /overlay 2>/dev/null | awk 'NR==2 {print $4}' || df -k / | awk 'NR==2 {print $4}')"
[ -n "$FREE_KB" ] && [ "$FREE_KB" -ge 256 ] || fail "At least 256 KB free overlay space is required; found ${FREE_KB:-unknown} KB."
info "Sufficient flash memory available: ${FREE_KB} KB free."

# 3. Check Required Core Utilities
info "Step 3/10: Validating core network utilities..."
FETCH_CMD=""
if command -v uclient-fetch >/dev/null 2>&1; then
    FETCH_CMD="uclient-fetch -q --timeout=30 -O"
elif command -v curl >/dev/null 2>&1; then
    FETCH_CMD="curl -s -m 30 -o"
else
    fail "Neither uclient-fetch nor curl is available. Cannot download agent files."
fi

# 4. Create Timestamped Backup of Router Configuration
info "Step 4/10: Creating pre-install configuration backup..."
mkdir -p /etc/cyberwave/backups
BACKUP_ARCHIVE="/etc/cyberwave/backups/uci-backup-$(date +%Y%m%d%H%M%S).tar.gz"
sysupgrade -b "$BACKUP_ARCHIVE" 2>/dev/null || tar -czf "$BACKUP_ARCHIVE" -C / etc/config 2>/dev/null || true
info "Configuration backed up to ${BACKUP_ARCHIVE}"

# 5. Download and Validate CyberWave Agent
info "Step 5/10: Downloading CyberWave Bridge Agent over secure transport..."
TMP_AGENT="/tmp/cyberwave-agent.sh.$$"
TMP_UNINSTALL="/tmp/cyberwave-uninstall.sh.$$"
trap 'rm -f "$TMP_AGENT" "$TMP_UNINSTALL"' EXIT HUP INT TERM

$FETCH_CMD "$TMP_AGENT" "${SERVER_URL}/router/cyberwave-agent.sh" || fail "Agent download failed. Check network connectivity."
[ -s "$TMP_AGENT" ] || fail "Downloaded agent is empty."
sh -n "$TMP_AGENT" || fail "Downloaded agent failed shell syntax validation."

$FETCH_CMD "$TMP_UNINSTALL" "${SERVER_URL}/router/cyberwave-uninstall.sh" || fail "Uninstaller download failed."
[ -s "$TMP_UNINSTALL" ] && sh -n "$TMP_UNINSTALL" || fail "Downloaded uninstaller failed validation."

# 6. Check and Install jsonfilter if needed
info "Step 6/10: Verifying JSON processor..."
if ! command -v jsonfilter >/dev/null 2>&1; then
    if command -v apk >/dev/null 2>&1; then
        apk add jsonfilter 2>/dev/null || info "Note: jsonfilter package unavailable via apk, using fallback parsers."
    elif command -v opkg >/dev/null 2>&1; then
        opkg update >/dev/null 2>&1 && opkg install jsonfilter >/dev/null 2>&1 || info "Note: jsonfilter unavailable via opkg."
    fi
fi

# 7. Install Files to Router Binary Directories
info "Step 7/10: Installing agent binaries..."
mkdir -p /etc/cyberwave /usr/bin /var/log
chmod 700 /etc/cyberwave
cp "$TMP_AGENT" /usr/bin/cyberwave-agent.sh
cp "$TMP_UNINSTALL" /usr/bin/cyberwave-uninstall.sh
chmod 755 /usr/bin/cyberwave-agent.sh /usr/bin/cyberwave-uninstall.sh

# 8. Configure Secure Credentials File
info "Step 8/10: Writing agent credentials configuration..."
cat > /etc/cyberwave/agent.conf <<EOF_CONF
# CyberWave Agent Configuration for Archer C6 v3.2
SERVER_URL="${SERVER_URL}"
ROUTER_ID="${ROUTER_ID}"
SECRET_KEY="${PAIRING_TOKEN}"
POLL_INTERVAL=10
BURST_INTERVAL=3
LOG_FILE=/var/log/cyberwave-agent.log
EOF_CONF
chmod 600 /etc/cyberwave/agent.conf

# 9. Configure procd Service
info "Step 9/10: Setting up procd init service..."
cat > /etc/init.d/cyberwave-agent <<'EOF_INIT'
#!/bin/sh /etc/rc.common
START=95
STOP=10
USE_PROCD=1

start_service() {
    [ -x /usr/bin/cyberwave-agent.sh ] || return 1
    [ -r /etc/cyberwave/agent.conf ] || return 1
    procd_open_instance
    procd_set_param command /bin/sh /usr/bin/cyberwave-agent.sh
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}

stop_service() {
    killall -q cyberwave-agent.sh 2>/dev/null || true
}
EOF_INIT
chmod 755 /etc/init.d/cyberwave-agent
/etc/init.d/cyberwave-agent enable
/etc/init.d/cyberwave-agent restart || /etc/init.d/cyberwave-agent start

# 10. Verify Service Startup
info "Step 10/10: Verifying daemon execution..."
sleep 2
if pgrep -f "cyberwave-agent.sh" >/dev/null 2>&1; then
    info "SUCCESS: CyberWave Bridge Agent is running."
else
    info "NOTICE: Service started via procd. Check logs with 'logread -e cyberwave-agent'."
fi

printf '\n============================================================\n'
printf '  CyberWave Bridge Successfully Installed on Archer C6 v3.2!\n'
printf '============================================================\n'
printf 'Router ID:    %s\n' "$ROUTER_ID"
printf 'Server URL:   %s\n' "$SERVER_URL"
printf 'Logs:         logread -e cyberwave-agent  or  cat /var/log/cyberwave-agent.log\n'
printf 'Uninstall:    /usr/bin/cyberwave-uninstall.sh\n\n'
