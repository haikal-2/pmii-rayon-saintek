# Design System — PK PMII UIN SGD Cab. Kab. Bandung

Rancangan visual mengikuti tiga kata kunci: **akademis, bersih, dan bergerak.** Latar putih
mendominasi agar teks panjang (naskah sejarah, AD/ART, artikel) nyaman dibaca; biru dipakai untuk
struktur dan kepercayaan; kuning dipakai hemat sebagai penanda aksi dan sorotan.

Implementasi berada di dua berkas:

- [`tailwind.config.js`](../tailwind.config.js) — token (warna, font, shadow, animasi)
- [`src/css/input.css`](../src/css/input.css) — komponen `@layer components`

---

## 1. Palet Warna

### Biru PMII (`pmii-*`) — warna utama

| Token | Hex | Penggunaan |
| --- | --- | --- |
| `pmii-50` | `#eef4ff` | Latar kartu ikon, latar hover menu |
| `pmii-100` | `#dae6ff` | Garis tepi halus, badge |
| `pmii-200` | `#bcd2ff` | Border tombol *outline*, ornamen blur |
| `pmii-500` | `#3364ff` | Border input saat fokus |
| `pmii-700` | `#162fe1` | Teks tautan, ikon |
| `pmii-800` | `#1829b6` | **Tombol primer**, teks tegas |
| `pmii-900` | `#122a8f` | Judul, hover tombol primer |
| `pmii-950` | `#0b1a5c` | Latar seksi gelap (footer, quote banner, hero MAPABA) |

### Kuning PMII (`kuning-*`) — warna aksen

| Token | Hex | Penggunaan |
| --- | --- | --- |
| `kuning-50/100` | `#fffceb` / `#fff6c6` | Latar panel catatan |
| `kuning-300` | `#ffdb4a` | Teks aksen di atas latar gelap |
| `kuning-400` | `#ffc820` | **Tombol aksen (CTA sorotan)**, ring fokus |
| `kuning-600` | `#dd7d02` | Teks aksen di atas latar putih (kontras aman) |
| `kuning-800` | `#94440c` | Judul pada panel kuning |

**Aturan kontras.** Kuning 400 tidak pernah dipakai sebagai warna teks di atas putih. Untuk teks
beraksen di latar terang gunakan `kuning-600` ke atas; di latar gelap gunakan `kuning-300`.
Tombol aksen memakai teks `pmii-950` di atas `kuning-400` (rasio kontras ≈ 9:1).

### Netral

`slate-50` untuk latar seksi bergantian, `slate-200` untuk garis pemisah, `slate-600` untuk teks
tubuh, `slate-500` untuk metadata.

---

## 2. Tipografi

| Peran | Font | Kelas |
| --- | --- | --- |
| Judul | **Sora** 600–800 | `font-display` (otomatis pada `h1`–`h4`) |
| Teks tubuh | **Plus Jakarta Sans** 400–700 | `font-sans` (default `body`) |

Skala judul responsif:

| Elemen | Mobile | Desktop |
| --- | --- | --- |
| H1 hero | `2rem` | `3.25rem` |
| H2 seksi | `1.875rem` | `2.75rem` |
| H3 kartu | `1.125rem` | `1.125rem` |
| Teks tubuh | `1rem` | `1rem`–`1.125rem` |

Judul memakai `text-wrap: balance` agar pemenggalan baris tidak menyisakan satu kata sendirian.
Kedua font dimuat dari Google Fonts dengan `display=swap` dan memiliki fallback ke font sistem,
sehingga halaman tetap terbaca bila jaringan lambat atau CDN diblokir.

---

## 3. Tata Letak & Spasi

```
.container-page  → max-w-7xl, padding 1rem (mobile) → 2rem (desktop)
.section         → py-16 (mobile) → py-24 (desktop)
```

Ritme vertikal antar seksi dibedakan dengan latar bergantian putih dan `slate-50/70`, sehingga
pengunjung dapat memindai batas seksi tanpa garis pemisah tegas.

**Titik responsif** (bawaan Tailwind): `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px.

| Komponen | Perilaku |
| --- | --- |
| Navbar | Menu penuh di `xl`, hamburger di bawah `xl` |
| Panel akses cepat | 1 kolom → 2 (`sm`) → 4 (`xl`) |
| Kartu artikel | 1 kolom → 2 (`md`) → 3 (`lg`) |
| Trilogi PMII | 1 kolom → 3 (`sm`) |
| Formulir | 1 kolom → 2 kolom (`sm`) untuk kolom pendek berpasangan |
| Halaman dengan sidebar | Menumpuk, sidebar `sticky` mulai `lg` |

---

## 4. Komponen

### Tombol

| Kelas | Wujud | Dipakai untuk |
| --- | --- | --- |
| `.btn-primary` | Biru `pmii-800`, teks putih | Aksi utama ("Tentang Kami", "Kirim Pengaduan") |
| `.btn-accent` | Kuning `kuning-400`, teks biru gelap, *glow shadow* | Sorotan ("Akses Platform", "Daftar Sekarang") |
| `.btn-outline` | Putih dengan border biru muda | Aksi sekunder ("Layanan", "Bersihkan Form") |
| `.btn-ghost-light` | Transparan berbingkai, untuk latar gelap | CTA sekunder di hero MAPABA |
| `.btn-sm` | Pengubah ukuran ringkas | Tombol di dalam navbar/kartu |

Semua tombol: sudut `rounded-xl`, transisi 200 ms, naik 2 px saat hover, mengecil `0.98` saat
ditekan (umpan balik sentuh), dan tinggi ≥ 44 px agar nyaman disentuh di ponsel.

### Kartu

- `.card` — putih, border `slate-200`, `shadow-card`; saat hover naik 4 px dan border menjadi biru.
- `.card-featured` — biru gelap untuk kartu sorotan CBT BIMTES, dilengkapi ornamen blur kuning dan
  pola grid transparan.
- `.card-icon` — kotak ikon 48 px dengan latar `pmii-50` dan ring `pmii-100`.

### Formulir

`.label`, `.input`, `.hint`, `.error-text`, `.input-error`, `.fieldset-card`.

Pola galat: pesan galat berada tepat di bawah input (`[data-error-for="namaKolom"]`), input diberi
border merah dan `aria-invalid="true"`. Validasi klien dijalankan oleh
[`public/assets/js/forms.js`](../public/assets/js/forms.js) dan digandakan di server dengan Zod —
pesan dari server memakai nama kolom yang sama sehingga langsung menempel di tempat yang benar.

### Tautan panah

`.link-arrow` menampilkan panah yang bergeser 4 px ke kanan saat hover — dipakai konsisten pada
semua tautan "Lihat →" dan "Baca Selengkapnya →".

---

## 5. Gerak (Motion)

| Nama | Durasi | Penggunaan |
| --- | --- | --- |
| `.reveal` | 700 ms, `cubic-bezier(.16,1,.3,1)` | Elemen memudar naik saat masuk viewport |
| `animate-float-slow` | 7 s, berulang | Lambang PMII di hero |
| `animate-ping` | bawaan Tailwind | Titik status "Salam Pergerakan!" / "Pendaftaran Dibuka" |

Animasi masuk dijalankan `IntersectionObserver`; urutan tunda diatur lewat atribut
`data-reveal-delay` sehingga kartu dalam satu grid tampil bertahap. Bila
`prefers-reduced-motion: reduce` aktif, semua elemen langsung tampil tanpa transisi.

---

## 6. Aksesibilitas

- Setiap seksi memakai `aria-labelledby` yang menunjuk ke judulnya.
- Cincin fokus kuning tebal 2 px + offset 2 px pada semua elemen interaktif.
- Menu mobile dan dropdown memelihara `aria-expanded`, dapat ditutup dengan tombol `Esc`, dan
  fokus kembali ke tombol pemicu.
- Tabel riwayat CBT memakai `scope="col"`; ikon dekoratif memakai `aria-hidden="true"`.
- Tanggal artikel memakai elemen `<time datetime="…">` agar terbaca mesin.
- Struktur data `schema.org/Organization` disematkan di Beranda untuk pencarian.
