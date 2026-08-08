# SEO & Optimasi Performa

Target: situs muncul di halaman pertama Google untuk pencarian
**"PMII UIN Bandung"**, **"PMII Kabupaten Bandung"**, dan **"MAPABA UIN Bandung"**.

---

## 1. Struktur `<head>`

Seluruh meta tag dihasilkan dari satu partial, [`src/partials/head.html`](../src/partials/head.html),
dengan nilai per halaman diambil dari front-matter. Hasil pada halaman Beranda:

```html
<title>PR PMII Sains dan Teknologi UIN Sunan Gunung Djati Cabang Kabupaten Bandung</title>
<meta name="description" content="Website resmi PR PMII Sains dan Teknologi UIN Sunan Gunung Djati Cabang
      Kabupaten Bandung. Organisasi ekstra kampus yang berlandaskan Islam Ahlussunnah
      wal Jama'ah dan Pancasila. Dzikir, Fikir, Amal Sholeh." />
<meta name="keywords" content="PMII UIN Bandung, PMII Kabupaten Bandung, PR PMII Saintek, …" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="https://www.pmiiuinsgd.site/" />

<meta name="geo.region" content="ID-JB" />
<meta name="geo.placename" content="Kabupaten Bandung, Jawa Barat" />

<meta property="og:type" content="website" />
<meta property="og:locale" content="id_ID" />
<meta property="og:title" content="…" />
<meta property="og:description" content="…" />
<meta property="og:url" content="https://www.pmiiuinsgd.site/" />
<meta property="og:image" content="https://www.pmiiuinsgd.site/assets/img/og-image.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
```

**Yang benar-benar berpengaruh pada peringkat, berurutan:**

1. `<title>` — 50–60 karakter, kata kunci di depan, nama organisasi di belakang.
2. `meta description` — 140–160 karakter. Tidak menaikkan peringkat, tetapi menentukan
   berapa banyak orang mengeklik hasil pencarian Anda.
3. Satu `<h1>` per halaman, diikuti hierarki `<h2>`/`<h3>` yang masuk akal.
4. `canonical` — mencegah `pmiiuinsgd.site` dan `www.pmiiuinsgd.site` dianggap dua situs
   berbeda yang saling bersaing.
5. Data terstruktur (bagian 2).

**`meta keywords`** sudah lama diabaikan Google. Tetap disertakan karena beberapa mesin
pencari lokal dan agregator masih membacanya, dengan daftar yang relevan dan tidak
berlebihan — menjejalkan puluhan kata kunci justru bisa dianggap spam.

**Gambar Open Graph** berukuran 1200×630 dan berformat JPEG (115 KB). Inilah yang muncul
saat tautan dibagikan di grup WhatsApp — jalur penyebaran paling penting untuk organisasi
kampus. Sumbernya ada di [`src/og-image.html`](../src/og-image.html) beserta perintah
untuk membuat ulang.

---

## 2. Data Terstruktur

Beranda menyematkan `schema.org/Organization`, yang membuat Google menampilkan panel
informasi organisasi (nama, logo, alamat, media sosial):

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "PR PMII Sains dan Teknologi UIN Sunan Gunung Djati Cabang Kabupaten Bandung",
  "alternateName": "PR PMII Saintek UIN SGD",
  "slogan": "Dzikir, Fikir, Amal Sholeh",
  "email": "pmiiuinbandun9@gmail.com",
  "sameAs": ["https://instagram.com/pmii_uinbandung"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Jl. Manisi No. 21B Gang Kramat III RT 01 RW 09, Cibiru",
    "addressLocality": "Bandung",
    "addressRegion": "Jawa Barat",
    "addressCountry": "ID"
  }
}
```

**Tambahan yang disarankan** ketika halaman detail artikel dibuat — sematkan
`schema.org/Article` agar artikel dapat muncul di Google Discover:

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{judul}}",
  "image": ["{{coverUrl}}"],
  "datePublished": "{{publishedAt}}",
  "dateModified": "{{updatedAt}}",
  "author": { "@type": "Person", "name": "{{penulis}}" },
  "publisher": {
    "@type": "Organization",
    "name": "PR PMII Saintek UIN SGD",
    "logo": { "@type": "ImageObject", "url": "https://www.pmiiuinsgd.site/assets/img/logo-pmii.svg" }
  }
}
```

Untuk halaman MAPABA, `schema.org/Event` membuat tanggal kegiatan muncul langsung di
hasil pencarian.

---

## 3. Optimasi Gambar Galeri

Halaman Galeri adalah halaman terberat di situs mana pun. Empat teknik berikut gratis dan
tidak memerlukan pustaka tambahan:

### a. Lazy loading

```html
<img src="foto-800.webp" loading="lazy" decoding="async" alt="Bakti sosial di Cibiru" />
```

`loading="lazy"` menunda pengunduhan sampai gambar mendekati viewport. Untuk album berisi
40 foto, hanya 4–6 foto pertama yang benar-benar diunduh saat halaman dibuka.

`decoding="async"` mencegah dekode gambar memblokir penggambaran halaman.

> **Kecuali gambar paling atas.** Gambar pertama biasanya adalah *Largest Contentful Paint*.
> Menunda pengunduhannya justru memperlambat skor. Pakai `loading="eager"` dan
> `fetchpriority="high"` untuk gambar itu saja.

### b. Ukuran responsif

```html
<img
  src="foto-800.webp"
  srcset="foto-400.webp 400w, foto-800.webp 800w, foto-1200.webp 1200w"
  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
  width="800" height="600"
  loading="lazy" decoding="async"
  alt="Deskripsi singkat kegiatan"
  class="h-full w-full object-cover" />
```

Ponsel mengunduh versi 400px (± 30 KB), bukan versi 1200px (± 250 KB). Pada koneksi
seluler kampus, perbedaannya sangat terasa.

### c. `width` dan `height` wajib diisi

Tanpa keduanya, peramban tidak tahu berapa ruang yang harus disediakan sehingga konten
melompat saat gambar selesai dimuat. Lompatan ini diukur Google sebagai
*Cumulative Layout Shift* dan menurunkan peringkat. Nilainya boleh berbeda dari ukuran
tampil — yang dibaca peramban hanyalah rasionya.

### d. Format modern

WebP rata-rata 30% lebih kecil daripada JPEG pada kualitas visual yang sama; AVIF lebih
kecil lagi. Cara termudah: pakai driver **Cloudinary** (`STORAGE_DRIVER=cloudinary`) yang
sudah dikonfigurasi dengan `quality: auto:good` dan `fetch_format: auto` — Cloudinary
otomatis mengirim AVIF ke Chrome, WebP ke Safari lama, dan JPEG ke peramban tua.

Konversi manual bila mengelola sendiri:

```bash
# Satu berkas
cwebp -q 82 foto.jpg -o foto.webp

# Seluruh folder + tiga ukuran
for f in *.jpg; do
  for w in 400 800 1200; do
    convert "$f" -resize ${w}x -quality 82 "${f%.jpg}-${w}.webp"
  done
done
```

### e. Muat bertahap

Ganti tombol "Muat Lebih Banyak" dengan `IntersectionObserver` yang memanggil
`GET /api/v1/galeri/album?page=N` saat pengguna mendekati bagian bawah, alih-alih memuat
seluruh album sekaligus.

---

## 4. Performa Situs Saat Ini

| Aset | Ukuran | Catatan |
| --- | --- | --- |
| `style.css` | 56 KB ter-minify, ±9 KB gzip | Satu berkas, seluruh situs |
| `main.js` | ±6 KB | Tanpa framework |
| `logo-pmii.svg` | 2,3 KB | Inline SVG, tajam di semua resolusi |
| `og-image.jpg` | 115 KB | Hanya diunduh perayap media sosial |
| Font | 2 keluarga, `display=swap` | Ada fallback font sistem |

Tidak ada React, jQuery, Bootstrap, atau pustaka animasi. Untuk situs organisasi yang
sebagian besar berisi teks, ini keputusan performa terbesar yang bisa diambil.

**Pengetatan lanjutan bila diperlukan:**

1. **Self-host font.** Menghilangkan dua koneksi ke domain Google dan menghapus
   ketergantungan pada jaringan pihak ketiga. Unduh melalui
   [google-webfonts-helper](https://gwfh.mranftl.com), lalu tambahkan
   `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
2. **Kompresi Brotli** di Nginx (±20% lebih baik daripada gzip).
3. **Hash pada nama berkas** (`style.a1b2c3.css`) agar cache dapat disetel satu tahun
   dengan aman. Saat ini CSS/JS di-cache 7 hari karena namanya tetap.
4. **Cloudflare** di depan situs: CDN, cache, dan proteksi DDoS gratis.

---

## 5. Setelah Situs Online

1. **Google Search Console** — verifikasi kepemilikan domain, kirim
   `https://www.pmiiuinsgd.site/sitemap.xml`, lalu minta pengindeksan halaman Beranda
   secara manual. Ini cara tercepat agar situs mulai terlihat.
2. **Bing Webmaster Tools** — dapat mengimpor langsung dari Search Console.
3. **Google Business Profile** — daftarkan sekretariat sebagai organisasi. Ini yang
   membuat situs muncul pada pencarian bernuansa lokal seperti "PMII Kabupaten Bandung".
4. **Tautan masuk** — minta tautan dari situs PC PMII Kabupaten Bandung, PB PMII, dan
   laman UKM/organisasi kampus. Beberapa tautan dari situs relevan bernilai lebih besar
   daripada puluhan tautan sembarangan.
5. **Isi konten secara rutin.** Satu artikel per pekan jauh lebih berpengaruh terhadap
   peringkat daripada semua penyetelan teknis di dokumen ini. Google memberi peringkat
   pada situs yang hidup.
6. **Periksa berkala** dengan [PageSpeed Insights](https://pagespeed.web.dev) dan
   Lighthouse; targetkan skor 90+ pada Performance, Accessibility, Best Practices, dan SEO.

---

## 6. Berkas yang Dihasilkan Otomatis

`npm run build` menghasilkan tiga berkas SEO di `public/`:

| Berkas | Isi |
| --- | --- |
| `site.webmanifest` | Manifest PWA agar situs dapat dipasang di layar utama ponsel |
