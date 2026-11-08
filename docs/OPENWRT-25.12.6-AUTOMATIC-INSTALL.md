# CyberWave Automatic Bridge — OpenWrt 25.12.6

Target device: TP-Link Archer C6 V3.2 (`tplink,archer-c6-v3`), target `ramips/mt7621`.

## Cloud environment requirements

Configure these Vercel environment variables before deploying:

- `ADMIN_PASSWORD`: strong dashboard administrator password.
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST URL.
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST token.
- `ROUTER_SECRET_KEY`: optional additional API/admin shared secret. The router agent uses its per-router pairing token instead.
- `ARCHER_C6_SECRET`: optional legacy API secret; do not reuse the admin password if a separate key can be used.

The bridge deliberately fails closed for pairing, installer tickets, heartbeats and command queues if Upstash Redis is not configured. Vercel function memory and local files are not persistent storage.

## Admin workflow

1. Deploy the updated project to `https://cyberwave.ai.studio`.
2. Open the Admin dashboard and sign in.
3. Open Settings → Router Bridge.
4. Select **Regenerate Pairing Token** once for the router you are pairing. This invalidates any older pairing token.
5. Select **Copy Code**. The dashboard requests a one-time installer ticket from the API. The ticket expires in five minutes and is consumed on first use.
6. Connect to the router over its LAN SSH session as root and paste the copied command.
7. Verify with ` /etc/init.d/cyberwave-agent status ` and ` logread -e cyberwave-agent `.

The installer is restricted to board `tplink,archer-c6-v3`, release `25.12.6`, and target `ramips/mt7621`. It requires at least 256 KB free overlay storage, verified HTTPS via `uclient-fetch`, `rpcd`, `uhttpd`, and `apk` only if `jsonfilter` is missing. It does not run `apk upgrade`, change firewall rules, expose LuCI/RPC to WAN, or modify Wi-Fi/network configuration.

## Router files

- `/usr/bin/cyberwave-agent.sh`
- `/usr/bin/cyberwave-uninstall.sh`
- `/etc/cyberwave/agent.conf` (mode 0600)
- `/etc/init.d/cyberwave-agent`

The agent initiates outbound HTTPS only. Its command interface is intentionally limited to a small allowlist (`ping_test`, `drop_caches`, `wifi_reload`, `backup_config`, `set_wifi_ssid`, `nds_auth`, `nds_deauth`, `reboot`). Other dashboard actions are rejected by the API and are not put on the router queue until a matching safe handler is implemented.

## Verification

On the router:

```sh
/etc/init.d/cyberwave-agent status
logread -e cyberwave-agent
cat /etc/cyberwave/agent.conf | sed 's/^SECRET_KEY=.*/SECRET_KEY=[redacted]/'
```

Do not paste the pairing token or the contents of `agent.conf` into support chats. To remove the agent without changing network configuration:

```sh
/usr/bin/cyberwave-uninstall.sh
```
