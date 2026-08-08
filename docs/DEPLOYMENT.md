# Panduan Deployment

Website PR PMII Saintek UIN SGD · domain target **www.pmiiuinsgd.site**

Dokumen ini memuat dua jalur peluncuran. Pilih salah satu:

| Jalur | Cocok untuk | Biaya per bulan | Kesulitan |
| --- | --- | --- | --- |
| **B. Front-end di Vercel + API di Render/Railway** | Ingin cepat online tanpa mengurus server | Rp0–Rp100.000 | Mudah |

---

## 1. Memilih Hosting

### Rekomendasi VPS

| Penyedia | Paket | Perkiraan biaya | Catatan |
| --- | --- | --- | --- |
| **Biznet Gio (NEO Lite)** | 1 vCPU / 1 GB | ± Rp50.000 | Server di Indonesia — latensi terendah untuk mahasiswa Bandung |
| **IDCloudHost** | 1 vCPU / 2 GB | ± Rp90.000 | Ada object storage kompatibel S3, dukungan Bahasa Indonesia |
| **Niagahoster VPS** | 1 vCPU / 2 GB | ± Rp100.000 | Dukungan 24 jam, panel mudah |
| **Contabo (Singapura)** | 4 vCPU / 8 GB | ± Rp90.000 | Spesifikasi paling besar per rupiah, latensi ±30 ms |
| **Hetzner (Jerman)** | 2 vCPU / 4 GB | ± Rp70.000 | Sangat andal, tetapi latensi ±180 ms ke Indonesia |

(satu permintaan kecil per klik jawaban), yang menentukan justru jumlah koneksi bersamaan.
Ambil **4 vCPU / 4 GB** bila menargetkan 300+ peserta serentak.

**Yang tidak disarankan:** shared hosting cPanel murah. Sebagian besar tidak mengizinkan

### Domain

`pmiiuinsgd.site` dapat dibeli di Niagahoster, Domainesia, atau Cloudflare Registrar
(± Rp30.000–Rp150.000 per tahun untuk TLD `.site`). Arahkan nameserver ke **Cloudflare**
(gratis) untuk mendapat CDN, proteksi DDoS dasar, dan pengelolaan DNS yang mudah.

---

## 2. Jalur A — VPS Tunggal (Ubuntu 24.04)

### Langkah 1 — Pengamanan server

```bash
# Masuk sebagai root, lalu buat pengguna non-root
adduser pmii && usermod -aG sudo pmii

# Salin kunci SSH Anda, lalu MATIKAN login sandi
ssh-copy-id pmii@IP_SERVER
sudo nano /etc/ssh/sshd_config
#   PermitRootLogin no
#   PasswordAuthentication no
sudo systemctl restart ssh

# Firewall: hanya SSH, HTTP, HTTPS yang terbuka.
# Port 4000 (API) sengaja TIDAK dibuka — hanya Nginx yang boleh mengaksesnya.
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable

# Proteksi brute force SSH
sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban
```

### Langkah 2 — Pasang kebutuhan

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx git sqlite3 build-essential
sudo npm install -g pm2
node -v && nginx -v
```

### Langkah 3 — Ambil kode dan bangun

```bash
sudo mkdir -p /var/www/pmii && sudo chown -R pmii:pmii /var/www/pmii
cd /var/www/pmii
git clone https://github.com/<organisasi>/<repo>.git .

npm ci
cp .env.example .env
nano .env      # isi JWT_SECRET, CORS_ORIGINS, SITE_URL, dst.

# Kunci JWT acak:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run build          # menghasilkan public/
npm run db:migrate
```

Isi `.env` minimal untuk produksi:

```ini
NODE_ENV=production
PORT=4000
DATABASE_PATH=/var/www/pmii/server/db/pmii.sqlite
JWT_SECRET=<hasil perintah di atas>
CORS_ORIGINS=https://www.pmiiuinsgd.site,https://pmiiuinsgd.site
SITE_URL=https://www.pmiiuinsgd.site
PUBLIC_BASE_URL=https://www.pmiiuinsgd.site
STORAGE_DRIVER=cloudinary
BCRYPT_COST=12
```

Buat akun superadmin pertama (jangan memakai kredensial contoh dari seeder):

```bash
node -e "
const bcrypt = require('bcryptjs');
const { db, migrate } = require('./server/src/lib/db');
migrate();
const sandi = process.argv[1];
db.prepare('INSERT INTO users (nama, email, password_hash, role) VALUES (?,?,?,?)')
  .run('Nama Ketua', 'admin@pmiiuinsgd.site', bcrypt.hashSync(sandi, 12), 'superadmin');
console.log('Akun superadmin dibuat.');
" 'SandiKuatAnda123'
```

### Langkah 4 — Jalankan API dengan PM2

```bash
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup systemd -u pmii --hp /home/pmii   # jalankan perintah yang ditampilkan

pm2 status
pm2 logs pmii-api --lines 50
```

### Langkah 5 — Nginx dan HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/pmii
sudo ln -s /etc/nginx/sites-available/pmii /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Sertifikat gratis Let's Encrypt (otomatis diperpanjang)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pmiiuinsgd.site -d www.pmiiuinsgd.site
```

### Langkah 6 — Arahkan domain

Di panel DNS (Cloudflare):

| Tipe | Nama | Nilai | Proxy |
| --- | --- | --- | --- |
| A | `@` | `IP_SERVER` | Aktif (oranye) |
| A | `www` | `IP_SERVER` | Aktif (oranye) |

Di Cloudflare aktifkan **SSL/TLS mode: Full (strict)**, **Always Use HTTPS**, dan
**Auto Minify** untuk CSS/JS. Propagasi DNS biasanya di bawah satu jam.

> **Penting saat memakai proxy Cloudflare:** jalankan `certbot` **sebelum** proxy
> diaktifkan (awan abu-abu), karena validasi Let's Encrypt perlu menjangkau server
> secara langsung. Setelah sertifikat terbit, nyalakan proxy.

### Langkah 7 — Pembaruan berikutnya

```bash
cd /var/www/pmii
git pull
npm ci --omit=dev
npm run build
pm2 reload pmii-api        # reload, bukan restart: tanpa waktu mati
```

---

## 3. Jalur B — Vercel + Render

**Front-end (Vercel).** Folder `public/` sepenuhnya statis.

1. Impor repositori di [vercel.com/new](https://vercel.com/new).
2. Setelan build:
   - Framework Preset: **Other**
   - Build Command: `npm run build`
   - Output Directory: `public`
3. Tambahkan domain `www.pmiiuinsgd.site` di menu Settings → Domains, lalu ikuti
   instruksi DNS-nya (CNAME `www` → `cname.vercel-dns.com`).

Berkas `vercel.json` sudah disediakan di repositori: mengatur header keamanan,
cache aset satu tahun, serta URL bersih tanpa akhiran `.html`.

**Back-end (Render).**

1. New → Web Service → hubungkan repositori.
2. Build Command `npm ci` · Start Command `node server/src/index.js` · Health Check Path
   `/api/v1/health`.
3. Isi Environment Variables sesuai `.env.example`. Set
   `CORS_ORIGINS=https://www.pmiiuinsgd.site`.
4. Tambahkan **Persistent Disk** dan pasang di `/data`, lalu set
   `DATABASE_PATH=/data/pmii.sqlite`.

> **Peringatan besar untuk paket gratis.** Layanan gratis Render/Railway tidur setelah
> menganggur dan filesystem-nya bersifat sementara. Basis data SQLite di paket gratis
> permanen — atau pindah ke MySQL/PostgreSQL terkelola dan gunakan
> `server/db/schema.mysql.sql`.

Setelah API online, ubah `public/assets/js/config.js`:

```js
window.PMII_CONFIG = {
  apiBaseUrl: 'https://pmii-api.onrender.com',
  apiPrefix: '/api/v1',
  useMockWhenOffline: false,      // WAJIB false di produksi
  captcha: { provider: 'turnstile', siteKey: '0x4AAA…' },
};
```

---

## 4. Penyimpanan Berkas

Penyimpanan lokal (`STORAGE_DRIVER=local`) hanya untuk pengembangan. Untuk produksi:

**Cloudinary (paling praktis).** Gratis 25 GB bandwidth per bulan, sudah termasuk
kompresi, konversi WebP/AVIF otomatis, dan CDN.

```ini
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=xxx
CLOUDINARY_API_KEY=xxx
CLOUDINARY_API_SECRET=xxx
```
```bash
npm install cloudinary
```

**Cloudflare R2 / AWS S3.** Lebih murah untuk penyimpanan besar, tanpa biaya keluar
data pada R2.

```ini
STORAGE_DRIVER=s3
S3_BUCKET=pmii-uinsgd
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_PUBLIC_URL=https://media.pmiiuinsgd.site
```
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Pas foto dan KTM pendaftar disimpan **privat** oleh kedua driver dan hanya dibuka lewat
URL bertanda tangan berumur pendek — keduanya dokumen identitas, bukan aset publik.

---

## 5. Backup

SQLite hanya satu berkas, jadi backup ringkas. Pasang sebagai cron harian:

```bash
sudo crontab -e -u pmii
```
```cron
# Backup basis data setiap hari pukul 02.00 WIB, simpan 14 hari terakhir
0 2 * * * sqlite3 /var/www/pmii/server/db/pmii.sqlite ".backup '/home/pmii/backup/pmii-$(date +\%F).sqlite'" && find /home/pmii/backup -name 'pmii-*.sqlite' -mtime +14 -delete
```

Salin juga ke luar server (agar aman bila VPS hilang):

```bash
rclone copy /home/pmii/backup gdrive:backup-pmii --max-age 24h
```

**Uji pemulihan minimal sekali per periode kepengurusan.** Backup yang tidak pernah
dicoba dipulihkan belum tentu berfungsi.

---


Beberapa jam sebelum ujian serentak:

1. **Naikkan sementara batas laju.** Saat ujian, satu peserta mengirim satu permintaan
   per klik jawaban. Batas bawaan 120 permintaan/menit per IP akan terpicu bila banyak
   peserta berbagi satu jaringan Wi-Fi kampus (mereka terlihat sebagai satu IP). Naikkan
   `max` pada limiter global di `server/src/app.js` menjadi 600, atau kecualikan jalur
2. **Matikan sementara perayap dan pembaruan.** Jangan melakukan `git pull` atau
   `pm2 reload` selama sesi berjalan.
3. **Pantau log:** `pm2 logs pmii-api` dan `pm2 monit`.
4. **Backup tepat sebelum mulai:** jalankan perintah `.backup` secara manual.
5. **Siapkan rencana cadangan:** bila server bermasalah, sesi yang berjalan tetap tercatat
   di basis data beserta `deadline_at`-nya. Setelah server hidup lagi, peserta dapat
   melanjutkan dari soal terakhir karena jawaban disimpan per soal.

---

## 6. Pemantauan

| Kebutuhan | Alat gratis |
| --- | --- |
| Situs mati/hidup | [UptimeRobot](https://uptimerobot.com) — pantau `/api/v1/health` tiap 5 menit |
| Galat aplikasi | [Sentry](https://sentry.io) paket gratis |
| Statistik pengunjung | Google Search Console + [Umami](https://umami.is) (swa-inang, ramah privasi) |
| Log server | `pm2 logs`, `journalctl -u nginx` |

Daftarkan situs ke **Google Search Console**, kirim `https://www.pmiiuinsgd.site/sitemap.xml`,
lalu minta pengindeksan halaman Beranda. Ini langkah tercepat agar pencarian
"PMII UIN Bandung" menemukan situs ini.

---

## 7. Daftar Periksa Sebelum Diumumkan

- [ ] `useMockWhenOffline: false` pada `public/assets/js/config.js`
- [ ] `apiBaseUrl` menunjuk ke domain API produksi
- [ ] `JWT_SECRET` acak dan berbeda dari contoh
- [ ] Akun contoh dari seeder (`admin@pmiiuinbandung.test`, `BIM-2026-0001`) sudah dihapus
- [ ] `CORS_ORIGINS` hanya berisi domain produksi
- [ ] HTTPS aktif dan pengalihan HTTP → HTTPS berjalan
- [ ] `STORAGE_DRIVER` bukan `local`
- [ ] CAPTCHA aktif pada formulir Advokasi & MAPABA
- [ ] SMTP/WhatsApp terisi, dan uji kirim satu pengaduan percobaan
- [ ] Cron backup berjalan dan hasilnya sudah dicoba dipulihkan
- [ ] Sitemap dikirim ke Google Search Console
