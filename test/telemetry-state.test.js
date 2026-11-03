const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const eventId = '216b0b86-d596-4c56-9ae0-53394d389025';
const calls = { active: null, nonce: '', alertInserts: 0, updates: [], statePatch: null };

const db = {
  from(table) {
    return {
      select() { return this; },
      eq() { return this; },
      neq() { return this; },
      order() { return this; },
      limit() { return this; },
      is() { return this; },
      async maybeSingle() {
        if (table === 'sensor_readings') return { data: { nonce: calls.nonce }, error: null };
        if (table === 'device_state') return {
          data: { active_alert_id: calls.active }, error: null,
        };
        throw Error('unexpected ' + table);
      },
      async insert() {
        if (table === 'alert_logs') calls.alertInserts++;
        throw Error('mirror tidak boleh menyisipkan ' + table);
      },
      update(row) {
        calls.updates.push({ table, row });
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

function reading(event = eventId, status = event ? 'bahaya' : 'normal') {
  return {
    device_id: 'AEROS_01', nonce: '0123456789abcdef0123456789abcdef',
    time_valid: true, timestamp: Math.floor(now / 1000),
    event_id: event, status,
    co_ppm: 50, co2_ppm: 1200, buzzer_state: event ? 'on' : 'off',
    window_status: null,
  };
}
function reset() {
  Object.assign(calls, { active: null, nonce: reading().nonce, alertInserts: 0, updates: [], statePatch: null });
}

test('keadaan terkini ditulis dengan peringatan aktif dan tanpa ack_driver/ack_at', async () => {
  reset();
  assert.equal(await mirrorRecentTelemetry(reading(), now), true);
  assert.equal(calls.statePatch.active_alert_id, eventId);
  assert.equal(calls.statePatch.last_co_ppm, 50);
  assert.equal(calls.statePatch.status, 'bahaya');
  assert.equal('ack_driver' in calls.statePatch, false);
  assert.equal('ack_at' in calls.statePatch, false);
});

test('mirror tidak lagi membuat peringatan (dibuat lebih dulu oleh handler)', async () => {
  reset();
  assert.equal(await mirrorRecentTelemetry(reading(), now), true);
  assert.equal(calls.alertInserts, 0);
});

test('tingkat naik ke bahaya menaikkan alert_type; waspada tidak menyentuhnya', async () => {
  reset();
  await mirrorRecentTelemetry(reading(eventId, 'waspada'), now);
  assert.equal(calls.updates.filter((u) => u.row.alert_type).length, 0);
  reset();
  await mirrorRecentTelemetry(reading(eventId, 'bahaya'), now);
  const naik = calls.updates.filter((u) => u.row.alert_type);
  assert.equal(naik.length, 1);
  assert.deepEqual(naik[0].row, { alert_type: 'bahaya' });
});

test('return to normal resolves old event and clears active alert', async () => {
  reset();
  calls.active = eventId;
  assert.equal(await mirrorRecentTelemetry(reading(null), now), true);
  const closed = calls.updates.filter((u) => u.table === 'alert_logs' && u.row.resolved_at);
  assert.equal(closed.length, 1);
  assert.equal(calls.statePatch.active_alert_id, null);
  assert.equal(calls.statePatch.status, 'normal');
});

test('episode baru menutup episode sebelumnya', async () => {
  reset();
  calls.active = '11111111-1111-4111-8111-111111111111';
  assert.equal(await mirrorRecentTelemetry(reading(eventId, 'waspada'), now), true);
  const closed = calls.updates.filter((u) => u.row.resolved_at);
  assert.equal(closed.length, 1);
  assert.equal(calls.statePatch.active_alert_id, eventId);
});

test('old/offline telemetry cannot re-open a resolved gas alert', async () => {
  reset();
  assert.equal(await mirrorRecentTelemetry({ ...reading(),
    timestamp: Math.floor((now - 600000) / 1000),
  }, now), false);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.statePatch, null);
});
