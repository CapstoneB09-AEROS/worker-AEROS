# AEROS Worker

Penghubung MQTT ke Supabase untuk perangkat AEROS. Proses ini harus **berjalan terus** (bukan serverless, tidak butuh port HTTP).

Alur: ESP32 -> HiveMQ Cloud -> worker ini -> Supabase. Worker memeriksa tanda tangan HMAC, menyimpan ke `sensor_readings`, mencatat tiap peringatan di `alert_logs` (dibuat sebelum bacaan yang menunjuknya), memperbarui `device_state`, dan membalas ACK ke ESP. Menerima pesan telemetri versi 3 dan 4. Fitur "Saya Tahu" sudah dibuang.

## Variabel lingkungan
Isi di dasbor layanan hosting (atau `.env` untuk lokal). **Jangan di-commit.** Contoh: [.env.example](.env.example).

| Variabel | Isi |
|---|---|
| `HIVEMQ_HOST`, `HIVEMQ_PORT` (8883), `HIVEMQ_USERNAME`, `HIVEMQ_PASSWORD` | pengguna **worker** di HiveMQ: subscribe `aeros/+/telemetry` dan `aeros/+/status`; publish `aeros/+/telemetry/ack` |
| `HMAC_SECRET` | sama persis dengan `HMAC_SECRET` di `secrets.h` ESP |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | proyek Supabase; kunci ini hanya untuk worker |
| `WRITE_STATUS_COLUMN` | bawaan `false`: `status` tidak ditulis, karena sejak SQL 004 (4b) kolom itu turunan dan menulisnya ditolak database. Isi `true` **hanya** untuk database yang belum 4b. |
| `ACCEPT_V3` | bawaan `true`. Ubah ke `false` setelah ESP versi 4 terpasang, supaya pesan versi 3 ditolak. |
| `ALLOW_DEMO_READINGS` | opsional, `true` hanya bila data simulasi (`demo`) boleh disimpan |

## Jalankan lokal
```bash
npm ci
cp .env.example .env     # lalu isi
node cek-database.js     # semua baris harus OK
npm start
```
Log yang benar: `[MQTT] HiveMQ Cloud TLS terhubung`, `[MQTT] Subscribe: ...`, lalu `[READING]` tiap 5 detik saat ESP menyala.

## Hosting
Layanan harus mendukung **background worker / proses terus-menerus** (bukan fungsi serverless). Ada [Dockerfile](Dockerfile) (`CMD node mqtt-worker.js`); atau pakai Node langsung dengan perintah mulai `npm start`.

## Aturan penting
- Hanya **satu** worker aktif untuk tiap perangkat. Dua worker sekaligus memproses pesan yang sama dua kali (bacaan ganda ditolak lewat `nonce`, tetapi log dan beban jadi dobel). Matikan worker di laptop sebelum yang di hosting dinyalakan.
- Database harus sudah dijalankan: [sql/003-mvp-4a-tambahan.sql](sql/003-mvp-4a-tambahan.sql) (kolom `co_level`, `co2_level`, `buzzer_state`, `event_id` dan view `v_alerts`) sebelum worker ini dipasang. [sql/004-mvp-4b-pemutusan.sql](sql/004-mvp-4b-pemutusan.sql) merusak worker lama (yang menulis `status`); worker ini aman karena bawaannya tidak menulis `status`. Berkas 001 dan 002 adalah riwayat.
- Uji: `npm test`. Uji kirim pesan tanpa ESP: `node publish-uji.js` (hanya mencetak; `--kirim` untuk mengirim).
