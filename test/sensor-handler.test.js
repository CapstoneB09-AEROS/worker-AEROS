const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { canonicalReading, signatureFor } = require('../src/services/securityService');

process.env.HMAC_SECRET = 'TEST_ONLY_shared_key_at_least_32_bytes_long_1234';
process.env.ALLOW_DEMO_READINGS = 'true';
delete process.env.WRITE_STATUS_COLUMN;
delete process.env.ACCEPT_V3;

const eventId = '216b0b86-d596-4c56-9ae0-53394d389025';
const calls = { insert: 0, ack: [], device: 0, result: null, existing: true,
  row: null, state: null, order: [], alert: null, alertResult: null,
  alertOwner: 'AEROS_01', alertFound: true };
const db = {
  from(table) {
    if (table === 'devices') {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          calls.device++;
          return { data: { device_id: 'AEROS_01', is_active: true }, error: null };
        },
      };
    }
    if (table === 'alert_logs') {
      return {
        select() { return this; }, eq() { return this; },
        neq() { return this; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
        update() { return this; },
        async insert(row) {
          calls.order.push('alert');
          calls.alert = row;
          return calls.alertResult || { error: null };
        },
        async maybeSingle() {
          return { data: calls.alertFound ? { device_id: calls.alertOwner } : null, error: null };
        },
      };
    }
    if (table === 'device_state') {
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { active_alert_id: null }, error: null }; },
        async upsert(patch) { calls.state = patch; return { error: null }; },
      };
    }
    if (table !== 'sensor_readings') throw Error('unexpected table: ' + table);
    return {
      selected: '',
      async insert(row) {
        calls.order.push('reading');
        calls.insert++;
        calls.row = row;
        return calls.result || { error: null };
      },
      select(cols) { this.selected = cols; return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return this; },
      async maybeSingle() {
        const data = calls.existing ? (this.selected === 'nonce'
          ? { nonce: calls.row?.nonce }
          : { id: 'stored-uuid' }) : null;
        return { data, error: null };
      },
    };
  },
};
const supabasePath = path.resolve(__dirname, '../src/config/supabaseClient.js');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: db };
const { handleSensorMessage } = require('../src/handlers/sensorDataHandler');
const mqtt = {
  publish(topic, payload, opts, callback) {
    calls.ack.push({ topic, payload: JSON.parse(payload) });
    callback?.(null);
  },
};
function input(overrides = {}) {
  const p = {
    version: 3, device_id: 'AEROS_01',
    nonce: '0123456789abcdef0123456789abcdef',
    timestamp: Math.floor(Date.now() / 1000), time_valid: true,
    co_ppm: 10, co2_ppm: 500, co_peak_ppm: 12, co2_peak_ppm: 510,
    co_peak_second: 1, co2_peak_second: 3, status: 'normal', buzzer_state: 'off',
    window_status: null, event_id: null, demo: true, ...overrides,
  };
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}
function inputV4(overrides = {}) {
  const p = input({ version: 4, co_level: 0, co2_level: 0, ...overrides });
  delete p.status;
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}
function reset() {
  Object.assign(calls, { insert: 0, ack: [], device: 0, result: null, existing: true,
    row: null, state: null, order: [], alert: null, alertResult: null,
    alertOwner: 'AEROS_01', alertFound: true });
  delete process.env.WRITE_STATUS_COLUMN;
}
const send = (p, topicDevice = null) => handleSensorMessage(mqtt, Buffer.from(JSON.stringify(p)), topicDevice);

test('DB success leads to signed ACK', async () => {
  reset();
  await send(input());
  assert.equal(calls.insert, 1);
  assert.equal(calls.ack.length, 1);
  assert.equal(calls.ack[0].payload.result, 'stored');
});
test('tampering never accesses database or publishes ACK', async () => {
  reset();
  const p = input();
  p.co_ppm = 999;
  await send(p);
  assert.equal(calls.device, 0);
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});
test('unavailable DB never acknowledges a reading', async () => {
  reset();
  calls.result = { error: { code: '500', message: 'DB unavailable' } };
  await send(input());
  assert.equal(calls.ack.length, 0);
});
test('duplicate is acknowledged only after checking the existing DB row', async () => {
  reset();
  calls.result = { error: { code: '23505', message: 'duplicate key' } };
  await send(input());
  assert.equal(calls.ack.length, 1);
  reset();
  calls.result = { error: { code: '23505', message: 'duplicate key' } };
  calls.existing = false;
  await send(input());
  assert.equal(calls.ack.length, 0);
});

test('v3: one five-sample aggregate stored with both peaks, state, and per-device DB ACK', async () => {
  reset();
  const p = input({ demo: false, co_ppm: 19, co2_ppm: 530, co_peak_ppm: 74, co2_peak_ppm: 810,
    co_peak_second: 2, co2_peak_second: 4 });
  await send(p, 'AEROS_01');
  assert.equal(calls.insert, 1);
  assert.equal(calls.row.co_peak_ppm, 74);
  assert.equal(calls.row.co2_peak_ppm, 810);
  assert.equal(calls.row.co_peak_second, 2);
  assert.equal(calls.row.co2_peak_second, 4);
  assert.equal(calls.state.last_co_ppm, 19);
  assert.equal(calls.ack[0].topic, 'aeros/AEROS_01/telemetry/ack');
  reset();
  await send(p, 'AEROS_02');
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});

test('v4: baris bacaan memuat co_level, co2_level, buzzer_state, event_id, dan ACK ke /telemetry/ack', async () => {
  reset();
  await send(inputV4({ co_level: 1, co2_level: 2, event_id: eventId, buzzer_state: 'on' }), 'AEROS_01');
  assert.equal(calls.row.co_level, 1);
  assert.equal(calls.row.co2_level, 2);
  assert.equal(calls.row.buzzer_state, 'on');
  assert.equal(calls.row.event_id, eventId);
  assert.equal(calls.row.status, 'bahaya');
  assert.equal(calls.state.status, 'bahaya');
  assert.equal(calls.ack[0].topic, 'aeros/AEROS_01/telemetry/ack');
});

test('v3: bacaan tanpa jenis gas disimpan sebagai co2_level, co_level 0', async () => {
  reset();
  await send(input({ status: 'waspada', event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.row.co_level, 0);
  assert.equal(calls.row.co2_level, 1);
  assert.equal(calls.row.event_id, eventId);
});

test('peringatan disisipkan SEBELUM bacaan, dengan id = event_id dan tanpa created_at', async () => {
  reset();
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.deepEqual(calls.order, ['alert', 'reading']);
  assert.deepEqual(calls.alert, { id: eventId, device_id: 'AEROS_01', alert_type: 'waspada' });
  assert.equal(calls.ack.length, 1);
});

test('bacaan tanpa event_id tidak menyentuh alert_logs', async () => {
  reset();
  await send(inputV4());
  assert.deepEqual(calls.order, ['reading']);
  assert.equal(calls.row.event_id, null);
});

test('menyimpan peringatan gagal: bacaan tidak disimpan dan tidak ada ACK', async () => {
  reset();
  calls.alertResult = { error: { code: '500', message: 'DB unavailable' } };
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});

test('peringatan sudah ada (pesan ulang): bacaan disimpan dan di-ACK', async () => {
  reset();
  calls.alertResult = { error: { code: '23505', message: 'duplicate key' } };
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.insert, 1);
  assert.equal(calls.ack.length, 1);
});

test('event_id milik perangkat lain ditolak: tanpa bacaan dan tanpa ACK', async () => {
  reset();
  calls.alertResult = { error: { code: '23505', message: 'duplicate key' } };
  calls.alertOwner = 'AEROS_02';
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});

test('peringatan duplikat yang tidak dapat dibuktikan ditolak', async () => {
  reset();
  calls.alertResult = { error: { code: '23505', message: 'duplicate key' } };
  calls.alertFound = false;
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});

test('WRITE_STATUS_COLUMN: status ditulis secara bawaan, tidak ditulis bila false', async () => {
  reset();
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal(calls.row.status, 'waspada');
  reset();
  process.env.WRITE_STATUS_COLUMN = 'false';
  await send(inputV4({ co2_level: 1, event_id: eventId, buzzer_state: 'on' }));
  assert.equal('status' in calls.row, false);
  assert.equal(calls.row.co2_level, 1);
  assert.equal(calls.ack.length, 1);
  reset();
});
