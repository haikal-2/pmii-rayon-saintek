# Keamanan & Privasi

Website ini menyimpan dua jenis data yang tidak boleh bocor: **laporan advokasi**
(termasuk kasus kekerasan seksual) dan **data pribadi pendaftar MAPABA** (NIM, KTM, pas foto). Dokumen ini menjelaskan pengamanan yang sudah terpasang, cara
kerjanya, dan apa yang masih perlu dilakukan sebelum situs diumumkan.

---

## 1. Kata Sandi: Hashing dengan bcrypt

Kata sandi tidak pernah disimpan — yang disimpan adalah hash bcrypt-nya. bcrypt dipilih
karena tiga sifatnya: lambat secara sengaja, ber-*salt* otomatis (dua pengguna dengan sandi
sama menghasilkan hash berbeda), dan biaya komputasinya dapat dinaikkan seiring waktu
lewat parameter *cost*.

`BCRYPT_COST=12` berarti 2¹² = 4.096 putaran, sekitar 250 ms di VPS 2 vCPU. Angka ini
membuat penebakan massal tidak ekonomis, tetapi tidak terasa saat login.

### Registrasi (server/src/routes/admin.js)

```js
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

router.post('/users', requireAdmin('superadmin'), asyncHandler(async (req, res) => {
  const data = parseOrThrow(z.object({
    nama: z.string().trim().min(3).max(100),
    email: z.string().trim().email().max(150),
    password: z.string().min(10)
      .regex(/[a-z]/, 'Kata sandi harus memuat huruf kecil.')
      .regex(/[A-Z]/, 'Kata sandi harus memuat huruf besar.')
      .regex(/[0-9]/, 'Kata sandi harus memuat angka.'),
    role: z.enum(['superadmin','editor','advokat','panitia_mapaba']),
  }), req.body);

  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(data.email)) {
    throw conflict('Email sudah terdaftar.', { email: 'Email ini sudah dipakai akun lain.' });
  }

  // Hash dibuat sebelum INSERT: sandi mentah tidak pernah menyentuh basis data maupun log.
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);

  const info = db.prepare('INSERT INTO users (nama, email, password_hash, role) VALUES (?,?,?,?)')
    .run(data.nama, data.email, passwordHash, data.role);

  return created(res, { id: info.lastInsertRowid, nama: data.nama, email: data.email, role: data.role });
}));
```

Tiga keputusan yang perlu diperhatikan:

1. **Tidak ada registrasi mandiri.** Akun hanya diterbitkan superadmin. Endpoint
   registrasi terbuka adalah salah satu jalan masuk yang paling sering dieksploitasi
   pada CMS kecil, dan website rayon tidak membutuhkannya.
2. **Syarat sandi ditegakkan di server**, bukan hanya di formulir: minimal 10 karakter
   dengan huruf besar, huruf kecil, dan angka.
3. **Kata sandi mentah tidak pernah menyentuh basis data maupun log.** Hash dibuat
   sebelum `INSERT`, dan galat validasi tidak pernah menyertakan nilai kolom sandi.

### Login (server/src/routes/admin.js)

```js
const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(data.email);

// Pesan galat sengaja sama untuk akun tidak ada maupun sandi salah,
// agar daftar email pengurus tidak dapat ditebak dari respons.
const gagal = () => unauthorized('Email atau kata sandi salah.');
if (!user) throw gagal();
if (!user.is_active) throw forbidden('Akun dinonaktifkan.');

if (user.locked_until && new Date(`${user.locked_until}Z`) > new Date()) {
  throw forbidden('Akun terkunci sementara karena terlalu banyak percobaan gagal.');
}

const cocok = await bcrypt.compare(data.password, user.password_hash);
if (!cocok) {
  // Panel admin adalah satu-satunya pintu masuk ke data pengaduan dan data
  // pribadi pendaftar, jadi penebakan sandi dibuat mahal: lima kegagalan
  // berturut-turut mengunci akun selama 15 menit.
  const gagalBaru = user.gagal_login + 1;
  db.prepare(`UPDATE users SET
       gagal_login  = @gagalBaru,
       locked_until = CASE WHEN @gagalBaru >= @maks THEN datetime('now', @durasi) ELSE locked_until END
     WHERE id = @id`)
    .run({ id: user.id, gagalBaru, maks: 5, durasi: '+15 minutes' });
  throw gagal();
}

db.prepare("UPDATE users SET gagal_login = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?")
  .run(user.id);
```

`bcrypt.compare` melakukan perbandingan yang tahan *timing attack*; jangan pernah
menggantinya dengan `===`.

---

## 2. Manajemen Sesi: JWT

Token diterbitkan dengan audiens dan issuer eksplisit:

| Audiens | Subjek | Middleware | Masa hidup |
| --- | --- | --- | --- |
| `admin` | `users.id` | `requireAdmin(...roles)` | access 2 jam |

Karena `verify` mensyaratkan `audience` dan `issuer`, token yang ditandatangani kunci lain
atau ditujukan untuk audiens lain langsung ditolak 401 — perilaku ini diuji otomatis di
`server/test/smoke.js`. Parameter `audience` tetap dipertahankan supaya penambahan audiens
baru di kemudian hari tidak perlu mengubah pemanggilnya.

```js
// server/src/lib/tokens.js
const signAccess = (payload, audience) =>
  jwt.sign(payload, SECRET, { audience, expiresIn: ACCESS_TTL, issuer: 'pmii-uinsgd' });

const verify = (token, audience) =>
  jwt.verify(token, SECRET, { audience, issuer: 'pmii-uinsgd' });
```

Karena `verify` mensyaratkan `audience`, token peserta yang dipakai pada endpoint admin
langsung ditolak 401 — perilaku ini diuji otomatis di `server/test/smoke.js`.

Middleware tidak hanya memverifikasi tanda tangan, tetapi juga **memuat ulang pengguna
dari basis data** setiap permintaan. Dengan begitu, akun yang dinonaktifkan langsung
kehilangan akses tanpa perlu menunggu tokennya kedaluwarsa:

```js
const user = db.prepare('SELECT id, nama, email, role, is_active FROM users WHERE id = ?')
  .get(payload.sub);
if (!user || !user.is_active) return next(unauthorized('Akun pengurus tidak aktif.'));
req.user = user;
```

### JWT atau cookie sesi?

| | JWT (dipakai sekarang) | Cookie sesi server |
| --- | --- | --- |
| Front-end statis di domain lain | Mudah | Perlu CORS + `credentials`, cookie lintas situs |
| Pencabutan segera | Perlu daftar hitam | Mudah (hapus sesi) |
| Rentan XSS | Ya bila disimpan di storage | Tidak bila `HttpOnly` |

Pilihan JWT diambil karena front-end statis dapat berada di domain berbeda dari API
(mis. Vercel + VPS). **Pengetatan yang disarankan sebelum menangani data dalam jumlah
besar:** simpan access token hanya di memori JavaScript dan pindahkan refresh token ke
cookie `HttpOnly; Secure; SameSite=Strict`. Perubahannya terbatas pada `forms.js`,
dan `admin.js` di sisi klien, serta penambahan `cookie-parser` di server.

Saat ini token disimpan di `sessionStorage` — hilang ketika tab ditutup, yang penting
karena panel admin sering dibuka di komputer sekretariat yang dipakai bergantian.

---

## 3. Proteksi Formulir dari Spam dan DDoS

Empat lapis dipasang berurutan; sebuah permintaan harus lolos semuanya:

### Lapis 1 — Nginx (sebelum menyentuh Node)

```nginx
limit_req_zone $binary_remote_addr zone=form:10m rate=1r/s;

location ~ ^/api/v1/(advokasi/pengaduan|mapaba/pendaftaran|upload|admin/auth/login)$ {
    limit_req zone=form burst=5 nodelay;
    proxy_pass http://pmii_api;
}
```

### Lapis 2 — express-rate-limit (per endpoint)

| Endpoint | Batas |
| --- | --- |
| Global `/api/v1/*` | 120 permintaan / menit / IP |
| `POST /advokasi/pengaduan` | 5 / jam / IP |
| `POST /mapaba/pendaftaran` | 10 / jam / IP |
| `POST /upload` | 20 / 15 menit / IP |
| `POST /admin/auth/login` | 15 / 10 menit / IP |

Angka pengaduan sengaja longgar (5/jam) — pelapor sungguhan kadang mengirim ulang karena
ragu, dan menolak laporan kekerasan hanya karena batas laju jauh lebih merugikan daripada
menerima sedikit spam.

`app.set('trust proxy', 1)` wajib aktif agar `req.ip` membaca `X-Forwarded-For` dan batas
laju tidak salah menghitung semua pengunjung sebagai satu IP (yaitu IP Nginx).

### Lapis 3 — CAPTCHA

Aktifkan lewat `.env` server dan `config.js` klien. **Cloudflare Turnstile** direkomendasikan:
gratis tanpa batas, tidak melacak pengguna, dan tidak memblokir pelapor yang memakai VPN —
tiga hal yang penting untuk formulir pengaduan.

```ini
# .env server
CAPTCHA_PROVIDER=turnstile          # turnstile | recaptcha | recaptcha3 | none
CAPTCHA_SECRET_KEY=0x4AAAAAAA...
CAPTCHA_MIN_SCORE=0.5               # khusus reCAPTCHA v3
CAPTCHA_FAIL_OPEN=true              # loloskan bila penyedia CAPTCHA sedang tumbang
```
```js
// public/assets/js/config.js
captcha: { provider: 'turnstile', siteKey: '0x4AAAAAAA...' }
```

Sisi klien (`captcha.js`) menyisipkan widget ke `[data-captcha]` dan mengisi input
tersembunyi `captchaToken`; sisi server (`middleware/captcha.js`) memverifikasi token ke
penyedia sebelum handler dijalankan.

`CAPTCHA_FAIL_OPEN=true` adalah keputusan yang disengaja: bila layanan CAPTCHA tidak dapat
dihubungi, permintaan tetap diteruskan (rate limiting masih berlaku). Untuk endpoint login,
setel `false` bila Anda lebih mengutamakan ketatnya proteksi.

### Lapis 4 — Validasi Zod

Tidak ada `req.body` yang dipakai mentah. Setiap endpoint tulis memvalidasi bentuk,
panjang, dan pola datanya; galat dikembalikan per-kolom sehingga langsung tampil di bawah
input yang salah.

---

## 4. Unggahan Berkas

Berkas yang diunggah pengguna adalah jalur serangan klasik. Lima lapis dipakai:

1. **Batas ukuran** ditegakkan Multer sebelum berkas selesai dibaca (3 MB gambar, 10 MB dokumen).
2. **Daftar putih MIME** pada `fileFilter` (JPG, PNG, WebP, PDF). SVG **tidak diizinkan**
   karena bisa memuat JavaScript.
3. **Pemeriksaan magic bytes** atas isi berkas — MIME dari peramban bisa dipalsukan:
   ```js
   const MAGIC = {
     'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
     'image/png':  (b) => b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
     'application/pdf': (b) => b.subarray(0,5).toString('ascii') === '%PDF-',
   };
   ```
   Uji otomatis memastikan berkas PHP berekstensi `.png` ditolak.
4. **Nama berkas ditentukan server** (12 byte acak + tanggal), tidak pernah memakai nama
   dari klien — menutup celah path traversal dan berkas `.php`/`.html` yang dieksekusi.
5. **Disimpan di luar server aplikasi** (Cloudinary/S3). Bila terpaksa memakai driver
   lokal, konfigurasi Nginx sudah menolak eksekusi `.php`, `.html`, `.js`, dan `.svg` di
   dalam `/uploads/`.

Pas foto dan KTM disimpan **privat** dan diakses lewat URL bertanda tangan berumur pendek
(`presignedUrl()`), karena keduanya dokumen identitas.

---

## 5. Perlindungan Data Pribadi

| Data | Perlakuan |
| --- | --- |
| Alamat IP pelapor | Tidak disimpan mentah — hanya `sha256(ip + secret)` untuk deteksi spam |
| Identitas pelapor | Nama opsional; laporan tanpa nama dicatat "Anonim" |
| Isi kronologi | Tidak dikembalikan endpoint pelacakan publik (nomor tiket bukan bukti kepemilikan) |
| KTM & pas foto | Objek privat, hanya lewat presigned URL |
| Kata sandi | bcrypt cost 12, tidak pernah dicatat di log |
| Tindakan pengurus | Tercatat di `audit_log` dan `pengaduan_log` |

**Kebijakan retensi yang disarankan** (belum otomatis — perlu cron): hapus pengaduan yang
sudah `selesai` lebih dari dua tahun, dan hapus pas foto/KTM pendaftar setelah kegiatan
MAPABA berakhir. Menyimpan dokumen identitas lebih lama dari kebutuhannya hanya menambah
risiko tanpa manfaat.

---

## 6. Celah yang Sudah Ditutup di Kode

| Serangan | Penangkal |
| --- | --- |
| SQL injection | Semua kueri memakai prepared statement dengan parameter bernama |
| XSS tersimpan | Semua data dari server di-escape sebelum masuk `innerHTML` (`escapeHtml`) |
| Clickjacking | `X-Frame-Options: SAMEORIGIN` + `frame-ancestors` pada CSP |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Kebocoran galat | Galat 500 hanya masuk log server; klien menerima pesan umum |
| Enumerasi akun | Pesan login tidak membedakan akun tidak ada vs sandi salah |
| Payload raksasa | Body JSON dibatasi 256 KB, unggahan 3/10 MB, Nginx 12 MB |
| Penebakan sandi | Batas laju + penguncian akun 15 menit setelah 5 kegagalan |

---

## 7. Yang Masih Perlu Dikerjakan

1. **Bersihkan HTML artikel** dengan `sanitize-html` sebelum disimpan, saat editor WYSIWYG
   dipasang. Konten dari editor tidak boleh dipercaya mentah.
2. **Hapus `'unsafe-inline'`** dari `script-src` pada CSP setelah skrip sebaris pada
   beberapa halaman dipindahkan ke berkas terpisah.
3. **Batasi akses baris pengaduan** hanya kepada petugas yang ditugaskan (`petugas_id`)
   untuk kasus kekerasan seksual, bukan ke seluruh pemegang role `advokat`.
4. **Aktifkan 2FA (TOTP)** untuk akun `superadmin`.
5. **Otomatiskan kebijakan retensi** data pribadi lewat cron.
6. **Jadwalkan `npm audit`** rutin dan perbarui dependensi minimal sekali per semester.
7. **Uji pemulihan backup** minimal sekali per periode kepengurusan.

---

## 8. Bila Terjadi Insiden

1. Putuskan akses: `pm2 stop pmii-api` (situs statis tetap tampil).
2. Cabut seluruh sesi dengan mengganti `JWT_SECRET`, lalu nyalakan ulang API.
3. Setel ulang kata sandi semua akun pada tabel `users`.
4. Periksa `audit_log`, `pengaduan_log`, dan `notifikasi_log` untuk melacak apa yang diakses.
5. Pulihkan dari backup bersih terakhir bila data diubah.
6. Bila data pribadi pelapor bocor, **beri tahu yang bersangkutan** — ini kewajiban etik,
   bukan pilihan.
