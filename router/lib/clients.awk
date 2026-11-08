# ArcherGuard C6 — High Performance Client Formatting (router/lib/clients.awk)
BEGIN {
    printf("\"clients\":[");
    first = 1;
    cur_m = "";
    has_arp = 0;
    arp_count = 0;
}
FILENAME ~ /\.cg_5g_sta$/ {
    if ($1 == "Station") { cur_m = tolower($2); band[cur_m] = "5GHz"; next; }
    if (cur_m != "") {
        if ($1 == "rx" && $2 == "bytes:") tx_b[cur_m] = $3;
        else if ($1 == "tx" && $2 == "bytes:") rx_b[cur_m] = $3;
        else if ($1 == "signal:") sig[cur_m] = $2;
        else if ($1 == "connected" && $2 == "time:") conn[cur_m] = $3;
    }
    next;
}
FILENAME ~ /\.cg_2g_sta$/ {
    if ($1 == "Station") { cur_m = tolower($2); band[cur_m] = "2.4GHz"; next; }
    if (cur_m != "") {
        if ($1 == "rx" && $2 == "bytes:") tx_b[cur_m] = $3;
        else if ($1 == "tx" && $2 == "bytes:") rx_b[cur_m] = $3;
        else if ($1 == "signal:") sig[cur_m] = $2;
        else if ($1 == "connected" && $2 == "time:") conn[cur_m] = $3;
    }
    next;
}
FILENAME ~ /\.cg_guest_sta$/ {
    if ($1 == "Station") { cur_m = tolower($2); band[cur_m] = "Guest"; next; }
    if (cur_m != "") {
        if ($1 == "rx" && $2 == "bytes:") tx_b[cur_m] = $3;
        else if ($1 == "tx" && $2 == "bytes:") rx_b[cur_m] = $3;
        else if ($1 == "signal:") sig[cur_m] = $2;
        else if ($1 == "connected" && $2 == "time:") conn[cur_m] = $3;
    }
    next;
}
FILENAME == "/etc/archer_guard_clients.conf" {
    split($0, arr, "|");
    m = tolower(arr[1]);
    if (m != "") {
        if (arr[2] != "") c_alias[m] = arr[2];
        if (arr[3] != "" && arr[3] != "0") c_dl_lim[m] = arr[3];
        if (arr[4] != "" && arr[4] != "0") c_ul_lim[m] = arr[4];
    }
    next;
}
FILENAME == "/tmp/.cg_blocked" {
    for (i = 1; i <= NF; i++) {
        if ($i == "--mac-source") { m = tolower($(i + 1)); blocked[m] = 1; }
        else if ($i ~ /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) { blocked[tolower($i)] = 1; }
    }
    next;
}
FILENAME == "/tmp/.cg_static" {
    split($0, arr, "=");
    gsub(/['\"]/, "", arr[2]);
    m = tolower(arr[2]);
    static_m[m] = 1;
    next;
}
FILENAME ~ /arp/ {
    if ($1 == "IP" || $1 == "") next;
    has_arp = 1;
    m = tolower($4);
    if (m != "00:00:00:00:00:00" && m != "") {
        arp_flags[m] = $3;
        arp_ip[m] = $1;
        if (!in_arp[m]) {
            arp_list[arp_count++] = m;
            in_arp[m] = 1;
        }
    }
    next;
}
FILENAME ~ /dhcp\.leases$/ && NF >= 4 {
    m = tolower($2); ip = $3; host = $4;
    is_wifi = (band[m] != "");

    # Active Verification: Eliminate stale DHCP leases (ghost clients)
    # If device is not on Wi-Fi, it must be an active Ethernet client.
    # A real Ethernet client requires valid ARP resolution (0x2) and physical LAN link.
    if (!is_wifi) {
        if (has_arp && arp_flags[m] != "0x2") next;
        if (lan_up != "" && lan_up == "0") next;
    }

    seen[m] = 1;
    c_band = band[m] ? band[m] : "LAN";
    c_sig = sig[m] ? sig[m] : 0;
    c_blk = blocked[m] ? "true" : "false";
    c_sta = static_m[m] ? "true" : "false";
    c_rx = rx_b[m] ? rx_b[m] : 0;
    c_tx = tx_b[m] ? tx_b[m] : 0;
    c_conn = conn[m] ? conn[m] : 0;
    if (c_conn == 0 && $1 > 0 && now > 0) {
        lease_start = $1 - 43200;
        if (now > lease_start) c_conn = now - lease_start;
    }
    c_ssid = "Ethernet LAN";
    if (band[m] == "5GHz") c_ssid = (s5g != "" ? s5g : "5GHz Wi-Fi");
    else if (band[m] == "2.4GHz") c_ssid = (s2g != "" ? s2g : "2.4GHz Wi-Fi");
    else if (band[m] == "Guest") c_ssid = (sguest != "" ? sguest : "Guest Wi-Fi");
    c_iso = (band[m] == "Guest") ? "true" : "false";

    if (!first) printf(",");
    printf("{\"mac\":\"%s\",\"ip\":\"%s\",\"hostname\":\"%s\",\"nds_authenticated\":false,\"blocked\":%s,\"signal_dbm\":%s,\"connection_type\":\"%s\",\"is_static\":%s,\"ssid_name\":\"%s\",\"is_isolated\":%s,\"rx_bytes\":%s,\"tx_bytes\":%s,\"connected_seconds\":%s", m, ip, host, c_blk, c_sig, c_band, c_sta, c_ssid, c_iso, c_rx, c_tx, c_conn);
    if (c_alias[m] != "") printf(",\"custom_name\":\"%s\"", c_alias[m]);
    if (c_dl_lim[m] != "") printf(",\"download_limit_kbps\":%s", c_dl_lim[m]);
    if (c_ul_lim[m] != "") printf(",\"upload_limit_kbps\":%s", c_ul_lim[m]);
    printf("}");
    first = 0;
    next;
}
END {
    # Include any statically addressed active clients present in ARP table but missing from DHCP
    for (i = 0; i < arp_count; i++) {
        m = arp_list[i];
        if (seen[m] || arp_flags[m] != "0x2") continue;
        if (band[m] == "" && lan_up != "" && lan_up == "0") continue;

        ip = arp_ip[m];
        host = "Static-" ip;
        c_band = band[m] ? band[m] : "LAN";
        c_sig = sig[m] ? sig[m] : 0;
        c_blk = blocked[m] ? "true" : "false";
        c_sta = static_m[m] ? "true" : "false";
        c_rx = rx_b[m] ? rx_b[m] : 0;
        c_tx = tx_b[m] ? tx_b[m] : 0;
        c_conn = conn[m] ? conn[m] : 3600;
        c_ssid = "Ethernet LAN";
        if (band[m] == "5GHz") c_ssid = (s5g != "" ? s5g : "5GHz Wi-Fi");
        else if (band[m] == "2.4GHz") c_ssid = (s2g != "" ? s2g : "2.4GHz Wi-Fi");
        else if (band[m] == "Guest") c_ssid = (sguest != "" ? sguest : "Guest Wi-Fi");
        c_iso = (band[m] == "Guest") ? "true" : "false";

        if (!first) printf(",");
        printf("{\"mac\":\"%s\",\"ip\":\"%s\",\"hostname\":\"%s\",\"nds_authenticated\":false,\"blocked\":%s,\"signal_dbm\":%s,\"connection_type\":\"%s\",\"is_static\":%s,\"ssid_name\":\"%s\",\"is_isolated\":%s,\"rx_bytes\":%s,\"tx_bytes\":%s,\"connected_seconds\":%s", m, ip, host, c_blk, c_sig, c_band, c_sta, c_ssid, c_iso, c_rx, c_tx, c_conn);
        if (c_alias[m] != "") printf(",\"custom_name\":\"%s\"", c_alias[m]);
        if (c_dl_lim[m] != "") printf(",\"download_limit_kbps\":%s", c_dl_lim[m]);
        if (c_ul_lim[m] != "") printf(",\"upload_limit_kbps\":%s", c_ul_lim[m]);
        printf("}");
        first = 0;
        seen[m] = 1;
    }
    printf("]");
}
