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
  name: 'PK PMII UIN SGD Cab. Kab. Bandung',
  longName: 'PK PMII UIN Sunan Gunung Djati Cabang Kabupaten Bandung',
  slogan: 'Dzikir, Fikir, Amal Sholeh',
  email: 'pmiiuinbandun9@gmail.com',
  instagram: '@pmii_uinbandung',
  instagramUrl: 'https://instagram.com/pmii_uinbandung',
  address:
    'Jl. Manisi No. 21B Gang Kramat III RT 01 RW 09, Cibiru, Bandung, Jawa Barat',
  year: new Date().getFullYear(),
};

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
 * Tandai menu yang sedang aktif. Kelas `nav-link-active` disuntikkan ke elemen
 * yang memiliki atribut data-nav sesuai nilai `active` halaman.
 */
function markActiveNav(html, active) {
  if (!active) return html;
  return html.replace(
    new RegExp(`(<a[^>]*data-nav="${active}"[^>]*class=")`, 'g'),
    '$1nav-link-active '
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
      canonical: out === 'index.html' ? '/' : `/${out}`,
      bodyClass: config.bodyClass || '',
      year: SITE.year,
    };

    let html = expandPartials(body);
    html = interpolate(html, vars);
    html = markActiveNav(html, config.active);

    const target = path.join(OUT_DIR, out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html.trimStart());
    results.push({ out, bytes: Buffer.byteLength(html) });
  }

  const pad = Math.max(...results.map((r) => r.out.length));
  console.log(`Build HTML → public/  (${results.length} halaman)`);
  for (const r of results) {
    console.log(`  ✓ ${r.out.padEnd(pad)}  ${(r.bytes / 1024).toFixed(1)} KB`);
  }
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
