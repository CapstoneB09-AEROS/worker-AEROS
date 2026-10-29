const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { signatureFor } = require('../src/services/securityService');

process.env.HMAC_SECRET = 'TEST_ONLY_shared_key_at_least_32_bytes_long_1234';

const alertId = '216b0b86-d596-4c56-9ae0-53394d389025';
const commandId = 'd6fba1bb-5aaf-4f1d-8dfe-e02ae77ca6a2';
const state = { activeAlertId: alertId, resolved: false, row: null, updates: [], published: [] };

function chain(table, selected = '') {
  return {
    selected,
    select(name) { this.selected = name; return this; },
    eq() { return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    update(values) { state.updates.push({ table, values }); return this; },
    async maybeSingle() {
      if (table === 'devices') return { data: { device_id: 'AEROS_01', is_active: true }, error: null };
      if (table === 'alert_logs') return { data: {
        id: alertId, device_id: 'AEROS_01', resolved_at: state.resolved ? new Date().toISOString() : null,
      }, error: null };
      if (table === 'device_state') return { data: {
        active_alert_id: state.activeAlertId,
      }, error: null };
      if (table === 'actuator_logs') return { data: state.row, error: null };
      throw new Error(`unexpected ${table}`);
    },
    then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
  };
}

const db = { from: (table) => chain(table) };
const supabasePath = path.resolve(__dirname, '../src/config/supabaseClient.js');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: db,
};
const { publishPendingCommand, handleCommandAck, actionFromRow } =
  require('../src/services/actuatorService');

const mqtt = {
  connected: true,
  publish(topic, json, opts, cb) {
    state.published.push({ topic, body: JSON.parse(json) });
    cb?.(null);
  },
};

function freshRow(id = commandId, action = 'open') {
  return {
    device_id: 'AEROS_01', command_id: id, alert_id: alertId,
    execution_status: 'pending', trigger_source: 'manual',
    window_action: action, buzzer_state: null, received_at: null,
  };
}

test('window actions are recognized, never confused with mute', () => {
  assert.equal(actionFromRow(freshRow()), 'WINDOW_OPEN');
  assert.equal(actionFromRow(freshRow(commandId, 'closed')), 'WINDOW_CLOSE');
  assert.equal(actionFromRow({ ...freshRow(), received_at: new Date().toISOString() }), null);
  assert.equal(actionFromRow({ ...freshRow(), buzzer_state: 'off' }), null);
});

test('window command is published only for current unresolved gas alert', async () => {
  state.published = [];
  state.resolved = false;
  state.activeAlertId = alertId;
  state.row = freshRow();
  await publishPendingCommand(mqtt, state.row);
  assert.equal(state.published.length, 1);
  assert.equal(state.published[0].topic, 'aeros/AEROS_01/cmd');
  assert.equal(state.published[0].body.action, 'WINDOW_OPEN');

  state.resolved = true;
  await publishPendingCommand(mqtt,
    freshRow('f30ef74f-a0ad-46cb-b969-c538550260a8', 'closed'));
  assert.equal(state.published.length, 1);

  state.resolved = false;
  state.activeAlertId = 'b9a4a2df-6fc1-41e3-913b-9eb90662a358';
  await publishPendingCommand(mqtt,
    freshRow('37b9cd5b-e982-4e43-a9b8-6fac5743c0d6', 'closed'));
  assert.equal(state.published.length, 1);
});

test('signed window ACK received sets received_at only, not execution success', async () => {
  state.activeAlertId = alertId;
  state.resolved = false;
  state.row = freshRow();
  state.updates = [];
  const p = {
    version: 3, device_id: 'AEROS_01', command_id: commandId,
    alert_id: alertId, action: 'WINDOW_OPEN', result: 'received',
  };
  p.signature = signatureFor(
    `cmdack3|AEROS_01|${commandId}|${alertId}|WINDOW_OPEN|received`,
    process.env.HMAC_SECRET,
  );
  await handleCommandAck(Buffer.from(JSON.stringify(p)), 'AEROS_01');
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].table, 'actuator_logs');
  assert.ok(state.updates[0].values.received_at);
  assert.equal('execution_status' in state.updates[0].values, false);

  state.updates = [];
  await handleCommandAck(Buffer.from(JSON.stringify({ ...p, action: 'WINDOW_CLOSE' })), 'AEROS_01');
  assert.equal(state.updates.length, 0);
});
