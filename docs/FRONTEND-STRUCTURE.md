# Struktur Front-End

## 1. Mengapa HTML statis, bukan React?

Situs ini didominasi konten yang perlu terindeks mesin pencari (artikel, sejarah, dokumen
konstitusi) dan akan sering disunting oleh pengurus yang berganti setiap periode. Karena itu
front-end publik dibangun sebagai **HTML statis + Tailwind CSS + JavaScript vanilla**:

- Tidak ada *build step* JavaScript, tidak ada beban runtime framework di sisi pengunjung.
- Halaman tetap tampil utuh tanpa JavaScript (penting untuk jaringan kampus yang tidak stabil).
- Hasil build berupa berkas statis, bisa dihosting gratis di Netlify/Cloudflare Pages.

untuk React. Pemetaan komponennya ada di bagian 5.

---

## 2. Sistem Partial

Agar navbar dan footer tidak diduplikasi di 10 halaman, sumber halaman disimpan di `src/` dan
dirakit oleh [`scripts/build-html.js`](../scripts/build-html.js) menjadi HTML statis di `public/`.

```
src/partials/
├── head.html           meta, Open Graph, font, stylesheet, favicon
├── header.html         navbar sticky + dropdown Profil + menu mobile
├── page-hero.html      hero ringkas + breadcrumb untuk halaman dalam
├── footer.html         footer 3 kolom + bottom bar
├── back-to-top.html    tombol kembali ke atas
└── scripts.html        pemuatan config.js dan main.js
```

Sintaks di dalam berkas sumber:

| Sintaks | Arti |
| --- | --- |
| `{{> header }}` | Sisipkan `src/partials/header.html` |
| `{{ site.email }}` | Variabel global situs (nama, slogan, email, alamat) |
| `{{ pageTitle }}` | Variabel dari front-matter halaman |
| `{{base}}` | Path relatif ke root (`""` atau `"../"`), dihitung dari kedalaman output |

Front-matter ditulis sebagai komentar HTML pertama:

```html
<!--page
{
  "out": "profil/sejarah.html",
  "active": "profil",
  "title": "Sejarah — PR PMII Saintek UIN SGD",
  "description": "…",
  "pageEyebrow": "Profil",
  "pageTitle": "Sejarah",
  "pageLead": "…"
}
page-->
```

Kunci `active` menyuntikkan kelas `nav-link-active` ke tautan navbar yang memiliki
`data-nav` bernilai sama, sehingga penanda menu aktif tidak perlu diatur manual per halaman.

Jalankan `npm run html:build` (sekali) atau `npm run dev` (mode watch).

---

## 3. Anatomi Halaman Beranda

`src/pages/index.html` tersusun dari tujuh blok sesuai urutan kebutuhan:

| # | Blok | Penanda di berkas | Catatan implementasi |
| --- | --- | --- | --- |
| 1 | Header & navigasi | `{{> header }}` | `sticky top-0 z-50`, latar `bg-white/85 backdrop-blur`, bayangan muncul setelah scroll 8 px |
| 2 | Hero | `<section aria-labelledby="hero-title">` | Grid 12 kolom: 7 kolom teks + 5 kolom visual; ornamen grid SVG dengan `mask-image` radial |
| 4 | Tentang kami & Trilogi | `id="tentang-kami"` | Naskah 17 April 1960 + tiga kartu ikon (Dzikir/Fikir/Amal Sholeh) + kutipan besar |
| 5 | Artikel terkini | `<section aria-labelledby="artikel-title">` | 3 kartu dengan label kategori, `<time>`, preview, tautan "Baca Selengkapnya →" |
| 6 | Quote banner | `<section aria-labelledby="quote-title">` | Latar `pmii-950` + tiga lapis ornamen blur; kutipan Mahbub Djunaidi |
| 7 | Footer | `{{> footer }}` | Kolom identitas, tautan cepat, kontak & sosial media, bottom bar |

Di antara blok 6 dan 7 terdapat satu seksi ajakan penutup berisi tiga kartu (MAPABA, Advokasi,
Landasan Hukum) — penambahan di luar spesifikasi awal agar pengunjung punya jalan keluar yang jelas
di akhir halaman.

**Tombol CTA hero** menunjuk ke anchor internal: "Tentang Kami" → `#tentang-kami`, "Layanan" →
`#layanan`. Offset anchor sudah diperhitungkan lewat `scroll-padding-top` agar judul tidak
tertutup navbar.

---

## 4. JavaScript

| Berkas | Tanggung jawab |
| --- | --- |
| `config.js` | `window.PMII_CONFIG`: `apiBaseUrl`, `apiPrefix`, `useMockWhenOffline` |
| `main.js` | Bayangan navbar, hamburger menu, dropdown Profil, akordeon, animasi reveal, tombol ke atas, tahun berjalan |
| `forms.js` | Validasi klien, kirim JSON ke API, galat per-kolom, status memuat, panel sukses + nomor tiket, penghitung karakter, tampil/sembunyi sandi |
| `countdown.js` | Hitung mundur penutupan pendaftaran MAPABA |

Semua modul memakai pola IIFE, memasang diri lewat atribut `data-*`, dan aman dimuat pada halaman
yang tidak memakainya (selector kosong → tidak melakukan apa pun).

### Kontrak atribut formulir

```html
<form data-api-form="/advokasi/pengaduan"        <!-- path relatif terhadap apiBaseUrl+apiPrefix -->
      data-store-token="true"                    <!-- opsional: simpan token hasil login -->
      data-success-redirect="dashboard.html">    <!-- opsional: alihkan setelah sukses -->
  <input name="nama" required data-label="Nama lengkap" />
  <p class="error-text" data-error-for="nama"></p>
  <button type="submit" data-submit>Kirim</button>
</form>

<div data-form-alert hidden></div>       <!-- pesan galat umum -->
<div data-form-success hidden>           <!-- panel sukses -->
  <p data-ticket>—</p>                   <!-- diisi nomorTiket / nomorRegistrasi -->
</div>
```

Selama `useMockWhenOffline: true`, kegagalan koneksi ke API akan memunculkan respons tiruan
sehingga alur UI (validasi → memuat → panel sukses + nomor tiket) tetap bisa didemokan tanpa
menyalakan back-end. **Matikan opsi ini di produksi.**

---

## 5. Pemetaan ke React (bila nanti dimigrasikan)

Jika suatu saat front-end dipindahkan ke React/Next.js, pemetaan komponennya langsung mengikuti
partial dan seksi yang sudah ada:

```
<SiteLayout>
  <Navbar />                     ← src/partials/header.html
    <NavDropdown items={...} />
    <MobileMenu />
  <main>
    <Hero />                     ← seksi 2
    <QuickAccessGrid>            ← seksi 3
      <QuickAccessCard />        (props: icon, title, description, href, featured)
    </QuickAccessGrid>
    <AboutSection>               ← seksi 4
      <TrilogiCard />            (Dzikir / Fikir / Amal Sholeh)
      <PullQuote />
    </AboutSection>
    <ArticleGrid>                ← seksi 5, data dari GET /artikel?limit=3
      <ArticleCard />
    </ArticleGrid>
    <QuoteBanner />              ← seksi 6
  </main>
  <Footer />                     ← src/partials/footer.html
</SiteLayout>
```

Komponen yang paling diuntungkan oleh React adalah **panel admin**, karena state-nya kaya
dan saling bergantung:

| Komponen | State yang dikelola |
| --- | --- |
| `<RegistrantTable>` | Baris, penyaring status, kata kunci pencarian, halaman aktif |
| `<StatusDialog>` | Pendaftar terpilih, catatan panitia, status pengiriman |
| `<Uploader>` | Berkas terpilih, persentase progres, URL hasil unggah |
| `<Toast>` | Antrean pesan dan penghitung waktu tampil |

Kontrak API-nya sudah siap dipakai apa adanya — lihat [`BACKEND-SPEC.md`](BACKEND-SPEC.md) bagian 6.
