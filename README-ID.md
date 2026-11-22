# Zephr.ai — Cloudflare Workers + D1

Paket ini menggunakan Cloudflare Worker (bukan Express/Node server). Tampilan publik dari proyek sebelumnya dipertahankan.

## Konfigurasi
- Worker entry: `src/index.js`
- Static frontend: `public/`
- D1 binding: `DB`
- D1 database: `zephr-ai-db`
- Gemini secret: `GEMINI_API_KEY` (tambahkan sebagai Secret di Cloudflare; jangan masukkan ke file atau GitHub)
- Model default: `gemini-3.5-flash-lite` (ubah `GEMINI_MODEL` jika model tidak tersedia pada project AI Studio)
- Cron `0 0 * * *` UTC = 07.00 WIB setiap hari.

## Batas aplikasi awal
- 10 pesan/IP/hari
- 200 pesan global/hari
- 12 permintaan/IP/menit
- Maksimum 2.000 karakter per pesan

## Database
Jalankan migrasi `migrations/0001_init.sql` pada database D1 sebelum Worker digunakan. `wrangler.jsonc` memerlukan `database_id` dari dashboard Cloudflare.

## Catatan
- Riset mengambil judul, tanggal, sumber, dan tautan dari Google News RSS; bukan isi penuh artikel.
- API Key hanya disimpan di Worker Secret.
- Kuota Gemini API terpisah dari kuota Cloudflare Workers/D1.
- Periksa model yang tersedia dan kuota API pada Google AI Studio project Anda.
