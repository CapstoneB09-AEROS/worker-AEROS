const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyReading, canonicalReading, signatureFor, signedDataAck,
} = require('../src/services/securityService');

process.env.HMAC_SECRET = 'TEST_ONLY_shared_key_at_least_32_bytes_long_1234';
delete process.env.ACCEPT_V3;

function signedReading(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const p = {
    version: 3, device_id: 'AEROS_01',
    nonce: '0123456789abcdef0123456789abcdef',
    timestamp: now, time_valid: true, co_ppm: 26, co2_ppm: 780,
    co_peak_ppm: 30, co2_peak_ppm: 790, co_peak_second: 2, co2_peak_second: 4,
    status: 'normal', buzzer_state: 'off', window_status: 0,
    event_id: null, demo: true, ...overrides,
  };
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}

function signedReadingV4(overrides = {}) {
  const p = signedReading({ version: 4, co_level: 0, co2_level: 0, ...overrides });
  delete p.status;
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}

const eventId = '216b0b86-d596-4c56-9ae0-53394d389025';

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
  assert.throws(() => verifyReading(signedReading({ timestamp: Math.floor(Date.now() / 1000) + 3600 })), /Timestamp/);
});

test('offline pre-NTP reading is explicitly marked, never falsely timestamped', () => {
  const p = signedReading({ timestamp: 0, time_valid: false });
  assert.equal(verifyReading(p).time_valid, false);
});

test('versi 2 ditolak', () => {
  assert.throws(() => verifyReading({ ...signedReading(), version: 2 }), /Versi/);
});

test('data ACK signing (dataack2 tidak berubah)', () => {
  const p = signedDataAck('AEROS_01', '0123456789abcdef0123456789abcdef');
  assert.equal(p.signature, signatureFor(
    'dataack2|AEROS_01|0123456789abcdef0123456789abcdef|stored',
    process.env.HMAC_SECRET,
  ));
});

test('v3: reading kelima beserta puncak 5 detik ditandatangani', () => {
  const p = signedReading({
    nonce: '1234567890abcdef1234567890abcdef', demo: false,
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

test('v3: tingkat dipetakan ke co2_level (jenis gas tidak dikirim)', () => {
  const waspada = verifyReading(signedReading({ status: 'waspada', event_id: eventId, buzzer_state: 'on' }));
  assert.equal(waspada.co_level, 0);
  assert.equal(waspada.co2_level, 1);
  const bahaya = verifyReading(signedReading({ status: 'bahaya', event_id: eventId, buzzer_state: 'on' }));
  assert.equal(bahaya.co2_level, 2);
  assert.equal(verifyReading(signedReading()).co2_level, 0);
});

test('v3: ACCEPT_V3=false menolak versi 3, versi 4 tetap lolos', () => {
  process.env.ACCEPT_V3 = 'false';
  try {
    assert.throws(() => verifyReading(signedReading()), /ACCEPT_V3/);
    assert.equal(verifyReading(signedReadingV4()).version, 4);
  } finally {
    delete process.env.ACCEPT_V3;
  }
});

test('v4: status dihitung dari tingkat tertinggi kedua gas', () => {
  assert.equal(verifyReading(signedReadingV4()).status, 'normal');
  const co = verifyReading(signedReadingV4({ co_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(co.status, 'waspada');
  const campur = verifyReading(signedReadingV4({ co_level: 1, co2_level: 2, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(campur.status, 'bahaya');
  assert.equal(campur.co_level, 1);
  assert.equal(campur.co2_level, 2);
});

test('v4: status kiriman pengirim diabaikan, dihitung ulang', () => {
  const p = signedReadingV4();
  p.status = 'bahaya';
  assert.equal(verifyReading(p).status, 'normal');
});

test('v4: mengubah co_level atau co2_level menolak (HMAC)', () => {
  for (const field of ['co_level', 'co2_level']) {
    const p = signedReadingV4({ event_id: eventId, co2_level: 1, buzzer_state: 'on' });
    p[field] = 2;
    assert.throws(() => verifyReading(p), /HMAC/);
  }
});

test('v4: tingkat di luar 0 sampai 2 atau bukan bilangan bulat ditolak', () => {
  for (const value of [3, -1, 1.5, '1', null]) {
    assert.throws(() => verifyReading(signedReadingV4({ co2_level: value })), /co2_level/);
    assert.throws(() => verifyReading(signedReadingV4({ co_level: value })), /co_level/);
  }
});

test('v4: aturan keselarasan event_id, status, dan buzzer', () => {
  assert.throws(() => verifyReading(signedReadingV4({ co2_level: 1, buzzer_state: 'on' })), /event_id/);
  assert.throws(() => verifyReading(signedReadingV4({ event_id: eventId })), /tidak konsisten/);
  assert.throws(() => verifyReading(signedReadingV4({ buzzer_state: 'on' })), /Buzzer/);
});

test('v4: puncak 5 detik tetap diperiksa', () => {
  assert.throws(() => verifyReading(signedReadingV4({ co2_peak_second: 6 })), /Jendela telemetry/);
  assert.throws(() => verifyReading(signedReadingV4({ co_peak_ppm: 1 })), /Jendela telemetry/);
});

test('kontrak r4: string kanonik dan HMAC sama dengan contoh di rancangan-worker-mvp.md', () => {
  const secret = 'uji-HMAC-secret-uji-HMAC-secret-01';
  assert.equal(Buffer.byteLength(secret, 'utf8'), 34);
  const p = {
    version: 4, device_id: 'AEROS_01', nonce: '0123456789abcdef0123456789abcdef',
    timestamp: 1793000000, time_valid: true, co_ppm: 12, co2_ppm: 950,
    co_peak_ppm: 15, co2_peak_ppm: 962, co_peak_second: 2, co2_peak_second: 4,
    co_level: 0, co2_level: 1, buzzer_state: 'on', window_status: 0,
    event_id: eventId, demo: false,
  };
  const canonical = canonicalReading(p);
  assert.equal(canonical,
    'r4|AEROS_01|0123456789abcdef0123456789abcdef|1793000000|1|12|950|15|962|2|4|0|1|on|0|' +
    '216b0b86-d596-4c56-9ae0-53394d389025|0');
  const signature = signatureFor(canonical, secret);
  assert.equal(signature, '02fc8cb02d9ccde1854f18fd7ba33df4b36db52fbc56ee4bf5df1e8bf18c2418');
  const saved = process.env.HMAC_SECRET;
  process.env.HMAC_SECRET = secret;
  try {
    assert.equal(verifyReading({ ...p, signature }, 1793000000).status, 'waspada');
  } finally {
    process.env.HMAC_SECRET = saved;
  }
});
