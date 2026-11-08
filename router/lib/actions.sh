#!/bin/sh
# ==============================================================================
# ArcherGuard C6 — Hardware & Service Control Actions Module (router/lib/actions.sh)
# Max lines: < 250 (DRY Principle Enforced)
# ==============================================================================

apply_client_rate_limits() {
    _cfg="/etc/archer_guard_clients.conf"; [ ! -f "$_cfg" ] || ! command -v nft >/dev/null 2>&1 && return
    _rules=0
    while IFS='|' read -r _m _name _dl _ul || [ -n "$_m" ]; do
        [ "$(( ${_dl:-0} / 8 ))" -gt 0 ] || [ "$(( ${_ul:-0} / 8 ))" -gt 0 ] && _rules=$((_rules + 1))
    done < "$_cfg"
    if [ "$_rules" -gt 0 ]; then
        nft 'add table inet archer_rate' 2>/dev/null; nft 'add chain inet archer_rate forward { type filter hook forward priority -5; policy accept; }' 2>/dev/null; nft 'flush chain inet archer_rate forward' 2>/dev/null
        while IFS='|' read -r _m _name _dl _ul || [ -n "$_m" ]; do
            _dl_k=$(( ${_dl:-0} / 8 )); _ul_k=$(( ${_ul:-0} / 8 ))
            [ "$_dl_k" -gt 0 ] && nft "add rule inet archer_rate forward ether daddr $_m limit rate over ${_dl_k} kbytes/second drop" 2>/dev/null
            [ "$_ul_k" -gt 0 ] && nft "add rule inet archer_rate forward ether saddr $_m limit rate over ${_ul_k} kbytes/second drop" 2>/dev/null
        done < "$_cfg"
    else nft 'delete table inet archer_rate' 2>/dev/null; fi
}

execute_control() {
    _payload=""
    [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] && read -n "$CONTENT_LENGTH" _payload
    check_auth "$_payload"
    _cmd=$(extract_param "command" "$_payload"); [ -z "$_cmd" ] && _cmd=$(extract_param "cmd" "$_payload")
    _target=$(extract_param "target" "$_payload"); [ -z "$_target" ] && _target=$(extract_param "mac" "$_payload")
    _val=$(extract_param "value" "$_payload"); [ -z "$_val" ] && _val=$(extract_param "val" "$_payload"); [ -z "$_val" ] && _val=$(extract_param "minutes" "$_payload")
    _status="success"; _msg=""

    case "$_cmd" in
        "reboot")
            _msg="Router is rebooting now..."; ( sleep 1; reboot ) >/dev/null 2>&1 & ;;
        "wifi_toggle")
            _radio="${_target:-radio0}"; _state="${_val:-toggle}"; [ "$_state" = "off" ] && uci set wireless."$_radio".disabled='1' || uci set wireless."$_radio".disabled='0'
            uci commit wireless && wifi reload >/dev/null 2>&1 & _msg="WiFi $_radio state updated to $_state" ;;
        "led_stealth")
            _b="$([ "$_val" = "on" ] && echo 1 || echo 0)"; for _l in /sys/class/leds/*; do [ -d "$_l" ] && echo "$_b" > "$_l/brightness" 2>/dev/null; done; _msg="LED stealth mode set to ${_val:-off}" ;;
        "block_client"|"unblock_client")
            if [ -n "$_target" ]; then
                case "$_target" in
                    [0-9a-fA-F][0-9a-fA-F]:[0-9a-fA-F][0-9a-fA-F]:[0-9a-fA-F][0-9a-fA-F]:[0-9a-fA-F][0-9a-fA-F]:[0-9a-fA-F][0-9a-fA-F]:[0-9a-fA-F][0-9a-fA-F])
                        _sec="blk_$(echo "$_target" | tr -d ':')"; _tm=$(echo "$_target" | tr '[:upper:]' '[:lower:]'); _bf="/etc/archer_guard_blocked.conf"; touch "$_bf"
                        if [ "$_cmd" = "block_client" ]; then
                            uci set firewall."$_sec"=rule; uci set firewall."$_sec".name="block_$_sec"; uci set firewall."$_sec".src="lan"; uci set firewall."$_sec".dest="wan"; uci set firewall."$_sec".src_mac="$_target"; uci set firewall."$_sec".target="DROP"
                            grep -qi "^$_tm$" "$_bf" 2>/dev/null || echo "$_tm" >> "$_bf"; command -v ndsctl >/dev/null 2>&1 && { ndsctl deauth "$_target" >/dev/null 2>&1; ndsctl block "$_target" >/dev/null 2>&1; }
                            for _h in /var/run/hostapd-phy* /var/run/hostapd/wlan* /var/run/hostapd/phy*; do [ -e "$_h" ] && hostapd_cli -p "$_h" deauthenticate "$_target" 2>/dev/null; done; if command -v ubus >/dev/null 2>&1; then for _if in $(ubus list hostapd.* 2>/dev/null); do ubus call "$_if" del_client "{\"addr\":\"$_target\",\"reason\":1,\"deauth\":true}" 2>/dev/null; done; fi
                            command -v conntrack >/dev/null 2>&1 && conntrack -D -s "$_target" 2>/dev/null; echo f > /proc/net/nf_conntrack 2>/dev/null || true
                        else
                            uci delete firewall."$_sec" 2>/dev/null; sed -i "/^$_tm$/d" "$_bf" 2>/dev/null; command -v ndsctl >/dev/null 2>&1 && ndsctl unblock "$_target" >/dev/null 2>&1
                        fi
                        uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1 &
                        if command -v nft >/dev/null 2>&1; then nft 'add table inet archer_block' 2>/dev/null; nft 'add chain inet archer_block forward { type filter hook forward priority -10; policy accept; }' 2>/dev/null; nft 'flush chain inet archer_block forward' 2>/dev/null; while read -r _bm || [ -n "$_bm" ]; do [ -n "$_bm" ] && nft "add rule inet archer_block forward ether saddr $_bm drop" 2>/dev/null; done < "$_bf"; fi
                        _op="$([ "$_cmd" = "block_client" ] && echo "-I FORWARD 1" || echo "-D FORWARD")"; iptables $_op -m mac --mac-source "$_target" -j DROP 2>/dev/null; _msg="Client $_target $([ "$_cmd" = "block_client" ] && echo 'blocked' || echo 'unblocked')" ;;
                    *) _status="error"; _msg="Invalid target MAC address format" ;;
                esac
            else _status="error"; _msg="Target MAC required"; fi ;;
        "nds_auth"|"nds_deauth"|"deauth")
            if command -v ndsctl >/dev/null 2>&1 && [ -n "$_target" ]; then
                [ "$_cmd" = "nds_auth" ] && ndsctl auth "$_target" "${_val:-120}" >/dev/null 2>&1 || ndsctl deauth "$_target" >/dev/null 2>&1
                _msg="openNDS $_cmd executed for $_target"
            else _status="error"; _msg="openNDS not active or invalid MAC"; fi ;;
        "kick_client"|"disconnect_client")
            if [ -n "$_target" ]; then
                for _h in /var/run/hostapd-phy* /var/run/hostapd/wlan* /var/run/hostapd/phy*; do [ -e "$_h" ] && hostapd_cli -p "$_h" deauthenticate "$_target" 2>/dev/null; done
                if command -v ubus >/dev/null 2>&1; then for _if in $(ubus list hostapd.* 2>/dev/null); do ubus call "$_if" del_client "{\"addr\":\"$_target\",\"reason\":1,\"deauth\":true}" 2>/dev/null; done; fi
                command -v ndsctl >/dev/null 2>&1 && ndsctl deauth "$_target" 2>/dev/null; _msg="Client $_target disconnected"
            else _status="error"; _msg="Target MAC required"; fi ;;
        "set_static_lease"|"del_static_lease")
            if [ -n "$_target" ]; then
                _sec="host_$(echo "$_target" | tr -d ':')"
                if [ "$_cmd" = "set_static_lease" ] && [ -n "$_val" ]; then
                    uci set dhcp."$_sec"="host"; uci set dhcp."$_sec".mac="$_target"; uci set dhcp."$_sec".ip="$_val"
                    _hname=$(extract_param "extra" "$_payload"); [ -z "$_hname" ] && _hname=$(extract_param "hostname" "$_payload")
                    if [ -n "$_hname" ]; then
                        _safe_host=$(printf "%s" "$_hname" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//' | cut -c1-30)
                        [ -n "$_safe_host" ] && uci set dhcp."$_sec".name="$_safe_host"
                    fi
                    _msg="Static lease for $_target reserved as $_val"
                else
                    uci delete dhcp."$_sec" 2>/dev/null; _msg="Static lease for $_target removed"
                fi
                uci commit dhcp
                if command -v dnsmasq >/dev/null 2>&1 && ! dnsmasq --test >/dev/null 2>&1; then
                    uci revert dhcp; _status="error"; _msg="dnsmasq syntax check failed; reverted dhcp config"
                else /etc/init.d/dnsmasq reload >/dev/null 2>&1 & fi
            else _status="error"; _msg="Target MAC required"; fi ;;
        "rename_client")
            if [ -n "$_target" ]; then
                _target_m=$(echo "$_target" | tr '[:upper:]' '[:lower:]')
                _cfg="/etc/archer_guard_clients.conf"; touch "$_cfg"
                _prev_dl=0; _prev_ul=0
                _match=$(grep -i "^$_target_m|" "$_cfg" 2>/dev/null)
                if [ -n "$_match" ]; then
                    _prev_dl=$(echo "$_match" | cut -d'|' -f3); _prev_ul=$(echo "$_match" | cut -d'|' -f4)
                    sed -i "/^$_target_m|/d" "$_cfg"
                fi
                _clean_val=$(printf "%s" "$_val" | tr '|' ' ' | tr '\n' ' ' | head -c 64)
                echo "$_target_m|$_clean_val|${_prev_dl:-0}|${_prev_ul:-0}" >> "$_cfg"
                _msg="Client $_target renamed to $_val"
            else _status="error"; _msg="Target MAC required"; fi ;;
        "set_speed_limit")
            if [ -n "$_target" ]; then
                _target_m=$(echo "$_target" | tr '[:upper:]' '[:lower:]')
                _cfg="/etc/archer_guard_clients.conf"; touch "$_cfg"
                _dl=$(extract_param "download_limit_kbps" "$_payload"); [ -z "$_dl" ] && _dl="${_val:-0}"
                _ul=$(extract_param "upload_limit_kbps" "$_payload"); [ -z "$_ul" ] && _ul="0"
                _clear=$(extract_param "clear" "$_payload")
                [ "$_val" = "unlimited" ] || [ "$_dl" = "unlimited" ] && _clear="true"
                _prev_name=""
                _match=$(grep -i "^$_target_m|" "$_cfg" 2>/dev/null)
                [ -n "$_match" ] && { _prev_name=$(echo "$_match" | cut -d'|' -f2); sed -i "/^$_target_m|/d" "$_cfg"; }
                if [ "$_clear" = "true" ] || [ "$_dl" = "0" ] || [ -z "$_dl" ]; then
                    [ -n "$_prev_name" ] && echo "$_target_m|$_prev_name|0|0" >> "$_cfg"
                else echo "$_target_m|$_prev_name|$_dl|${_ul:-0}" >> "$_cfg"; fi
                apply_client_rate_limits; _msg="Speed limit for $_target updated"
            else _status="error"; _msg="Target MAC required"; fi ;;
        "drop_caches")
            echo 3 > /proc/sys/vm/drop_caches 2>/dev/null; _msg="Kernel RAM caches cleared" ;;
        "wol")
            if command -v etherwake >/dev/null 2>&1 && [ -n "$_target" ]; then
                etherwake -i br-lan "$_target" 2>/dev/null; _msg="Magic packet dispatched to $_target"
            else _status="error"; _msg="etherwake unavailable or invalid MAC"; fi ;;
        "set_txpower")
            _radio="${_target:-radio0}"; _dbm="${_val:-20}"
            uci set wireless."$_radio".txpower="$_dbm" && uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="TX Power for $_radio set to $_dbm dBm" ;;
        "set_wifi_channel")
            _radio="${_target:-radio0}"; _chan="${_val:-6}"
            uci set wireless."$_radio".channel="$_chan" && uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="Channel for $_radio set to $_chan" ;;
        "set_wifi_htmode")
            _radio="${_target:-radio0}"; _htmode="${_val:-HT20}"
            uci set wireless."$_radio".htmode="$_htmode" && uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="Channel width for $_radio set to $_htmode" ;;
        "set_wifi_ssid")
            _radio="${_target:-default_radio0}"; _ssid="$_val"
            _key=$(extract_param "key" "$_payload"); _hid=$(extract_param "hidden" "$_payload")
            uci set wireless."$_radio".ssid="$_ssid"
            [ -n "$_key" ] && uci set wireless."$_radio".key="$_key"
            [ -n "$_hid" ] && uci set wireless."$_radio".hidden="$_hid"
            uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="SSID for $_radio updated" ;;
        "add_wifi_ssid")
            _ssid="$_val"; _rad="${_target:-radio0}"; _key=$(extract_param "key" "$_payload")
            _enc=$(extract_param "encryption" "$_payload"); _iso=$(extract_param "isolate" "$_payload")
            _sec="ap_$(echo "$_ssid" | tr -cd 'a-zA-Z0-9_' | head -c 10)"
            uci set wireless."$_sec"=wifi-iface; uci set wireless."$_sec".device="$_rad"; uci set wireless."$_sec".mode="ap"
            uci set wireless."$_sec".network="lan"; uci set wireless."$_sec".ssid="$_ssid"; uci set wireless."$_sec".encryption="${_enc:-psk2}"
            [ -n "$_key" ] && uci set wireless."$_sec".key="$_key"
            [ "$_iso" = "1" ] && uci set wireless."$_sec".isolate="1"
            uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="New SSID $_ssid added on $_rad" ;;
        "del_wifi_ssid")
            if [ -n "$_target" ]; then
                uci delete wireless."$_target" 2>/dev/null && uci commit wireless && wifi reload >/dev/null 2>&1 &
                _msg="SSID $_target deleted"
            else _status="error"; _msg="Target SSID interface required"; fi ;;
        "toggle_wifi_ssid")
            _sec="${_target:-default_radio0}"; _dis="$([ "$_val" = "off" ] && echo 1 || echo 0)"
            uci set wireless."$_sec".disabled="$_dis" && uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="SSID $_sec set to $_val" ;;
        "guest_wifi_toggle")
            _state="${_val:-toggle}"; [ "$_state" = "on" ] || [ "$_state" = "1" ] && _dis="0" || _dis="1"
            uci set wireless.guest.disabled="$_dis" && uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="Guest Wi-Fi set to $_state" ;;
        "set_wifi_advanced")
            _opt="${_target:-roaming}"; _state="$([ "$_val" = "off" ] || [ "$_val" = "0" ] && echo 0 || echo 1)"
            [ "$_opt" = "roaming" ] && { uci set wireless.default_radio0.ieee80211r="$_state"; uci set wireless.default_radio1.ieee80211r="$_state"; }
            [ "$_opt" = "pmf" ] && { uci set wireless.default_radio0.ieee80211w="$_state"; uci set wireless.default_radio1.ieee80211w="$_state"; }
            [ "$_opt" = "wmm" ] && { uci set wireless.default_radio0.wmm="$_state"; uci set wireless.default_radio1.wmm="$_state"; }
            [ "$_opt" = "legacy_rates" ] && { [ "$_state" = "1" ] && uci set wireless.radio0.legacy_rates='0' || uci set wireless.radio0.legacy_rates='1'; }
            uci commit wireless && wifi reload >/dev/null 2>&1 &
            _msg="Advanced RF option $_opt set to $_state" ;;
        "set_hw_offload")
            _s="${_val:-1}"; [ "$_s" = "on" ] || [ "$_s" = "true" ] && _s="1"; [ "$_s" = "off" ] || [ "$_s" = "false" ] && _s="0"
            # ANTI-BRICK: MediaTek MT7621 PPE hardware offload triggers fatal FIFO lockups. Lock to software offload.
            uci set firewall.@defaults[0].flow_offloading="$_s"; uci set firewall.@defaults[0].flow_offloading_hw='0'
            uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1 &
            _msg="Software Flow Offloading set to $_s (HW NAT locked to 0 for stability)" ;;
        "set_sqm"|"set_sqm_limits")
            _s="${_val:-1}"; [ "$_s" = "on" ] || [ "$_s" = "true" ] && _s="1"; [ "$_s" = "off" ] || [ "$_s" = "false" ] && _s="0"
            [ "$_cmd" = "set_sqm" ] && uci set sqm.@queue[0].enabled="$_s"
            _qd=$(extract_param "qdisc" "$_payload"); [ -n "$_qd" ] && uci set sqm.@queue[0].qdisc="$_qd"
            _dl=$(extract_param "download" "$_payload"); [ -n "$_dl" ] && uci set sqm.@queue[0].download="$_dl"
            _ul=$(extract_param "upload" "$_payload"); [ -n "$_ul" ] && uci set sqm.@queue[0].upload="$_ul"
            uci commit sqm && /etc/init.d/sqm restart >/dev/null 2>&1 &
            _msg="CAKE SQM QoS updated" ;;
        "set_wireguard")
            _s="${_val:-on}"; [ "$_s" = "1" ] || [ "$_s" = "true" ] && _s="on"
            [ "$_s" = "on" ] && (ifup wg0 >/dev/null 2>&1 &) || (ifdown wg0 >/dev/null 2>&1 &)
            _msg="WireGuard tunnel set to $_s" ;;
        "set_multiwan")
            _s="${_val:-1}"; [ "$_s" = "on" ] || [ "$_s" = "true" ] && _s="1"; [ "$_s" = "off" ] || [ "$_s" = "false" ] && _s="0"
            uci set mwan3.globals.enabled="$_s" && uci commit mwan3
            [ "$_s" = "1" ] && (/etc/init.d/mwan3 restart >/dev/null 2>&1 &) || (/etc/init.d/mwan3 stop >/dev/null 2>&1 &)
            _msg="Multi-WAN mwan3 set to $_s" ;;
        "set_doh")
            _s="${_val:-1}"; [ "$_s" = "on" ] || [ "$_s" = "true" ] && _s="1"; [ "$_s" = "off" ] || [ "$_s" = "false" ] && _s="0"
            [ "$_s" = "1" ] && (/etc/init.d/https-dns-proxy start >/dev/null 2>&1 &) || (/etc/init.d/https-dns-proxy stop >/dev/null 2>&1 &)
            _msg="DNS-over-HTTPS set to $_s" ;;
        "set_dns")
            _d1=$(extract_param "primary" "$_payload"); [ -z "$_d1" ] && _d1="$_val"
            _d2=$(extract_param "secondary" "$_payload"); [ -z "$_d2" ] && _d2="$_target"
            _v1=$(printf "%s" "$_d1" | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$|^auto$')
            _v2=$(printf "%s" "$_d2" | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$')
            if [ -n "$_v1" ] && [ "$_v1" != "auto" ]; then
                uci set network.wan.peerdns='0'; uci delete network.wan.dns 2>/dev/null; uci add_list network.wan.dns="$_v1"; [ -n "$_v2" ] && uci add_list network.wan.dns="$_v2"; _msg="Custom DNS set to $_v1${_v2:+, $_v2}"
            else uci set network.wan.peerdns='1'; uci delete network.wan.dns 2>/dev/null; _msg="DNS reset to automatic ISP"; fi
            uci get network.lan.ipaddr >/dev/null 2>&1 || uci revert network
            uci commit network && (/etc/init.d/network reload >/dev/null 2>&1 &) ;;
        "raw_cmd")
            [ -z "$_val" ] && _val="uptime"
            # SECURITY FILTER: Block metacharacters and command chaining
            case "$_val" in
                *[\;\&\|\`\(\)\>\<]*|*[\$]*|*"
"*)
                    send_header; printf '{"status":"error","message":"SECURITY ALERT: Metacharacters and command chaining blocked","blocked":true}\n'; exit 0 ;;
            esac
            # WHITELIST FILTER: Allow only verified safe network and diagnostic commands
            case "$_val" in
                ping\ *|traceroute\ *|nslookup\ *|logread*|dmesg*|uptime|free*|df*|netstat*|iwinfo*|cat\ /proc/*) ;;
                *) send_header; printf '{"status":"error","message":"SECURITY ALERT: Command not in diagnostic allowlist","blocked":true}\n'; exit 0 ;;
            esac
            _output=$($_val 2>&1 | head -n 60)
            _json_out=$(printf '%s\n' "$_output" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{printf "["} NR>1{printf ","} {printf "\"%s\"", $0} END{print "]"}')
            send_header; printf '{"status":"ok","command":"%s","output":%s}\n' "$_val" "$_json_out"; exit 0 ;;
        "set_smp_steering")
            _s="${_val:-1}"; [ "$_s" = "on" ] || [ "$_s" = "true" ] && _s="1"; [ "$_s" = "off" ] || [ "$_s" = "false" ] && _s="0"; _c="$([ "$_s" = "1" ] && echo "f" || echo "0")"; for q in /sys/class/net/*/queues/rx-*/rps_cpus; do [ -e "$q" ] && echo "$_c" > "$q" 2>/dev/null; done; uci set system.@system[0].smp_steering="$_s" 2>/dev/null && uci commit system 2>/dev/null; _msg="SMP Packet Steering set to $_s" ;;
        "set_wps_action")
            _act="${_val:-Toggle 5G Wi-Fi}"; uci set system.@system[0].wps_action="$_act" 2>/dev/null && uci commit system 2>/dev/null; _msg="WPS Button Action configured: $_act" ;;
        "set_dns_rebind")
            _s="$([ "$_val" = "off" ] || [ "$_val" = "0" ] && echo 0 || echo 1)"; uci set dhcp.@dnsmasq[0].rebind_protection="$_s" && uci commit dhcp && /etc/init.d/dnsmasq reload >/dev/null 2>&1 & _msg="DNS Rebind Protection set to $_s" ;;
        "set_wan_lockdown")
            _s="$([ "$_val" = "off" ] || [ "$_val" = "0" ] && echo 0 || echo 1)"; uci set firewall.@defaults[0].input="$([ "$_s" = "1" ] && echo 'DROP' || echo 'ACCEPT')"; uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1 & _msg="WAN Management Lockdown set to $_s" ;;
        "harden_security")
            uci set dhcp.@dnsmasq[0].rebind_protection='1' && uci commit dhcp && /etc/init.d/dnsmasq reload >/dev/null 2>&1 & uci set wireless.default_radio0.ieee80211w='1'; uci set wireless.default_radio1.ieee80211w='1'; uci commit wireless && wifi reload >/dev/null 2>&1 & _msg="Router Security Hardened" ;;
        "backup_config")
            _bpath="/tmp/backup-OpenWrt-c6.tar.gz"; sysupgrade -b "$_bpath" 2>/dev/null || tar -czf "$_bpath" -C / etc/config etc/shadow 2>/dev/null; _msg="Configuration archive generated at $_bpath" ;;
        "set_quota"|"reset_quota"|"set_client_quota"|"toggle_cron_task"|"set_cron_schedule"|"set_homeassistant_webhook"|"trigger_ha_webhook")
            handle_analytics_action "$_cmd" "$_target" "$_val" "$_payload"; exit 0 ;;
        *) _status="error"; _msg="Unknown command: $_cmd" ;;
    esac

    rm -f /tmp/c6_status.json /tmp/c6_status.lock 2>/dev/null
    send_header
    printf '{"status":"%s","message":"%s","command":"%s"}\n' "$_status" "$_msg" "$_cmd"
}
