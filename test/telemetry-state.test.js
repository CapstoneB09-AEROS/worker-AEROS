const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const eventId = '216b0b86-d596-4c56-9ae0-53394d389025';
const calls = { active: null, nonce: '', insertedAlert: null,
  resolved: null, statePatch: null };

const db = {
  from(table) {
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return this; },
      is() { return this; },
      async maybeSingle() {
        if (table === 'sensor_readings') return { data: { nonce: calls.nonce }, error: null };
        if (table === 'device_state') return {
          data: { active_alert_id: calls.active }, error: null,
        };
        if (table === 'alert_logs') return { data: null, error: null };
        throw Error('unexpected ' + table);
      },
      async insert(row) {
        if (table !== 'alert_logs') throw Error('unexpected insert ' + table);
        calls.insertedAlert = row;
        return { error: null };
      },
      update(row) {
        calls.resolved = { table, row };
        return this;
      },
      async upsert(row) {
        calls.statePatch = row;
        return { error: null };
      },
      then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
    };
  },
};

const supabasePath = path.resolve(__dirname, '../src/config/supabaseClient.js');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: db,
};
const { mirrorRecentTelemetry } = require('../src/services/telemetryStateService');
const now = Date.now();

function reading(event = eventId) {
  return {
    device_id: 'AEROS_01', nonce: '0123456789abcdef0123456789abcdef',
    time_valid: true, timestamp: Math.floor(now / 1000),
    event_id: event, status: event ? 'bahaya' : 'normal',
    co_ppm: 50, co2_ppm: 1200, buzzer_state: event ? 'on' : 'off',
    window_status: null,
  };
}

test('current gas event creates a matching alert and resets old confirmation', async () => {
  calls.nonce = reading().nonce;
  calls.active = null;
  assert.equal(await mirrorRecentTelemetry(reading(), now), true);
  assert.equal(calls.insertedAlert.id, eventId);
  assert.equal(calls.statePatch.active_alert_id, eventId);
  assert.equal(calls.statePatch.last_co_ppm, 50);
  assert.equal(calls.statePatch.ack_driver, false);
  assert.equal(calls.statePatch.ack_at, null);
});

test('return to normal resolves old event and clears active alert', async () => {
  calls.active = eventId;
  calls.resolved = null;
  assert.equal(await mirrorRecentTelemetry(reading(null), now), true);
  assert.equal(calls.resolved.table, 'alert_logs');
  assert.ok(calls.resolved.row.resolved_at);
  assert.equal(calls.statePatch.active_alert_id, null);
  assert.equal(calls.statePatch.ack_driver, false);
});

test('old/offline telemetry cannot re-open a resolved gas alert', async () => {
  calls.insertedAlert = null;
  calls.statePatch = null;
  assert.equal(await mirrorRecentTelemetry({ ...reading(),
    timestamp: Math.floor((now - 600000) / 1000),
  }, now), false);
  assert.equal(calls.insertedAlert, null);
  assert.equal(calls.statePatch, null);
});
