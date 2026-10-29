-- AEROS: perubahan database MINIMAL agar worker v3 bisa menyimpan data ESP (29 Okt 2026).
-- Jalankan di Supabase -> SQL Editor oleh pemilik database. Hanya MENAMBAH; aman dijalankan berulang.
-- Perubahan besar di rencana (cascade, kolom tambahan, indeks, retensi) sengaja TIDAK ada di sini: dokumentasi/keputusan/data-dan-database.md bagian 2.4.
-- Sesudahnya jalankan di laptop: cd worker && node cek-database.js  (semua baris harus OK)

-- 1. Hak akses worker (service_role)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

-- 2. Kolom telemetri v3 (nilai puncak per jendela 5 detik); pesan ESP mengirim bilangan bulat, detik puncak 1-5
ALTER TABLE public.sensor_readings
  ADD COLUMN IF NOT EXISTS co_peak_ppm integer,
  ADD COLUMN IF NOT EXISTS co2_peak_ppm integer,
  ADD COLUMN IF NOT EXISTS co_peak_second integer,
  ADD COLUMN IF NOT EXISTS co2_peak_second integer;

-- 3. Kolom yang dibaca worker untuk perintah dari aplikasi ("Saya Tahu")
ALTER TABLE public.actuator_logs
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

-- 4. Perangkat harus terdaftar dan aktif. PERIKSA dulu kolom tabel devices, lalu sesuaikan dan buka komentarnya:
--   SELECT * FROM public.devices;
--   INSERT INTO public.devices (device_id, is_active) VALUES ('AEROS_01', true)
--     ON CONFLICT (device_id) DO UPDATE SET is_active = true;
