#!/usr/bin/env node
/**
 * Data contoh untuk pengembangan lokal.
 *
 * Jalankan: `npm run db:seed`
 *
 * Kredensial contoh (HANYA untuk pengembangan — ganti sebelum produksi):
 *   Admin  : admin@pmiiuinbandung.test  / RahasiaAdmin123
 *   Peserta: BIM-2026-0001              / bimtes2026
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { db, migrate } = require('../src/lib/db');

migrate();

const seed = db.transaction(() => {
  /* ------------------------------------------------------------- Pengguna */
  const adminHash = bcrypt.hashSync('RahasiaAdmin123', 10);
  db.prepare(
    `INSERT INTO users (nama, email, password_hash, role) VALUES (?, ?, ?, 'superadmin')
     ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash`
  ).run('Admin Komisariat', 'admin@pmiiuinbandung.test', adminHash);

  /* ------------------------------------------------------------- Kategori */
  const kategori = [
    ['Berita', 'berita'],
    ['Opini', 'opini'],
    ['Kajian', 'kajian'],
    ['Sastra', 'sastra'],
  ];
  for (const [nama, slug] of kategori) {
    db.prepare('INSERT INTO kategori (nama, slug) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING').run(
      nama,
      slug
    );
  }
  const idKategori = (slug) => db.prepare('SELECT id FROM kategori WHERE slug = ?').get(slug).id;

  /* -------------------------------------------------------------- Artikel */
  const artikel = [
    {
      slug: 'barangkali-kita-terlalu-banyak-membawa',
      judul: 'Barangkali, Kita Terlalu Banyak Membawa',
      kategori: 'berita',
      tanggal: '2026-07-26 09:00:00',
      ringkasan:
        'Catatan reflektif tentang beban ekspektasi yang dipikul kader muda: mana yang benar-benar perlu dibawa, dan mana yang sebaiknya diletakkan di tengah jalan.',
      unggulan: 1,
    },
    {
      slug: 'apakah-hijau-selalu-berarti-baik',
      judul: 'Apakah Hijau Selalu Berarti Baik?',
      kategori: 'opini',
      tanggal: '2026-07-19 09:00:00',
      ringkasan:
        'Membaca ulang narasi pembangunan berkelanjutan di Kabupaten Bandung — ketika label ramah lingkungan justru menutupi persoalan agraria di sekitarnya.',
      unggulan: 0,
    },
    {
      slug: 'formasi-counter-hegemony-gerakan-mahasiswa',
      judul: 'Formasi Counter-Hegemony Gerakan Mahasiswa di Era Digital',
      kategori: 'kajian',
      tanggal: '2026-07-12 09:00:00',
      ringkasan:
        'Dari Gramsci ke grup pesan singkat: bagaimana kader menyusun blok historis baru ketika ruang wacana dikuasai algoritma.',
      unggulan: 0,
    },
  ];

  for (const item of artikel) {
    db.prepare(
      `INSERT INTO artikel (slug, judul, ringkasan, konten, kategori_id, penulis_nama,
                            status, is_unggulan, published_at)
       VALUES (@slug, @judul, @ringkasan, @konten, @kategoriId, 'Kader PMII',
               'published', @unggulan, @tanggal)
       ON CONFLICT(slug) DO NOTHING`
    ).run({
      ...item,
      kategoriId: idKategori(item.kategori),
      konten: `<p>${item.ringkasan}</p><p>Naskah lengkap artikel ini diisi melalui panel admin CMS.</p>`,
    });
  }

  /* --------------------------------------------------------------- Dokumen */
  const dokumen = [
    ['Anggaran Dasar & Anggaran Rumah Tangga (AD/ART)', 'konstitusi', 1],
    ['Nilai Dasar Pergerakan (NDP)', 'ndp', 2],
    ['Peraturan Organisasi (PO)', 'peraturan', 3],
    ['Pedoman Kaderisasi (Multi Level Strategy)', 'kaderisasi', 4],
  ];
  for (const [judul, kat, urutan] of dokumen) {
    db.prepare(
      `INSERT INTO dokumen (judul, deskripsi, kategori, file_url, mime, tahun, urutan)
       SELECT ?, ?, ?, ?, 'application/pdf', 2025, ?
       WHERE NOT EXISTS (SELECT 1 FROM dokumen WHERE judul = ?)`
    ).run(
      judul,
      `Salinan digital ${judul} untuk keperluan internal kader.`,
      kat,
      `/uploads/dokumen/${kat}.pdf`,
      urutan,
      judul
    );
  }

  /* ---------------------------------------------------- Periode & pengurus */
  db.prepare(
    `INSERT INTO periode (label, mulai, selesai, is_aktif) VALUES ('2025-2026', '2025-09-01', '2026-08-31', 1)
     ON CONFLICT(label) DO NOTHING`
  ).run();
  const periodeId = db.prepare("SELECT id FROM periode WHERE label = '2025-2026'").get().id;

  const pengurus = [
    ['Nama Ketua Umum', 'Ketua Umum', null, 1],
    ['Nama Sekretaris Umum', 'Sekretaris Umum', null, 2],
    ['Nama Bendahara Umum', 'Bendahara Umum', null, 3],
    ['Nama Ketua I', 'Ketua Bidang', 'Kaderisasi', 4],
  ];
  for (const [nama, jabatan, bidang, urutan] of pengurus) {
    db.prepare(
      `INSERT INTO pengurus (periode_id, nama, jabatan, bidang, urutan)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM pengurus WHERE periode_id = ? AND jabatan = ? AND nama = ?)`
    ).run(periodeId, nama, jabatan, bidang, urutan, periodeId, jabatan, nama);
  }

  /* ---------------------------------------------------------------- Galeri */
  const album = [
    ['mapaba-raya-2025', 'MAPABA Raya 2025', 'MAPABA', '2025-10-12'],
    ['ngaji-filsafat-sore', 'Ngaji Filsafat Sore', 'Kajian', '2025-09-03'],
    ['bakti-sosial-cibiru', 'Bakti Sosial Cibiru', 'Pengabdian', '2025-08-21'],
  ];
  for (const [slug, judul, kat, tanggal] of album) {
    db.prepare(
      `INSERT INTO galeri_album (slug, judul, deskripsi, kategori, tanggal)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING`
    ).run(slug, judul, `Dokumentasi kegiatan ${judul}.`, kat, tanggal);
  }

  /* -------------------------------------------------------- MAPABA & CBT */
  db.prepare(
    `INSERT INTO mapaba_gelombang
       (nama, tahun, buka_at, tutup_at, mulai_acara, selesai_acara, lokasi, kuota, biaya, is_aktif)
     SELECT 'MAPABA Raya 2026', 2026, '2026-08-01 00:00:00', '2026-10-10 23:59:59',
            '2026-10-16 07:00:00', '2026-10-18 17:00:00',
            'Sekretariat PK PMII UIN SGD, Cibiru, Kab. Bandung', 150, 75000, 1
     WHERE NOT EXISTS (SELECT 1 FROM mapaba_gelombang WHERE nama = 'MAPABA Raya 2026')`
  ).run();

  const pesertaHash = bcrypt.hashSync('bimtes2026', 10);
  db.prepare(
    `INSERT INTO cbt_peserta (nomor_peserta, nama, email, password_hash, must_change_password)
     VALUES ('BIM-2026-0001', 'Peserta Demo', 'peserta@bimtes.test', ?, 0)
     ON CONFLICT(nomor_peserta) DO UPDATE SET password_hash = excluded.password_hash`
  ).run(pesertaHash);

  // Nomor BIM-2026-0001 di atas dibuat manual, jadi penghitung harus ikut maju.
  // Tanpa ini, akun peserta pertama yang dibuat panitia akan memakai nomor yang
  // sama dan ditolak constraint UNIQUE.
  db.prepare(
    `INSERT INTO counters (nama, tahun, nilai) VALUES ('cbt', 2026, 1)
     ON CONFLICT(nama, tahun) DO UPDATE SET nilai = MAX(counters.nilai, excluded.nilai)`
  ).run();

  db.prepare(
    `INSERT INTO cbt_paket (kode, nama, deskripsi, durasi_menit, jumlah_soal, max_percobaan)
     VALUES ('TPS-2026-01', 'Tryout UTBK — Tes Potensi Skolastik',
             'Latihan penalaran umum, pengetahuan kuantitatif, dan pemahaman bacaan.', 30, 3, 2)
     ON CONFLICT(kode) DO NOTHING`
  ).run();
  const paketId = db.prepare("SELECT id FROM cbt_paket WHERE kode = 'TPS-2026-01'").get().id;

  const soalContoh = [
    {
      subtes: 'Penalaran Umum',
      pertanyaan:
        'Semua kader PMII mengikuti MAPABA. Sebagian peserta MAPABA berasal dari Fakultas Syariah. Kesimpulan yang pasti benar adalah…',
      pembahasan:
        'Premis hanya menjamin bahwa kader mengikuti MAPABA, bukan sebaliknya, sehingga kesimpulan yang sah bersifat terbatas.',
      opsi: [
        ['A', 'Semua peserta MAPABA adalah kader PMII', 0],
        ['B', 'Sebagian peserta MAPABA berasal dari Fakultas Syariah', 1],
        ['C', 'Semua kader PMII berasal dari Fakultas Syariah', 0],
        ['D', 'Tidak ada kader PMII dari Fakultas Syariah', 0],
      ],
    },
    {
      subtes: 'Pengetahuan Kuantitatif',
      pertanyaan: 'Jika 3x + 7 = 25, maka nilai 2x − 4 adalah…',
      pembahasan: '3x = 18 sehingga x = 6, maka 2(6) − 4 = 8.',
      opsi: [
        ['A', '4', 0],
        ['B', '6', 0],
        ['C', '8', 1],
        ['D', '10', 0],
      ],
    },
    {
      subtes: 'Pemahaman Bacaan',
      pertanyaan:
        'Kalimat "Teguh pada prinsip, setia pada proses" paling tepat dimaknai sebagai ajakan untuk…',
      pembahasan:
        'Ungkapan tersebut menekankan konsistensi nilai sekaligus kesabaran menjalani tahapan.',
      opsi: [
        ['A', 'Mempertahankan nilai sambil menjalani tahapan dengan sabar', 1],
        ['B', 'Menolak segala bentuk perubahan', 0],
        ['C', 'Mengutamakan hasil di atas cara', 0],
        ['D', 'Menunda keputusan selama mungkin', 0],
      ],
    },
  ];

  soalContoh.forEach((item, index) => {
    const sudahAda = db
      .prepare('SELECT id FROM cbt_soal WHERE paket_id = ? AND urutan = ?')
      .get(paketId, index + 1);
    if (sudahAda) return;

    const info = db
      .prepare(
        `INSERT INTO cbt_soal (paket_id, subtes, pertanyaan, pembahasan, urutan)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(paketId, item.subtes, item.pertanyaan, item.pembahasan, index + 1);

    for (const [label, teks, benar] of item.opsi) {
      db.prepare('INSERT INTO cbt_opsi (soal_id, label, teks, is_benar) VALUES (?, ?, ?, ?)').run(
        info.lastInsertRowid,
        label,
        teks,
        benar
      );
    }
  });
});

seed();

console.log('Data contoh berhasil dimasukkan.');
console.log('  Admin   : admin@pmiiuinbandung.test / RahasiaAdmin123');
console.log('  Peserta : BIM-2026-0001 / bimtes2026');
