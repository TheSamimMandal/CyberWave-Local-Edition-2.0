import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouterCommand } from '../lib/router/commands.js';
import {
  registerRouter,
  getRouterProfile,
  enqueueCommandForRouter,
  dequeuePendingCommands,
  handleRouterHeartbeat,
  recordCommandResult,
  getCommandStatus
} from '../lib/router/bridge.js';
import { redeemVoucher, createVoucher } from '../lib/voucher.js';
import routerHandler from '../api/router.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end(data) {
      this.body = data;
      return this;
    }
  };
}

test('End-to-End Command Lifecycle & Hardware Telemetry Verification', async (t) => {
  await t.test('1. "set_wifi_config" is accepted and generates safe UCI command', async () => {
    const payload = {
      command: 'set_wifi_config',
      target: 'both',
      extra: {
        wlan2g: {
          ssid: 'CyberWave_2.4G_Test',
          channel: '6',
          txpower: '20',
          encryption: 'psk2',
          key: 'passphrase123',
          disabled: false
        },
        wlan5g: {
          ssid: 'CyberWave_5G_Test',
          channel: '149',
          txpower: '23',
          encryption: 'psk2',
          key: 'passphrase123',
          disabled: false
        }
      }
    };

    const res = await buildRouterCommand(payload, {}, null);
    assert.equal(res.error, undefined);
    assert.ok(res.routerCmd);
    assert.match(res.routerCmd, /wireless\.radio0\.channel='6'/);
    assert.match(res.routerCmd, /wireless\.default_radio0\.ssid='CyberWave_2\.4G_Test'/);
    assert.match(res.routerCmd, /wireless\.radio1\.channel='149'/);
    assert.match(res.routerCmd, /wireless\.default_radio1\.ssid='CyberWave_5G_Test'/);
    assert.match(res.routerCmd, /wifi reload/);
  });

  await t.test('2. "set_wifi_config" is enqueued via POST /api/router and serialized into queue', async () => {
    const reg = await registerRouter({ routerId: 'cw-c6-test-e2e', routerName: 'Archer C6 E2E' }, null);
    assert.equal(reg.ok, true);

    const req = {
      method: 'POST',
      headers: {
        'x-admin-password': process.env.ADMIN_PASSWORD || 'CyberWave@2026'
      },
      body: {
        action: 'exec_command',
        command: 'set_wifi_config',
        target: 'both',
        value: null,
        extra: {
          wlan2g: { ssid: 'CyberWave_2.4G_Live', channel: 6 },
          wlan5g: { ssid: 'CyberWave_5G_Live', channel: 149 }
        }
      }
    };
    const res = createMockRes();
    await routerHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.command, 'set_wifi_config');
    assert.ok(res.body.commandId);

    // Verify command is popped from queue with structured payload
    const popped = await dequeuePendingCommands(null, 5);
    const wifiCmd = popped.find(c => c.command === 'set_wifi_config' || c.action === 'set_wifi_config');
    assert.ok(wifiCmd, 'Queued command must be present in router dequeue');
    assert.match(wifiCmd.value, /CyberWave_2\.4G_Live/);
  });

  await t.test('3. Command confirmation reaches backend and marks status confirmed', async () => {
    const profile = await getRouterProfile(null);
    const testCmdId = 'cmd-test-' + Date.now();

    // Agent reports execution result
    const reportReq = {
      method: 'POST',
      headers: {
        'x-router-id': profile.routerId,
        'x-router-secret': profile.routerSecret
      },
      body: {
        action: 'bridge_report_result',
        commandId: testCmdId,
        command: 'set_wifi_config',
        status: 'confirmed',
        output: 'Dual-band Wi-Fi settings successfully applied to Archer C6 and reloaded.'
      }
    };
    const reportRes = createMockRes();
    await routerHandler(reportReq, reportRes);

    assert.equal(reportRes.statusCode, 200);
    assert.equal(reportRes.body.confirmed, true);

    const statusCheck = await getCommandStatus(testCmdId, null);
    assert.equal(statusCheck.status, 'confirmed');
    assert.match(statusCheck.output, /Dual-band Wi-Fi settings/);
  });

  await t.test('4. Heartbeat updates last-seen time and transitions router to ONLINE', async () => {
    const profile = await getRouterProfile(null);
    const hbReq = {
      method: 'POST',
      headers: {
        'x-router-id': profile.routerId,
        'x-router-secret': profile.routerSecret
      },
      body: {
        action: 'bridge_heartbeat',
        routerId: profile.routerId,
        system: {
          model: 'TP-Link Archer C6 v3.2',
          openwrtVersion: 'OpenWrt 25.12.6'
        },
        opennds: {
          installed: true,
          running: true,
          authorizedClients: 0
        },
        firewall: {
          guestToLanIsolated: true
        }
      }
    };
    const hbRes = createMockRes();
    await routerHandler(hbReq, hbRes);

    assert.equal(hbRes.statusCode, 200);
    assert.equal(hbRes.body.ok, true);

    const updatedProfile = await getRouterProfile(null);
    assert.equal(updatedProfile.isOnline, true);
    assert.equal(updatedProfile.status, 'online');
    assert.ok(updatedProfile.lastSeen);
    assert.ok(updatedProfile.lastSeenEpoch > 0);
  });

  await t.test('5. Voucher redemption enqueues nds_auth to router bridge without Redis', async () => {
    const voucher = await createVoucher(null, 60, 'E2E Test', 'Automated Test', 'TEST');
    assert.ok(voucher?.code);

    const clientMac = 'e4:5f:01:aa:bb:cc';
    const redeemRes = await redeemVoucher(null, voucher.code, clientMac, '192.168.10.105', 'Guest E2E');
    assert.equal(redeemRes.ok, true);
    assert.equal(redeemRes.code, voucher.code);

    // Verify nds_auth command is in queue for router agent
    const cmds = await dequeuePendingCommands(null, 5);
    const authCmd = cmds.find(c => c.command === 'nds_auth' && c.target === clientMac);
    assert.ok(authCmd, 'nds_auth command must be dispatched to router bridge queue');
    assert.equal(String(authCmd.value), '60');
  });

  await t.test('6. Voucher 1-device restriction rejects second MAC address', async () => {
    const voucher = await createVoucher(null, 60, 'E2E Test', '1-Device Test', 'ODEV');
    const firstMac = 'e4:5f:01:11:22:33';
    const secondMac = 'e4:5f:01:99:88:77';

    const firstRedeem = await redeemVoucher(null, voucher.code, firstMac);
    assert.equal(firstRedeem.ok, true);

    const secondRedeem = await redeemVoucher(null, voucher.code, secondMac);
    assert.equal(secondRedeem.ok, false);
    assert.match(secondRedeem.error, /ইতিমধ্যে ব্যবহার করা হয়েছে/);
  });
});
