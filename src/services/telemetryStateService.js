const supabase = require('../config/supabaseClient');

// Data offline tetap disimpan di sensor_readings, tetapi tidak boleh
// memundurkan state/dashboard atau membuka ulang alarm lama.
const LIVE_MAX_AGE_SECONDS = 90;

async function mirrorRecentTelemetry(p, now = Date.now()) {
  if (!p.time_valid || p.timestamp * 1000 > now + 300000 ||
      now - p.timestamp * 1000 > LIVE_MAX_AGE_SECONDS * 1000) return false;

  const { data: newest, error: latestError } = await supabase.from('sensor_readings')
    .select('nonce').eq('device_id', p.device_id)
    .order('measured_at', { ascending: false })
    .order('received_at', { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  if (!newest || newest.nonce !== p.nonce) return false;

  const { data: previous, error: previousError } = await supabase.from('device_state')
    .select('active_alert_id').eq('device_id', p.device_id).maybeSingle();
  if (previousError) throw previousError;

  if (previous?.active_alert_id && previous.active_alert_id !== p.event_id) {
    // A new alarm episode or a return to normal closes the previous episode.
    const result = await supabase.from('alert_logs')
      .update({ resolved_at: new Date(now).toISOString() })
      .eq('id', previous.active_alert_id).eq('device_id', p.device_id)
      .is('resolved_at', null);
    if (result.error) throw result.error;
  }

  const patch = {
    device_id: p.device_id,
    last_co_ppm: p.co_ppm,
    last_co2_ppm: p.co2_ppm,
    status: p.status,
    buzzer_state: p.buzzer_state,
    window_status: p.window_status,
    active_alert_id: p.event_id,
    updated_at: new Date(now).toISOString(),
  };
  const { error } = await supabase.from('device_state').upsert(patch, { onConflict: 'device_id' });
  if (error) throw error;

  // Peringatan dibuat lebih dulu oleh pastikanPeringatan (sensorDataHandler). Di sini hanya
  // alert_type (sementara, demi aplikasi lama) yang dinaikkan satu arah: waspada -> bahaya.
  if (p.event_id && p.status === 'bahaya') {
    const result = await supabase.from('alert_logs').update({ alert_type: 'bahaya' })
      .eq('id', p.event_id).eq('device_id', p.device_id).neq('alert_type', 'bahaya');
    if (result.error) throw result.error;
  }
  return true;
}

module.exports = { mirrorRecentTelemetry };
