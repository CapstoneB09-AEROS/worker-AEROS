const crypto = require('node:crypto');

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const LEVEL_NAMES = ['normal', 'waspada', 'bahaya'];

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
  // Versi 4 menandatangani co_level|co2_level sebagai ganti status.
  const gas = p.version === 4
    ? [p.co_level, p.co2_level]
    : [p.status];
  return [
    p.version === 4 ? 'r4' : 'r3', p.device_id, p.nonce, p.timestamp, Number(p.time_valid),
    p.co_ppm, p.co2_ppm, p.co_peak_ppm, p.co2_peak_ppm,
    p.co_peak_second, p.co2_peak_second, ...gas, p.buzzer_state,
    p.window_status === null ? '-' : p.window_status,
    p.event_id || '-', Number(p.demo),
  ].join('|');
}

function verifyReading(p, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!p || ![3, 4].includes(p.version) || !DEVICE_ID_PATTERN.test(p.device_id || '')) {
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
  for (const [peak, current, offset] of [
    ['co_peak_ppm', 'co_ppm', 'co_peak_second'],
    ['co2_peak_ppm', 'co2_ppm', 'co2_peak_second'],
  ]) {
    if (!Number.isSafeInteger(p[peak]) || p[peak] < p[current] || p[peak] > 100000 ||
        !Number.isSafeInteger(p[offset]) || p[offset] < 1 || p[offset] > 5) {
      throw new Error(`Jendela telemetry 5 detik tidak valid: ${peak}/${offset}`);
    }
  }
  if (p.version === 4) {
    for (const name of ['co_level', 'co2_level']) {
      if (!Number.isInteger(p[name]) || p[name] < 0 || p[name] > 2) throw new Error(`${name} tidak valid`);
    }
    p.status = LEVEL_NAMES[Math.max(p.co_level, p.co2_level)];   // status tidak dikirim; dihitung di sini
  } else {
    if (process.env.ACCEPT_V3 === 'false') throw new Error('Versi 3 ditolak (ACCEPT_V3=false)');
    if (!LEVEL_NAMES.includes(p.status)) throw new Error('Status gas tidak valid');
    p.co_level = 0;                                 // versi 3 tidak membawa jenis gas: dianggap CO2
    p.co2_level = LEVEL_NAMES.indexOf(p.status);
  }
  if (!['on', 'off'].includes(p.buzzer_state)) throw new Error('Status buzzer tidak valid');
  if (p.window_status !== null &&
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

module.exports = {
  verifyReading, signedDataAck, canonicalReading, signatureFor, checkSignature,
};
