#!/usr/bin/env node
/**
 * Uji asap (smoke test) untuk seluruh alur API.
 *
 * Prasyarat: `npm run db:migrate && npm run db:seed`, lalu jalankan berkas ini
 * dengan `node server/test/smoke.js`. Server dinyalakan sendiri oleh skrip pada
 * port terpisah agar tidak bertabrakan dengan server pengembangan.
 */
process.env.DATABASE_PATH = process.env.DATABASE_PATH || './server/db/pmii.sqlite';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'kunci-uji-asap-yang-cukup-panjang-123456';
process.env.CORS_ORIGINS = 'http://localhost:4321';

const assert = require('node:assert/strict');
const { app, PREFIX } = require('../src/app');
const { migrate } = require('../src/lib/db');

migrate();

const PORT = 4555;
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;
let lolos = 0;

async function call(method, path, { body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function uji(nama, fn) {
  try {
    await fn();
    lolos += 1;
    console.log(`  ✓ ${nama}`);
  } catch (error) {
    console.error(`  ✗ ${nama}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('Uji asap API PR PMII Saintek\n');

  await uji('health mengembalikan status sehat', async () => {
    const { payload } = await call('GET', '/health');
    assert.equal(payload.data.status, 'sehat');
  });

  /* ------------------------------------------------------------- Advokasi */

  await uji('pengaduan tanpa persetujuan ditolak dengan galat per-kolom', async () => {
    const { status, payload } = await call('POST', '/advokasi/pengaduan', {
      body: { nama: 'Ab', kontak: '08', status: 'mahasiswa', kategori: 'ukt', kronologi: 'pendek' },
    });
    assert.equal(status, 400);
    assert.ok(payload.errors.kontak, 'seharusnya ada galat pada kolom kontak');
    assert.ok(payload.errors.kronologi, 'seharusnya ada galat pada kolom kronologi');
    assert.ok(payload.errors.persetujuan, 'seharusnya ada galat pada kolom persetujuan');
  });

  await uji('pengaduan boleh dikirim tanpa nama (anonim)', async () => {
    const { status, payload } = await call('POST', '/advokasi/pengaduan', {
      body: {
        kontak: '081200000000',
        status: 'mahasiswa',
        kategori: 'fasilitas',
        kronologi:
          'Lift gedung perkuliahan sudah tiga bulan rusak dan belum ada perbaikan, padahal ada mahasiswa pengguna kursi roda di lantai empat.',
        persetujuan: true,
      },
    });
    assert.equal(status, 201);
    assert.match(payload.data.nomorTiket, /^ADV-\d{4}-\d{4}$/);
  });

  let nomorTiket;
  await uji('pengaduan valid menerbitkan nomor tiket', async () => {
    const { status, payload } = await call('POST', '/advokasi/pengaduan', {
      body: {
        nama: 'Ahmad Fauzi',
        kontak: '081234567890',
        email: 'ahmad@example.com',
        status: 'mahasiswa',
        kategori: 'ukt',
        kronologi:
          'Saya menerima tagihan UKT golongan 5 padahal penghasilan orang tua tidak berubah sejak tahun lalu, dan pengajuan banding tidak mendapat jawaban.',
        persetujuan: true,
      },
    });
    assert.equal(status, 201);
    assert.match(payload.data.nomorTiket, /^ADV-\d{4}-\d{4}$/);
    nomorTiket = payload.data.nomorTiket;
  });

  await uji('pelacakan tiket tidak membocorkan identitas pelapor', async () => {
    const { payload } = await call('GET', `/advokasi/pengaduan/${nomorTiket}`);
    assert.equal(payload.data.status, 'baru');
    assert.equal(payload.data.nama, undefined);
    assert.equal(payload.data.kronologi, undefined);
    assert.ok(payload.data.riwayat.length >= 1);
  });

  /* --------------------------------------------------------------- MAPABA */

  const nimAcak = String(Date.now()).slice(-10);
  let nomorRegistrasi;
  await uji('pendaftaran MAPABA valid menerbitkan nomor registrasi', async () => {
    const { status, payload } = await call('POST', '/mapaba/pendaftaran', {
      body: {
        namaLengkap: 'Siti Aisyah',
        nim: nimAcak,
        angkatan: 2026,
        fakultas: 'Sains dan Teknologi',
        prodi: 'Teknik Informatika',
        jenisKelamin: 'P',
        whatsapp: '081234567891',
        email: 'siti@example.com',
        motivasi: 'Ingin belajar berorganisasi, memperluas jaringan, dan memperdalam tradisi keilmuan.',
        kesediaan: true,
        persetujuanData: true,
      },
    });
    assert.equal(status, 201);
    assert.match(payload.data.nomorRegistrasi, /^MPB-\d{4}-\d{4}$/);
    nomorRegistrasi = payload.data.nomorRegistrasi;
  });

  await uji('NIM ganda pada gelombang yang sama ditolak (409)', async () => {
    const { status, payload } = await call('POST', '/mapaba/pendaftaran', {
      body: {
        namaLengkap: 'Siti Aisyah',
        nim: nimAcak,
        angkatan: 2026,
        fakultas: 'Sains dan Teknologi',
        prodi: 'Teknik Informatika',
        jenisKelamin: 'P',
        whatsapp: '081234567891',
        email: 'siti@example.com',
        motivasi: 'Ingin belajar berorganisasi, memperluas jaringan, dan memperdalam tradisi keilmuan.',
        kesediaan: true,
        persetujuanData: true,
      },
    });
    assert.equal(status, 409);
    assert.ok(payload.errors?.nim);
  });

  await uji('status pendaftaran dapat dicek publik', async () => {
    const { payload } = await call('GET', `/mapaba/pendaftaran/${nomorRegistrasi}`);
    assert.equal(payload.data.status, 'menunggu');
  });

  /* ---------------------------------------------------------------- Admin */

  let adminToken;
  await uji('login admin berhasil', async () => {
    const { status, payload } = await call('POST', '/admin/auth/login', {
      body: { email: 'admin@pmiiuinbandung.test', password: 'RahasiaAdmin123' },
    });
    assert.equal(status, 200);
    adminToken = payload.data.accessToken;
  });

  await uji('token palsu ditolak endpoint admin (401)', async () => {
    // Token bertanda tangan kunci lain: bentuknya sah, tanda tangannya tidak.
    const palsu = require('jsonwebtoken').sign({ sub: 1, role: 'superadmin' }, 'kunci-yang-salah', {
      audience: 'admin',
      issuer: 'pmii-uinsgd',
      expiresIn: '1h',
    });
    const { status } = await call('GET', '/advokasi/admin/pengaduan', { token: palsu });
    assert.equal(status, 401);
  });

  await uji('endpoint admin menolak permintaan tanpa token (401)', async () => {
    const { status } = await call('GET', '/mapaba/admin/pendaftar');
    assert.equal(status, 401);
  });

  await uji('admin dapat melihat daftar pengaduan', async () => {
    const { status, payload } = await call('GET', '/advokasi/admin/pengaduan?status=baru', {
      token: adminToken,
    });
    assert.equal(status, 200);
    assert.ok(payload.data.length >= 1);
    assert.ok(payload.meta.total >= 1);
  });

  await uji('admin dapat mengubah status pengaduan dan tercatat di log', async () => {
    const daftar = await call('GET', '/advokasi/admin/pengaduan?limit=100', { token: adminToken });
    const target = daftar.payload.data.find((item) => item.nomorTiket === nomorTiket);
    assert.ok(target, 'pengaduan yang baru dibuat harus muncul di daftar admin');

    const { status } = await call('PATCH', `/advokasi/admin/pengaduan/${target.id}`, {
      token: adminToken,
      body: { status: 'verifikasi', catatanInternal: 'Menghubungi pelapor.' },
    });
    assert.equal(status, 200);

    const lacak = await call('GET', `/advokasi/pengaduan/${nomorTiket}`);
    assert.ok(lacak.payload.data.riwayat.some((item) => item.status === 'verifikasi'));
  });

  await uji('ringkasan dashboard admin mengembalikan angka', async () => {
    const { payload } = await call('GET', '/admin/ringkasan', { token: adminToken });
    assert.ok(payload.data.pengaduan.total >= 1);
  });

  await uji('admin dapat memverifikasi pendaftar MAPABA (Terima)', async () => {
    const daftar = await call('GET', '/mapaba/admin/pendaftar?status=menunggu', {
      token: adminToken,
    });
    const target = daftar.payload.data[0];
    const { status } = await call('PATCH', `/mapaba/admin/pendaftar/${target.id}`, {
      token: adminToken,
      body: { status: 'terverifikasi', catatanPanitia: 'Berkas lengkap.' },
    });
    assert.equal(status, 200);

    const cek = await call('GET', `/mapaba/pendaftaran/${target.nomorRegistrasi}`);
    assert.equal(cek.payload.data.status, 'terverifikasi');
  });

  /* -------------------------------------------------- Registrasi & bcrypt */

  await uji('akun pengurus terkunci setelah lima kali gagal login', async () => {
    // Dipakai akun sekali pakai supaya penguncian tidak mengganggu uji lain.
    const email = `uji-kunci-${Date.now()}@pmii.test`;
    const buat = await call('POST', '/admin/users', {
      token: adminToken,
      body: { nama: 'Akun Uji Kunci', email, password: 'SandiUjiKuat9', role: 'editor' },
    });
    assert.equal(buat.status, 201);

    for (let i = 0; i < 5; i += 1) {
      const { status } = await call('POST', '/admin/auth/login', {
        body: { email, password: 'SandiSalah123' },
      });
      assert.equal(status, 401, `percobaan ke-${i + 1} seharusnya 401`);
    }

    // Setelah terkunci, sandi yang BENAR pun harus ditolak dengan 403.
    const { status, payload } = await call('POST', '/admin/auth/login', {
      body: { email, password: 'SandiUjiKuat9' },
    });
    assert.equal(status, 403);
    assert.match(payload.message, /terkunci/i);
  });

  await uji('pembuatan akun pengurus menolak sandi lemah', async () => {
    const { status, payload } = await call('POST', '/admin/users', {
      token: adminToken,
      body: { nama: 'Editor Baru', email: `editor${Date.now()}@pmii.test`, password: 'pendek', role: 'editor' },
    });
    assert.equal(status, 400);
    assert.ok(payload.errors.password);
  });

  /* ------------------------------------------------------------- Unggahan */

  // PNG 1x1 piksel yang sah — dipakai untuk menguji pemeriksaan magic bytes.
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  async function unggah(nama, buffer, tipe) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: tipe }), nama);
    const response = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  }

  let urlPasFoto;
  await uji('unggah pas foto PNG berhasil dan mengembalikan URL', async () => {
    const { status, payload } = await unggah('pasfoto.png', PNG_1PX, 'image/png');
    assert.equal(status, 200);
    assert.match(payload.data.url, /^https?:\/\//);
    urlPasFoto = payload.data.url;
  });

  await uji('unggah berkas yang menyamar sebagai gambar ditolak (400)', async () => {
    const jahat = Buffer.from('<?php system($_GET["c"]); ?>');
    const { status, payload } = await unggah('shell.png', jahat, 'image/png');
    assert.equal(status, 400);
    assert.ok(payload.errors?.file || payload.message);
  });

  await uji('unggah tipe berkas terlarang ditolak (400)', async () => {
    const { status } = await unggah('skrip.svg', Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml');
    assert.equal(status, 400);
  });

  await uji('berkas melebihi 3 MB ditolak dengan pesan batas yang benar', async () => {
    // PNG sah namun sengaja digelembungkan melewati batas ukuran.
    const besar = Buffer.concat([PNG_1PX, Buffer.alloc(3.2 * 1024 * 1024)]);
    const { status, payload } = await unggah('besar.png', besar, 'image/png');
    assert.equal(status, 400);
    assert.match(payload.errors?.file || payload.message, /3 MB/);
  });

  await uji('pendaftaran MAPABA menyimpan URL pas foto dan KTM', async () => {
    const nim = String(Date.now() + 7).slice(-10);
    const { status } = await call('POST', '/mapaba/pendaftaran', {
      body: {
        namaLengkap: 'Rizky Pratama',
        nim,
        angkatan: 2026,
        universitas: 'UIN Sunan Gunung Djati Bandung',
        fakultas: 'Ushuluddin',
        prodi: 'Aqidah dan Filsafat Islam',
        jenisKelamin: 'L',
        whatsapp: '081234567892',
        email: 'rizky@example.com',
        motivasi: 'Ingin memperdalam tradisi keilmuan dan belajar berorganisasi secara serius.',
        pasFotoUrl: urlPasFoto,
        ktmUrl: urlPasFoto,
        kesediaan: true,
        persetujuanData: true,
      },
    });
    assert.equal(status, 201);

    const { db } = require('../src/lib/db');
    const row = db.prepare('SELECT pas_foto_url, ktm_url FROM mapaba_pendaftar WHERE nim = ?').get(nim);
    assert.equal(row.pas_foto_url, urlPasFoto);
    assert.ok(row.ktm_url);
  });

  console.log(`\n${lolos} pemeriksaan lolos.`);
}

const server = app.listen(PORT, async () => {
  try {
    await main();
  } finally {
    server.close();
  }
});
