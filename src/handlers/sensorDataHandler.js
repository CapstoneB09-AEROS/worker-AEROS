const supabase = require('../config/supabaseClient');
const { verifyReading, signedDataAck } = require('../services/securityService');
const { assertActiveDevice } = require('../services/deviceRegistry');
const { mirrorRecentTelemetry } = require('../services/telemetryStateService');

async function persistReading(p) {
  const receivedAt = new Date().toISOString();
  const row = {
    device_id: p.device_id, nonce: p.nonce,
    co_ppm: p.co_ppm, co2_ppm: p.co2_ppm, status: p.status,
    window_status: p.window_status,
    // No NTP on first boot: receivedAt is an estimate, not a true measurement timestamp.
    measured_at: p.time_valid ? new Date(p.timestamp * 1000).toISOString() : receivedAt,
    received_at: receivedAt,
  };
  if (p.version === 3) {
    Object.assign(row, {
      co_peak_ppm: p.co_peak_ppm, co2_peak_ppm: p.co2_peak_ppm,
      co_peak_second: p.co_peak_second, co2_peak_second: p.co2_peak_second,
    });
  }
  const { error } = await supabase.from('sensor_readings').insert(row);
  if (!error) return 'new';
  if (error.code !== '23505') throw new Error('INSERT sensor_readings: ' + error.message);
  // A UNIQUE constraint violation might be on some other column: prove this reading exists.
  const found = await supabase.from('sensor_readings').select('id')
    .eq('device_id', p.device_id).eq('nonce', p.nonce).maybeSingle();
  if (found.error || !found.data) throw new Error('Duplicate belum dapat dibuktikan di database');
  return 'duplicate';
}

async function handleSensorMessage(mqttClient, rawPayload, topicDeviceId = null) {
  try {
    const p = verifyReading(JSON.parse(rawPayload.toString('utf8')));
    if (topicDeviceId && p.device_id !== topicDeviceId) {
      throw new Error('device_id payload tidak cocok dengan topik MQTT');
    }
    if (p.demo && process.env.ALLOW_DEMO_READINGS !== 'true') {
      throw new Error('Pembacaan simulasi diblokir (ALLOW_DEMO_READINGS=false)');
    }
    await assertActiveDevice(p.device_id);
    const status = await persistReading(p);
    // DB ACK confirms the telemetry row; mirroring state/alerts is best-effort
    // and must not cause already-stored offline data to be retransmitted forever.
    try {
      await mirrorRecentTelemetry(p);
    } catch (err) {
      console.error('[STATE MIRROR]', p.device_id, err.message);
    }
    // Only after DB confirms insert or verified duplicate.
    mqttClient.publish('aeros/' + p.device_id +
      (p.version === 3 ? '/telemetry/ack' : '/data/ack'),
      JSON.stringify(signedDataAck(p.device_id, p.nonce)), { qos: 1, retain: false },
      (err) => { if (err) console.error('[ACK DATA]', err.message); });
    console.log('[READING]', p.device_id, p.nonce, status,
      p.time_valid ? 'timestamp-valid' : 'estimated-time', p.demo ? 'DEMO' : 'REAL');
  } catch (err) {
    console.warn('[READING REJECTED]', err.message);
  }
}
module.exports = { handleSensorMessage, persistReading };

