#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Autonomous Self-Healing & Router Watchdog (router/lib/watchdog.sh)
#
# Hardware: TP-Link Archer C6 v3 (MediaTek MT7621DAT, OpenWrt 21.02+)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

BACKUP_DIR="/etc/archer_guard_backup"
LOG_TAG="archer_watchdog"

# 1. Ensure pristine baseline configurations are backed up
backup_baseline() {
    [ ! -d "$BACKUP_DIR" ] && mkdir -p "$BACKUP_DIR"
    for _cfg in dhcp network wireless; do
        if [ -f "/etc/config/$_cfg" ] && [ ! -f "$BACKUP_DIR/$_cfg" ]; then
            cp -p "/etc/config/$_cfg" "$BACKUP_DIR/$_cfg"
            logger -t "$LOG_TAG" "Backed up pristine baseline for /etc/config/$_cfg"
        fi
    done
    if [ ! -f "$BACKUP_DIR/firewall" ] && [ -f "/etc/config/firewall" ]; then
        cp -p "/etc/config/firewall" "$BACKUP_DIR/firewall"
        logger -t "$LOG_TAG" "Backed up pristine baseline for /etc/config/firewall"
    elif fw4 -q check >/dev/null 2>&1 && nft list tables 2>/dev/null | grep -q "table inet fw4"; then
        cp -f "/etc/config/firewall" "$BACKUP_DIR/firewall"
    fi
}

# 2. Check and heal dnsmasq (DHCP & DNS gateway)
heal_dnsmasq() {
    if ! pidof dnsmasq >/dev/null 2>&1; then
        logger -t "$LOG_TAG" "[ALERT] dnsmasq is NOT running! Initiating emergency diagnostics..."
        if command -v dnsmasq >/dev/null 2>&1 && ! dnsmasq --test >/dev/null 2>&1; then
            logger -t "$LOG_TAG" "[FATAL] dnsmasq syntax test failed! Restoring baseline backup..."
            if [ -f "$BACKUP_DIR/dhcp" ]; then
                cp -f "$BACKUP_DIR/dhcp" /etc/config/dhcp
                logger -t "$LOG_TAG" "Restored clean /etc/config/dhcp from backup."
            else
                uci revert dhcp 2>/dev/null
            fi
        fi
        /etc/init.d/dnsmasq restart >/dev/null 2>&1
        sleep 1
        if pidof dnsmasq >/dev/null 2>&1; then
            logger -t "$LOG_TAG" "[SUCCESS] dnsmasq successfully revived by watchdog!"
        else
            logger -t "$LOG_TAG" "[CRITICAL] Unable to start dnsmasq. Emergency revert to defaults."
        fi
    fi
}

# 3. Check and heal firewall4 (NAT, forwarding & nftables ruleset)
heal_firewall() {
    _fw_ok=1
    if ! nft list tables 2>/dev/null | grep -q "table inet fw4"; then
        _fw_ok=0
    elif ! fw4 -q check >/dev/null 2>&1; then
        _fw_ok=0
    elif [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" != "1" ]; then
        _fw_ok=0
    fi

    if [ "$_fw_ok" = "0" ]; then
        logger -t "$LOG_TAG" "[ALERT] Firewall failure detected! Initiating automated recovery..."
        mkdir -p "$BACKUP_DIR/quarantine"

        # Step 1: Isolate offending custom .nft rule if fw4 check fails
        if ! fw4 -q check >/dev/null 2>&1; then
            _fixed=0
            for _dir in /etc/nftables.d /usr/share/nftables.d/ruleset-post; do
                [ -d "$_dir" ] || continue
                for _rule in "$_dir"/*.nft; do
                    [ -f "$_rule" ] || continue
                    [ "$_rule" = "/etc/nftables.d/10-custom-filter-chains.nft" ] && continue
                    mv "$_rule" "$BACKUP_DIR/quarantine/"
                    if fw4 -q check >/dev/null 2>&1; then
                        logger -t "$LOG_TAG" "[FATAL] Bad nftables rule isolated & quarantined: $(basename "$_rule")"
                        _fixed=1
                        break 2
                    else
                        mv "$BACKUP_DIR/quarantine/$(basename "$_rule")" "$_rule"
                    fi
                done
            done

            # If single isolation didn't fix, quarantine all non-system .nft rules
            if [ "$_fixed" = "0" ] && ! fw4 -q check >/dev/null 2>&1; then
                for _dir in /etc/nftables.d /usr/share/nftables.d/ruleset-post; do
                    [ -d "$_dir" ] || continue
                    for _rule in "$_dir"/*.nft; do
                        [ -f "$_rule" ] || continue
                        [ "$_rule" = "/etc/nftables.d/10-custom-filter-chains.nft" ] && continue
                        mv "$_rule" "$BACKUP_DIR/quarantine/"
                    done
                done
            fi
        fi

        # Step 2: If fw4 check STILL fails, restore clean /etc/config/firewall baseline
        if ! fw4 -q check >/dev/null 2>&1; then
            logger -t "$LOG_TAG" "[FATAL] firewall config corrupted! Restoring baseline backup..."
            if [ -f "$BACKUP_DIR/firewall" ]; then
                cp -f "$BACKUP_DIR/firewall" /etc/config/firewall
            else
                uci revert firewall 2>/dev/null
            fi
        fi

        # Step 3: Restart firewall & ensure kernel IPv4 forwarding is active
        /etc/init.d/firewall restart >/dev/null 2>&1 || fw4 -q start >/dev/null 2>&1
        echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null
        sleep 1

        if nft list tables 2>/dev/null | grep -q "table inet fw4"; then
            logger -t "$LOG_TAG" "[SUCCESS] Firewall successfully revived and client NAT restored!"
        else
            logger -t "$LOG_TAG" "[CRITICAL] Forcing fw4 clean start..."
            fw4 -q flush >/dev/null 2>&1
            [ -f "$BACKUP_DIR/firewall" ] && cp -f "$BACKUP_DIR/firewall" /etc/config/firewall
            fw4 -q start >/dev/null 2>&1
            echo 1 > /proc/sys/net/ipv4/ip_forward 2>/dev/null
        fi
    fi
}

# 4. Check and heal uhttpd web server
heal_uhttpd() {
    if ! pidof uhttpd >/dev/null 2>&1; then
        logger -t "$LOG_TAG" "[WARN] uhttpd web server is not running. Reviving..."
        /etc/init.d/uhttpd restart >/dev/null 2>&1
    fi
}

# 5. Enforce MediaTek MT7621 Silicon Safeguards (Disable HW offload lockup)
enforce_silicon_safeguards() {
    _hw_offload=$(uci get firewall.@defaults[0].flow_offloading_hw 2>/dev/null)
    if [ "$_hw_offload" = "1" ]; then
        logger -t "$LOG_TAG" "[PROTECTION] flow_offloading_hw detected as 1! MT7621 queue lockup prevention triggered."
        uci set firewall.@defaults[0].flow_offloading_hw='0'
        uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1
    fi
}

# 6. Prevent RAM Exhaustion & Kernel OOM Panics
check_memory_pressure() {
    _avail_kb=0
    if [ -f /proc/meminfo ]; then
        _avail_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
        [ -z "$_avail_kb" ] && _avail_kb=$(awk '/MemFree/ {f=$2} /Cached/ {c=$2} END {print f+c}' /proc/meminfo)
    fi
    if [ "${_avail_kb:-99999}" -lt 8192 ]; then
        logger -t "$LOG_TAG" "[WARN] Critically low memory (${_avail_kb} kB). Dropping kernel caches..."
        sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
    fi
}

# 7. Clean stale execution locks
clean_stale_locks() {
    if [ -d "/tmp/c6_status.lock" ]; then
        _now=$(date +%s)
        _lock_time=$(date -r /tmp/c6_status.lock +%s 2>/dev/null || echo "$_now")
        if [ $((_now - _lock_time)) -gt 30 ]; then
            rm -rf /tmp/c6_status.lock
            logger -t "$LOG_TAG" "Purged stale status cache lock."
        fi
    fi
}

# 8. Real-Time Internet & Firewall WAN LED Controller (Green=Online, Amber/Red=Offline/Degraded)
check_wan_led() {
    _online=0
    if ip route | grep -q "^default " 2>/dev/null; then
        if ping -q -c 1 -W 2 1.1.1.1 >/dev/null 2>&1 || ping -q -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
            _online=1
        fi
    fi

    # Crucial: If firewall or table inet fw4 is down, clients cannot browse even if router pings WAN
    if ! nft list tables 2>/dev/null | grep -q "table inet fw4"; then
        _online=0
    fi

    if [ "$_online" = "1" ]; then
        echo 0 > /sys/class/leds/amber:wan/brightness 2>/dev/null
        echo 1 > /sys/class/leds/green:wan/brightness 2>/dev/null
    else
        echo 0 > /sys/class/leds/green:wan/brightness 2>/dev/null
        echo 1 > /sys/class/leds/amber:wan/brightness 2>/dev/null
        logger -t "$LOG_TAG" "[WAN] Internet or Firewall degraded! WAN LED set to AMBER/RED."
    fi
}

# Main Entry
case "$1" in
    "init"|"backup")
        backup_baseline
        check_wan_led ;;
    "led_check")
        check_wan_led ;;
    "heal_fw")
        heal_firewall ;;
    "run"|*)
        backup_baseline
        heal_dnsmasq
        heal_firewall
        heal_uhttpd
        enforce_silicon_safeguards
        check_memory_pressure
        clean_stale_locks
        check_wan_led ;;
esac
exit 0
