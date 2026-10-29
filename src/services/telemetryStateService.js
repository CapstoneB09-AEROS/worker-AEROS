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

  if (p.event_id) {
    const { data: existing, error: lookupError } = await supabase.from('alert_logs')
      .select('id,device_id').eq('id', p.event_id).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.device_id !== p.device_id) throw Error('event_id milik perangkat lain');
    if (!existing) {
      const { error } = await supabase.from('alert_logs').insert({
        id: p.event_id, device_id: p.device_id, alert_type: p.status,
      });
      // Concurrent delivery may race; the primary key settles duplicates.
      if (error && error.code !== '23505') throw error;
    }
  }
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
  if (previous?.active_alert_id !== p.event_id) {
    patch.ack_driver = false;
    patch.ack_at = null;
  }
  const { error } = await supabase.from('device_state').upsert(patch, { onConflict: 'device_id' });
  if (error) throw error;
  return true;
}

module.exports = { mirrorRecentTelemetry };
