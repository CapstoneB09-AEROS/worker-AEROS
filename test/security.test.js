const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyReading, canonicalReading, signatureFor,
  signedDataAck, signedCommand, signedWindowCommand, verifyCommandAck,
} = require('../src/services/securityService');

process.env.HMAC_SECRET = 'TEST_ONLY_shared_key_at_least_32_bytes_long_1234';

function signedReading(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const p = {
    version: 2, device_id: 'AEROS_01',
    nonce: '0123456789abcdef0123456789abcdef',
    timestamp: now, time_valid: true, co_ppm: 26, co2_ppm: 780,
    status: 'normal', buzzer_state: 'off', window_status: 0,
    event_id: null, demo: true, ...overrides,
  };
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}

test('valid signature accepted', () => {
  assert.equal(verifyReading(signedReading()).device_id, 'AEROS_01');
});

test('modified gas, status, device id rejected', () => {
  for (const [field, value] of [['co_ppm', 999], ['status', 'bahaya'], ['device_id', 'AEROS_02']]) {
    const p = signedReading();
    p[field] = value;
    assert.throws(() => verifyReading(p));
  }
});

test('reject malformed signature and future timestamp', () => {
  assert.throws(() => verifyReading({ ...signedReading(), signature: 'bad' }), /HMAC/);
  assert.throws(() => verifyReading(signedReading({ timestamp: Math.floor(Date.now()/1000) + 3600 })), /Timestamp/);
});

test('offline pre-NTP reading is explicitly marked, never falsely timestamped', () => {
  const p = signedReading({ timestamp: 0, time_valid: false });
  assert.equal(verifyReading(p).time_valid, false);
});

test('firmware/worker canonical order is explicit', () => {
  const p = signedReading({ timestamp: 1730000000, co_ppm: 25, co2_ppm: 850 });
  assert.equal(canonicalReading(p),
    'r2|AEROS_01|0123456789abcdef0123456789abcdef|1730000000|1|25|850|normal|off|0|-|1');
});

test('data ACK and mute command signing', () => {
  const p = signedDataAck('AEROS_01', '0123456789abcdef0123456789abcdef');
  assert.equal(p.signature, signatureFor(
    'dataack2|AEROS_01|0123456789abcdef0123456789abcdef|stored',
    process.env.HMAC_SECRET,
  ));
  const commandId = 'd6fba1bb-5aaf-4f1d-8dfe-e02ae77ca6a2';
  const alertId = '216b0b86-d596-4c56-9ae0-53394d389025';
  const cmd = signedCommand('AEROS_01', commandId, alertId, 1730000000);
  assert.equal(cmd.action, 'MUTE_BUZZER');
  const ack = { version: 2, device_id: 'AEROS_01', command_id: commandId,
    alert_id: alertId, result: 'success' };
  ack.signature = signatureFor(
    'cmdack2|AEROS_01|' + commandId + '|' + alertId + '|success',
    process.env.HMAC_SECRET,
  );
  assert.equal(verifyCommandAck(ack).result, 'success');
  ack.result = 'failed';
  assert.throws(() => verifyCommandAck(ack), /HMAC/);
});

test('v3: reading kelima beserta puncak 5 detik ditandatangani', () => {
  const p = signedReading({
    version: 3, nonce: '1234567890abcdef1234567890abcdef', demo: false,
    co_ppm: 14, co2_ppm: 540, co_peak_ppm: 35, co2_peak_ppm: 875,
    co_peak_second: 2, co2_peak_second: 4, window_status: null,
  });
  assert.equal(verifyReading(p), p);
  assert.equal(canonicalReading(p),
    `r3|AEROS_01|${p.nonce}|${p.timestamp}|1|14|540|35|875|2|4|normal|off|-|-|0`);
  p.co_peak_ppm = 60;
  assert.throws(() => verifyReading(p), /HMAC/);
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  p.co_peak_second = 6;
  assert.throws(() => verifyReading(p), /Jendela telemetry/);
});

test('v3: WINDOW_OPEN/CLOSE + received ACK bertanda tangan; replay diubah ditolak', () => {
  const commandId = 'd6fba1bb-5aaf-4f1d-8dfe-e02ae77ca6a2';
  const alertId = '216b0b86-d596-4c56-9ae0-53394d389025';
  for (const action of ['WINDOW_OPEN', 'WINDOW_CLOSE']) {
    const cmd = signedWindowCommand('AEROS_01', commandId, alertId, action, 1730000000);
    assert.equal(cmd.version, 3);
    assert.equal(cmd.signature, signatureFor(
      `cmd3|AEROS_01|${commandId}|${alertId}|${action}|1730000000`,
      process.env.HMAC_SECRET,
    ));
    const ack = { version: 3, device_id: 'AEROS_01', command_id: commandId,
      alert_id: alertId, action, result: 'received' };
    ack.signature = signatureFor(
      `cmdack3|AEROS_01|${commandId}|${alertId}|${action}|received`,
      process.env.HMAC_SECRET,
    );
    assert.equal(verifyCommandAck(ack).result, 'received');
    ack.result = 'failed';
    assert.throws(() => verifyCommandAck(ack), /HMAC/);
  }
  assert.throws(() => signedWindowCommand('AEROS_01', commandId, alertId,
    'WINDOW_TOGGLE', 1730000000), /action/);
});
