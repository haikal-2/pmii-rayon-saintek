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
    assert.ok(payload.errors.nama, 'seharusnya ada galat pada kolom nama');
    assert.ok(payload.errors.kronologi, 'seharusnya ada galat pada kolom kronologi');
    assert.ok(payload.errors.persetujuan, 'seharusnya ada galat pada kolom persetujuan');
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

  let token;
  await uji('login CBT yang benar mengembalikan access token', async () => {
    const { status, payload } = await call('POST', '/cbt/auth/login', {
      body: { identitas: 'BIM-2026-0001', password: 'bimtes2026' },
    });
    assert.equal(status, 200);
    assert.ok(payload.data.accessToken);
    assert.equal(payload.data.peserta.nomorPeserta, 'BIM-2026-0001');
    token = payload.data.accessToken;
  });

  await uji('endpoint ujian menolak permintaan tanpa token (401)', async () => {
    const { status } = await call('GET', '/cbt/ujian');
    assert.equal(status, 401);
  });

  let paketId;
  await uji('daftar ujian memuat paket tryout aktif', async () => {
    const { payload } = await call('GET', '/cbt/ujian', { token });
    assert.ok(payload.data.length >= 1);
    paketId = payload.data[0].id;
  });

  let sesiId;
  await uji('sesi ujian dapat dimulai dan menyimpan batas waktu di server', async () => {
    const { status, payload } = await call('POST', `/cbt/ujian/${paketId}/mulai`, { token });
    assert.ok([200, 201].includes(status));
    assert.ok(payload.data.sesiId);
    assert.ok(payload.data.deadlineAt || payload.data.dilanjutkan);
    sesiId = payload.data.sesiId;
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
    const daftar = await call('GET', '/advokasi/admin/pengaduan', { token: adminToken });
    const id = daftar.payload.data[0].id;
    const { status } = await call('PATCH', `/advokasi/admin/pengaduan/${id}`, {
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

  console.log(`\n${lolos} pemeriksaan lolos.`);
}

const server = app.listen(PORT, async () => {
  try {
    await main();
  } finally {
    server.close();
  }
});
