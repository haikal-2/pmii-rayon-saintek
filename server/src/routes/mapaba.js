/**
 * MAPABA Raya — pendaftaran anggota baru.
 *
 * Publik:
 *   GET  /api/v1/mapaba/gelombang-aktif           info gelombang & sisa kuota
 *   POST /api/v1/mapaba/pendaftaran               kirim formulir registrasi
 *   GET  /api/v1/mapaba/pendaftaran/:nomor        cek status pendaftaran
 *
 * Internal (role: panitia_mapaba / superadmin):
 *   GET   /api/v1/mapaba/admin/pendaftar          daftar peserta + filter
 *   PATCH /api/v1/mapaba/admin/pendaftar/:id      verifikasi / tolak / tandai hadir
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const { db, nextNumber } = require('../lib/db');
const { notifikasiPendaftarMapaba, notifikasiStatusMapaba } = require('../lib/notify');
const { verifyCaptcha } = require('../middleware/captcha');
const { requireAdmin } = require('../middleware/auth');
const {
  ok,
  created,
  notFound,
  conflict,
  badRequest,
  asyncHandler,
  parseOrThrow,
} = require('../lib/http');

const router = express.Router();

const pendaftaranSchema = z.object({
  namaLengkap: z.string().trim().min(3, 'Nama lengkap minimal 3 karakter.').max(100),
  nim: z
    .string()
    .trim()
    .regex(/^[0-9]{8,15}$/, 'NIM harus berupa 8–15 angka.'),
  angkatan: z.coerce
    .number()
    .int()
    .min(2015, 'Tahun angkatan tidak valid.')
    .max(new Date().getFullYear()),
  universitas: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((value) => value || 'UIN Sunan Gunung Djati Bandung'),
  fakultas: z.string().trim().min(3, 'Fakultas wajib dipilih.').max(80),
  prodi: z.string().trim().min(2, 'Program studi wajib diisi.').max(80),
  jenisKelamin: z.enum(['L', 'P'], {
    errorMap: () => ({ message: 'Pilih jenis kelamin.' }),
  }),
  whatsapp: z
    .string()
    .trim()
    .min(8, 'Nomor WhatsApp minimal 8 digit.')
    .max(20)
    .regex(/^[0-9+\-\s()]+$/, 'Nomor WhatsApp hanya boleh berisi angka dan tanda + - ( ).'),
  email: z.string().trim().email('Format email tidak valid.').max(120),
  asalDaerah: z.string().trim().max(100).optional(),
  motivasi: z.string().trim().min(30, 'Motivasi minimal 30 karakter.').max(1000),
  riwayatOrganisasi: z.string().trim().max(200).optional(),
  sumberInformasi: z
    .enum(['instagram', 'teman', 'website', 'poster', 'lainnya'])
    .optional()
    .or(z.literal('')),
  // URL hasil unggah dari POST /upload. Berkas tidak dikirim sebagai base64 di
  // sini agar payload JSON tetap kecil dan penyimpanan bisa dipindah ke S3.
  pasFotoUrl: z
    .union([z.string().trim().url('Tautan pas foto tidak valid.'), z.literal('')])
    .optional(),
  ktmUrl: z.union([z.string().trim().url('Tautan KTM tidak valid.'), z.literal('')]).optional(),
  kesediaan: z.literal(true, {
    errorMap: () => ({ message: 'Kesediaan mengikuti seluruh rangkaian wajib dicentang.' }),
  }),
  persetujuanData: z.literal(true, {
    errorMap: () => ({ message: 'Persetujuan pengolahan data wajib dicentang.' }),
  }),
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi nanti.',
  },
});

/** Ambil gelombang aktif beserta jumlah pendaftar terverifikasi. */
function gelombangAktif() {
  return db
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM mapaba_pendaftar p
                WHERE p.gelombang_id = g.id AND p.status <> 'batal') AS terpakai
       FROM mapaba_gelombang g
       WHERE g.is_aktif = 1
       ORDER BY g.tahun DESC, g.id DESC
       LIMIT 1`
    )
    .get();
}

/* ----------------------------------------------------------------- Publik */

router.get(
  '/gelombang-aktif',
  asyncHandler((_req, res) => {
    const g = gelombangAktif();
    if (!g) throw notFound('Belum ada gelombang pendaftaran yang dibuka.');

    const now = new Date();
    return ok(res, {
      id: g.id,
      nama: g.nama,
      tahun: g.tahun,
      bukaAt: g.buka_at,
      tutupAt: g.tutup_at,
      mulaiAcara: g.mulai_acara,
      selesaiAcara: g.selesai_acara,
      lokasi: g.lokasi,
      kuota: g.kuota,
      terpakai: g.terpakai,
      sisaKuota: Math.max(0, g.kuota - g.terpakai),
      biaya: g.biaya,
      sedangDibuka: now >= new Date(g.buka_at) && now <= new Date(g.tutup_at),
    });
  })
);

router.post(
  '/pendaftaran',
  limiter,
  verifyCaptcha,
  asyncHandler((req, res) => {
    const data = parseOrThrow(pendaftaranSchema, req.body);

    const g = gelombangAktif();
    if (!g) throw badRequest('Pendaftaran MAPABA belum dibuka.');

    const now = new Date();
    if (now < new Date(g.buka_at)) throw badRequest('Pendaftaran belum dibuka.');
    if (now > new Date(g.tutup_at)) throw badRequest('Pendaftaran sudah ditutup.');
    if (g.terpakai >= g.kuota) throw conflict('Kuota peserta sudah terpenuhi.');

    const duplikat = db
      .prepare('SELECT nomor_registrasi FROM mapaba_pendaftar WHERE gelombang_id = ? AND nim = ?')
      .get(g.id, data.nim);
    if (duplikat) {
      throw conflict('NIM ini sudah terdaftar pada gelombang ini.', {
        nim: `Sudah terdaftar dengan nomor registrasi ${duplikat.nomor_registrasi}.`,
      });
    }

    const nomorRegistrasi = nextNumber('mapaba', 'MPB');

    const info = db
      .prepare(
        `INSERT INTO mapaba_pendaftar
           (nomor_registrasi, gelombang_id, nama_lengkap, nim, angkatan, universitas, fakultas, prodi,
            jenis_kelamin, whatsapp, email, asal_daerah, motivasi, riwayat_organisasi, sumber_informasi,
            pas_foto_url, ktm_url)
         VALUES (@nomorRegistrasi, @gelombangId, @namaLengkap, @nim, @angkatan, @universitas, @fakultas, @prodi,
                 @jenisKelamin, @whatsapp, @email, @asalDaerah, @motivasi, @riwayatOrganisasi, @sumberInformasi,
                 @pasFotoUrl, @ktmUrl)`
      )
      .run({
        nomorRegistrasi,
        gelombangId: g.id,
        namaLengkap: data.namaLengkap,
        nim: data.nim,
        angkatan: data.angkatan,
        universitas: data.universitas,
        fakultas: data.fakultas,
        prodi: data.prodi,
        jenisKelamin: data.jenisKelamin,
        whatsapp: data.whatsapp,
        email: data.email,
        asalDaerah: data.asalDaerah || null,
        motivasi: data.motivasi,
        riwayatOrganisasi: data.riwayatOrganisasi || null,
        sumberInformasi: data.sumberInformasi || null,
        pasFotoUrl: data.pasFotoUrl || null,
        ktmUrl: data.ktmUrl || null,
      });

    notifikasiPendaftarMapaba({ id: info.lastInsertRowid, nomorRegistrasi, ...data });

    return created(res, {
      nomorRegistrasi,
      status: 'menunggu',
      biaya: g.biaya,
      pesan:
        'Pendaftaran diterima. Panitia akan menghubungi kamu melalui WhatsApp untuk verifikasi ' +
        'dan petunjuk teknis kegiatan.',
    });
  })
);

router.get(
  '/pendaftaran/:nomor',
  asyncHandler((req, res) => {
    const row = db
      .prepare(
        `SELECT nomor_registrasi AS nomorRegistrasi, nama_lengkap AS namaLengkap,
                fakultas, prodi, status, created_at AS dibuatPada
         FROM mapaba_pendaftar WHERE nomor_registrasi = ?`
      )
      .get(req.params.nomor);

    if (!row) throw notFound('Nomor registrasi tidak ditemukan.');
    return ok(res, row);
  })
);

/* ---------------------------------------------------------------- Internal */

router.get(
  '/admin/pendaftar',
  requireAdmin('panitia_mapaba'),
  asyncHandler((req, res) => {
    const query = parseOrThrow(
      z.object({
        gelombangId: z.coerce.number().int().positive().optional(),
        status: z.enum(['menunggu', 'terverifikasi', 'hadir', 'ditolak', 'batal']).optional(),
        q: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query
    );

    const where = [];
    const params = {};
    if (query.gelombangId) {
      where.push('gelombang_id = @gelombangId');
      params.gelombangId = query.gelombangId;
    }
    if (query.status) {
      where.push('status = @status');
      params.status = query.status;
    }
    if (query.q) {
      where.push('(nama_lengkap LIKE @q OR nim LIKE @q OR nomor_registrasi LIKE @q)');
      params.q = `%${query.q}%`;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM mapaba_pendaftar ${clause}`)
      .get(params);

    const rows = db
      .prepare(
        `SELECT id, nomor_registrasi AS nomorRegistrasi, nama_lengkap AS namaLengkap, nim,
                angkatan, universitas, fakultas, prodi, jenis_kelamin AS jenisKelamin,
                whatsapp, email, asal_daerah AS asalDaerah, motivasi,
                riwayat_organisasi AS riwayatOrganisasi,
                pas_foto_url AS pasFotoUrl, ktm_url AS ktmUrl,
                status, catatan_panitia AS catatanPanitia, created_at AS dibuatPada
         FROM mapaba_pendaftar ${clause}
         ORDER BY created_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: query.limit, offset: (query.page - 1) * query.limit });

    return ok(res, rows, {
      page: query.page,
      limit: query.limit,
      total,
      totalPage: Math.ceil(total / query.limit),
    });
  })
);

router.patch(
  '/admin/pendaftar/:id',
  requireAdmin('panitia_mapaba'),
  asyncHandler((req, res) => {
    const data = parseOrThrow(
      z.object({
        status: z.enum(['menunggu', 'terverifikasi', 'hadir', 'ditolak', 'batal']).optional(),
        catatanPanitia: z.string().trim().max(1000).optional(),
      }),
      req.body
    );

    const row = db.prepare('SELECT * FROM mapaba_pendaftar WHERE id = ?').get(req.params.id);
    if (!row) throw notFound('Pendaftar tidak ditemukan.');

    db.prepare(
      `UPDATE mapaba_pendaftar SET
         status          = COALESCE(@status, status),
         catatan_panitia = COALESCE(@catatanPanitia, catatan_panitia),
         updated_at      = datetime('now')
       WHERE id = @id`
    ).run({
      id: row.id,
      status: data.status ?? null,
      catatanPanitia: data.catatanPanitia ?? null,
    });

    db.prepare(
      `INSERT INTO audit_log (user_id, aksi, entitas, entitas_id, metadata)
       VALUES (?, 'mapaba.update', 'mapaba_pendaftar', ?, ?)`
    ).run(req.user.id, row.id, JSON.stringify(data));

    // Kabari pendaftar hanya saat keputusan panitia benar-benar berubah,
    // supaya tidak ada pesan berulang setiap kali catatan disunting.
    if (data.status && data.status !== row.status && ['terverifikasi', 'ditolak'].includes(data.status)) {
      notifikasiStatusMapaba(row, data.status, data.catatanPanitia);
    }

    return ok(res, db.prepare('SELECT * FROM mapaba_pendaftar WHERE id = ?').get(row.id));
  })
);

module.exports = router;
