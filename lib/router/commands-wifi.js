/**
 * lib/router/commands-wifi.js
 *
 * Archer C6 Wi-Fi, radio, SQM, DNS and network commands.
 * Kept strictly under 250 lines.
 */

import { simState } from './status-sim.js';

export function handleWifiAndNetworkCommands(cleanCmd, payload, req) {
  const { target, value, extra } = payload;

  switch (cleanCmd) {
    case 'wifi_toggle': {
      const radio = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'radio0';
      const disabled = value === 'off' ? '1' : '0';
      return { routerCmd: `uci set wireless.${radio}.disabled='${disabled}' && uci commit wireless && wifi reload` };
    }

    case 'set_txpower': {
      const radio = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'radio0';
      const dbm = parseInt(value, 10);
      const safeDbm = !isNaN(dbm) && dbm >= 1 && dbm <= 30 ? dbm : 20;
      return { routerCmd: `uci set wireless.${radio}.txpower='${safeDbm}' && uci commit wireless && wifi reload` };
    }

    case 'set_wifi_channel': {
      const radio = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'radio0';
      const chan = parseInt(value, 10);
      const safeChan = !isNaN(chan) && chan >= 0 && chan <= 165 ? chan : 0;
      return { routerCmd: `uci set wireless.${radio}.channel='${safeChan}' && uci commit wireless && wifi reload` };
    }

    case 'set_wifi_htmode': {
      const radio = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'radio0';
      const allowed = ['HT20', 'HT40', 'VHT20', 'VHT40', 'VHT80', 'NOHT'];
      const safeMode = allowed.includes(value) ? value : 'HT20';
      return { routerCmd: `uci set wireless.${radio}.htmode='${safeMode}' && uci commit wireless && wifi reload` };
    }

    case 'set_wifi_ssid': {
      const iface = target && /^[a-zA-Z0-9_@.-]+$/.test(target) ? target : 'default_radio0';
      const cleanSsid = typeof value === 'string' ? value.replace(/['"\\]/g, '').substring(0, 32) : 'Archer_C6';
      let extraCmds = '';
      if (extra && extra.key && typeof extra.key === 'string') {
        const cleanKey = extra.key.replace(/['"\\]/g, '').substring(0, 64);
        extraCmds += ` && uci set wireless.${iface}.key='${cleanKey}'`;
      }
      if (extra && extra.hidden !== undefined) {
        const hidVal = (extra.hidden === '1' || extra.hidden === 1 || extra.hidden === true) ? '1' : '0';
        extraCmds += ` && uci set wireless.${iface}.hidden='${hidVal}'`;
      }
      const targetSsid = simState.ssids.find(s => s.id === iface || s.ifname === iface);
      if (targetSsid) {
        targetSsid.ssid = cleanSsid;
        if (extra?.key) targetSsid.key = extra.key;
        if (extra?.hidden !== undefined) targetSsid.hidden = (extra.hidden === '1' || extra.hidden === 1 || extra.hidden === true);
      }
      return { routerCmd: `uci set wireless.${iface}.ssid='${cleanSsid}'${extraCmds} && uci commit wireless && wifi reload` };
    }

    case 'add_wifi_ssid': {
      const rad = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'radio0';
      const cleanSsid = typeof value === 'string' ? value.replace(/['"\\]/g, '').substring(0, 32) : 'New_SSID';
      const sec = `ap_${cleanSsid.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 10)}`;
      const is5g = rad === 'radio1' || rad === '1';
      simState.ssids.push({
        id: sec,
        ssid: cleanSsid,
        band: is5g ? '5.0 GHz' : '2.4 GHz',
        radio: rad,
        ifname: `wlan_${sec}`,
        enabled: true,
        encryption: payload.encryption || 'WPA2-PSK',
        channel: is5g ? 149 : 6,
        connected_clients: 0,
        is_guest: false,
        isolated: payload.isolate === '1' || payload.isolate === true
      });
      return { routerCmd: `uci set wireless.${sec}=wifi-iface && uci set wireless.${sec}.device='${rad}' && uci set wireless.${sec}.mode='ap' && uci set wireless.${sec}.network='lan' && uci set wireless.${sec}.ssid='${cleanSsid}' && uci set wireless.${sec}.encryption='psk2' && uci commit wireless && wifi reload` };
    }

    case 'del_wifi_ssid': {
      const sec = target && /^[a-zA-Z0-9_@.-]+$/.test(target) ? target : '';
      simState.ssids = simState.ssids.filter(s => s.id !== sec && s.ifname !== sec);
      return sec ? { routerCmd: `uci delete wireless.${sec} && uci commit wireless && wifi reload` } : { routerCmd: '' };
    }

    case 'toggle_wifi_ssid': {
      const sec = target && /^[a-zA-Z0-9_@.-]+$/.test(target) ? target : 'default_radio0';
      const disabled = (value === 'off' || value === '0' || value === false) ? '1' : '0';
      const targetSsid = simState.ssids.find(s => s.id === sec || s.ifname === sec);
      if (targetSsid) {
        targetSsid.enabled = (disabled === '0');
      }
      return { routerCmd: `uci set wireless.${sec}.disabled='${disabled}' && uci commit wireless && wifi reload` };
    }

    case 'set_wifi_config':
    case 'wifi_config': {
      let cfg = payload.extra || payload.config || value;
      if (typeof cfg === 'string' && cfg.startsWith('{')) {
        try { cfg = JSON.parse(cfg); } catch {}
      }
      cfg = cfg || payload || {};

      const wlan2g = cfg.wlan2g || {};
      const wlan5g = cfg.wlan5g || {};

      const s2g = String(wlan2g.ssid || 'CyberWave_2.4G').replace(/['"\\]/g, '').slice(0, 32);
      const c2g = parseInt(wlan2g.channel, 10);
      const safeChan2g = (!isNaN(c2g) && c2g >= 0 && c2g <= 14) ? c2g : 6;
      const p2g = parseInt(wlan2g.txpower, 10);
      const safePwr2g = (!isNaN(p2g) && p2g >= 1 && p2g <= 30) ? p2g : 20;
      const allowedEnc = ['psk2', 'sae', 'sae-mixed', 'psk', 'none'];
      const enc2g = allowedEnc.includes(wlan2g.encryption) ? wlan2g.encryption : 'psk2';
      const key2g = wlan2g.key ? String(wlan2g.key).replace(/['"\\]/g, '').slice(0, 64) : '';
      const d2g = (wlan2g.disabled === '1' || wlan2g.disabled === 1 || wlan2g.disabled === true) ? '1' : '0';

      const s5g = String(wlan5g.ssid || 'CyberWave_5G').replace(/['"\\]/g, '').slice(0, 32);
      const c5g = parseInt(wlan5g.channel, 10);
      const safeChan5g = (!isNaN(c5g) && (c5g === 0 || (c5g >= 36 && c5g <= 165))) ? c5g : 149;
      const p5g = parseInt(wlan5g.txpower, 10);
      const safePwr5g = (!isNaN(p5g) && p5g >= 1 && p5g <= 30) ? p5g : 23;
      const enc5g = allowedEnc.includes(wlan5g.encryption) ? wlan5g.encryption : 'psk2';
      const key5g = wlan5g.key ? String(wlan5g.key).replace(/['"\\]/g, '').slice(0, 64) : '';
      const d5g = (wlan5g.disabled === '1' || wlan5g.disabled === 1 || wlan5g.disabled === true) ? '1' : '0';

      let k2gCmd = '';
      if (enc2g !== 'none' && key2g) {
        k2gCmd = ` && uci set wireless.default_radio0.key='${key2g}'`;
      }
      let k5gCmd = '';
      if (enc5g !== 'none' && key5g) {
        k5gCmd = ` && uci set wireless.default_radio1.key='${key5g}'`;
      }

      // Update in-memory simState for dashboard preview
      const ssid2gObj = simState.ssids.find(s => s.id === 'default_radio0' || s.radio === 'radio0');
      if (ssid2gObj) {
        ssid2gObj.ssid = s2g;
        ssid2gObj.channel = safeChan2g;
        ssid2gObj.enabled = (d2g === '0');
      }
      const ssid5gObj = simState.ssids.find(s => s.id === 'default_radio1' || s.radio === 'radio1');
      if (ssid5gObj) {
        ssid5gObj.ssid = s5g;
        ssid5gObj.channel = safeChan5g;
        ssid5gObj.enabled = (d5g === '0');
      }

      const routerCmd = `uci set wireless.radio0.channel='${safeChan2g}' && uci set wireless.radio0.txpower='${safePwr2g}' && uci set wireless.default_radio0.ssid='${s2g}' && uci set wireless.default_radio0.encryption='${enc2g}'${k2gCmd} && uci set wireless.default_radio0.disabled='${d2g}' && (uci get wireless.radio1 >/dev/null 2>&1 && uci set wireless.radio1.channel='${safeChan5g}' && uci set wireless.radio1.txpower='${safePwr5g}' && uci set wireless.default_radio1.ssid='${s5g}' && uci set wireless.default_radio1.encryption='${enc5g}'${k5gCmd} && uci set wireless.default_radio1.disabled='${d5g}' || true) && uci commit wireless && wifi reload`;

      return {
        routerCmd,
        simulatedOutput: 'Dual-band Wi-Fi settings successfully applied and wireless radios reloaded.'
      };
    }

    case 'guest_wifi_config': {
      let cfg = value;
      if (typeof value === 'string' && value.startsWith('{')) {
        try { cfg = JSON.parse(value); } catch {}
      }
      cfg = cfg || payload.extra || payload || {};
      const s2g = String(cfg.ssid2g || 'CyberWave_Guest_2.4G').replace(/['"\\]/g, '').slice(0, 32);
      const s5g = String(cfg.ssid5g || 'CyberWave_Guest_5G').replace(/['"\\]/g, '').slice(0, 32);
      const k2g = cfg.key2g ? String(cfg.key2g).replace(/['"\\]/g, '').slice(0, 64) : '';
      const k5g = cfg.key5g ? String(cfg.key5g).replace(/['"\\]/g, '').slice(0, 64) : '';
      const d2g = (cfg.disabled2g === '1' || cfg.disabled2g === 1 || cfg.disabled2g === true) ? '1' : '0';
      const d5g = (cfg.disabled5g === '1' || cfg.disabled5g === 1 || cfg.disabled5g === true) ? '1' : '0';

      const g2Obj = simState.ssids.find(s => s.id === 'guest_2g' || (s.is_guest && s.band && s.band.includes('2.4')));
      if (g2Obj) {
        g2Obj.ssid = s2g;
        g2Obj.enabled = (d2g === '0');
      }
      const g5Obj = simState.ssids.find(s => s.id === 'guest_5g' || (s.is_guest && s.band && s.band.includes('5')));
      if (g5Obj) {
        g5Obj.ssid = s5g;
        g5Obj.enabled = (d5g === '0');
      }

      return {
        routerCmd: `uci set wireless.guest_2g.ssid='${s2g}' && uci set wireless.guest_2g.disabled='${d2g}' && (uci get wireless.radio1 >/dev/null 2>&1 && uci set wireless.guest_5g.ssid='${s5g}' && uci set wireless.guest_5g.disabled='${d5g}' || true) && uci commit wireless && wifi reload`,
        simulatedOutput: 'Dual-band Guest Wi-Fi configuration saved and reloaded.'
      };
    }

    case 'guest_wifi_toggle': {
      const disabled = (value === 'on' || value === '1' || value === true) ? '0' : '1';
      const targetGuest = simState.ssids.find(s => s.id === 'guest' || s.is_guest);
      if (targetGuest) {
        targetGuest.enabled = (disabled === '0');
      }
      return { routerCmd: `uci set wireless.guest.disabled='${disabled}' && uci commit wireless && wifi reload` };
    }

    case 'set_wifi_advanced': {
      const opt = target && /^[a-zA-Z0-9_-]+$/.test(target) ? target : 'roaming';
      const flag = (value === 'on' || value === '1' || value === true) ? '1' : '0';
      if (opt === 'pmf') simState.pmfProtected = (flag === '1');
      return { routerCmd: `uci set wireless.@wifi-iface[0].${opt}='${flag}' && uci commit wireless && wifi reload` };
    }

    case 'set_hw_offload': {
      const flag = (value === 'on' || value === '1' || value === true) ? '1' : '0';
      return { routerCmd: `uci set firewall.@defaults[0].flow_offloading='${flag}' && uci set firewall.@defaults[0].flow_offloading_hw='0' && uci commit firewall && /etc/init.d/firewall restart` };
    }

    case 'set_sqm': {
      const flag = (value === 'on' || value === '1' || value === true) ? '1' : '0';
      return { routerCmd: `uci set sqm.@queue[0].enabled='${flag}' && uci commit sqm && /etc/init.d/sqm restart` };
    }

    case 'set_sqm_limits': {
      const qdisc = (target && ['cake', 'fq_codel'].includes(target))
        ? target
        : (req.body?.qdisc && ['cake', 'fq_codel'].includes(req.body.qdisc) ? req.body.qdisc : 'cake');
      let parsedVal = value;
      if (typeof value === 'string' && value.startsWith('{')) {
        try { parsedVal = JSON.parse(value); } catch (_) {}
      }
      const dl = parseInt(parsedVal && typeof parsedVal === 'object' ? parsedVal.download : (req.body?.download || value), 10) || 95000;
      const ul = parseInt(parsedVal && typeof parsedVal === 'object' ? parsedVal.upload : (req.body?.upload || target), 10) || 20000;
      return { routerCmd: `uci set sqm.@queue[0].qdisc='${qdisc}' && uci set sqm.@queue[0].download='${dl}' && uci set sqm.@queue[0].upload='${ul}' && uci commit sqm && /etc/init.d/sqm restart` };
    }

    case 'set_wireguard': {
      const active = (value === 'on' || value === '1' || value === true);
      return { routerCmd: active ? 'ifup wg0' : 'ifdown wg0' };
    }

    case 'set_multiwan': {
      const flag = (value === 'on' || value === '1' || value === true) ? '1' : '0';
      const action = flag === '1' ? 'restart' : 'stop';
      return { routerCmd: `uci set mwan3.globals.enabled='${flag}' && uci commit mwan3 && /etc/init.d/mwan3 ${action}` };
    }

    case 'set_doh': {
      const flag = (value === 'on' || value === '1' || value === true) ? '1' : '0';
      const action = flag === '1' ? 'start' : 'stop';
      return { routerCmd: `/etc/init.d/https-dns-proxy ${action}` };
    }

    case 'set_dns': {
      const primary = (req.body?.primary || value || '').trim();
      const secondary = (req.body?.secondary || target || '').trim();
      const ipv4Regex = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
      if (primary && primary !== 'auto') {
        if (!ipv4Regex.test(primary) || (secondary && !ipv4Regex.test(secondary))) {
          return { error: 'Invalid DNS IP address format.', statusCode: 400 };
        }
        const list = [primary];
        if (secondary) list.push(secondary);
        const uciList = list.map(d => `uci add_list network.wan.dns='${d}'`).join(' && ');
        simState.customDns = list.join(', ');
        if (globalThis.__localRouterStatus?.network?.wan_details) {
          globalThis.__localRouterStatus.network.wan_details.dns = simState.customDns;
        }
        return { routerCmd: `uci set network.wan.peerdns='0' && uci delete network.wan.dns 2>/dev/null && ${uciList} && uci commit network && /etc/init.d/network reload` };
      }
      simState.customDns = null;
      if (globalThis.__localRouterStatus?.network?.wan_details) {
        globalThis.__localRouterStatus.network.wan_details.dns = '1.1.1.1, 8.8.8.8';
      }
      return { routerCmd: `uci set network.wan.peerdns='1' && uci delete network.wan.dns 2>/dev/null && uci commit network && /etc/init.d/network reload` };
    }

    case 'set_smp_steering': {
      const enabled = (value === '1' || value === 'true' || value === 'on');
      return {
        routerCmd: enabled
          ? `for q in /sys/class/net/*/queues/rx-*/rps_cpus; do [ -e "$q" ] && echo "f" > "$q" 2>/dev/null; done && uci set system.@system[0].smp_steering='1' && uci commit system`
          : `for q in /sys/class/net/*/queues/rx-*/rps_cpus; do [ -e "$q" ] && echo "0" > "$q" 2>/dev/null; done && uci set system.@system[0].smp_steering='0' && uci commit system`
      };
    }

    case 'set_wps_action': {
      const action = (value && typeof value === 'string') ? value.replace(/['"\\]/g, '') : 'Toggle 5G Wi-Fi';
      return { routerCmd: `uci set system.@system[0].wps_action='${action}' && uci commit system` };
    }

    default:
      return null;
  }
}
