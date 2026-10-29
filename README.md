# AEROS Worker

Penghubung MQTT ke Supabase untuk perangkat AEROS. Proses ini harus **berjalan terus** (bukan serverless, tidak butuh port HTTP).

Alur: ESP32 -> HiveMQ Cloud -> worker ini -> Supabase. Worker memeriksa tanda tangan HMAC, menyimpan ke `sensor_readings`, memperbarui `device_state` dan `alert_logs`, membalas ACK ke ESP, dan membaca perintah "Saya Tahu" dari `actuator_logs`.

## Variabel lingkungan
Isi di dasbor layanan hosting (atau `.env` untuk lokal). **Jangan di-commit.** Contoh: [.env.example](.env.example).

| Variabel | Isi |
|---|---|
| `HIVEMQ_HOST`, `HIVEMQ_PORT` (8883), `HIVEMQ_USERNAME`, `HIVEMQ_PASSWORD` | pengguna **worker** di HiveMQ: subscribe `aeros/#` (worker memasang `aeros/data`, `aeros/+/telemetry`, `aeros/+/status`, `aeros/+/cmd/ack`, `aeros/+/command/ack`); publish `aeros/+/telemetry/ack` dan `aeros/+/cmd` |
| `HMAC_SECRET` | sama persis dengan `HMAC_SECRET` di `secrets.h` ESP |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | proyek Supabase; kunci ini hanya untuk worker |
| `MAX_OFFLINE_AGE_DAYS`, `MAX_FUTURE_SKEW_SECONDS`, `LIVE_STALENESS_SECONDS`, `COMMAND_RETRY_MS`, `POLL_INTERVAL_MS` | 30, 120, 90, 10000, 5000 |

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
- Hanya **satu** worker aktif untuk tiap perangkat. Dua worker sekaligus membuat perintah "Saya Tahu" bisa diproses ganda. Matikan worker di laptop sebelum yang di hosting dinyalakan.
- Database harus sudah dijalankan: [sql/001-minimal-v3.sql](sql/001-minimal-v3.sql) dan [sql/002-device-state.sql](sql/002-device-state.sql).
- Uji: `npm test`.
