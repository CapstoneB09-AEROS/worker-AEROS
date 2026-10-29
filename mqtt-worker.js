require('dotenv').config();
const createMqttClient = require('./src/config/mqttClient');
const { handleSensorMessage } = require('./src/handlers/sensorDataHandler');
const { handleDevicePresence } = require('./src/services/stateService');
const { handleCommandAck, reconcilePendingCommands } = require('./src/services/actuatorService');
const { subscribePendingCommands } = require('./src/services/realtimeAckService');

if (!process.env.HMAC_SECRET || Buffer.byteLength(process.env.HMAC_SECRET, 'utf8') < 32) {
  throw new Error('HMAC_SECRET belum aman: minimal 32 byte, sama dengan ESP32');
}
const client = createMqttClient();
subscribePendingCommands(client);

client.on('connect', () => {
  console.log('[MQTT] HiveMQ Cloud TLS terhubung (certificate verified)');
  for (const topic of ['aeros/data', 'aeros/+/telemetry',
    'aeros/+/status', 'aeros/+/command/ack', 'aeros/+/cmd/ack']) {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe gagal:', topic, err.message);
      else console.log('[MQTT] Subscribe:', topic);
    });
  }
  void reconcilePendingCommands(client).catch((err) => console.error('[RECONCILE]', err));
});

client.on('message', (topic, payload) => {
  if (topic === 'aeros/data') return void handleSensorMessage(client, payload);
  const telemetry = /^aeros\/([A-Za-z0-9_-]+)\/telemetry$/.exec(topic);
  if (telemetry) return void handleSensorMessage(client, payload, telemetry[1]);
  const presence = /^aeros\/([A-Za-z0-9_-]+)\/status$/.exec(topic);
  if (presence) {
    return void handleDevicePresence(presence[1], payload.toString('utf8'))
      .catch((err) => console.warn('[PRESENCE REJECTED]', err.message));
  }
  const ack = /^aeros\/([A-Za-z0-9_-]+)\/(?:command|cmd)\/ack$/.exec(topic);
  if (ack) return void handleCommandAck(payload, ack[1]);
});

setInterval(() => {
  void reconcilePendingCommands(client).catch((err) => console.error('[RECONCILE]', err));
}, 15000).unref();

client.on('reconnect', () => console.log('[MQTT] Menghubungkan ulang ...'));
client.on('offline', () => console.warn('[MQTT] Worker offline'));
client.on('error', (err) => console.error('[MQTT ERROR]', err.message));

