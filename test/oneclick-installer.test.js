/**
 * test/oneclick-installer.test.js
 *
 * Automated verification test suite for CyberWave Unified One-Click Installer,
 * Bundle Archive, Manifest Checksums, and Setup Wizard API Endpoints.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import handler from '../api/router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(data) { this.body = data; return this; },
    send(str) { this.body = str; return this; },
    end(str) { if (str !== undefined) this.body = str; return this; }
  };
  return res;
}

test('CyberWave One-Click Bundle Deliverables & Integrity', async (t) => {
  await t.test('manifest file exists and has valid structure', () => {
    const manifestPath = path.join(ROOT_DIR, 'install-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'install-manifest.json must exist in root');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.name, 'CyberWave Archer C6 One-Click Bundle');
    assert.equal(manifest.target.board, 'tplink,archer-c6-v3');
    assert.equal(manifest.target.firmware, 'OpenWrt 25.12.6');
    assert.equal(manifest.target.architecture, 'ramips/mt7621');
    assert.ok(manifest.components['cyberwave-agent.sh'], 'cyberwave-agent.sh component present');
    assert.ok(manifest.components['guest-setup.sh'], 'guest-setup.sh component present');
    assert.ok(manifest.components['opennds-setup.sh'], 'opennds-setup.sh component present');
    assert.ok(manifest.components['rollback.sh'], 'rollback.sh component present');
    assert.ok(manifest.components['uninstall.sh'], 'uninstall.sh component present');
  });

  await t.test('component checksums match SHA-256 hashes exactly', () => {
    const manifestPath = path.join(ROOT_DIR, 'install-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    for (const [fname, meta] of Object.entries(manifest.components)) {
      const fpath = path.join(ROOT_DIR, 'router', fname);
      assert.ok(fs.existsSync(fpath), `File router/${fname} must exist`);
      const data = fs.readFileSync(fpath);
      const computedHash = crypto.createHash('sha256').update(data).digest('hex');
      assert.equal(computedHash, meta.sha256, `SHA-256 must match for ${fname}`);
      assert.equal(data.length, meta.sizeBytes, `Byte size must match for ${fname}`);
    }
  });

  await t.test('cyberwave-bundle.tar.gz exists and is lightweight (< 30KB)', () => {
    const bundlePath = path.join(ROOT_DIR, 'cyberwave-bundle.tar.gz');
    assert.ok(fs.existsSync(bundlePath), 'cyberwave-bundle.tar.gz must exist in root');
    const stats = fs.statSync(bundlePath);
    assert.ok(stats.size > 1000, 'Bundle must not be empty');
    assert.ok(stats.size < 30000, `Bundle must be under 30KB for 16MB flash (actual: ${stats.size} bytes)`);
  });

  await t.test('all shell deliverables are present in root, router/, and public/router/', () => {
    const deliverables = [
      'cyberwave-oneclick-installer.sh',
      'cyberwave-bundle.tar.gz',
      'install-manifest.json',
      'rollback.sh',
      'uninstall.sh'
    ];
    for (const d of deliverables) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, d)), `Root ${d} exists`);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'router', d)), `router/${d} exists`);
      assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/router', d)), `public/router/${d} exists`);
    }
  });
});

test('CyberWave Setup Wizard API Endpoints & Progress Ingestion', async (t) => {
  const oldEnv = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'TestPassword123!';

  await t.test('POST /api/router?action=install_progress accepts valid stage reporting', async () => {
    const req = {
      method: 'POST',
      url: '/api/router?action=install_progress',
      headers: { 'content-type': 'application/json' },
      body: {
        stage: 6,
        totalStages: 10,
        stageName: 'Guest Wi-Fi integration',
        percent: 65,
        status: 'in_progress',
        log: 'Configured 2.4G and 5G guest interfaces on radios radio0, radio1'
      }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.progress?.stage, 6);
    assert.equal(res.body?.progress?.percent, 65);
  });

  await t.test('GET /api/router?action=get_install_progress returns latest recorded stage', async () => {
    const req = {
      method: 'GET',
      url: '/api/router?action=get_install_progress',
      headers: { 'authorization': 'Bearer TestPassword123!' }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(res.body?.progress?.stage, 6);
    assert.equal(res.body?.progress?.stageName, 'Guest Wi-Fi integration');
  });

  await t.test('POST /api/router action=trigger_oneclick_install rejects unauthenticated requests', async () => {
    const req = {
      method: 'POST',
      url: '/api/router',
      headers: { 'content-type': 'application/json' },
      body: { action: 'trigger_oneclick_install' }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });

  await t.test('POST /api/router action=trigger_oneclick_install generates single-line bootstrap command', async () => {
    // First register/pair router
    const regReq = {
      method: 'POST',
      url: '/api/router',
      headers: { 'authorization': 'Bearer TestPassword123!', 'content-type': 'application/json' },
      body: { action: 'register_router', model: 'TP-Link Archer C6 v3.2' }
    };
    const regRes = mockRes();
    await handler(regReq, regRes);
    assert.equal(regRes.statusCode, 200);

    const req = {
      method: 'POST',
      url: '/api/router',
      headers: { 'authorization': 'Bearer TestPassword123!', 'content-type': 'application/json' },
      body: { action: 'trigger_oneclick_install' }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.ok(res.body?.sshCommand, 'Must provide single-line SSH command');
    assert.match(res.body?.sshCommand, /uclient-fetch.*oneclick_script.*ticket=/);
    assert.ok(res.body?.ticket, 'Must return ticket');
  });

  await t.test('GET /api/router?action=oneclick_script serves valid POSIX bootstrap shell script', async () => {
    // Get install ticket
    const ticketReq = {
      method: 'GET',
      url: '/api/router?action=create_install_ticket',
      headers: { 'authorization': 'Bearer TestPassword123!' }
    };
    const ticketRes = mockRes();
    await handler(ticketReq, ticketRes);
    assert.equal(ticketRes.statusCode, 200);
    const ticket = ticketRes.body?.ticket;
    assert.ok(ticket);

    const scriptReq = {
      method: 'GET',
      url: `/api/router?action=oneclick_script&ticket=${ticket}`,
      headers: {}
    };
    const scriptRes = mockRes();
    await handler(scriptReq, scriptRes);
    assert.equal(scriptRes.statusCode, 200);
    assert.equal(scriptRes.headers['content-type'], 'text/x-shellscript; charset=utf-8');
    assert.match(scriptRes.body, /#!\/bin\/sh/);
    assert.match(scriptRes.body, /cyberwave-oneclick-installer\.sh/);
  });

  await t.test('POST /api/router action=trigger_rollback dispatches rollback_setup', async () => {
    const req = {
      method: 'POST',
      url: '/api/router',
      headers: { 'authorization': 'Bearer TestPassword123!', 'content-type': 'application/json' },
      body: { action: 'trigger_rollback' }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.match(res.body?.message, /Rollback/i);
  });

  await t.test('POST /api/router action=trigger_uninstall dispatches uninstall_setup', async () => {
    const req = {
      method: 'POST',
      url: '/api/router',
      headers: { 'authorization': 'Bearer TestPassword123!', 'content-type': 'application/json' },
      body: { action: 'trigger_uninstall' }
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.ok, true);
    assert.match(res.body?.message, /Uninstall/i);
  });

  process.env.ADMIN_PASSWORD = oldEnv;
});
