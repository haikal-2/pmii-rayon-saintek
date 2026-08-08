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
| Halaman publik | `src/pages/`, hasil build di `public/` | 10 halaman statis, termasuk Beranda |
| Design system | `src/css/input.css`, `tailwind.config.js` | Token warna PMII, komponen tombol/kartu/form |
| Interaksi UI | `public/assets/js/` | Navbar, dropdown, reveal, formulir, hitung mundur, CBT |
| API | `server/src/` | Express + better-sqlite3, validasi Zod, JWT |
| Skema basis data | `server/db/schema.sql` | 20 tabel dengan relasi dan constraint |
| Dokumentasi | `docs/` | Design system, struktur front-end, spesifikasi back-end |

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
│   ├── src/{app.js,index.js,lib,middleware,routes}
│   ├── db/{schema.sql,migrate.js,seed.js}
│   └── test/smoke.js
└── docs/
    ├── DESIGN-SYSTEM.md
    ├── FRONTEND-STRUCTURE.md
    └── BACKEND-SPEC.md
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

**Back-end** — jalankan API di VPS dengan proses manager (PM2/systemd) di belakang Nginx.
Langkah lengkap termasuk contoh konfigurasi Nginx dan strategi backup ada di
[`docs/BACKEND-SPEC.md`](docs/BACKEND-SPEC.md) bagian 9.

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
