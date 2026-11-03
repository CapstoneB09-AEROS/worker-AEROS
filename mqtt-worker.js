require('dotenv').config();
const createMqttClient = require('./src/config/mqttClient');
const { handleSensorMessage } = require('./src/handlers/sensorDataHandler');
const { handleDevicePresence } = require('./src/services/stateService');

if (!process.env.HMAC_SECRET || Buffer.byteLength(process.env.HMAC_SECRET, 'utf8') < 32) {
  throw new Error('HMAC_SECRET belum aman: minimal 32 byte, sama dengan ESP32');
}
const client = createMqttClient();

client.on('connect', () => {
  console.log('[MQTT] HiveMQ Cloud TLS terhubung (certificate verified)');
  for (const topic of ['aeros/+/telemetry', 'aeros/+/status']) {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe gagal:', topic, err.message);
      else console.log('[MQTT] Subscribe:', topic);
    });
  }
});

client.on('message', (topic, payload) => {
  const telemetry = /^aeros\/([A-Za-z0-9_-]+)\/telemetry$/.exec(topic);
  if (telemetry) return void handleSensorMessage(client, payload, telemetry[1]);
  const presence = /^aeros\/([A-Za-z0-9_-]+)\/status$/.exec(topic);
  if (presence) {
    return void handleDevicePresence(presence[1], payload.toString('utf8'))
      .catch((err) => console.warn('[PRESENCE REJECTED]', err.message));
  }
});

client.on('reconnect', () => console.log('[MQTT] Menghubungkan ulang ...'));
client.on('offline', () => console.warn('[MQTT] Worker offline'));
client.on('error', (err) => console.error('[MQTT ERROR]', err.message));

