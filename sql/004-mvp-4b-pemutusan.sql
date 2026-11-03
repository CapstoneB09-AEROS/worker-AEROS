-- SALINAN dari dokumentasi/keputusan/rancangan-database-mvp.md bagian 4b (3 Nov 2026). Sumber kebenaran: dokumen itu; jangan diubah di sini saja.
-- Jalankan di Supabase -> SQL Editor oleh pemilik database, SEKALI dan UTUH (satu transaksi). Butuh PostgreSQL 15 atau lebih.
-- MERUSAK worker lama. Jalankan hanya setelah worker baru berjalan; matikan ESP selama ini; sesudahnya WRITE_STATUS_COLUMN=false.
begin;

-- B1. bacaan yang ditulis worker lama sejak 4a belum punya tingkat: isi dari status
update public.sensor_readings
  set co2_level = case status when 'bahaya' then 2 when 'waspada' then 1 else 0 end
  where co_level = 0 and co2_level = 0 and status <> 'normal';

-- B2. status jadi kolom turunan
alter table public.sensor_readings drop column status;
alter table public.sensor_readings add column status text generated always as
  (case greatest(co_level, co2_level) when 2 then 'bahaya' when 1 then 'waspada' else 'normal' end) stored;

-- B3. alert_logs: buang yang terkait "Saya Tahu" dan reading_id
alter table public.alert_logs drop constraint if exists alert_logs_reading_id_fkey;
alter table public.alert_logs drop column if exists reading_id;
alter table public.alert_logs drop column if exists acknowledged_at;

-- B4. buang "Saya Tahu"
drop table if exists public.actuator_logs;
alter table public.device_state drop column if exists ack_driver, drop column if exists ack_at;

-- B5. hapus bacaan lama yang bukan bukti peringatan (jadwalkan sesudah B3)
-- delete from public.sensor_readings where event_id is null and measured_at < now() - interval '7 days';

commit;
