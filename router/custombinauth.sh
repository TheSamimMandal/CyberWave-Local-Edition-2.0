#!/bin/sh
# ==============================================================================
# OpenWrt openNDS Custom BinAuth Hook (/usr/lib/opennds/custombinauth.sh)
#
# Sourced automatically by /usr/lib/opennds/binauth_log.sh on openNDS events.
# When any deauthentication event occurs (e.g. session timeout expiration,
# idle timeout, or manual ndsctl deauth), this script immediately kicks
# the client from Wi-Fi radios (Layer 2 802.11) via ubus / iw.
#
# This causes the client device (Android/iOS) to immediately detect disconnection
# and trigger the captive portal login popup within 2-5 seconds.
# ==============================================================================

# Kick client station from Wi-Fi immediately upon any deauthentication event
case "$1" in
	*deauth)
		_kick_mac="${clientmac:-$2}"
		if [ -n "$_kick_mac" ]; then
			if command -v logger >/dev/null 2>&1; then
				logger -t "opennds-kick" "[INFO] Deauth event ($1) for $_kick_mac - kicking station from Wi-Fi"
			fi
			if command -v ubus >/dev/null 2>&1; then
				for _h in $(ubus list 'hostapd.*' 2>/dev/null); do
					ubus call "$_h" del_client "{\"addr\":\"$_kick_mac\",\"reason\":1,\"deauth\":true}" >/dev/null 2>&1
				done
			fi
			if command -v iw >/dev/null 2>&1; then
				for _w in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
					iw dev "$_w" station del "$_kick_mac" >/dev/null 2>&1
				done
			fi
		fi
		;;
esac
