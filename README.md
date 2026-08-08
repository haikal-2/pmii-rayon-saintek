# Website PK PMII UIN Sunan Gunung Djati Cabang Kabupaten Bandung

> **Dzikir, Fikir, Amal Sholeh**
> Organisasi ekstra kampus yang berlandaskan Islam Ahlussunnah wal Jama'ah dan Pancasila.

Repositori ini berisi **front-end statis** (HTML + Tailwind CSS + JavaScript) dan **API back-end**
(Express + SQLite) untuk website resmi PK PMII UIN SGD Cab. Kab. Bandung, termasuk tiga layanan
interaktif: Layanan Advokasi, MAPABA Raya, dan CBT BIMTES.

---

## Isi Singkat

| Bagian | Lokasi | Keterangan |
| --- | --- | --- |
| Halaman publik | `src/pages/`, hasil build di `public/` | 18 halaman statis, termasuk Beranda |
| Panel admin | `public/admin/` | Dashboard, verifikasi MAPABA, laporan advokasi, kelola konten |
| Modul CBT | `public/cbt/` | Login, dashboard peserta, ruang ujian dengan timer & autosave |
| Design system | `src/css/input.css`, `tailwind.config.js` | Token warna PMII, komponen tombol/kartu/form |
| Interaksi UI | `public/assets/js/` | Navbar, formulir, unggah berkas, CAPTCHA, ujian, admin |
| API | `server/src/` | Express + better-sqlite3, validasi Zod, JWT, Multer |
| Skema basis data | `server/db/schema.sql` (SQLite) · `schema.mysql.sql` (produksi) | 22 tabel + view `cbt_scores` |
| Deployment | `deploy/`, `vercel.json` | Nginx, PM2, konfigurasi Vercel |
| Dokumentasi | `docs/` | Design system, front-end, back-end, keamanan, SEO, deployment |

---

## Menjalankan Secara Lokal

```bash
# 1. Pasang dependensi
npm install

# 2. Siapkan konfigurasi server
cp .env.example .env
# lalu isi JWT_SECRET, mis. dengan:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Siapkan basis data + data contoh
npm run db:migrate
npm run db:seed

# 4a. Jalankan front-end (build HTML + Tailwind watch + static server)
npm run dev          # http://localhost:4321

# 4b. Jalankan API di terminal terpisah
npm run api          # http://localhost:4000/api/v1
```

Kredensial data contoh (**hanya untuk pengembangan**):

| Peran | Identitas | Kata sandi |
| --- | --- | --- |
| Admin/pengurus | `admin@pmiiuinbandung.test` | `RahasiaAdmin123` |
| Peserta CBT | `BIM-2026-0001` | `bimtes2026` |

### Perintah npm

| Perintah | Fungsi |
| --- | --- |
| `npm run build` | Rakit HTML + kompilasi Tailwind ter-minify (siap deploy) |
| `npm run dev` | Mode pengembangan: watch HTML, watch CSS, static server |
| `npm run html:build` | Rakit `src/pages/` + `src/partials/` menjadi `public/*.html` |
| `npm run css:build` | Kompilasi Tailwind ke `public/assets/css/style.css` |
| `npm run api` | Jalankan API Express |
| `npm run db:migrate` / `npm run db:seed` | Terapkan skema / isi data contoh |
| `npm test` | Uji asap API (24 pemeriksaan alur end-to-end) |

---

## Struktur Direktori

```
.
├── src/
│   ├── css/input.css          Design system (token + @layer components)
│   ├── partials/              head, header (navbar), footer, page-hero, dll.
│   └── pages/                 Sumber setiap halaman + front-matter JSON
├── scripts/build-html.js      Perakit HTML statis dari partial
├── public/                    HASIL BUILD — inilah yang di-deploy
│   ├── index.html             Beranda
│   ├── profil/{sejarah,struktur}.html
│   ├── artikel.html, galeri.html, landasan-hukum.html
│   ├── advokasi.html, mapaba.html
│   ├── cbt/{login,dashboard}.html
│   └── assets/{css,js,img}/
├── server/
│   ├── src/
│   │   ├── lib/{db,http,tokens,storage,notify}.js
│   │   ├── middleware/{auth,captcha}.js
│   │   └── routes/{artikel,konten,advokasi,mapaba,cbt,admin,upload}.js
│   ├── db/{schema.sql,schema.mysql.sql,migrate.js,seed.js}
│   └── test/smoke.js
├── deploy/{nginx.conf,ecosystem.config.js}
└── docs/
    ├── DESIGN-SYSTEM.md
    ├── FRONTEND-STRUCTURE.md
    ├── BACKEND-SPEC.md
    ├── KEAMANAN.md
    ├── SEO-PERFORMA.md
    └── DEPLOYMENT.md
```

> `public/*.html` adalah **hasil build**. Untuk mengubah tampilan, edit berkas di
> `src/pages/` atau `src/partials/`, lalu jalankan `npm run html:build`.

---

## Halaman yang Tersedia

| Halaman | URL | Isi |
| --- | --- | --- |
| Beranda | `/index.html` | Hero, panel akses cepat, tentang kami + Trilogi PMII, artikel terkini, quote banner |
| Sejarah | `/profil/sejarah.html` | Naskah sejarah PMII sejak 17 April 1960 + linimasa |
| Struktur | `/profil/struktur.html` | Pengurus inti, enam bidang kerja, bagan koordinasi |
| Artikel | `/artikel.html` | Filter kategori, pencarian, artikel unggulan, paginasi |
| Galeri | `/galeri.html` | Grid album kegiatan dengan filter kategori |
| Landasan Hukum | `/landasan-hukum.html` | AD/ART, NDP, PO, pedoman kaderisasi + hierarki peraturan |
| Layanan Advokasi | `/advokasi.html` | Form pengaduan + alur penanganan + nomor tiket |
| MAPABA Raya | `/mapaba.html` | Landing page, hitung mundur, agenda, formulir registrasi, FAQ |
| Login CBT | `/cbt/login.html` | Login peserta CBT BIMTES 2026 |
| Dashboard CBT | `/cbt/dashboard.html` | Daftar ujian, riwayat skor, tata tertib |
| Ruang Ujian CBT | `/cbt/ujian.html?sesi=N` | Navigasi soal, pilihan A–E, timer, ragu-ragu, autosave |

### Panel Admin (`/admin/`, tidak diindeks mesin pencari)

| Halaman | URL | Status |
| --- | --- | --- |
| Masuk | `/admin/login.html` | Berfungsi penuh |
| Dashboard | `/admin/index.html` | Berfungsi penuh — ringkasan + daftar terbaru |
| Data Pendaftar MAPABA | `/admin/mapaba.html` | Berfungsi penuh — tabel, filter, Terima/Tolak, ekspor CSV |
| Laporan Advokasi | `/admin/advokasi.html` | Berfungsi penuh — alur status berjenjang |
| Kelola Soal CBT | `/admin/cbt.html` | Penerbitan akun peserta berfungsi; editor bank soal menyusul |
| Kelola Artikel | `/admin/artikel.html` | Daftar artikel berfungsi; editor WYSIWYG menyusul |
| Kelola Galeri | `/admin/galeri.html` | Daftar album berfungsi; pengunggah album menyusul |

---

## Deploy

**Front-end** — folder `public/` bersifat statis sepenuhnya, cocok untuk Netlify, Vercel,
Cloudflare Pages, atau GitHub Pages:

```bash
npm run build          # menghasilkan public/ siap unggah
```

Sebelum deploy, sesuaikan `public/assets/js/config.js`:

```js
window.PMII_CONFIG = {
  apiBaseUrl: 'https://api.pmiiuinbandung.or.id',
  apiPrefix: '/api/v1',
  useMockWhenOffline: false,   // matikan di produksi
};
```

**Back-end** — jalankan API di VPS dengan PM2 di belakang Nginx, atau di Render/Railway.

Panduan lengkap ada di [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): rekomendasi VPS beserta
kisaran harganya, langkah demi langkah pemasangan, konfigurasi Nginx dan PM2 yang sudah
disediakan di `deploy/`, cara mengarahkan domain `www.pmiiuinsgd.site`, strategi backup,
serta daftar periksa khusus hari-H pelaksanaan CBT.

Sebelum diumumkan ke publik, kerjakan daftar periksa di
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) bagian 8 dan baca
[`docs/KEAMANAN.md`](docs/KEAMANAN.md) bagian 7.

---

## Aksesibilitas & Performa

- Navigasi penuh dengan papan tik (keyboard), indikator fokus terlihat, dan tautan *lompat ke konten utama*.
- Seluruh ikon dekoratif memakai `aria-hidden`, ikon fungsional memiliki label teks.
- Animasi dinonaktifkan otomatis saat pengguna mengaktifkan `prefers-reduced-motion`.
- Tanpa dependensi front-end di sisi klien: satu berkas CSS (56 KB ter-minify, ±9 KB setelah gzip)
  dan beberapa berkas JS kecil tanpa framework.
- Logo berupa SVG inline sehingga tajam di semua resolusi dan tidak memerlukan permintaan gambar tambahan.

---

## Lisensi & Atribusi

Kode dalam repositori ini disiapkan untuk keperluan internal PK PMII UIN Sunan Gunung Djati
Cabang Kabupaten Bandung. Lambang PMII pada `public/assets/img/logo-pmii.svg` adalah render SVG
bergaya untuk keperluan antarmuka; untuk dokumen resmi gunakan berkas lambang resmi organisasi.

**Kontak:** [pmiiuinbandun9@gmail.com](mailto:pmiiuinbandun9@gmail.com) ·
Instagram [@pmii_uinbandung](https://instagram.com/pmii_uinbandung) ·
Sekretariat: Jl. Manisi No. 21B Gang Kramat III RT 01 RW 09, Cibiru, Bandung, Jawa Barat.

_Salam Pergerakan!_
