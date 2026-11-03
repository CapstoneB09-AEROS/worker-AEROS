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
  await cek('sensor_readings: kolom yang ditulis worker (termasuk co_level, co2_level, buzzer_state, event_id)', () => supabase.from('sensor_readings')
    .select('device_id,nonce,co_ppm,co2_ppm,status,window_status,measured_at,received_at,co_peak_ppm,co2_peak_ppm,co_peak_second,co2_peak_second,co_level,co2_level,buzzer_state,event_id', { count: 'exact' }).limit(1));
  await cek('device_state: kolom yang ditulis worker', () => supabase.from('device_state').select('device_id,last_co_ppm,last_co2_ppm,status,buzzer_state,window_status,active_alert_id,updated_at,connection_status,last_seen_at', { count: 'exact' }).limit(1));
  await cek('alert_logs: kolom yang ditulis worker', () => supabase.from('alert_logs').select('id,device_id,alert_type,created_at,resolved_at', { count: 'exact' }).limit(1));
  await cek('v_alerts bisa dibaca (untuk aplikasi)', () => supabase.from('v_alerts').select('id,device_id,created_at,resolved_at,tingkat,gas', { count: 'exact' }).limit(1));
  await cek('v_alert_gas bisa dibaca', () => supabase.from('v_alert_gas').select('alert_id,gas,tingkat_maks,puncak_ppm,mulai_at', { count: 'exact' }).limit(1));
  process.exit(0);
})();
