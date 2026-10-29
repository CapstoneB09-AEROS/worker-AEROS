-- AEROS: kolom device_state yang ditulis worker v3 (29 Okt 2026). Hanya MENAMBAH; aman diulang.
-- Tanpa ini worker gagal memperbarui device_state ("[STATE MIRROR]"): status terkini, alert aktif, dan penutupan peringatan tidak tersimpan.
ALTER TABLE public.device_state
  ADD COLUMN IF NOT EXISTS last_co_ppm integer,
  ADD COLUMN IF NOT EXISTS last_co2_ppm integer;
