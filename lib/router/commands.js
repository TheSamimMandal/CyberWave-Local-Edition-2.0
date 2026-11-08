/**
 * lib/router/commands.js
 *
 * Archer C6 router command dispatcher and coordinator.
 * Kept strictly under 250 lines.
 */

import { handleWifiAndNetworkCommands } from './commands-wifi.js';
import { handleSystemAndClientCommands } from './commands-sys.js';
import { handleFirewallCommands } from './commands-firewall.js';

export async function buildRouterCommand(payload, req, redis) {
  const command = payload?.command || payload?.cmd;
  if (!command || typeof command !== 'string') {
    return { error: 'Field "command" is required.', statusCode: 400 };
  }

  const cleanCmd = command.trim();

  // Try Wi-Fi and network commands first
  const wifiResult = handleWifiAndNetworkCommands(cleanCmd, payload, req);
  if (wifiResult) {
    if (wifiResult.error) return wifiResult;
    return { routerCmd: wifiResult.routerCmd, simulatedOutput: null, cleanCmd };
  }

  // Try Firewall and NAT commands
  const fwResult = await handleFirewallCommands(cleanCmd, payload, req);
  if (fwResult) {
    if (fwResult.error) return fwResult;
    return {
      routerCmd: fwResult.routerCmd,
      simulatedOutput: fwResult.simulatedOutput !== undefined ? fwResult.simulatedOutput : null,
      cleanCmd
    };
  }

  // Try System and client commands
  const sysResult = await handleSystemAndClientCommands(cleanCmd, payload, req, redis);
  if (sysResult) {
    if (sysResult.error) return sysResult;
    return {
      routerCmd: sysResult.routerCmd,
      simulatedOutput: sysResult.simulatedOutput !== undefined ? sysResult.simulatedOutput : null,
      cleanCmd
    };
  }

  return { error: `Unsupported command: "${cleanCmd}".`, statusCode: 400 };
}
