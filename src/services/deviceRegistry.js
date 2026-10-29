const supabase = require('../config/supabaseClient');

async function assertActiveDevice(deviceId) {
  const { data, error } = await supabase.from('devices')
    .select('device_id,is_active').eq('device_id', deviceId).maybeSingle();
  if (error) throw new Error(`Pemeriksaan devices gagal: ${error.message}`);
  if (!data || !data.is_active) throw new Error(`Perangkat ${deviceId} tidak terdaftar/aktif`);
  return data;
}

module.exports = { assertActiveDevice };
