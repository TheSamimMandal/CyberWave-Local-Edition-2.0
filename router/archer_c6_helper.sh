#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Modular Router API Gateway (/www/cgi-bin/api)
#
# Hardware: TP-Link Archer C6 v3 (MediaTek MT7621DAT, OpenWrt 21.02+)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

# 1. Resolve Library Directory (Router /usr/lib or local lib/)
SCRIPT_DIR="$(dirname "$0")"
LIB_DIR="/usr/lib/archer_guard"
[ ! -d "$LIB_DIR" ] && LIB_DIR="$SCRIPT_DIR/lib"

# 2. Source Modules
if [ -f "$LIB_DIR/common.sh" ]; then
    . "$LIB_DIR/common.sh"
    . "$LIB_DIR/sys_metrics.sh"
    . "$LIB_DIR/net_metrics.sh"
    . "$LIB_DIR/analytics.sh"
    . "$LIB_DIR/actions.sh"
else
    # Fallback error if library files are missing
    printf "Content-Type: application/json\r\n\r\n"
    printf '{"error":"missing_modules","message":"Library modules not found in %s"}\n' "$LIB_DIR"
    exit 1
fi

# 3. Handle CORS Pre-flight
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    send_header
    printf '{"status":"ok"}\n'
    exit 0
fi

# 4. Parse Query Action
ACTION=$(printf "%s" "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')
[ -z "$ACTION" ] && ACTION="status"

# 5. Dispatch Request
case "$ACTION" in
    "login")
        _payload=""
        [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] && read -n "$CONTENT_LENGTH" _payload
        _user=$(extract_param "username" "$_payload")
        [ -z "$_user" ] && _user=$(extract_param "user" "$_payload")
        [ -z "$_user" ] && _user="root"
        _pass=$(extract_param "password" "$_payload")
        [ -z "$_pass" ] && _pass=$(extract_param "pass" "$_payload")
        handle_login "$_user" "$_pass"
        ;;
    "logout")
        _payload=""
        [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] && read -n "$CONTENT_LENGTH" _payload
        _token=$(extract_param "token" "$_payload")
        [ -z "$_token" ] && _token="$HTTP_X_ROUTER_SESSION"
        if [ -n "$_token" ]; then
            rm -f "/tmp/archer_sessions/$_token" 2>/dev/null
            command -v ubus >/dev/null 2>&1 && ubus -t 2 call session destroy "{\"ubus_rpc_session\":\"$_token\"}" 2>/dev/null
        fi
        json_ok "Logged out successfully"
        ;;
    "control")
        execute_control
        ;;
    "speed")
        send_header
        printf '{'
        get_wan_traffic_metrics
        printf '}\n'
        ;;
    "clients")
        check_auth ""
        send_header
        printf '{'
        get_connected_clients
        printf '}\n'
        ;;
    "analytics"|"quota")
        check_auth ""
        send_header
        printf '{'
        get_bandwidth_quota_metrics
        printf '}\n'
        ;;
    "cron"|"crontab")
        check_auth ""
        send_header
        printf '{'
        get_crontab_metrics
        printf '}\n'
        ;;
    "status"|*)
        _cache_f="/tmp/c6_status.json"
        _lock_dir="/tmp/c6_status.lock"
        _now=$(date +%s)

        # 1. Serve fresh cache if younger than 6 seconds
        if [ -s "$_cache_f" ]; then
            _mod=$(date -r "$_cache_f" +%s 2>/dev/null || echo 0)
            if [ $((_now - _mod)) -lt 6 ]; then
                send_header
                cat "$_cache_f"
                exit 0
            fi
        fi

        # 2. Concurrency Lock: Prevent multiple concurrent background status generations
        if ! mkdir "$_lock_dir" 2>/dev/null; then
            # Another process is currently regenerating status; serve previous cache if available
            if [ -s "$_cache_f" ]; then
                send_header
                cat "$_cache_f"
                exit 0
            fi
            # If no cache exists yet, wait briefly for other process
            sleep 1
            if [ -s "$_cache_f" ]; then
                send_header
                cat "$_cache_f"
                exit 0
            fi
        fi

        # 3. Generate Status Atomically
        _tmp_gen="/tmp/c6_status_$$.tmp"
        {
            printf '{'
            get_cpu_metrics; printf ','
            get_memory_metrics; printf ','
            get_storage_metrics; printf ','
            get_ports_metrics; printf ','
            get_wireless_metrics; printf ','
            get_wan_traffic_metrics; printf ','
            get_network_acceleration_metrics; printf ','
            get_conntrack_metrics; printf ','
            get_connected_clients; printf ','
            get_bandwidth_quota_metrics; printf ','
            get_crontab_metrics; printf ','
            get_smart_home_metrics; printf ','
            get_led_status
            printf ',"timestamp":%d}\n' "$(date +%s)"
        } > "$_tmp_gen" 2>/dev/null
        mv -f "$_tmp_gen" "$_cache_f" 2>/dev/null
        rmdir "$_lock_dir" 2>/dev/null

        send_header
        cat "$_cache_f"
        ;;
esac
