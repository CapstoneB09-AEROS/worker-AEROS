// Pemeriksa database untuk worker (hanya MEMBACA; tidak menulis dan tidak butuh ESP).
// Pakai .env yang sama dengan worker. Jalankan: node cek-database.js
// Hasilnya OK atau GAGAL beserta alasannya, tanpa menampilkan kunci atau isi data.
require('dotenv').config();
const supabase = require('./src/config/supabaseClient');

async function cek(nama, fn) {
  try {
    const { error, count } = await fn();
    console.log(error ? `GAGAL  ${nama}: ${error.message}` : `OK     ${nama}${count != null ? ` (${count} baris)` : ''}`);
  } catch (e) {
    console.log(`GAGAL  ${nama}: ${e.message}`);
  }
}

(async () => {
  const deviceId = process.env.DEVICE_ID_CEK || 'AEROS_01';
  await cek('tabel devices bisa dibaca', () => supabase.from('devices').select('device_id,is_active', { count: 'exact' }).limit(1));
  try {
    const { data, error } = await supabase.from('devices').select('device_id,is_active').eq('device_id', deviceId).maybeSingle();
    if (error) console.log(`GAGAL  perangkat ${deviceId}: ${error.message}`);
    else if (!data) console.log(`GAGAL  perangkat ${deviceId}: TIDAK ADA di tabel devices`);
    else console.log(data.is_active ? `OK     perangkat ${deviceId} terdaftar dan aktif` : `GAGAL  perangkat ${deviceId} ada tetapi is_active = false`);
  } catch (e) { console.log(`GAGAL  perangkat ${deviceId}: ${e.message}`); }
  await cek('sensor_readings: kolom yang ditulis worker v3', () => supabase.from('sensor_readings')
    .select('device_id,nonce,co_ppm,co2_ppm,status,window_status,measured_at,received_at,co_peak_ppm,co2_peak_ppm,co_peak_second,co2_peak_second', { count: 'exact' }).limit(1));
  await cek('device_state: kolom yang ditulis worker v3', () => supabase.from('device_state').select('device_id,last_co_ppm,last_co2_ppm,status,buzzer_state,window_status,active_alert_id,updated_at,ack_driver,ack_at,connection_status,last_seen_at', { count: 'exact' }).limit(1));
  await cek('alert_logs bisa dibaca', () => supabase.from('alert_logs').select('*', { count: 'exact' }).limit(1));
  await cek('actuator_logs: kolom perintah (Saya Tahu)', () => supabase.from('actuator_logs').select('device_id,command_id,alert_id,buzzer_state,window_action,trigger_source,execution_status,received_at,created_at', { count: 'exact' }).limit(1));
  process.exit(0);
})();
