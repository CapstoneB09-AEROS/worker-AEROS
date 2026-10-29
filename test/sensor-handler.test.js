const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { canonicalReading, signatureFor } = require('../src/services/securityService');

process.env.HMAC_SECRET = 'TEST_ONLY_shared_key_at_least_32_bytes_long_1234';
process.env.ALLOW_DEMO_READINGS = 'true';

const calls = { insert: 0, ack: [], device: 0, result: null, existing: true,
  row: null, state: null };
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
function input() {
  const p = {
    version: 2, device_id: 'AEROS_01',
    nonce: '0123456789abcdef0123456789abcdef',
    timestamp: Math.floor(Date.now() / 1000), time_valid: true,
    co_ppm: 10, co2_ppm: 500, status: 'normal', buzzer_state: 'off',
    window_status: 0, event_id: null, demo: true,
  };
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  return p;
}
function reset() { calls.insert = 0; calls.ack = []; calls.device = 0;
  calls.result = null; calls.existing = true; calls.row = null; calls.state = null; }

test('DB success leads to signed ACK', async () => {
  reset();
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(input())));
  assert.equal(calls.insert, 1);
  assert.equal(calls.ack.length, 1);
  assert.equal(calls.ack[0].payload.result, 'stored');
});
test('tampering never accesses database or publishes ACK', async () => {
  reset();
  const p = input();
  p.co_ppm = 999;
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(p)));
  assert.equal(calls.device, 0);
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});
test('unavailable DB never acknowledges a reading', async () => {
  reset();
  calls.result = { error: { code: '500', message: 'DB unavailable' } };
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(input())));
  assert.equal(calls.ack.length, 0);
});
test('duplicate is acknowledged only after checking the existing DB row', async () => {
  reset();
  calls.result = { error: { code: '23505', message: 'duplicate key' } };
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(input())));
  assert.equal(calls.ack.length, 1);
  reset();
  calls.result = { error: { code: '23505', message: 'duplicate key' } };
  calls.existing = false;
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(input())));
  assert.equal(calls.ack.length, 0);
});

test('v3: one five-sample aggregate stored with both peaks, state, and per-device DB ACK', async () => {
  reset();
  const p = { ...input(), version: 3, demo: false,
    co_ppm: 19, co2_ppm: 530, co_peak_ppm: 74, co2_peak_ppm: 810,
    co_peak_second: 2, co2_peak_second: 4, window_status: null };
  p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(p)), 'AEROS_01');
  assert.equal(calls.insert, 1);
  assert.equal(calls.row.co_peak_ppm, 74);
  assert.equal(calls.row.co2_peak_ppm, 810);
  assert.equal(calls.row.co_peak_second, 2);
  assert.equal(calls.row.co2_peak_second, 4);
  assert.equal(calls.state.last_co_ppm, 19);
  assert.equal(calls.ack[0].topic, 'aeros/AEROS_01/telemetry/ack');
  reset();
  await handleSensorMessage(mqtt, Buffer.from(JSON.stringify(p)), 'AEROS_02');
  assert.equal(calls.insert, 0);
  assert.equal(calls.ack.length, 0);
});
