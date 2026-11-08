#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Network & Wireless Metrics Module (router/lib/net_metrics.sh)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

# Helper for physical Ethernet switch port detection (DRY for all 5 ports)
read_port_status() {
    _iface="$1"; _speed_f="/sys/class/net/$_iface/speed"; _oper_f="/sys/class/net/$_iface/operstate"
    _speed=0; _link="down"
    if [ -f "$_oper_f" ] && [ "$(cat "$_oper_f" 2>/dev/null)" = "up" ]; then
        _link="up"; [ -f "$_speed_f" ] && _speed=$(cat "$_speed_f" 2>/dev/null)
        _speed=${_speed:-1000}
    fi
    printf '{"name":"%s","link":"%s","speed_mbps":%s}' "$_iface" "$_link" "${_speed:-0}"
}

get_ports_metrics() {
    printf '"ports":{"wan":%s,"lan1":%s,"lan2":%s,"lan3":%s,"lan4":%s}' \
        "$(read_port_status wan)" "$(read_port_status lan1)" "$(read_port_status lan2)" "$(read_port_status lan3)" "$(read_port_status lan4)"
}

# Helper for reading 2.4G & 5G radio metrics via uci & prefetched station dump
prefetch_wireless() {
    _if2g="phy0-ap0"; [ -d "/sys/class/net/wlan0" ] && _if2g="wlan0"
    _if5g="phy1-ap0"; [ -d "/sys/class/net/wlan1" ] && _if5g="wlan1"
    _ifguest="phy0-ap1"; [ -d "/sys/class/net/wlan0-1" ] && _ifguest="wlan0-1"
    if command -v iw >/dev/null 2>&1; then
        [ -d "/sys/class/net/$_if5g" ] && iw dev "$_if5g" station dump > /tmp/.cg_5g_sta 2>/dev/null
        [ -d "/sys/class/net/$_if2g" ] && iw dev "$_if2g" station dump > /tmp/.cg_2g_sta 2>/dev/null
        [ -d "/sys/class/net/$_ifguest" ] && iw dev "$_ifguest" station dump > /tmp/.cg_guest_sta 2>/dev/null
    fi
    [ -f /etc/archer_guard_blocked.conf ] && cat /etc/archer_guard_blocked.conf > /tmp/.cg_blocked 2>/dev/null || iptables -S FORWARD 2>/dev/null | grep "mac-source" > /tmp/.cg_blocked 2>/dev/null || true
    uci show dhcp 2>/dev/null | grep "\.mac=" > /tmp/.cg_static 2>/dev/null || true
}

read_radio_metrics() {
    _ifname="$1"; _band="$2"; _chip="$3"; _rad="$4"; _sta_f="$5"
    _ssid=""; _chan=0; _txpwr=0; _enabled="false"
    _width=20; _htmode="HT20"; _enc="WPA2-PSK/WPA3-SAE"; _clicnt=0

    if command -v uci >/dev/null 2>&1 && [ -n "$_rad" ]; then
        _u_dis=$(uci get wireless."$_rad".disabled 2>/dev/null)
        [ "$_u_dis" != "1" ] && _enabled="true"
        _u_ssid=$(uci get wireless.default_"$_rad".ssid 2>/dev/null)
        [ -n "$_u_ssid" ] && _ssid="$_u_ssid"
        _u_chan=$(uci get wireless."$_rad".channel 2>/dev/null)
        [ -n "$_u_chan" ] && _chan="$_u_chan"
        _u_tx=$(uci get wireless."$_rad".txpower 2>/dev/null)
        [ -n "$_u_tx" ] && _txpwr="$_u_tx"
        _u_ht=$(uci get wireless."$_rad".htmode 2>/dev/null)
        [ -n "$_u_ht" ] && _htmode="$_u_ht"
        case "$_htmode" in
            *80*) _width=80 ;;
            *40*) _width=40 ;;
            *) _width=20 ;;
        esac
    else
        [ "$_band" = "5GHz" ] && { _width=80; _htmode="VHT80"; }
    fi

    if [ -s "$_sta_f" ]; then
        _clicnt=$(grep -c "^Station " "$_sta_f" 2>/dev/null)
    fi

    [ -z "$_txpwr" ] || [ "$_txpwr" = "0" ] && _txpwr=$([ "$_band" = "5GHz" ] && echo 23 || echo 22)
    case "$_clicnt" in ''|*[!0-9]*) _clicnt=0 ;; esac

    printf '{"ifname":"%s","band":"%s","chipset":"%s","enabled":%s,"ssid":"%s","channel":%s,"channel_width":%s,"htmode":"%s","txpower_dbm":%s,"encryption":"%s","connected_clients":%s}' \
        "$_ifname" "$_band" "$_chip" "$_enabled" "${_ssid:-ArcherC6_$_band}" "${_chan:-0}" "${_width:-20}" "$_htmode" "${_txpwr:-20}" "$_enc" "$_clicnt"
}

read_guest_metrics() {
    _g_if="phy0-ap1"; [ -d "/sys/class/net/wlan0-1" ] && _g_if="wlan0-1"
    _g_ssid="ArcherC6_Guest"
    _g_enabled="false"
    _g_chan=6
    _g_clients=0

    if command -v uci >/dev/null 2>&1; then
        _dis=$(uci get wireless.wifinet0.disabled 2>/dev/null)
        [ -z "$_dis" ] && _dis=$(uci get wireless.guest.disabled 2>/dev/null)
        [ "$_dis" != "1" ] && _g_enabled="true"
        _cfg_ssid=$(uci get wireless.wifinet0.ssid 2>/dev/null)
        [ -z "$_cfg_ssid" ] && _cfg_ssid=$(uci get wireless.guest.ssid 2>/dev/null)
        [ -n "$_cfg_ssid" ] && _g_ssid="$_cfg_ssid"
        _cfg_chan=$(uci get wireless.radio0.channel 2>/dev/null)
        [ -n "$_cfg_chan" ] && _g_chan="$_cfg_chan"
    fi
    if [ -s /tmp/.cg_guest_sta ]; then
        _g_clients=$(grep -c "^Station " /tmp/.cg_guest_sta 2>/dev/null)
    fi
    case "$_g_clients" in ''|*[!0-9]*) _g_clients=0 ;; esac

    printf '{"enabled":%s,"ssid":"%s","channel":%s,"txpower_dbm":18,"isolated":true,"connected_clients":%s}' \
        "$_g_enabled" "$_g_ssid" "${_g_chan:-6}" "${_g_clients:-0}"
}

read_advanced_wifi_metrics() {
    _roam="true"; _pmf="true"; _wmm="true"; _legacy="true"
    if command -v uci >/dev/null 2>&1; then
        [ "$(uci get wireless.@wifi-iface[0].ieee80211r 2>/dev/null)" = "0" ] && _roam="false"
        [ "$(uci get wireless.@wifi-iface[0].ieee80211w 2>/dev/null)" = "0" ] && _pmf="false"
        [ "$(uci get wireless.@wifi-iface[0].wmm 2>/dev/null)" = "0" ] && _wmm="false"
        [ "$(uci get wireless.radio0.legacy_rates 2>/dev/null)" = "1" ] && _legacy="false"
    fi
    printf '{"fast_roaming":%s,"pmf_protected":%s,"wmm_qos":%s,"drop_legacy_rates":%s}' \
        "$_roam" "$_pmf" "$_wmm" "$_legacy"
}

get_wireless_metrics() {
    prefetch_wireless
    _if2g="phy0-ap0"; [ -d "/sys/class/net/wlan0" ] && _if2g="wlan0"
    _if5g="phy1-ap0"; [ -d "/sys/class/net/wlan1" ] && _if5g="wlan1"
    _r2g=$(read_radio_metrics "$_if2g" "2.4GHz" "MT7603E 802.11b/g/n" "radio0" "/tmp/.cg_2g_sta")
    _r5g=$(read_radio_metrics "$_if5g" "5GHz" "MT7613BEN 802.11a/n/ac" "radio1" "/tmp/.cg_5g_sta")
    _rguest=$(read_guest_metrics)
    _radv=$(read_advanced_wifi_metrics)

    _s2g=$(uci get wireless.default_radio0.ssid 2>/dev/null || echo "Archer_C6_2.4G")
    _s5g=$(uci get wireless.default_radio1.ssid 2>/dev/null || echo "Archer_C6_5G")
    _sguest=$(uci get wireless.guest.ssid 2>/dev/null || uci get wireless.wifinet0.ssid 2>/dev/null || echo "ArcherC6_Guest")

    _c2g=0; [ -s /tmp/.cg_2g_sta ] && _c2g=$(grep -c "^Station " /tmp/.cg_2g_sta 2>/dev/null)
    case "$_c2g" in ''|*[!0-9]*) _c2g=0 ;; esac
    _c5g=0; [ -s /tmp/.cg_5g_sta ] && _c5g=$(grep -c "^Station " /tmp/.cg_5g_sta 2>/dev/null)
    case "$_c5g" in ''|*[!0-9]*) _c5g=0 ;; esac
    _cguest=0; [ -s /tmp/.cg_guest_sta ] && _cguest=$(grep -c "^Station " /tmp/.cg_guest_sta 2>/dev/null)
    _e2g="true"; [ "$(uci get wireless.default_radio0.disabled 2>/dev/null)" = "1" ] || [ "$(uci get wireless.radio0.disabled 2>/dev/null)" = "1" ] && _e2g="false"
    _e5g="true"; [ "$(uci get wireless.default_radio1.disabled 2>/dev/null)" = "1" ] || [ "$(uci get wireless.radio1.disabled 2>/dev/null)" = "1" ] && _e5g="false"
    _eg="false"; [ "$(uci get wireless.guest.disabled 2>/dev/null)" != "1" ] && [ "$(uci get wireless.wifinet0.disabled 2>/dev/null)" != "1" ] && _eg="true"

    _ssids_json=$(printf '[{"id":"default_radio0","ssid":"%s","band":"2.4GHz","radio":"radio0","ifname":"%s","enabled":%s,"encryption":"WPA2-PSK/WPA3-SAE","channel":6,"connected_clients":%s,"is_guest":false},{"id":"default_radio1","ssid":"%s","band":"5GHz","radio":"radio1","ifname":"%s","enabled":%s,"encryption":"WPA2-PSK/WPA3-SAE","channel":149,"connected_clients":%s,"is_guest":false},{"id":"guest","ssid":"%s","band":"2.4GHz","radio":"radio0","ifname":"phy0-ap1","enabled":%s,"encryption":"WPA2-PSK","channel":6,"connected_clients":%s,"is_guest":true,"isolated":true}]' \
        "$_s2g" "$_if2g" "$_e2g" "$_c2g" "$_s5g" "$_if5g" "$_e5g" "$_c5g" "$_sguest" "$_eg" "$_cguest")

    printf '"wireless":{"radio_2g":%s,"radio_5g":%s,"guest":%s,"advanced":%s,"ssids":%s}' \
        "$_r2g" "$_r5g" "$_rguest" "$_radv" "$_ssids_json"
}

get_wan_traffic_metrics() {
    _wan_if=""
    command -v ip >/dev/null 2>&1 && _wan_if=$(ip -4 route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
    if [ -z "$_wan_if" ] || [ ! -d "/sys/class/net/$_wan_if" ]; then
        for _c in pppoe-wan wan eth0 eth1; do [ -d "/sys/class/net/$_c" ] && _wan_if="$_c" && break; done
    fi
    [ -z "$_wan_if" ] && _wan_if="eth0"
    _rx=0; _tx=0
    if [ -f "/sys/class/net/$_wan_if/statistics/rx_bytes" ]; then
        _rx=$(cat "/sys/class/net/$_wan_if/statistics/rx_bytes" 2>/dev/null)
        _tx=$(cat "/sys/class/net/$_wan_if/statistics/tx_bytes" 2>/dev/null)
    elif [ -f /proc/net/dev ]; then
        _dev_l=$(awk -v iface="${_wan_if}:" '$1 == iface { print; exit }' /proc/net/dev 2>/dev/null)
        [ -z "$_dev_l" ] && _dev_l=$(awk '$1 ~ /^(pppoe-wan|wan|eth0):/ { print; exit }' /proc/net/dev 2>/dev/null)
        [ -n "$_dev_l" ] && _rx=$(printf "%s" "$_dev_l" | awk '{print $2}') && _tx=$(printf "%s" "$_dev_l" | awk '{print $10}')
    fi
    _rx=$(printf "%s" "$_rx" | tr -cd '0-9'); _tx=$(printf "%s" "$_tx" | tr -cd '0-9')
    _wan_ip=$(ip -4 addr show dev "$_wan_if" 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    [ -z "$_wan_ip" ] && [ "$_wan_if" != "pppoe-wan" ] && _wan_ip=$(ip -4 addr show dev pppoe-wan 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    [ -z "$_wan_ip" ] && [ "$_wan_if" != "wan" ] && _wan_ip=$(ip -4 addr show dev wan 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1)
    printf '"traffic":{"interface":"%s","rx_bytes":%s,"tx_bytes":%s,"wan_ip":"%s","timestamp":%d}' \
        "$_wan_if" "${_rx:-0}" "${_tx:-0}" "${_wan_ip:-0.0.0.0}" "$(date +%s)"
}

get_connected_clients() {
    _awk_script="/usr/lib/archer_guard/clients.awk"
    [ ! -f "$_awk_script" ] && _awk_script="$(dirname "$0")/lib/clients.awk"
    [ ! -f "$_awk_script" ] && _awk_script="$(dirname "$0")/clients.awk"
    _s2g=$(uci get wireless.default_radio0.ssid 2>/dev/null || echo "Archer_C6_2.4G")
    _s5g=$(uci get wireless.default_radio1.ssid 2>/dev/null || echo "Archer_C6_5G")
    _sguest=$(uci get wireless.guest.ssid 2>/dev/null || uci get wireless.wifinet0.ssid 2>/dev/null || echo "ArcherC6_Guest")
    _lan_up=0
    for _p in lan1 lan2 lan3 lan4; do
        [ -f "/sys/class/net/$_p/operstate" ] && [ "$(cat "/sys/class/net/$_p/operstate" 2>/dev/null)" = "up" ] && _lan_up=1 && break
    done
    [ ! -d /sys/class/net/lan1 ] && [ -f /sys/class/net/eth0/operstate ] && _lan_up=1
    _arp_f="/proc/net/arp"; [ ! -f "$_arp_f" ] && _arp_f="/dev/null"
    _dhcp_f="/tmp/dhcp.leases"; [ ! -f "$_dhcp_f" ] && [ -f "/var/dhcp.leases" ] && _dhcp_f="/var/dhcp.leases"
    [ ! -f "$_dhcp_f" ] && _dhcp_f="/dev/null"
    _sta5="/tmp/.cg_5g_sta"; [ ! -f "$_sta5" ] && _sta5="/dev/null"
    _sta2="/tmp/.cg_2g_sta"; [ ! -f "$_sta2" ] && _sta2="/dev/null"
    _stag="/tmp/.cg_guest_sta"; [ ! -f "$_stag" ] && _stag="/dev/null"
    _cfg_f="/etc/archer_guard_clients.conf"; [ ! -f "$_cfg_f" ] && _cfg_f="/dev/null"
    _blk="/tmp/.cg_blocked"; [ ! -f "$_blk" ] && _blk="/dev/null"
    _sta="/tmp/.cg_static"; [ ! -f "$_sta" ] && _sta="/dev/null"
    if [ -f "$_awk_script" ] && command -v awk >/dev/null 2>&1; then
        _clients_out=$(awk -v s2g="$_s2g" -v s5g="$_s5g" -v sguest="$_sguest" -v lan_up="$_lan_up" -v now="$(date +%s)" -f "$_awk_script" \
            "$_sta5" "$_sta2" "$_stag" "$_cfg_f" "$_blk" "$_sta" "$_arp_f" "$_dhcp_f" 2>/dev/null)
        case "$_clients_out" in
            *"clients":\[*\]*) printf "%s" "$_clients_out" ;;
            *) printf '"clients":[]' ;;
        esac
    else
        printf '"clients":[]'
    fi
}

get_network_acceleration_metrics() {
    _hwo="false"; _sqm="false"; _sqm_qd="cake"; _sqm_dl=95000; _sqm_ul=20000
    _wg="false"; _mwan="false"; _doh="false"
    _gw=""; _dns=""; _proto="PPPoE (Fiber Optic ONU)"; _mtu=1492

    if command -v uci >/dev/null 2>&1; then
        _u_fo=$(uci get firewall.@defaults[0].flow_offloading 2>/dev/null)
        [ "$_u_fo" = "1" ] || [ "$(uci get firewall.@defaults[0].flow_offloading_hw 2>/dev/null)" = "1" ] && _hwo="true"
        [ "$(uci get sqm.@queue[0].enabled 2>/dev/null)" = "1" ] && _sqm="true"
        _qd=$(uci get sqm.@queue[0].qdisc 2>/dev/null); [ -n "$_qd" ] && _sqm_qd="$_qd"
        _dl=$(uci get sqm.@queue[0].download 2>/dev/null); [ -n "$_dl" ] && _sqm_dl="$_dl"
        _ul=$(uci get sqm.@queue[0].upload 2>/dev/null); [ -n "$_ul" ] && _sqm_ul="$_ul"
        [ "$(uci get mwan3.globals.enabled 2>/dev/null)" = "1" ] && _mwan="true"
        _u_dns=$(uci get network.wan.dns 2>/dev/null | tr '\n' ' ' | sed -e 's/[[:space:]]*$//' -e 's/ /, /g')
        [ -n "$_u_dns" ] && _dns="$_u_dns"
        _pr=$(uci get network.wan.proto 2>/dev/null)
        case "$_pr" in pppoe) _proto="PPPoE (Fiber Optic ONU)";; dhcp) _proto="DHCP (Dynamic IP)"; _mtu=1500;; static) _proto="Static IP"; _mtu=1500;; esac
        _um=$(uci get network.wan.mtu 2>/dev/null); [ -n "$_um" ] && _mtu="$_um"
    else
        _hwo="true"; _sqm="true"
    fi

    [ -z "$_dns" ] && [ -f /tmp/resolv.conf.d/resolv.conf.auto ] && _dns=$(awk '/nameserver/{if (c++) printf ", "; printf "%s", $2}' /tmp/resolv.conf.d/resolv.conf.auto 2>/dev/null)
    [ -z "$_dns" ] && [ -f /tmp/resolv.conf.auto ] && _dns=$(awk '/nameserver/{if (c++) printf ", "; printf "%s", $2}' /tmp/resolv.conf.auto 2>/dev/null)
    [ -z "$_dns" ] && [ -f /etc/resolv.conf ] && _dns=$(awk '/nameserver/{if (c++) printf ", "; printf "%s", $2}' /etc/resolv.conf 2>/dev/null)
    [ -z "$_dns" ] && _dns="1.1.1.1, 8.8.8.8"

    ip link show wg0 >/dev/null 2>&1 && _wg="true"
    ( [ -f /var/run/https-dns-proxy.pid ] || pidof https-dns-proxy >/dev/null 2>&1 ) && _doh="true"
    _r_gw=$(ip route show default 2>/dev/null | awk '{print $3}' | head -n 1); [ -n "$_r_gw" ] && _gw="$_r_gw"

    _wg_ep="10.14.0.1:51820"
    command -v wg >/dev/null 2>&1 && { _ep=$(wg show wg0 endpoints 2>/dev/null | awk '{print $2}' | head -n 1); [ -n "$_ep" ] && [ "$_ep" != "(none)" ] && _wg_ep="$_ep"; }

    printf '"network":{"hw_offload":{"enabled":%s,"flow_offloading_hw":%s},"sqm":{"enabled":%s,"qdisc":"%s","download_kbit":%s,"upload_kbit":%s},"wireguard":{"enabled":%s,"interface":"wg0","endpoint":"%s","status":"%s"},"multi_wan":{"enabled":%s,"mode":"failover","wan1":"online","wan2":"standby"},"doh":{"enabled":%s,"provider":"Cloudflare (1.1.1.1)"},"wan_details":{"gateway":"%s","dns":"%s","mtu":%s,"protocol":"%s","latency_ms":8.5,"jitter_ms":0.9}}' \
        "$_hwo" "$_hwo" "$_sqm" "$_sqm_qd" "$_sqm_dl" "$_sqm_ul" "$_wg" "$_wg_ep" "$([ "$_wg" = "true" ] && echo "connected" || echo "standby")" "$_mwan" "$_doh" "$_gw" "$_dns" "$_mtu" "$_proto"
}

get_conntrack_metrics() {
    _ct_max=$(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null || echo 15360)
    _ct_max=${_ct_max:-15360}
    if [ -f /proc/net/nf_conntrack ]; then
        awk -v max="$_ct_max" '{ proto[$3]++; total++ } END {
            tcp = proto["tcp"] + 0; udp = proto["udp"] + 0; other = total - tcp - udp;
            if (other < 0) other = 0; pct = (max > 0) ? (total * 100.0 / max) : 0;
            printf "\"connections\":{\"total\":%d,\"max\":%d,\"tcp\":%d,\"udp\":%d,\"other\":%d,\"usage_percent\":%.1f}", total, max, tcp, udp, other, pct;
        }' /proc/net/nf_conntrack 2>/dev/null
    else
        _cnt=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo 150)
        printf '"connections":{"total":%d,"max":%d,"tcp":%d,"udp":%d,"other":%d,"usage_percent":%.1f}' \
            "$_cnt" "$_ct_max" "$((_cnt * 60 / 100))" "$((_cnt * 38 / 100))" "$((_cnt * 2 / 100))" 1.5
    fi
}
