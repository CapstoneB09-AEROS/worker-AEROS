const mqtt = require('mqtt');
const crypto = require('node:crypto');
require('dotenv').config();

function createMqttClient() {
  const host = process.env.HIVEMQ_HOST || process.env.MQTT_HOST;
  const username = process.env.HIVEMQ_USERNAME || process.env.MQTT_USERNAME;
  const password = process.env.HIVEMQ_PASSWORD || process.env.MQTT_PASSWORD;
  const port = Number(process.env.HIVEMQ_PORT || 8883);
  if (!host || !username || !password || !Number.isInteger(port)) {
    throw new Error('Konfigurasi HiveMQ TLS belum lengkap');
  }
  return mqtt.connect({
    host, port, protocol: 'mqtts', username, password,
    clientId: 'aeros-worker-' + crypto.randomBytes(6).toString('hex'),
    rejectUnauthorized: true, clean: true, reconnectPeriod: 5000,
    connectTimeout: 15000, keepalive: 30,
  });
}
module.exports = createMqttClient;

