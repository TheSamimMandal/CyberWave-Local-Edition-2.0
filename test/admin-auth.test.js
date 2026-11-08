import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkAdminAuth,
  verifyAdminPassword,
  changeAdminPassword,
  resetAdminPassword,
  getAdminAuthStatus,
  DEFAULT_INITIAL_PASSWORD
} from '../lib/admin/auth.js';

describe('Admin Authentication & Persistent Password System', () => {
  test('verifyAdminPassword authenticates default password initially', () => {
    resetAdminPassword('CyberWave@2026', true);
    assert.equal(verifyAdminPassword('CyberWave@2026'), true);
    assert.equal(verifyAdminPassword('WrongPassword'), false);
    assert.equal(verifyAdminPassword(''), false);
    assert.equal(verifyAdminPassword(null), false);
  });

  test('checkAdminAuth authenticates via Bearer header and x-admin-password', () => {
    resetAdminPassword('CyberWave@2026', false);
    assert.equal(checkAdminAuth({ headers: { authorization: 'Bearer CyberWave@2026' } }), true);
    assert.equal(checkAdminAuth({ headers: { 'x-admin-password': 'CyberWave@2026' } }), true);
    assert.equal(checkAdminAuth({ headers: { authorization: 'Bearer wrong' } }), false);
    assert.equal(checkAdminAuth({ headers: {} }), false);
  });

  test('changeAdminPassword enforces current password verification', () => {
    resetAdminPassword('OldPass123', false);
    const failRes = changeAdminPassword('WrongCurrent', 'NewPass456');
    assert.equal(failRes.ok, false);
    assert.match(failRes.error, /Current password is incorrect/);
    assert.equal(verifyAdminPassword('OldPass123'), true);
    assert.equal(verifyAdminPassword('NewPass456'), false);
  });

  test('changeAdminPassword enforces minimum password length', () => {
    resetAdminPassword('OldPass123', false);
    const failRes = changeAdminPassword('OldPass123', '123');
    assert.equal(failRes.ok, false);
    assert.match(failRes.error, /at least 6 characters/);
  });

  test('changeAdminPassword successfully updates password and invalidates old password', () => {
    resetAdminPassword('InitialPass123', false);
    assert.equal(verifyAdminPassword('InitialPass123'), true);

    const successRes = changeAdminPassword('InitialPass123', 'UpdatedSecurePass999');
    assert.equal(successRes.ok, true);

    // Old password stops working
    assert.equal(verifyAdminPassword('InitialPass123'), false);
    // New password works
    assert.equal(verifyAdminPassword('UpdatedSecurePass999'), true);

    // Metadata status is updated
    const status = getAdminAuthStatus();
    assert.equal(status.isDefault, false);
    assert.ok(status.updatedAt);
  });

  test('password hash and salt are persisted to disk without plaintext', () => {
    resetAdminPassword('SecretStoredCheck2026', false);
    const raw = fs.readFileSync(path.resolve('data/admin-auth.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.salt && parsed.salt.length === 32);
    assert.ok(parsed.hash && parsed.hash.length === 128);
    assert.equal(raw.includes('SecretStoredCheck2026'), false, 'Plaintext password must NEVER be written to disk');
  });

  test('resetAdminPassword resets directly without old password for CLI recovery', () => {
    const res = resetAdminPassword('CyberWave@2026', true);
    assert.equal(res.ok, true);
    assert.equal(verifyAdminPassword('CyberWave@2026'), true);
  });
});
