#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Common Helpers & Security Module (router/lib/common.sh)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

# Load optional external configuration
CONFIG_FILE="/etc/opennds/sync.conf"
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

# Send standardized HTTP Headers with restricted CORS and Cache-Control
send_header() {
    printf "Content-Type: application/json; charset=utf-8\r\n"
    _origin="$HTTP_ORIGIN"
    case "$_origin" in
        "http://192.168.1.1"*|"https://192.168.1.1"*|"https://wifihandler.vercel.app"*)
            printf "Access-Control-Allow-Origin: %s\r\n" "$_origin"
            printf "Access-Control-Allow-Credentials: true\r\n"
            ;;
        *)
            # Safe default: omit Access-Control-Allow-Origin for untrusted third-party origins
            ;;
    esac
    printf "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    printf "Access-Control-Allow-Headers: Content-Type, X-Router-Session, Authorization\r\n"
    printf "Cache-Control: no-cache, no-store, must-revalidate\r\n\r\n"
}

# Unified success response helper (DRY)
json_ok() {
    send_header
    printf '{"status":"ok","message":"%s"}\n' "$1"
    exit 0
}

# Unified error response helper (DRY)
json_error() {
    send_header
    printf '{"status":"error","message":"%s"}\n' "$1"
    exit 0
}

# Authentication check for mutating and sensitive actions
check_auth() {
    _payload="$1"
    _auth="$HTTP_X_ROUTER_SESSION"
    [ -z "$_auth" ] && _auth=$(printf "%s" "$HTTP_AUTHORIZATION" | sed -e 's/^[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]*//')
    [ -z "$_auth" ] && _auth=$(printf "%s" "$QUERY_STRING" | sed -n 's/.*token=\([^&]*\).*/\1/p')
    [ -z "$_auth" ] && [ -n "$_payload" ] && _auth=$(extract_param "token" "$_payload")

    _matched=0
    if [ -n "$_auth" ]; then
        # 1. Local session token cache check in RAM (/tmp)
        if [ -f "/tmp/archer_sessions/$_auth" ]; then
            _mod=$(date -r "/tmp/archer_sessions/$_auth" +%s 2>/dev/null || echo 0)
            _now=$(date +%s)
            # Token valid for 24 hours (86400 seconds)
            if [ $((_now - _mod)) -lt 86400 ]; then
                _matched=1
            else
                rm -f "/tmp/archer_sessions/$_auth" 2>/dev/null
            fi
        fi

        # 2. OpenWrt ubus session check (rpcd)
        if [ "$_matched" -ne 1 ] && command -v ubus >/dev/null 2>&1; then
            if ubus -t 2 call session list "{\"ubus_rpc_session\":\"$_auth\"}" 2>/dev/null | grep -q "ubus_rpc_session"; then
                _matched=1
            fi
        fi
    fi

    if [ "$_matched" -ne 1 ]; then
        send_header
        printf '{"error":"unauthorized","message":"Invalid or expired session. Please log in with username and password."}\n'
        exit 0
    fi
}

# Session login handler using OpenWrt ubus / shadow verification
handle_login() {
    _u="$1"
    _p="$2"

    [ -z "$_u" ] && _u="root"

    if [ -z "$_p" ]; then
        send_header
        printf '{"status":"error","message":"Password cannot be empty"}\n'
        exit 0
    fi

    _tok=""

    # Attempt 1: OpenWrt ubus session login (standard LuCI rpcd)
    if command -v ubus >/dev/null 2>&1; then
        _u_out=$(ubus -t 3 call session login "{\"username\":\"$_u\",\"password\":\"$_p\"}" 2>/dev/null)
        _tok=$(printf "%s" "$_u_out" | sed -n 's/.*"ubus_rpc_session"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    fi

    # Attempt 2: Verify /etc/shadow directly using Lua nixio (standard on OpenWrt with LuCI)
    if [ -z "$_tok" ] && command -v lua >/dev/null 2>&1 && [ -f /etc/shadow ]; then
        _valid=$(lua -e '
            local u = [=['"$_u"']=]
            local p = [=['"$_p"']=]
            local f = io.open("/etc/shadow", "r")
            if not f then os.exit(1) end
            local c = f:read("*a")
            f:close()
            local h = c:match(u .. ":([^:]+)")
            if h and require("nixio").crypt(p, h) == h then
                print("yes")
            else
                os.exit(1)
            end
        ' 2>/dev/null)
        if [ "$_valid" = "yes" ]; then
            _tok=$(head -c 16 /dev/urandom 2>/dev/null | hexdump -e '16/1 "%02x"' 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-')
        fi
    fi

    if [ -n "$_tok" ]; then
        mkdir -p /tmp/archer_sessions
        touch "/tmp/archer_sessions/$_tok"
        send_header
        printf '{"status":"ok","token":"%s","username":"%s","expires":86400}\n' "$_tok" "$_u"
        exit 0
    else
        send_header
        printf '{"status":"error","message":"Invalid username or password"}\n'
        exit 0
    fi
}

# Extract key from JSON payload or query string (DRY parameter extractor)
extract_param() {
    _key="$1"
    _payload="$2"
    _val=""
    if [ -n "$_payload" ]; then
        _val=$(printf "%s" "$_payload" | sed -n "s/.*\"$_key\"[ ]*:[ ]*\"\([^\"]*\)\".*/\1/p")
        if [ -z "$_val" ]; then
            _val=$(printf "%s" "$_payload" | sed -n "s/.*\"$_key\"[ ]*:[ ]*\([0-9a-zA-Z._-]*\).*/\1/p")
        fi
    fi
    if [ -z "$_val" ]; then
        _val=$(printf "%s" "$QUERY_STRING" | sed -n "s/.*$_key=\([^&]*\).*/\1/p")
    fi
    printf "%s" "$_val"
}
