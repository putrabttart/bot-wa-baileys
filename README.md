# PBS Bot (Modular)

Refactor modular dari file monolitik Anda. Struktur ini menjaga fitur asli: daftar produk/promo dari CSV, pembelian `#buynow` via Midtrans (QRIS/Snap), webhook, Apps Script stok/log, dan smart intent (opsional). Sekarang menggunakan Baileys (tanpa Chrome) sehingga jalan di Termux/Android atau server headless.

## Menjalankan
1. Salin `.env.example` menjadi `.env` dan isi variabel (minimal: `ADMINS`, `ADMIN_CONTACT`, `MIDTRANS_SERVER_KEY`, `PUBLIC_BASE_URL`).
2. `npm install`
3. Jalankan: `npm run start`
	- Atau dev dengan log stack detail: `npm run dev`

## Jalankan di Termux (Android)
- Instal Node.js terbaru: `pkg install nodejs git` (Node 18+ disarankan).
- Clone repo, isi `.env`.
- Opsional: set `SESSION_DIR=/sdcard/pbs-session` agar file login tersimpan di storage mudah dibackup.
- Start: `npm run start`. Scan QR di terminal (Baileys menampilkan QR ASCII). Endpoint `/qr` di HTTP juga menampilkan PNG.
- Bot berjalan headless, tanpa Chrome/puppeteer.

## Struktur
- `src/config/` – parsing ENV
- `src/utils/` – helper umum
- `src/data/` – loader Produk/Promo
- `src/services/` – integrasi Apps Script stok & notifikasi admin
- `src/payments/` – Midtrans API
- `src/formatters/` – card/box WhatsApp
- `src/intent/` – smart intent helper
- `src/whatsapp/` – inisialisasi client, state
- `src/handlers/` – handler Express & command WhatsApp
- `src/index.js` – entry point

## Catatan
- Proyek menggunakan ESM (`type: module`).
- Pastikan `PUBLIC_BASE_URL` mengarah ke domain/tunnel yang online untuk menerima webhook Midtrans.
- Set `QUIET_MODE=false` jika ingin smart intent (user mengetik nama produk tanpa `#`).
- Baileys menyimpan sesi di `baileys_auth/<CLIENT_ID>` secara default. Backup folder ini agar tidak perlu scan ulang.

## Variabel ENV Tambahan
- `LIST_PER_PAGE` (default: 20) — jumlah item per halaman untuk perintah `#list` (nama saja).
- `STOK_PER_PAGE` (default: 8) — jumlah item per halaman untuk perintah `#stok` (detail lengkap).