const supabase = require('../config/supabaseClient');
const { assertActiveDevice } = require('./deviceRegistry');

async function handleDevicePresence(deviceId, status) {
  if (status !== 'ONLINE' && status !== 'OFFLINE') return;
  await assertActiveDevice(deviceId);
  const now = new Date().toISOString();
  let result;
  if (status === 'ONLINE') {
    result = await supabase.from('device_state').upsert({
      device_id: deviceId, connection_status: 'online',
      last_seen_at: now, updated_at: now,
    }, { onConflict: 'device_id' });
  } else {
    result = await supabase.from('device_state').update({
      connection_status: 'offline', updated_at: now,
    }).eq('device_id', deviceId);
  }
  if (result.error) throw new Error(result.error.message);
  console.log('[PRESENCE]', deviceId, status);
}
module.exports = { handleDevicePresence };

