# Desain Migrasi Backend Website ke Cloudflare Workers

Tanggal: 2026-10-11

## Tujuan

Memindahkan layanan backend website PR PMII Saintek ke Cloudflare Workers secara
bertahap tanpa mematikan atau menghapus backend Express + SQLite yang saat ini
digunakan. Seluruh layanan ditargetkan berpindah, tetapi setiap tahap harus dapat
diuji dan dirilis secara mandiri.

Tahap pertama adalah fondasi Worker dan layanan MAPABA. Tahap berikutnya adalah
Advokasi, kemudian artikel, galeri, dokumen, data pengurus, serta autentikasi
admin bersama. Dokumen ini merinci tahap pertama; layanan lain tidak masuk ke
implementasi tahap pertama.

## Keadaan Proyek dan Batasan

- Frontend bersifat statis; halaman sumber berada di `src/pages/` dan dibangun ke
  `public/`.
- Backend aktif yang ada menggunakan Express, SQLite, JWT, dan bcrypt di
  `server/`.
- Konfigurasi frontend saat ini memakai satu `apiBaseUrl` untuk semua layanan.
- Kontrak MAPABA yang perlu dipertahankan mencakup endpoint, field formulir,
  format respons, validasi, status, dan format nomor `MPB-YYYY-NNNN`.
- Lampiran mengarahkan layanan baru ke Cloudflare Workers, D1, Cloudinary,
  serta autentikasi admin berbasis token.
- Akun Cloudinary dan nilai secret Cloudflare belum tersedia di repo; seluruh
  nilai rahasia akan disediakan oleh pengelola saat konfigurasi lokal/deploy.
- Tidak ada berkas basis data SQLite aktual di repo untuk diimpor. D1 baru tidak
  boleh menerima data produksi secara otomatis.

## Keputusan Arsitektur

### Migrasi bertahap

Worker ditempatkan pada direktori `worker/` sebagai aplikasi terpisah dari
aplikasi Express dan proses build frontend. Express tetap melayani endpoint
website selain MAPABA sampai masing-masing layanan dipindahkan dalam tahap
berikutnya.

Frontend mendapat konfigurasi `mapabaApiBaseUrl` terpisah. Hanya permintaan
MAPABA dan upload berkas MAPABA yang diarahkan ke Worker pada tahap pertama;
Advokasi, artikel, konten, autentikasi lama, dan halaman admin lain tetap
menggunakan `apiBaseUrl` Express.

### Runtime dan komponen

- Cloudflare Worker menggunakan Web APIs bawaan (`fetch`, `Request`, `Response`,
  `FormData`, dan Web Crypto) serta router JavaScript kecil tanpa ketergantungan
  pada server HTTP Node.
- Cloudflare D1 menyimpan gelombang, pendaftar, nomor urut, audit perubahan
  status, dan metadata referensi unggahan.
- Cloudinary menyimpan pas foto dan KTM sebagai aset privat/terautentikasi.
- CORS hanya mengizinkan origin frontend lokal dan origin deploy yang
  dikonfigurasi. Origin wildcard tidak digunakan.
- Secret Worker disimpan di konfigurasi lokal yang diabaikan Git atau melalui
  Cloudflare Worker Secrets. Nilainya tidak pernah ditulis pada source code,
  konfigurasi publik frontend, atau dokumentasi.

### API tahap pertama

Semua endpoint memakai prefix `/api/v1` dan bentuk respons API yang telah
digunakan frontend.

| Metode | Endpoint | Akses | Perilaku |
| --- | --- | --- | --- |
| `GET` | `/health` | Publik | Pemeriksaan kesiapan Worker dan D1 |
| `GET` | `/mapaba/gelombang-aktif` | Publik | Detail gelombang aktif dan sisa kuota |
| `POST` | `/mapaba/pendaftaran` | Publik | Validasi dan pembuatan pendaftaran |
| `GET` | `/mapaba/pendaftaran/:nomor` | Publik | Status pendaftaran tanpa membuka data pribadi |
| `POST` | `/upload` | Publik terbatas | Unggah pas foto/KTM ke Cloudinary privat |
| `GET` | `/mapaba/admin/pendaftar` | Token Worker | Daftar pendaftar dengan filter dan paginasi |
| `PATCH` | `/mapaba/admin/pendaftar/:id` | Token Worker | Ubah status/catatan dan tulis audit |

Kontrak JSON pendaftaran tetap memakai field yang sudah ada, termasuk
`namaLengkap`, `nim`, `angkatan`, `universitas`, `fakultas`, `prodi`,
`jenisKelamin`, `whatsapp`, `email`, `asalDaerah`, `motivasi`,
`riwayatOrganisasi`, `sumberInformasi`, `pasFotoUrl`, `ktmUrl`, `kesediaan`,
`persetujuanData`, dan `captchaToken`.

Respons validasi memakai `{ ok: false, message, errors }` dengan nama field
frontend sebagai kunci `errors`. Respons pendaftaran sukses tetap
mengembalikan `nomorRegistrasi`, `status`, `biaya`, dan `pesan`. Endpoint
pelacakan publik hanya mengembalikan informasi minimum yang diperlukan untuk
mengecek status.

### D1 dan konsistensi pendaftaran

Migration D1 membuat tabel yang diperlukan untuk layanan MAPABA dan indeks
unik pada `(gelombang_id, nim)`. Status yang didukung tetap
`menunggu`, `terverifikasi`, `hadir`, `ditolak`, dan `batal`.

Pendaftaran harus memeriksa gelombang aktif, jendela waktu, duplikasi NIM, dan
kuota di sisi server. Penegakan kuota dilakukan melalui operasi SQL atomik di
D1 agar permintaan bersamaan tidak melampaui kuota. Penerbitan nomor registrasi
menggunakan counter per tahun dengan format `MPB-YYYY-NNNN`; konflik unik
diterjemahkan menjadi respons `409`, bukan galat server.

D1 dimulai kosong dan tidak mengimpor isi SQLite. Data gelombang contoh hanya
untuk pengembangan/pengujian lokal. Petunjuk deploy harus meminta pengelola
membuat atau mengisi gelombang produksi secara eksplisit sebelum pendaftaran
dibuka.

### Autentikasi transisi

Tahap pertama menggunakan secret `ADMIN_TOKEN` pada Worker. Admin mengisi token
di halaman MAPABA admin; token hanya disimpan di `sessionStorage` dan dikirim
melalui header `Authorization: Bearer`. Worker membandingkan token dengan cara
constant-time dan hanya membuka endpoint admin MAPABA bagi token yang sah.

Login Express berbasis email/kata sandi dan token JWT tetap dipakai layanan
Express lain selama migrasi. Halaman MAPABA admin untuk sementara memakai token
Worker terpisah. Penyatuan autentikasi dilakukan ketika layanan admin lainnya
telah dipindahkan, bukan dengan membuat endpoint Express lama berhenti bekerja.

### Upload dan privasi berkas

Endpoint upload menerima field multipart `file`, membatasi ukuran hingga 3 MB,
menerima JPEG/PNG/WebP, dan memeriksa magic bytes selain MIME yang dikirim
browser. Endpoint publik dibatasi lajunya. Worker membuat identitas referensi
unggahan sendiri; nama file klien tidak dipakai sebagai path.

Worker menandatangani permintaan upload ke Cloudinary di sisi server dan
menyimpan asset privat. Secret Cloudinary tidak pernah dikirim ke browser.
Respons mempertahankan bentuk `data.url`, `data.kunci`, dan `data.ukuranByte`
yang dipakai uploader, tetapi referensi berkas dikelola oleh Worker. Tautan
berkas yang dikirim ke browser adalah endpoint Worker, bukan URL Cloudinary.
Endpoint unduh memeriksa Bearer token admin, mengambil aset privat dari
Cloudinary di sisi server, lalu mengalirkan kontennya tanpa menyimpan respons
publik/cache. Frontend meminta berkas dengan header otorisasi dan membuka Blob
hasilnya. Dengan demikian URL bertanda tangan Cloudinary dan kredensial provider
tidak terlihat oleh browser; fitur akses bertoken premium Cloudinary tidak
diperlukan.

### CAPTCHA, pembatasan laju, dan notifikasi

- Worker mempertahankan pemeriksaan CAPTCHA server-side ketika provider
  dikonfigurasi. `none` hanya berlaku untuk pengembangan; provider aktif tanpa
  secret atau token yang sah menghasilkan galat eksplisit.
- Pendaftaran dibatasi maksimal 10 permintaan per IP per jam dan upload maksimal
  20 permintaan per IP per 15 menit. Identitas IP untuk pembatasan disimpan
  sebagai hash, bukan teks IP mentah.
- Notifikasi pendaftaran dan perubahan status tidak membatalkan operasi utama.
  Google Sheets dan WhatsApp menggunakan endpoint HTTP yang dapat dikonfigurasi.
  Email menggunakan API HTTP Resend yang opsional karena Worker tidak
  menjalankan Nodemailer/SMTP.
- Kegagalan dan status notifikasi dicatat di D1 dan log Worker; tidak ada
  kegagalan notifikasi yang disamarkan sebagai kegagalan pendaftaran.
- Notifikasi pendaftaran baru dikirim setelah transaksi data berhasil. Notifikasi
  keputusan admin hanya dipicu saat status berubah menjadi `terverifikasi` atau
  `ditolak`.

### Penanganan galat

Worker memakai kode status yang konsisten dengan Express: `400` untuk validasi,
`401` untuk token tidak sah, `404` untuk data tidak ditemukan, `409` untuk
duplikasi/kuota, `429` untuk batas laju, dan `500` untuk kegagalan internal.
Detail secret/provider tidak dikirim ke klien. Galat pihak ketiga dicatat tanpa
mengubah hasil sukses transaksi data yang sudah tersimpan.

## Perubahan Tahap Pertama

### File baru

- `worker/wrangler.jsonc` — konfigurasi Worker dan binding D1.
- `worker/package.json` — perintah dev/test Worker.
- `worker/.dev.vars.example` — nama konfigurasi lokal tanpa nilai rahasia.
- `worker/src/index.js` — handler fetch, CORS, dan pemetaan route.
- `worker/src/lib/` — validasi, autentikasi token, D1, Cloudinary, CAPTCHA,
  pembatasan laju, dan notifikasi.
- `worker/src/routes/` — route health, MAPABA, dan upload.
- `worker/migrations/0001_init.sql` — tabel dan indeks D1.
- `worker/test/` — pengujian route, validasi, akses admin, kuota, dan upload.

Nama modul akhir boleh mengikuti pembagian kode yang paling sederhana selama
batas tanggung jawab dan kontrak pada desain ini tetap dipenuhi.

### File yang diubah

- `public/assets/js/config.js` — menambah URL Worker MAPABA tanpa mengganti URL
  Express yang dipakai layanan lain.
- `public/assets/js/forms.js` — memilih Worker khusus untuk endpoint MAPABA.
- `public/assets/js/uploader.js` dan `src/pages/mapaba.html` — mengarahkan upload
  MAPABA ke Worker, tanpa mengalihkan upload admin Express yang belum dipindah.
- `public/assets/js/admin-mapaba.js` dan `src/pages/admin-mapaba.html` — token
  Worker transisi, endpoint daftar/status, dan akses berkas privat.
- `docs/BACKEND-SPEC.md` dan `docs/DEPLOYMENT.md` — menjelaskan kedua backend,
  setup lokal, konfigurasi Cloudflare/Cloudinary, migrasi D1, dan urutan cutover.

File Express tidak dihapus atau diubah pada tahap ini. Tidak ada perubahan
database produksi dan tidak ada deploy produksi.

## Pengujian dan Kriteria Sukses

1. Tes Worker berjalan lokal dengan D1 lokal dan tanpa secret Cloudinary/Resend
   nyata; integrasi eksternal diuji memakai respons fetch tiruan.
2. Tes mengunci field request/response dan kode status endpoint yang sudah
   dipakai frontend.
3. Tes mencakup validasi field, CAPTCHA aktif/tidak valid, token admin,
   rate limit, berkas terlalu besar/MIME palsu/magic bytes salah, NIM duplikat,
   kuota penuh, dan request bersamaan pada batas kuota.
4. Tes memastikan pelacakan publik tidak mengembalikan NIM, email, WhatsApp,
   motivasi, atau URL berkas privat.
5. Tes memastikan hanya admin Worker yang dapat mengunduh berkas privat; URL
   Cloudinary dan secret provider tidak muncul pada respons maupun frontend.
6. `npm test` tetap lulus untuk backend Express yang dipertahankan.
7. `npm run build` tetap menghasilkan frontend statis yang valid.
8. Petunjuk deploy menjelaskan binding dan secrets yang dibutuhkan tanpa
   menyertakan nilai secret.

Tidak ada data lama yang dianggap berhasil dimigrasikan. D1 harus berisi
gelombang produksi yang dikonfigurasi pengelola sebelum formulir Worker
menerima pendaftaran.

## Risiko dan Mitigasi

| Risiko | Mitigasi |
| --- | --- |
| Admin belum memiliki token Worker | Siapkan token acak sebagai Worker Secret melalui panduan deploy; jangan memakai nilai contoh |
| D1 kosong saat cutover | Buat gelombang produksi secara eksplisit dan verifikasi `GET /mapaba/gelombang-aktif` sebelum mengubah URL frontend |
| Cloudinary/Resend tidak dikonfigurasi | Upload gagal dengan galat eksplisit; notifikasi opsional dicatat sebagai dilewati/gagal tanpa membatalkan data utama |
| Kuota berubah karena request paralel | Pemeriksaan dan insert menggunakan query/transaksi atomik serta indeks unik |
| Dua backend aktif selama migrasi | URL Worker MAPABA terpisah; layanan lain tetap menunjuk Express sampai tahap migrasinya selesai |
| Berkas privat diakses tanpa izin | Endpoint proxy memeriksa token Worker dan tidak mengekspos URL Cloudinary |

## Rencana Tahap Lanjutan

1. **Fondasi Worker + MAPABA** — cakupan dokumen ini.
2. **Advokasi** — port formulir, pelacakan tiket minimum, panel advokat,
   status/log, CAPTCHA, dan notifikasi.
3. **Artikel, galeri, dokumen, dan pengurus** — port API publik/admin, upload
   konten, dan ringkasan dashboard.
4. **Autentikasi admin bersama dan cutover** — penyatuan sesi/role, pengujian
   integrasi seluruh halaman, pemindahan URL API, dan keputusan retensi Express.

Setiap tahap lanjutan memerlukan pemeriksaan kontrak frontend dan rencana
implementasi tersendiri. Express tetap tersedia sampai cutover akhir disetujui.
