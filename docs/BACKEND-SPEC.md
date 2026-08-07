# Spesifikasi Back-End

Website PK PMII UIN Sunan Gunung Djati Cabang Kabupaten Bandung

---

## 1. Ikhtisar Arsitektur

```
Pengunjung ──HTTPS──► Nginx ──► /            → berkas statis (public/)
                             └► /api/v1/*    → Node.js + Express (proses PM2)
                                                     │
                                                     ▼
                                            SQLite (WAL) / MySQL
                                                     │
                                            /uploads (dokumen & foto)
```

| Lapisan | Teknologi | Alasan pemilihan |
| --- | --- | --- |
| Runtime | Node.js 20+ | Satu bahasa dengan front-end, mudah dilanjutkan pengurus berikutnya |
| Framework | Express 4 | Ringan, sangat banyak referensi, cukup untuk skala organisasi |
| Basis data | SQLite (better-sqlite3) | Tanpa server terpisah, satu berkas mudah di-backup. Bermigrasi ke MySQL/PostgreSQL bila trafik CBT tumbuh |
| Validasi | Zod | Skema sekaligus tipe; galat dapat dipetakan per-kolom untuk front-end |
| Autentikasi | JWT (jsonwebtoken) + bcryptjs | Stateless, cocok untuk front-end statis lintas domain |
| Pembatas laju | express-rate-limit | Melindungi formulir publik dari spam |

**Prinsip yang dipegang**

1. Front-end tidak dipercaya. Setiap aturan yang ada di JavaScript juga ditegakkan di server.
2. Waktu selalu ditentukan server (deadline ujian, buka/tutup pendaftaran).
3. Data sensitif hanya keluar melalui endpoint yang terautentikasi dan sesuai peran.
4. Setiap perubahan status oleh pengurus dicatat di `audit_log` / `pengaduan_log`.

---

## 2. Struktur Kode

```
server/
├── src/
│   ├── index.js               bootstrap: dotenv → migrate → listen → graceful shutdown
│   ├── app.js                 CORS, JSON parser, header keamanan, rate limit, pendaftaran route
│   ├── lib/
│   │   ├── db.js              koneksi SQLite, migrate(), nextNumber() penomoran tiket
│   │   ├── http.js            ApiError, ok/created, parseOrThrow(Zod), errorHandler
│   │   └── tokens.js          signAccess/signRefresh/verify, hashOpaque
│   ├── middleware/auth.js     requirePeserta, requireAdmin(...roles)
│   └── routes/
│       ├── artikel.js         CMS artikel (publik + admin)
│       ├── konten.js          galeri, dokumen, pengurus
│       ├── advokasi.js        pengaduan + panel advokat
│       ├── mapaba.js          pendaftaran + panel panitia
│       ├── cbt.js             autentikasi peserta + alur ujian
│       └── admin.js           login pengurus + ringkasan dashboard
├── db/{schema.sql, migrate.js, seed.js}
└── test/smoke.js              24 pemeriksaan alur end-to-end
```

---

## 3. Model Data

Skema lengkap dengan komentar ada di [`server/db/schema.sql`](../server/db/schema.sql).

### Relasi utama

```
users ──< artikel >── kategori          periode ──< pengurus
artikel >──< tag (artikel_tag)
galeri_album ──< galeri_media
pengaduan ──< pengaduan_log >── users
mapaba_gelombang ──< mapaba_pendaftar
cbt_paket ──< cbt_soal ──< cbt_opsi
cbt_peserta ──< cbt_sesi ──< cbt_jawaban
counters (penomoran per tahun)          audit_log      settings
```

### Tabel dan perannya

| Tabel | Peran | Constraint penting |
| --- | --- | --- |
| `users` | Pengurus/panitia CMS | `email` unik; `role` CHECK 5 nilai |
| `periode`, `pengurus` | Struktur kepengurusan per masa khidmat | `pengurus.urutan` untuk pengurutan tampilan |
| `kategori`, `artikel`, `tag`, `artikel_tag` | CMS blog | `artikel.slug` unik; `status` CHECK; soft delete `deleted_at` |
| `galeri_album`, `galeri_media` | Galeri kegiatan | media dihapus otomatis via `ON DELETE CASCADE` |
| `dokumen` | Landasan hukum (AD/ART, NDP, PO) | `kategori` CHECK; penghitung `diunduh` |
| `pengaduan`, `pengaduan_log` | Layanan Advokasi | `nomor_tiket` unik; `status`, `prioritas`, `kategori` CHECK |
| `mapaba_gelombang`, `mapaba_pendaftar` | MAPABA Raya | `UNIQUE(gelombang_id, nim)` mencegah pendaftaran ganda |
| `cbt_peserta` | Akun peserta ujian | `nomor_peserta` unik; `gagal_login` + `locked_until` untuk penguncian |
| `cbt_paket`, `cbt_soal`, `cbt_opsi` | Bank soal | `cbt_opsi.is_benar` **tidak pernah** dikirim saat sesi berjalan |
| `cbt_sesi` | Satu percobaan pengerjaan | `UNIQUE(peserta_id, paket_id, percobaan)`; `deadline_at` sumber kebenaran waktu |
| `cbt_jawaban` | Jawaban tersimpan | `UNIQUE(sesi_id, soal_id)` membuat autosave idempoten (UPSERT) |
| `counters` | Penomoran `ADV-`/`MPB-`/`BIM-` per tahun | PK gabungan `(nama, tahun)`, dinaikkan dalam transaksi |
| `audit_log` | Jejak tindakan pengurus | — |

### Padanan tipe bila pindah ke MySQL/PostgreSQL

| SQLite (dipakai) | MySQL 8 | PostgreSQL 15 |
| --- | --- | --- |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT AUTO_INCREMENT` | `BIGSERIAL` / `IDENTITY` |
| `TEXT` waktu ISO-8601 | `DATETIME` | `TIMESTAMPTZ` |
| `INTEGER` 0/1 | `TINYINT(1)` | `BOOLEAN` |
| `CHECK (x IN (...))` | `ENUM(...)` | tipe `ENUM` khusus |
| `datetime('now')` | `NOW()` | `now()` |
| `ON CONFLICT … DO UPDATE` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT … DO UPDATE` |

---

## 4. Konvensi API

Base URL: `https://api.pmiiuinbandung.or.id/api/v1` (lokal: `http://localhost:4000/api/v1`)

**Bentuk respons**

```jsonc
// Sukses
{ "ok": true, "data": { ... }, "meta": { "page": 1, "limit": 9, "total": 24, "totalPage": 3 } }

// Gagal
{ "ok": false, "message": "Data yang dikirim belum lengkap atau tidak valid.",
  "errors": { "kronologi": "Kronologi minimal 50 karakter agar dapat ditindaklanjuti." } }
```

`errors` memakai **nama kolom formulir** sebagai kunci, sehingga `forms.js` dapat menempelkan pesan
tepat di bawah input yang bersangkutan tanpa pemetaan tambahan.

**Kode status**

| Kode | Makna |
| --- | --- |
| 200 / 201 | Berhasil / sumber daya baru dibuat |
| 400 | Validasi gagal (selalu disertai `errors`) |
| 401 | Token tidak ada / tidak valid / kedaluwarsa |
| 403 | Terautentikasi tetapi tidak berwenang (atau sesi ujian sudah berakhir) |
| 404 | Sumber daya tidak ditemukan |
| 409 | Konflik data (NIM sudah terdaftar, kuota penuh) |
| 429 | Melewati batas laju |
| 500 | Galat server (detail hanya masuk log, tidak dikirim ke klien) |

---

## 5. Endpoint Konten (Publik & Admin)

| Metode | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| GET | `/health` | publik | Pemeriksaan kesehatan |
| GET | `/artikel` | publik | Query: `kategori`, `q`, `unggulan`, `page`, `limit` |
| GET | `/artikel/:slug` | publik | Detail + 3 artikel terkait; menaikkan `dilihat` |
| GET | `/artikel/meta/kategori` | publik | Kategori + jumlah artikel |
| POST | `/artikel/admin` | editor | Buat artikel; slug dibuat otomatis dan dijamin unik |
| PATCH | `/artikel/admin/:id` | editor | Ubah/terbitkan; `published_at` hanya diisi sekali |
| DELETE | `/artikel/admin/:id` | editor | Soft delete |
| GET | `/galeri/album` | publik | Query: `kategori`, `page`, `limit` |
| GET | `/galeri/album/:slug` | publik | Album + daftar media |
| GET | `/dokumen` | publik | Query: `kategori` |
| GET | `/dokumen/:id/unduh` | publik | Catat unduhan lalu redirect 302 ke berkas |
| GET | `/pengurus` | publik | Query: `periode` (default: periode aktif) |
| POST | `/admin/auth/login` | publik | Login pengurus → access token audiens `admin` |
| GET | `/admin/me` | admin | Profil pengurus |
| GET | `/admin/ringkasan` | admin | Angka ringkas artikel, pengaduan, MAPABA, CBT |

---

## 6. Tiga Layanan Interaktif

### 6.1 Layanan Advokasi

Halaman: [`public/advokasi.html`](../public/advokasi.html) — kode:
[`server/src/routes/advokasi.js`](../server/src/routes/advokasi.js)

| Metode | Path | Akses |
| --- | --- | --- |
| POST | `/advokasi/pengaduan` | publik (maks. 5 per IP per jam) |
| GET | `/advokasi/pengaduan/:nomorTiket` | publik (hanya status, bukan isi) |
| GET | `/advokasi/admin/pengaduan` | advokat / superadmin |
| PATCH | `/advokasi/admin/pengaduan/:id` | advokat / superadmin |

**Permintaan**

```jsonc
POST /api/v1/advokasi/pengaduan
{
  "nama": "Ahmad Fauzi",              // wajib, 3–100 karakter
  "kontak": "081234567890",           // wajib, 8–20, hanya angka dan + - ( )
  "email": "ahmad@example.com",       // opsional
  "status": "mahasiswa",              // mahasiswa | alumni | kader | masyarakat
  "kategori": "ukt",                  // ukt | akademik | kekerasan_seksual | perundungan |
                                      // kebebasan_berpendapat | ketenagakerjaan | lainnya
  "kronologi": "…",                   // wajib, 50–4000 karakter
  "lampiranUrl": "https://…",         // opsional, harus URL valid
  "anonim": true,                     // opsional
  "persetujuan": true                 // wajib true
}
```

**Respons 201**

```jsonc
{ "ok": true, "data": { "nomorTiket": "ADV-2026-0001", "status": "baru", "pesan": "…" } }
```

**Aturan bisnis**

1. Nomor tiket `ADV-<tahun>-<urut 4 digit>` diterbitkan dalam transaksi (tabel `counters`), sehingga
   tidak pernah ganda meski dua pengaduan masuk bersamaan.
2. Kategori `kekerasan_seksual` otomatis mendapat `prioritas = 'tinggi'`.
3. Alamat IP pelapor tidak disimpan mentah; hanya `sha256(ip + secret)` untuk deteksi spam.
4. Endpoint pelacakan publik **tidak** mengembalikan nama, kontak, maupun kronologi — nomor tiket
   saja bukan bukti kepemilikan data yang cukup kuat.
5. Setiap perubahan status menulis baris baru di `pengaduan_log` beserta pengurus pelakunya.

Siklus status: `baru → verifikasi → pendampingan → selesai` (atau `ditolak`).
`closed_at` diisi otomatis ketika status menjadi `selesai`/`ditolak`.

### 6.2 MAPABA Raya

Halaman: [`public/mapaba.html`](../public/mapaba.html) — kode:
[`server/src/routes/mapaba.js`](../server/src/routes/mapaba.js)

| Metode | Path | Akses |
| --- | --- | --- |
| GET | `/mapaba/gelombang-aktif` | publik |
| POST | `/mapaba/pendaftaran` | publik (maks. 10 per IP per jam) |
| GET | `/mapaba/pendaftaran/:nomor` | publik |
| GET | `/mapaba/admin/pendaftar` | panitia_mapaba / superadmin |
| PATCH | `/mapaba/admin/pendaftar/:id` | panitia_mapaba / superadmin |

**Permintaan**

```jsonc
POST /api/v1/mapaba/pendaftaran
{
  "namaLengkap": "Siti Aisyah",
  "nim": "1234567890",                 // 8–15 angka
  "angkatan": 2026,
  "fakultas": "Sains dan Teknologi",
  "prodi": "Teknik Informatika",
  "jenisKelamin": "P",                 // L | P
  "whatsapp": "081234567891",
  "email": "siti@example.com",
  "asalDaerah": "Kab. Bandung",        // opsional
  "motivasi": "…",                     // 30–1000 karakter
  "riwayatOrganisasi": "OSIS, IPNU",   // opsional
  "sumberInformasi": "instagram",      // opsional
  "kesediaan": true,                   // wajib true
  "persetujuanData": true              // wajib true
}
```

**Respons 201** → `{ "nomorRegistrasi": "MPB-2026-0001", "status": "menunggu", "biaya": 75000 }`

**Aturan bisnis**

1. Pendaftaran hanya diterima bila ada gelombang `is_aktif = 1` **dan** waktu server berada di
   antara `buka_at` dan `tutup_at`.
2. Kuota diperiksa terhadap jumlah pendaftar berstatus selain `batal`; kuota penuh → 409.
3. `UNIQUE(gelombang_id, nim)` di basis data menjadi jaring terakhir; endpoint mengembalikan 409
   dengan `errors.nim` yang menyebutkan nomor registrasi sebelumnya.
4. Siklus status: `menunggu → terverifikasi → hadir`, atau `ditolak`/`batal`.

### 6.3 CBT BIMTES

Halaman: [`public/cbt/login.html`](../public/cbt/login.html),
[`public/cbt/dashboard.html`](../public/cbt/dashboard.html) — kode:
[`server/src/routes/cbt.js`](../server/src/routes/cbt.js)

| Metode | Path | Akses |
| --- | --- | --- |
| POST | `/cbt/auth/login` | publik (maks. 20 per IP per 10 menit) |
| POST | `/cbt/auth/refresh` | publik (dengan refresh token) |
| GET | `/cbt/me` | peserta |
| GET | `/cbt/ujian` | peserta |
| POST | `/cbt/ujian/:paketId/mulai` | peserta |
| GET | `/cbt/sesi/:sesiId` | peserta (pemilik sesi) |
| PUT | `/cbt/sesi/:sesiId/jawaban` | peserta (pemilik sesi) |
| POST | `/cbt/sesi/:sesiId/submit` | peserta (pemilik sesi) |
| GET | `/cbt/hasil` | peserta |

**Login**

```jsonc
POST /api/v1/cbt/auth/login
{ "identitas": "BIM-2026-0001", "password": "…", "ingatSaya": true }

// 200
{ "ok": true, "data": {
    "accessToken": "eyJ…",              // audiens "cbt", masa hidup 2 jam
    "refreshToken": "eyJ…",             // hanya bila ingatSaya = true, 7 hari
    "harusUbahSandi": false,
    "peserta": { "id": 1, "nomorPeserta": "BIM-2026-0001", "nama": "…", "email": "…" }
} }
```

Login menerima nomor peserta **atau** email. Pesan galat tidak membedakan "akun tidak ada" dan
"sandi salah" agar nomor peserta tidak bisa ditebak. Lima kegagalan berturut-turut mengunci akun
15 menit (`gagal_login`, `locked_until`).

**Alur pengerjaan**

```
POST /cbt/ujian/:paketId/mulai
  ├─ sesi 'berjalan' sudah ada → dikembalikan kembali (dilanjutkan: true)
  ├─ percobaan >= max_percobaan → 403
  └─ buat cbt_sesi:
       urutan_soal = JSON hasil Fisher–Yates (bila paket.acak_soal)
       deadline_at = datetime('now', '+<durasi_menit> minutes')   ← sumber kebenaran waktu

GET /cbt/sesi/:sesiId
  → { sesi: { status, deadlineAt, sisaDetik }, paket, soal: [ … ] }
     · urutan soal mengikuti urutan_soal yang tersimpan (konsisten saat refresh)
     · opsi diacak bila paket.acak_opsi
     · is_benar & pembahasan TIDAK dikirim selama status = 'berjalan'

PUT /cbt/sesi/:sesiId/jawaban   { soalId, opsiId, ragu }
  → UPSERT pada UNIQUE(sesi_id, soal_id); aman dipanggil berulang
  → memvalidasi bahwa soal milik paket sesi dan opsi milik soal tersebut
  → mengembalikan sisaDetik agar timer klien dapat menyelaraskan diri

POST /cbt/sesi/:sesiId/submit
  → penilaian dalam transaksi, status 'selesai'
  → skor = round(1000 × Σbobot benar / Σbobot total)   (skala menyerupai UTBK)
  → submit kedua → 403

GET /cbt/hasil
  → riwayat + skor + peringkat (dihitung dengan subquery COUNT skor lebih tinggi)
```

**Kedaluwarsa otomatis.** Setiap kali sesi diakses, server memeriksa `deadline_at`. Bila terlampaui,
sesi langsung dinilai dengan status `kedaluwarsa`. Peserta tidak dapat "menahan" waktu dengan
menutup browser atau memutus koneksi.

**Anti-kecurangan yang sudah tertanam**

| Risiko | Penanganan |
| --- | --- |
| Membaca kunci jawaban dari respons | `is_benar` hanya disertakan setelah sesi tidak lagi `berjalan` |
| Memanipulasi timer di klien | Waktu dihitung dari `deadline_at` di basis data |
| Mengulang ujian | `max_percobaan` + `UNIQUE(peserta_id, paket_id, percobaan)` |
| Mengerjakan soal paket lain | Validasi `soalId` terhadap `paket_id` sesi |
| Mengerjakan sesi peserta lain | Pemeriksaan `sesi.peserta_id === req.peserta.id` → 403 |
| Berbagi akun antar perangkat | `device_hash` tercatat per sesi (dasar untuk penegakan lebih ketat) |

---

## 7. Autentikasi & Otorisasi

Dua audiens JWT dipisahkan agar token tidak dapat dipakai lintas area:

| Audiens | Subjek | Dipakai oleh | Middleware |
| --- | --- | --- | --- |
| `cbt` | `cbt_peserta.id` | Peserta ujian | `requirePeserta` |
| `admin` | `users.id` | Pengurus/panitia | `requireAdmin(...roles)` |

Token peserta yang dipakai pada endpoint admin menghasilkan 401 (diuji di `smoke.js`).

| Role | Kewenangan |
| --- | --- |
| `superadmin` | Semua (melewati pemeriksaan role) |
| `editor` | CRUD artikel, galeri, dokumen |
| `advokat` | Baca & ubah status pengaduan |
| `panitia_mapaba` | Verifikasi pendaftar MAPABA |
| `panitia_cbt` | Kelola paket, bank soal, dan sesi ujian |

Kata sandi di-hash dengan bcrypt (cost 10). Access token berumur 2 jam; refresh token 7 hari dan
hanya diterbitkan bila pengguna memilih "Ingat saya".

**Catatan penyimpanan token.** Front-end saat ini menyimpan access token di `sessionStorage`
(hilang saat tab ditutup). Untuk pengetatan, pindahkan refresh token ke cookie `HttpOnly; Secure;
SameSite=Strict` dan simpan access token hanya di memori — perubahan terbatas pada `forms.js` dan
`cbt.js`.

---

## 8. Keamanan & Privasi

| Aspek | Penerapan |
| --- | --- |
| Validasi masukan | Zod di setiap endpoint tulis; tidak ada `req.body` yang dipakai langsung |
| SQL injection | Semua kueri memakai *prepared statement* dengan parameter bernama |
| CORS | Daftar putih dari `CORS_ORIGINS`; permintaan tanpa Origin (curl/health check) diizinkan |
| Pembatas laju | Global 120/menit + pembatas khusus per formulir dan per login |
| Header | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` (ganti dengan `helmet()` bila dipasang) |
| Ukuran payload | Body JSON dibatasi 256 KB |
| Data pribadi | IP hanya disimpan sebagai hash; pengaduan anonim ditandai `is_anonim` |
| Kebocoran galat | Galat 500 hanya dicatat di log server; klien menerima pesan umum |
| Jejak audit | `audit_log` + `pengaduan_log` merekam siapa mengubah apa dan kapan |

**Rekomendasi tambahan sebelum produksi**

1. Pasang `helmet` dan `compression`.
2. Tambahkan CAPTCHA ringan (mis. Cloudflare Turnstile) pada dua formulir publik.
3. Aktifkan HTTPS wajib dan HSTS di Nginx.
4. Untuk kasus kekerasan seksual, batasi akses baris `pengaduan` hanya kepada petugas yang
   ditugaskan (`petugas_id`), bukan seluruh role `advokat`.
5. Pindai berkas unggahan (dokumen/foto) dengan antivirus dan batasi MIME type yang diterima.

---

## 9. Deploy

### Front-end statis

```bash
npm run build      # menghasilkan public/
```

Unggah folder `public/` ke Netlify, Cloudflare Pages, Vercel, atau ke direktori Nginx. Jangan lupa
mengubah `public/assets/js/config.js` agar menunjuk ke domain API produksi dan mematikan
`useMockWhenOffline`.

### API

```bash
npm ci --omit=dev
cp .env.example .env      # isi JWT_SECRET, CORS_ORIGINS, DATABASE_PATH
npm run db:migrate
pm2 start server/src/index.js --name pmii-api
pm2 save
```

Contoh blok Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name pmiiuinbandung.or.id;

  root /var/www/pmii/public;
  index index.html;

  # Front-end statis
  location / {
    try_files $uri $uri.html $uri/ =404;
  }

  location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }

  # API
  location /api/ {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

`app.set('trust proxy', 1)` sudah aktif agar `req.ip` (dipakai pembatas laju dan hash anti-spam)
membaca `X-Forwarded-For` dengan benar.

### Backup

SQLite hanya satu berkas, jadi backup cukup ringkas:

```bash
# Backup konsisten meski server sedang berjalan
sqlite3 server/db/pmii.sqlite ".backup '/backup/pmii-$(date +%F).sqlite'"
```

Jadwalkan lewat cron harian dan simpan `server/uploads/` bersamaan. Uji pemulihan minimal sekali
per periode kepengurusan.

---

## 10. Pengujian

```bash
npm run db:migrate && npm run db:seed
npm test
```

`server/test/smoke.js` menyalakan aplikasi Express pada port terpisah lalu menjalankan 24
pemeriksaan yang menutup seluruh alur penting, di antaranya:

- Validasi per-kolom pada formulir pengaduan (`nama`, `kronologi`, `persetujuan`).
- Penerbitan `ADV-…`/`MPB-…` dan pencegahan NIM ganda (409).
- Endpoint pelacakan tiket tidak membocorkan identitas pelapor.
- Login CBT gagal/berhasil, penolakan akses tanpa token.
- Kunci jawaban tidak terkirim saat sesi berjalan, lalu terbuka setelah submit.
- Autosave idempoten dan penolakan opsi milik soal lain.
- Penilaian (benar + salah + kosong = total soal) dan penolakan submit ganda.
- Token peserta ditolak di endpoint admin; perubahan status pengaduan tercatat di log.

---

## 11. Rencana Pengembangan Berikutnya

| Prioritas | Pekerjaan | Komponen yang tersentuh |
| --- | --- | --- |
| Tinggi | Halaman pengerjaan soal CBT (`/cbt/ujian.html`) | Front-end baru; API sudah siap |
| Tinggi | Panel admin (CMS artikel, verifikasi MAPABA, papan pengaduan) | Front-end baru + endpoint admin yang sudah ada |
| Tinggi | Unggah berkas (cover artikel, foto galeri, PDF dokumen) | `multer` + endpoint `/upload`, atau S3/R2 |
| Sedang | Notifikasi email/WhatsApp saat pengaduan & pendaftaran masuk | Nodemailer/gateway WA pada dua titik `TODO(integrasi)` |
| Sedang | Impor peserta CBT massal dari CSV/XLSX | Endpoint admin + praviu sebelum simpan |
| Sedang | Analisis butir soal (tingkat kesukaran, daya beda) | Kueri agregat atas `cbt_jawaban` |
| Rendah | Pencarian teks penuh artikel | FTS5 (SQLite) atau `tsvector` (PostgreSQL) |
| Rendah | Migrasi ke MySQL/PostgreSQL bila CBT dipakai serentak >200 peserta | Ganti `server/src/lib/db.js` saja |
