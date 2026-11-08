#!/bin/sh
# ==============================================================================
# OpenWrt openNDS BinAuth Hook Script (router/binauth.sh)
#
# Automatically executed by openNDS upon client lifecycle events:
#  - auth_client: Client authentication request
#  - client_auth: Client authenticated notification
#  - timeout_deauth: Client session duration expired (e.g. 30m / 60m ended)
#  - idle_deauth: Client idle timeout reached
#  - downquota_deauth / upquota_deauth: Data quota exceeded
#  - client_deauth: Client manually deauthenticated
#
# When any deauthentication event occurs (especially session timeout), this
# script immediately kicks the client from the Wi-Fi AP at Layer 2 (802.11).
# This ensures smartphones (Android/iOS) detect disconnection within 2-5s
# instead of waiting 1-2 minutes for OS background connectivity checks.
# ==============================================================================

METHOD="$1"
CLIENT_MAC="$2"

# ------------------------------------------------------------------------------
# Wi-Fi Client Deauthentication Helper (Layer 2 Disconnect)
# ------------------------------------------------------------------------------
kick_wifi_client() {
    _mac="$1"
    [ -z "$_mac" ] && return 0

    # 1. OpenWrt ubus hostapd client deletion (forces 802.11 deauth frame)
    if command -v ubus >/dev/null 2>&1; then
        for _h_iface in $(ubus list 'hostapd.*' 2>/dev/null); do
            ubus call "$_h_iface" del_client "{\"addr\":\"$_mac\",\"reason\":1,\"deauth\":true}" >/dev/null 2>&1
        done
    fi

    # 2. Linux mac80211 iw station deletion fallback
    if command -v iw >/dev/null 2>&1; then
        for _iw_dev in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
            iw dev "$_iw_dev" station del "$_mac" >/dev/null 2>&1
        done
    fi

    # 3. hostapd_cli fallback if available
    if command -v hostapd_cli >/dev/null 2>&1; then
        hostapd_cli deauthenticate "$_mac" >/dev/null 2>&1
    fi
}

case "$METHOD" in
    auth_client)
        # Authentication requested. Exit 0 allows openNDS to proceed.
        exit 0
        ;;

    client_auth)
        # Client successfully authenticated notification
        if command -v logger >/dev/null 2>&1; then
            logger -t "opennds-binauth" "[INFO] Client authenticated: $CLIENT_MAC"
        fi
        CONF="/etc/opennds/sync.conf"
        [ -f "$CONF" ] && . "$CONF"
        _confirm_url="${CONFIRM_URL:-https://wifihandler.vercel.app/api/confirm-auth}"
        if command -v uclient-fetch >/dev/null 2>&1; then
            uclient-fetch -q --timeout=5 \
                --header="x-router-secret: $ROUTER_SECRET_KEY" \
                --header="Content-Type: application/x-www-form-urlencoded" \
                --post-data="mac=$CLIENT_MAC&command=ndsctl+auth+$CLIENT_MAC&status=success" \
                -O - "$_confirm_url" >/dev/null 2>&1 &
        elif command -v curl >/dev/null 2>&1; then
            curl -s -m 5 \
                -H "x-router-secret: $ROUTER_SECRET_KEY" \
                -H "Content-Type: application/x-www-form-urlencoded" \
                -d "mac=$CLIENT_MAC&command=ndsctl+auth+$CLIENT_MAC&status=success" \
                "$_confirm_url" >/dev/null 2>&1 &
        fi
        exit 0
        ;;

    timeout_deauth|idle_deauth|downquota_deauth|upquota_deauth|client_deauth)
        # Session ended / expired. Kick client from Wi-Fi immediately!
        if command -v logger >/dev/null 2>&1; then
            logger -t "opennds-binauth" "[INFO] Session ended ($METHOD) for MAC $CLIENT_MAC - kicking station from Wi-Fi"
        fi
        kick_wifi_client "$CLIENT_MAC"

        # Dispatch background notification to Cloud Bridge
        CONF="/etc/opennds/sync.conf"
        [ -f "$CONF" ] && . "$CONF"
        _deauth_url="${DEAUTH_URL:-https://wifihandler.vercel.app/api/deauth}"
        _start="$5"
        _end="$6"
        [ -z "$_start" ] && _start="0"
        [ -z "$_end" ] && _end="$(date +%s)"

        if command -v uclient-fetch >/dev/null 2>&1; then
            uclient-fetch -q --timeout=5 \
                --header="x-router-secret: $ROUTER_SECRET_KEY" \
                --header="Content-Type: application/json" \
                --post-data="{\"mac\":\"$CLIENT_MAC\",\"reason\":\"$METHOD\",\"session_start\":$_start,\"session_end\":$_end}" \
                -O - "$_deauth_url" >/dev/null 2>&1 &
        elif command -v curl >/dev/null 2>&1; then
            curl -s -m 5 \
                -H "x-router-secret: $ROUTER_SECRET_KEY" \
                -H "Content-Type: application/json" \
                -d "{\"mac\":\"$CLIENT_MAC\",\"reason\":\"$METHOD\",\"session_start\":$_start,\"session_end\":$_end}" \
                "$_deauth_url" >/dev/null 2>&1 &
        fi
        exit 0
        ;;

    *)
        exit 0
        ;;
esac
