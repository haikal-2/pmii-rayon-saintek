#!/usr/bin/env node
/**
 * Static page assembler.
 *
 * Menggabungkan `src/pages/*.html` dengan partial di `src/partials/` menjadi
 * HTML statis penuh di dalam `public/`. Hasil build tidak memerlukan JavaScript
 * untuk menampilkan header/footer, sehingga aman untuk SEO dan tetap tampil
 * ketika JS dimatikan.
 *
 * Sintaks di dalam file sumber:
 *   {{> nama-partial }}   sisipkan src/partials/nama-partial.html
 *   {{ variabel }}        ganti dengan nilai dari front-matter halaman
 *   {{base}}              path relatif ke root public/ (mis. "" atau "../")
 *
 * Front-matter ditulis sebagai komentar HTML pertama pada file halaman:
 *   <!--page
 *   { "out": "index.html", "title": "...", "description": "...", "active": "beranda" }
 *   page-->
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'src/pages');
const PARTIALS_DIR = path.join(ROOT, 'src/partials');
const OUT_DIR = path.join(ROOT, 'public');

const SITE = {
  name: 'PR PMII Saintek UIN SGD',
  longName: 'PR PMII Sains dan Teknologi UIN Sunan Gunung Djati Cabang Kabupaten Bandung',
  slogan: 'Dzikir, Fikir, Amal Sholeh',
  email: 'pmiiuinbandun9@gmail.com',
  instagram: '@pmii_uinbandung',
  instagramUrl: 'https://instagram.com/pmii_uinbandung',
  address:
    'Jl. Manisi No. 21B Gang Kramat III RT 01 RW 09, Cibiru, Bandung, Jawa Barat',
  // Dipakai untuk canonical, og:url, dan sitemap. Ubah lewat SITE_URL saat build
  // bila situs dipasang di domain lain (mis. saat pratinjau).
  url: (process.env.SITE_URL || 'https://www.pmiiuinsgd.site').replace(/\/$/, ''),
  year: new Date().getFullYear(),
};

/**
 * Kata kunci bawaan.
 *
 * Meta keywords sudah lama tidak dipakai Google sebagai faktor peringkat, tetapi
 * masih dibaca beberapa mesin pencari lokal dan agregator, jadi tetap disertakan
 * dengan daftar yang relevan dan tidak berlebihan. Yang benar-benar menentukan
 * peringkat ada pada <title>, meta description, struktur heading, dan data
 * terstruktur — semuanya sudah diatur per halaman.
 */
const DEFAULT_KEYWORDS = [
  'PMII UIN Bandung',
  'PMII Kabupaten Bandung',
  'PR PMII Saintek',
  'PMII UIN Sunan Gunung Djati',
  'Pergerakan Mahasiswa Islam Indonesia',
  'MAPABA UIN Bandung',
  'organisasi mahasiswa UIN Bandung',
  'advokasi mahasiswa Bandung',
  'KOPRI PMII',
  'Rayon Sains dan Teknologi',
].join(', ');

function readPartial(name) {
  const file = path.join(PARTIALS_DIR, `${name}.html`);
  if (!fs.existsSync(file)) throw new Error(`Partial tidak ditemukan: ${name}`);
  return fs.readFileSync(file, 'utf8');
}

/** Sisipkan partial secara rekursif (maksimal 10 level untuk mencegah loop). */
function expandPartials(html, depth = 0) {
  if (depth > 10) throw new Error('Kedalaman partial berlebihan (kemungkinan include melingkar).');
  return html.replace(/\{\{>\s*([\w./-]+)\s*\}\}/g, (_, name) =>
    expandPartials(readPartial(name.trim()), depth + 1)
  );
}

function interpolate(html, vars) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), vars);
    return value == null ? '' : String(value);
  });
}

/**
 * Tandai menu yang sedang aktif dengan menyuntikkan kelas ke elemen yang
 * atribut penandanya cocok, mis. data-nav="artikel" → kelas nav-link-active.
 */
function markActive(html, attribute, value, className) {
  if (!value) return html;
  return html.replace(
    new RegExp(`(<a[^>]*${attribute}="${value}"[^>]*class=")`, 'g'),
    `$1${className} `
  );
}

function parseFrontMatter(raw, fallbackName) {
  const match = raw.match(/^\s*<!--page([\s\S]*?)page-->/);
  if (!match) {
    return { config: { out: `${fallbackName}.html`, title: fallbackName }, body: raw };
  }
  let config;
  try {
    config = JSON.parse(match[1].trim());
  } catch (error) {
    throw new Error(`Front-matter tidak valid pada ${fallbackName}.html: ${error.message}`);
  }
  return { config, body: raw.slice(match[0].length) };
}

function build() {
  const pages = fs
    .readdirSync(PAGES_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();

  const results = [];

  for (const file of pages) {
    const name = path.basename(file, '.html');
    const raw = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    const { config, body } = parseFrontMatter(raw, name);

    const out = config.out || `${name}.html`;
    const depth = out.split('/').length - 1;
    const base = depth === 0 ? '' : '../'.repeat(depth);

    const vars = {
      // Semua kunci front-matter tersedia sebagai variabel halaman,
      // mis. "pageTitle" dipakai oleh partial page-hero.
      ...config,
      site: SITE,
      base,
      title: config.title || SITE.longName,
      description: config.description || '',
      keywords: config.keywords || DEFAULT_KEYWORDS,
      canonical: `${SITE.url}${out === 'index.html' ? '/' : `/${out}`}`,
      // Halaman panel admin, ruang ujian, dan login tidak boleh masuk indeks.
      robots: config.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
      ogImage: `${SITE.url}/assets/img/og-image.jpg`,
      bodyClass: config.bodyClass || '',
      year: SITE.year,
    };

    let html = expandPartials(body);
    html = interpolate(html, vars);
    html = markActive(html, 'data-nav', config.active, 'nav-link-active');
    html = markActive(html, 'data-admin-nav', config.adminNav, 'admin-link-active');

    const target = path.join(OUT_DIR, out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html.trimStart());
    results.push({ out, bytes: Buffer.byteLength(html), noindex: Boolean(config.noindex) });
  }

  tulisRobots();
  tulisSitemap(results.filter((r) => !r.noindex));
  tulisManifest();

  const pad = Math.max(...results.map((r) => r.out.length));
  console.log(`Build HTML → public/  (${results.length} halaman)`);
  for (const r of results) {
    console.log(`  ✓ ${r.out.padEnd(pad)}  ${(r.bytes / 1024).toFixed(1)} KB`);
  }
  console.log('  ✓ robots.txt, sitemap.xml, site.webmanifest');
}

/* -------------------------------------------------------------------- SEO */

function tulisRobots() {
  const isi = `# robots.txt — ${SITE.longName}
User-agent: *
Allow: /

# Area internal: tidak boleh diindeks maupun ditelusuri
Disallow: /admin/
Disallow: /uploads/

# Beri jeda pada perayap agresif agar tidak membebani server
User-agent: AhrefsBot
Crawl-delay: 10

User-agent: SemrushBot
Crawl-delay: 10

Sitemap: ${SITE.url}/sitemap.xml
`;
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), isi);
}

/**
 * Sitemap XML.
 *
 * `priority` dan `changefreq` hanyalah petunjuk (Google mengabaikannya),
 * tetapi `lastmod` tetap dipakai untuk menentukan kapan halaman dirayapi ulang.
 */
function tulisSitemap(halaman) {
  const hariIni = new Date().toISOString().slice(0, 10);
  const prioritas = (out) => {
    if (out === 'index.html') return '1.0';
    if (['artikel.html', 'mapaba.html', 'advokasi.html'].includes(out)) return '0.9';
    if (out.startsWith('profil/')) return '0.7';
    return '0.8';
  };

  const url = halaman
    .map((item) => {
      const loc = `${SITE.url}${item.out === 'index.html' ? '/' : `/${item.out}`}`;
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${hariIni}</lastmod>
    <changefreq>${item.out === 'artikel.html' ? 'daily' : 'weekly'}</changefreq>
    <priority>${prioritas(item.out)}</priority>
  </url>`;
    })
    .join('\n');

  fs.writeFileSync(
    path.join(OUT_DIR, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${url}\n</urlset>\n`
  );
}

/** Manifest PWA sederhana agar situs dapat dipasang di layar utama ponsel. */
function tulisManifest() {
  const manifest = {
    name: SITE.longName,
    short_name: 'PR PMII Saintek',
    description: `Website resmi ${SITE.longName}. ${SITE.slogan}.`,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#122a8f',
    lang: 'id',
    icons: [
      { src: '/assets/img/logo-pmii.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
}

build();

/* Mode watch: rebuild otomatis saat halaman atau partial berubah. */
if (process.argv.includes('--watch')) {
  console.log('\nMemantau perubahan di src/pages dan src/partials … (Ctrl+C untuk berhenti)');
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build();
      } catch (error) {
        console.error(`✗ ${error.message}`);
      }
    }, 80);
  };
  [PAGES_DIR, PARTIALS_DIR].forEach((dir) =>
    fs.watch(dir, { recursive: true }, rebuild)
  );
}
