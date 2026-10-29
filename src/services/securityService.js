const crypto = require('node:crypto');

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function secretForDevice(deviceId) {
  // One-device prototype. Replace with a server-side per-device secret lookup
  // when onboarding multiple devices. Never accept a secret from the payload.
  const secret = process.env.HMAC_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('HMAC_SECRET wajib minimal 32 byte');
  }
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error('device_id tidak valid');
  return secret;
}

function signatureFor(canonical, secret) {
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function checkSignature(canonical, signature, secret) {
  if (typeof signature !== 'string' || !HEX_64.test(signature)) return false;
  const expected = Buffer.from(signatureFor(canonical, secret), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return crypto.timingSafeEqual(expected, supplied);
}

function canonicalReading(p) {
  if (p.version === 3) {
    return [
      'r3', p.device_id, p.nonce, p.timestamp, Number(p.time_valid),
      p.co_ppm, p.co2_ppm, p.co_peak_ppm, p.co2_peak_ppm,
      p.co_peak_second, p.co2_peak_second, p.status, p.buzzer_state,
      p.window_status === null ? '-' : p.window_status,
      p.event_id || '-', Number(p.demo),
    ].join('|');
  }
  return [
    'r2', p.device_id, p.nonce, p.timestamp, Number(p.time_valid),
    p.co_ppm, p.co2_ppm, p.status, p.buzzer_state,
    p.window_status, p.event_id || '-', Number(p.demo),
  ].join('|');
}

function verifyReading(p, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!p || ![2, 3].includes(p.version) || !DEVICE_ID_PATTERN.test(p.device_id || '')) {
    throw new Error('Versi atau identitas perangkat tidak valid');
  }
  if (typeof p.nonce !== 'string' || !HEX_32.test(p.nonce)) throw new Error('Nonce tidak valid');
  if (!Number.isSafeInteger(p.timestamp) || p.timestamp < 0) throw new Error('Timestamp tidak valid');
  if (typeof p.time_valid !== 'boolean' || typeof p.demo !== 'boolean') {
    throw new Error('Flag time_valid/demo tidak valid');
  }
  if (!p.time_valid && p.timestamp !== 0) throw new Error('Timestamp tanpa NTP harus 0');
  if (p.time_valid && (p.timestamp > nowSeconds + 300 || p.timestamp < nowSeconds - 90 * 86400)) {
    throw new Error('Timestamp di luar jendela penerimaan 90 hari / 5 menit ke depan');
  }
  for (const name of ['co_ppm', 'co2_ppm']) {
    if (!Number.isSafeInteger(p[name]) || p[name] < 0 || p[name] > 100000) {
      throw new Error(`${name} tidak valid`);
    }
  }
  if (p.version === 3) {
    for (const [peak, current, offset] of [
      ['co_peak_ppm', 'co_ppm', 'co_peak_second'],
      ['co2_peak_ppm', 'co2_ppm', 'co2_peak_second'],
    ]) {
      if (!Number.isSafeInteger(p[peak]) || p[peak] < p[current] || p[peak] > 100000 ||
          !Number.isSafeInteger(p[offset]) || p[offset] < 1 || p[offset] > 5) {
        throw new Error(`Jendela telemetry 5 detik tidak valid: ${peak}/${offset}`);
      }
    }
  }
  if (!['normal', 'waspada', 'bahaya'].includes(p.status)) throw new Error('Status gas tidak valid');
  if (!['on', 'off'].includes(p.buzzer_state)) throw new Error('Status buzzer tidak valid');
  if (!(p.version === 3 && p.window_status === null) &&
      (!Number.isSafeInteger(p.window_status) || p.window_status < 0 || p.window_status > 100)) {
    throw new Error('Posisi jendela tidak valid');
  }
  if (p.event_id !== null && (typeof p.event_id !== 'string' || !UUID_PATTERN.test(p.event_id))) {
    throw new Error('event_id harus UUID atau null');
  }
  if (p.status !== 'normal' && !p.event_id) throw new Error('Alarm wajib membawa event_id');
  if (p.status === 'normal' && p.event_id) throw new Error('Event alarm tidak konsisten dengan status normal');
  if (p.status === 'normal' && p.buzzer_state === 'on') throw new Error('Buzzer ON tanpa alarm');
  if (!checkSignature(canonicalReading(p), p.signature, secretForDevice(p.device_id))) {
    throw new Error('HMAC telemetry salah');
  }
  return p;
}

function signedDataAck(deviceId, nonce) {
  const p = { version: 2, device_id: deviceId, nonce, result: 'stored' };
  p.signature = signatureFor(`dataack2|${deviceId}|${nonce}|stored`, secretForDevice(deviceId));
  return p;
}

function signedCommand(deviceId, commandId, alertId, issuedAt) {
  const p = {
    version: 2, device_id: deviceId, command_id: commandId,
    alert_id: alertId, action: 'MUTE_BUZZER', issued_at: issuedAt,
  };
  p.signature = signatureFor(
    `cmd2|${deviceId}|${commandId}|${alertId}|MUTE_BUZZER|${issuedAt}`,
    secretForDevice(deviceId),
  );
  return p;
}

function signedWindowCommand(deviceId, commandId, alertId, action, issuedAt) {
  if (!['WINDOW_OPEN', 'WINDOW_CLOSE'].includes(action) ||
      !UUID_PATTERN.test(commandId || '') || !UUID_PATTERN.test(alertId || '')) {
    throw new Error('Perintah jendela butuh action dan UUID yang valid');
  }
  const p = { version: 3, device_id: deviceId, command_id: commandId,
    alert_id: alertId, action, issued_at: issuedAt };
  p.signature = signatureFor(
    `cmd3|${deviceId}|${commandId}|${alertId}|${action}|${issuedAt}`,
    secretForDevice(deviceId),
  );
  return p;
}

function verifyCommandAck(p) {
  if (!p || ![2, 3].includes(p.version) || !DEVICE_ID_PATTERN.test(p.device_id || '') ||
      !UUID_PATTERN.test(p.command_id || '') || !UUID_PATTERN.test(p.alert_id || '')) {
    throw new Error('ACK command tidak valid');
  }
  let canonical;
  if (p.version === 2) {
    if (!['success', 'failed'].includes(p.result)) throw new Error('ACK v2 tidak valid');
    canonical = `cmdack2|${p.device_id}|${p.command_id}|${p.alert_id}|${p.result}`;
  } else {
    if (!['WINDOW_OPEN', 'WINDOW_CLOSE'].includes(p.action) ||
        !['received', 'failed'].includes(p.result)) throw new Error('ACK jendela tidak valid');
    canonical = `cmdack3|${p.device_id}|${p.command_id}|${p.alert_id}|${p.action}|${p.result}`;
  }
  if (!checkSignature(canonical, p.signature, secretForDevice(p.device_id))) {
    throw new Error('HMAC ACK command salah');
  }
  return p;
}

module.exports = {
  verifyReading, signedDataAck, signedCommand, signedWindowCommand, verifyCommandAck,
  canonicalReading, signatureFor, checkSignature,
};
