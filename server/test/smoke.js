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

/** Fixture ujian; disimpan di luar main() agar tetap dibersihkan bila uji gagal. */
let fixtureUjian = null;

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

/**
 * Siapkan peserta dan paket ujian khusus pengujian.
 *
 * Ditulis langsung ke basis data (bukan lewat API) karena endpoint pembuatan
 * bank soal memang belum ada, dan karena persiapan ini bagian dari *fixture*
 * pengujian — bukan perilaku yang sedang diuji.
 *
 * Biaya bcrypt sengaja rendah (4) agar uji berjalan cepat; produksi memakai 12.
 */
function siapkanUjianUji() {
  const { db } = require('../src/lib/db');
  const bcrypt = require('bcryptjs');

  const tanda = String(Date.now()).slice(-8);
  const password = 'ujiasap123';
  const nomorPeserta = `UJI-${tanda}`;

  const peserta = db
    .prepare(
      `INSERT INTO cbt_peserta (nomor_peserta, nama, password_hash, must_change_password)
       VALUES (?, 'Peserta Uji Asap', ?, 0)`
    )
    .run(nomorPeserta, bcrypt.hashSync(password, 4));

  const paket = db
    .prepare(
      `INSERT INTO cbt_paket (kode, nama, durasi_menit, jumlah_soal, max_percobaan)
       VALUES (?, ?, 30, 3, 5)`
    )
    .run(`UJI-${tanda}`, `Paket Uji Asap ${tanda}`);

  for (let i = 1; i <= 3; i += 1) {
    const soal = db
      .prepare(
        `INSERT INTO cbt_soal (paket_id, subtes, pertanyaan, pembahasan, urutan)
         VALUES (?, 'Uji', ?, 'Pembahasan uji.', ?)`
      )
      .run(paket.lastInsertRowid, `Soal uji nomor ${i}?`, i);

    // Opsi A selalu benar agar skor yang diharapkan mudah dihitung.
    ['A', 'B', 'C', 'D'].forEach((label, indeks) => {
      db.prepare('INSERT INTO cbt_opsi (soal_id, label, teks, is_benar) VALUES (?, ?, ?, ?)').run(
        soal.lastInsertRowid,
        label,
        `Opsi ${label} untuk soal ${i}`,
        indeks === 0 ? 1 : 0
      );
    });
  }

  return {
    nomorPeserta,
    password,
    pesertaId: peserta.lastInsertRowid,
    paketId: paket.lastInsertRowid,
  };
}

/** Bersihkan fixture agar basis data pengembangan tidak menumpuk data uji. */
function bersihkanUjianUji(fixture) {
  if (!fixture) return;
  const { db } = require('../src/lib/db');
  // ON DELETE CASCADE ikut menghapus soal, opsi, sesi, dan jawabannya.
  db.prepare('DELETE FROM cbt_paket WHERE id = ?').run(fixture.paketId);
  db.prepare('DELETE FROM cbt_peserta WHERE id = ?').run(fixture.pesertaId);
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
  console.log('Uji asap API PK PMII UIN SGD\n');

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

  /* ------------------------------------------------------------------ CBT */

  await uji('login CBT dengan sandi salah ditolak (401)', async () => {
    const { status } = await call('POST', '/cbt/auth/login', {
      body: { identitas: 'BIM-2026-0001', password: 'sandi-salah' },
    });
    assert.equal(status, 401);
  });

  await uji('login CBT yang benar mengembalikan access token', async () => {
    const { status, payload } = await call('POST', '/cbt/auth/login', {
      body: { identitas: 'BIM-2026-0001', password: 'bimtes2026' },
    });
    assert.equal(status, 200);
    assert.ok(payload.data.accessToken);
    assert.equal(payload.data.peserta.nomorPeserta, 'BIM-2026-0001');
  });

  await uji('endpoint ujian menolak permintaan tanpa token (401)', async () => {
    const { status } = await call('GET', '/cbt/ujian');
    assert.equal(status, 401);
  });

  // Alur ujian dijalankan memakai peserta dan paket khusus uji (lihat
  // siapkanUjianUji), bukan data contoh. Tanpa itu, jumlah percobaan pada akun
  // demo akan habis setelah beberapa kali menjalankan uji atau setelah dipakai
  // pengujian manual di peramban, dan hasil `npm test` menjadi tidak konsisten.
  const uji_ = siapkanUjianUji();
  fixtureUjian = uji_;

  let token;
  await uji('peserta uji dapat login untuk menjalankan alur ujian', async () => {
    const { status, payload } = await call('POST', '/cbt/auth/login', {
      body: { identitas: uji_.nomorPeserta, password: uji_.password },
    });
    assert.equal(status, 200);
    token = payload.data.accessToken;
  });

  await uji('daftar ujian memuat paket tryout aktif', async () => {
    const { payload } = await call('GET', '/cbt/ujian', { token });
    assert.ok(payload.data.length >= 1);
    const paket = payload.data.find((item) => item.id === uji_.paketId);
    assert.ok(paket, 'paket uji harus muncul di daftar');
    assert.equal(paket.status, 'tersedia');
    assert.equal(paket.jumlahSoal, 3);
  });

  let sesiId;
  await uji('sesi ujian dapat dimulai dan menyimpan batas waktu di server', async () => {
    const { status, payload } = await call('POST', `/cbt/ujian/${uji_.paketId}/mulai`, { token });
    assert.equal(status, 201);
    assert.ok(payload.data.sesiId);
    assert.ok(payload.data.deadlineAt);
    sesiId = payload.data.sesiId;
  });

  await uji('memulai ulang mengembalikan sesi yang sama, bukan sesi baru', async () => {
    const { payload } = await call('POST', `/cbt/ujian/${uji_.paketId}/mulai`, { token });
    assert.equal(payload.data.sesiId, sesiId);
    assert.equal(payload.data.dilanjutkan, true);
  });

  let soal;
  await uji('soal dikirim tanpa membocorkan kunci jawaban', async () => {
    const { payload } = await call('GET', `/cbt/sesi/${sesiId}`, { token });
    soal = payload.data.soal;
    assert.ok(soal.length >= 1);
    const adaKunci = soal.some((item) => item.opsi.some((opsi) => 'isBenar' in opsi));
    assert.equal(adaKunci, false, 'kunci jawaban tidak boleh terkirim saat sesi berjalan');
    assert.ok(payload.data.sesi.sisaDetik > 0);
  });

  await uji('autosave jawaban bersifat idempoten', async () => {
    const target = soal[0];
    const kirim = () =>
      call('PUT', `/cbt/sesi/${sesiId}/jawaban`, {
        token,
        body: { soalId: target.id, opsiId: target.opsi[0].id, ragu: false },
      });
    assert.equal((await kirim()).status, 200);
    assert.equal((await kirim()).status, 200);
  });

  await uji('opsi milik soal lain ditolak (400)', async () => {
    const { status } = await call('PUT', `/cbt/sesi/${sesiId}/jawaban`, {
      token,
      body: { soalId: soal[0].id, opsiId: soal[1].opsi[0].id },
    });
    assert.equal(status, 400);
  });

  await uji('submit menghasilkan skor dan rekap jawaban', async () => {
    const { status, payload } = await call('POST', `/cbt/sesi/${sesiId}/submit`, { token });
    assert.equal(status, 200);
    assert.equal(payload.data.status, 'selesai');
    assert.equal(typeof payload.data.skor, 'number');
    assert.equal(payload.data.benar + payload.data.salah + payload.data.kosong, payload.data.totalSoal);
    assert.equal(payload.data.totalSoal, 3);

    // Satu soal dijawab (opsi pertama yang tampil, belum tentu kunci) dan dua
    // dibiarkan kosong, jadi skor tidak mungkin sempurna maupun negatif.
    assert.ok(payload.data.kosong >= 2, 'dua soal seharusnya kosong');
    assert.ok(payload.data.skor >= 0 && payload.data.skor <= 1000);
  });

  await uji('submit kedua kali ditolak (403)', async () => {
    const { status } = await call('POST', `/cbt/sesi/${sesiId}/submit`, { token });
    assert.equal(status, 403);
  });

  await uji('pembahasan terbuka setelah sesi selesai', async () => {
    const { payload } = await call('GET', `/cbt/sesi/${sesiId}`, { token });
    const adaKunci = payload.data.soal.some((item) => item.opsi.some((opsi) => 'isBenar' in opsi));
    assert.equal(adaKunci, true, 'kunci jawaban seharusnya dibuka setelah sesi selesai');
  });

  await uji('riwayat hasil memuat skor dan peringkat', async () => {
    const { payload } = await call('GET', '/cbt/hasil', { token });
    assert.ok(payload.data.length >= 1);
    assert.ok(payload.data[0].peringkat >= 1);
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

  await uji('token peserta tidak dapat dipakai di endpoint admin (401)', async () => {
    const { status } = await call('GET', '/advokasi/admin/pengaduan', { token });
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
    assert.ok(payload.data.cbt.paket >= 1);
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

  let pesertaBaru;
  await uji('panitia dapat menerbitkan akun peserta CBT dengan sandi acak', async () => {
    const { status, payload } = await call('POST', '/cbt/admin/peserta', {
      token: adminToken,
      body: { nama: 'Peserta Uji', email: `uji${Date.now()}@bimtes.test` },
    });
    assert.equal(status, 201);
    assert.match(payload.data.nomorPeserta, /^BIM-\d{4}-\d{4}$/);
    assert.ok(payload.data.passwordAwal.length >= 8, 'sandi awal harus dikembalikan sekali');
    pesertaBaru = payload.data;
  });

  await uji('peserta baru dapat login dengan sandi awal hasil hash bcrypt', async () => {
    const { status, payload } = await call('POST', '/cbt/auth/login', {
      body: { identitas: pesertaBaru.nomorPeserta, password: pesertaBaru.passwordAwal },
    });
    assert.equal(status, 200);
    assert.equal(payload.data.harusUbahSandi, true);
  });

  await uji('sandi tersimpan sebagai hash bcrypt, bukan teks polos', async () => {
    const { db } = require('../src/lib/db');
    const row = db
      .prepare('SELECT password_hash FROM cbt_peserta WHERE nomor_peserta = ?')
      .get(pesertaBaru.nomorPeserta);
    assert.match(row.password_hash, /^\$2[aby]\$\d{2}\$/, 'hash harus berformat bcrypt');
    assert.notEqual(row.password_hash, pesertaBaru.passwordAwal);
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
    bersihkanUjianUji(fixtureUjian);
    server.close();
  }
});
