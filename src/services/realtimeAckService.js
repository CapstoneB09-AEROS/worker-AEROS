const supabase = require('../config/supabaseClient');
const { publishPendingCommand } = require('./actuatorService');

function subscribePendingCommands(mqttClient) {
  return supabase.channel('aeros-actuator-pending-v2')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'actuator_logs' },
      async (event) => {
        if (event.new?.execution_status === 'pending') {
          await publishPendingCommand(mqttClient, event.new);
        }
      })
    .subscribe((status) => console.log('[REALTIME actuator_logs]', status));
}
module.exports = { subscribePendingCommands };

