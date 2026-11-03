-- SALINAN dari dokumentasi/keputusan/rancangan-database-mvp.md bagian 4a (3 Nov 2026). Sumber kebenaran: dokumen itu; jangan diubah di sini saja.
-- Jalankan di Supabase -> SQL Editor oleh pemilik database, SEKALI dan UTUH (satu transaksi). Butuh PostgreSQL 15 atau lebih.
-- Aman dijalankan kapan saja: tidak merusak worker lama.
begin;

-- A1. sensor_readings: tingkat per gas, buzzer, tautan ke peringatan
alter table public.sensor_readings
  add column if not exists co_level smallint not null default 0 check (co_level between 0 and 2),
  add column if not exists co2_level smallint not null default 0 check (co2_level between 0 and 2),
  add column if not exists buzzer_state text check (buzzer_state in ('on','off')),
  add column if not exists event_id uuid;
-- bacaan hanya boleh menunjuk peringatan milik perangkat yang sama (butuh PostgreSQL 15 atau lebih)
alter table public.alert_logs add constraint uq_alert_logs_id_device unique (id, device_id);
alter table public.sensor_readings add constraint fk_sensor_readings_alert
  foreign key (event_id, device_id) references public.alert_logs (id, device_id) on delete set null (event_id);
create index if not exists idx_sensor_readings_event on public.sensor_readings (event_id);
create index if not exists idx_sensor_readings_device_time on public.sensor_readings (device_id, measured_at desc);

-- A2. data lama: dianggap CO2 saja (CO nonaktif sebelum 2 Nov)
update public.sensor_readings
  set co2_level = case status when 'bahaya' then 2 when 'waspada' then 1 else 0 end;

-- A3. view untuk aplikasi: gas dan tingkat tiap peringatan
create or replace view public.v_alert_gas as
select r.event_id as alert_id, g.gas,
       max(g.tingkat) as tingkat_maks,
       max(g.ppm) as puncak_ppm,
       min(r.measured_at) filter (where g.tingkat > 0) as mulai_at
from public.sensor_readings r
cross join lateral (values ('CO',  r.co_level,  coalesce(r.co_peak_ppm,  r.co_ppm)),
                           ('CO2', r.co2_level, coalesce(r.co2_peak_ppm, r.co2_ppm))) as g(gas, tingkat, ppm)
where r.event_id is not null and g.tingkat > 0
group by r.event_id, g.gas;

create or replace view public.v_alerts as
select a.id, a.device_id, a.created_at, a.resolved_at,
       case max(g.tingkat_maks) when 2 then 'bahaya' when 1 then 'waspada' end as tingkat,   -- kosong bila belum ada bacaan bertingkat
       array_agg(g.gas order by g.gas) filter (where g.gas is not null) as gas
from public.alert_logs a
left join public.v_alert_gas g on g.alert_id = a.id
group by a.id;

commit;
