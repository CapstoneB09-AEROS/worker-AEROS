// Kirim SATU pesan telemetri versi 4 bertanda tangan ke HiveMQ untuk menguji worker (tanpa ESP).
// Tanpa argumen: hanya MENCETAK pesan (tidak mengirim). Dengan --kirim: mengirim ke aeros/<device>/telemetry.
// Pakai .env yang sama dengan worker; pengguna MQTT-nya harus boleh publish ke aeros/+/telemetry.
// Pesan bertanda demo=true, jadi worker menolaknya kecuali ALLOW_DEMO_READINGS=true.
// Contoh:  node publish-uji.js                       -> cetak pesan normal
//          node publish-uji.js --co2 1 --kirim       -> kirim waspada CO2 (co2_level 1)
//          node publish-uji.js --co 2 --kirim        -> kirim bahaya CO
require('dotenv').config();
const crypto = require('node:crypto');
const mqtt = require('mqtt');
const { canonicalReading, signatureFor } = require('./src/services/securityService');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const coLevel = Number(arg('co', 0));
const co2Level = Number(arg('co2', 0));
const deviceId = arg('device', process.env.DEVICE_ID_CEK || 'AEROS_01');
const alarm = Math.max(coLevel, co2Level) > 0;

const p = {
  version: 4, device_id: deviceId, nonce: crypto.randomBytes(16).toString('hex'),
  timestamp: Math.floor(Date.now() / 1000), time_valid: true,
  co_ppm: coLevel ? 40 : 0, co2_ppm: co2Level ? (co2Level === 2 ? 4100 : 2600) : 700,
  co_peak_ppm: coLevel ? 42 : 0, co2_peak_ppm: co2Level ? (co2Level === 2 ? 4150 : 2650) : 710,
  co_peak_second: 1, co2_peak_second: 1, co_level: coLevel, co2_level: co2Level,
  buzzer_state: alarm ? 'on' : 'off', window_status: null,
  event_id: alarm ? crypto.randomUUID() : null, demo: true,
};
p.signature = signatureFor(canonicalReading(p), process.env.HMAC_SECRET);
console.log(JSON.stringify(p, null, 2));
if (!process.argv.includes('--kirim')) process.exit(0);

const client = mqtt.connect(`mqtts://${process.env.HIVEMQ_HOST}:${process.env.HIVEMQ_PORT || 8883}`, {
  clientId: `publish_uji_${crypto.randomBytes(4).toString('hex')}`, clean: true,
  username: process.env.HIVEMQ_USERNAME, password: process.env.HIVEMQ_PASSWORD,
});
client.on('connect', () => {
  client.publish(`aeros/${deviceId}/telemetry`, JSON.stringify(p), { qos: 1 }, (err) => {
    console.log(err ? 'GAGAL kirim: ' + err.message : 'Terkirim ke aeros/' + deviceId + '/telemetry');
    client.end();
  });
});
client.on('error', (err) => { console.error('[MQTT ERROR]', err.message); process.exit(1); });
