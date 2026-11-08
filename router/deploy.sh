#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Router Deployment & Hardening Script (router/deploy.sh)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

ROUTER_IP="${1:-192.168.1.1}"
ROUTER_USER="${2:-root}"
SCRIPT_DIR="$(dirname "$0")"

printf "\n🚀 Deploying ArcherGuard C6 Modular API to %s@%s...\n\n" "$ROUTER_USER" "$ROUTER_IP"

# 1. Create target directories on OpenWrt
ssh -q -o ConnectTimeout=5 "$ROUTER_USER@$ROUTER_IP" "mkdir -p /usr/lib/archer_guard /www/cgi-bin /etc/archer_guard_backup /etc/hotplug.d/iface && touch /etc/config/archer_guard"
if [ $? -ne 0 ]; then
    printf "❌ Failed to connect to %s. Ensure router is online and SSH is active.\n" "$ROUTER_IP"
    exit 1
fi

# 2. Copy library modules to /usr/lib/archer_guard/
printf "📦 Copying modular libraries to /usr/lib/archer_guard/...\n"
scp -O -q "$SCRIPT_DIR"/lib/*.sh "$SCRIPT_DIR"/lib/*.awk "$ROUTER_USER@$ROUTER_IP":/usr/lib/archer_guard/

# 3. Copy main entry point to /www/cgi-bin/api
printf "⚡ Copying main gateway to /www/cgi-bin/api...\n"
scp -O -q "$SCRIPT_DIR/archer_c6_helper.sh" "$ROUTER_USER@$ROUTER_IP":/www/cgi-bin/api

# 4. Set execution permissions & reload web server
printf "🔒 Setting execution permissions & refreshing uhttpd...\n"
ssh -q "$ROUTER_USER@$ROUTER_IP" "chmod +x /www/cgi-bin/api /usr/lib/archer_guard/*.sh && /etc/init.d/uhttpd reload"

# 4b. Sync Modern Pro Theme Enhancements (if present)
if [ -f "$SCRIPT_DIR/modern-enhancements.css" ]; then
    printf "🎨 Syncing Modern Pro UI Enhancements to Proton2025 theme...\n"
    scp -O -q "$SCRIPT_DIR/modern-enhancements.css" "$ROUTER_USER@$ROUTER_IP":/www/luci-static/proton2025/css/ 2>/dev/null
fi

# 5. Configure Smart WAN LED Hotplug & Smooth LED Intervals (LAN & Wi-Fi)
printf "💡 Configuring Smart WAN & Smooth LED triggers (LAN & Wi-Fi)...\n"
if [ -f "$SCRIPT_DIR/lib/99-firewall-guard" ]; then
    scp -O -q "$SCRIPT_DIR/lib/99-firewall-guard" "$ROUTER_USER@$ROUTER_IP":/etc/hotplug.d/iface/99-firewall-guard
    ssh -q "$ROUTER_USER@$ROUTER_IP" "chmod +x /etc/hotplug.d/iface/99-firewall-guard"
fi
if [ -f "$SCRIPT_DIR/lib/99-wan-led" ]; then
    scp -O -q "$SCRIPT_DIR/lib/99-wan-led" "$ROUTER_USER@$ROUTER_IP":/etc/hotplug.d/iface/99-wan-led
    ssh -q "$ROUTER_USER@$ROUTER_IP" "
        chmod +x /etc/hotplug.d/iface/99-wan-led
        uci set system.led_wan.trigger='none' 2>/dev/null
        uci set system.led_lan.interval='500' 2>/dev/null
        uci set system.led_wlan2=led 2>/dev/null
        uci set system.led_wlan2.name='WLAN2G' 2>/dev/null
        uci set system.led_wlan2.sysfs='green:wlan-2' 2>/dev/null
        uci set system.led_wlan2.trigger='netdev' 2>/dev/null
        uci set system.led_wlan2.dev='phy0-ap0' 2>/dev/null
        uci set system.led_wlan2.mode='link tx rx' 2>/dev/null
        uci set system.led_wlan2.interval='500' 2>/dev/null
        uci set system.led_wlan5=led 2>/dev/null
        uci set system.led_wlan5.name='WLAN5G' 2>/dev/null
        uci set system.led_wlan5.sysfs='green:wlan-5' 2>/dev/null
        uci set system.led_wlan5.trigger='netdev' 2>/dev/null
        uci set system.led_wlan5.dev='phy1-ap0' 2>/dev/null
        uci set system.led_wlan5.mode='link tx rx' 2>/dev/null
        uci set system.led_wlan5.interval='500' 2>/dev/null
        uci commit system 2>/dev/null && /etc/init.d/led reload 2>/dev/null
    "
fi

# 6. Initialize Watchdog & baseline config backup
printf "🛡️ Initializing Autonomous Watchdog & Baseline Backups...\n"
ssh -q "$ROUTER_USER@$ROUTER_IP" "sh /usr/lib/archer_guard/watchdog.sh init"

# 7. Configure Watchdog & Nightly Cache Drop Cron schedules + VM tuning
printf "⏰ Installing Watchdog, Nightly Cache Flush & VM Tuning...\n"
ssh -q "$ROUTER_USER@$ROUTER_IP" '
mkdir -p /etc/crontabs /etc/sysctl.d
touch /etc/crontabs/root
if ! grep -q "watchdog.sh run" /etc/crontabs/root 2>/dev/null; then
    echo "* * * * * /usr/lib/archer_guard/watchdog.sh run >/dev/null 2>&1" >> /etc/crontabs/root
fi
if ! grep -q "drop_caches" /etc/crontabs/root 2>/dev/null; then
    echo "30 3 * * * sync && echo 3 > /proc/sys/vm/drop_caches" >> /etc/crontabs/root
fi
echo "vm.vfs_cache_pressure=150" > /etc/sysctl.d/99-memory-tuning.conf
sysctl -w vm.vfs_cache_pressure=150 >/dev/null 2>&1
/etc/init.d/cron enable >/dev/null 2>&1
/etc/init.d/cron restart >/dev/null 2>&1
'

# 8. Verification check
printf "\n🔍 Verifying Router API...\n"
_http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://$ROUTER_IP/cgi-bin/api?action=status")
if [ "$_http_code" = "200" ]; then
    printf "✅ Deployment Successful! API is LIVE (HTTP %s)\n" "$_http_code"
    printf "   Test URL: http://%s/cgi-bin/api?action=status\n\n" "$ROUTER_IP"
else
    printf "⚠️ Deployment warning: API returned HTTP %s\n\n" "$_http_code"
fi
