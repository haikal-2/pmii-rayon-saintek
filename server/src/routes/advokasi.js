/**
 * Layanan Advokasi — pengaduan mahasiswa.
 *
 * Publik:
 *   POST /api/v1/advokasi/pengaduan          kirim pengaduan baru
 *   GET  /api/v1/advokasi/pengaduan/:tiket   lacak status via nomor tiket
 *
 * Internal (role: advokat / superadmin):
 *   GET   /api/v1/advokasi/admin/pengaduan          daftar + filter + paginasi
 *   PATCH /api/v1/advokasi/admin/pengaduan/:id      ubah status / petugas / catatan
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const { db, nextNumber } = require('../lib/db');
const { hashOpaque } = require('../lib/tokens');
const { notifikasiPengaduanBaru } = require('../lib/notify');
const { verifyCaptcha } = require('../middleware/captcha');
const { requireAdmin } = require('../middleware/auth');
const { ok, created, notFound, asyncHandler, parseOrThrow } = require('../lib/http');

const router = express.Router();

/* -------------------------------------------------------------- Skema Zod */

const KATEGORI = [
  'akademik',
  'fasilitas',
  'kekerasan_seksual',
  'ukt',
  'perundungan',
  'kebebasan_berpendapat',
  'ketenagakerjaan',
  'lainnya',
];

/** Kategori yang otomatis diperlakukan sebagai kasus berprioritas tinggi. */
const KATEGORI_MENDESAK = new Set(['kekerasan_seksual', 'perundungan']);

const pengaduanSchema = z.object({
  // Nama boleh dikosongkan: pelapor berhak menyampaikan aduan secara anonim.
  nama: z
    .union([z.string().trim().max(100), z.literal('')])
    .optional()
    .transform((value) => (value && value.length >= 2 ? value : 'Anonim')),
  kontak: z
    .string()
    .trim()
    .min(8, 'Nomor kontak minimal 8 digit.')
    .max(20)
    .regex(/^[0-9+\-\s()]+$/, 'Nomor kontak hanya boleh berisi angka dan tanda + - ( ).'),
  email: z.union([z.string().trim().email('Format email tidak valid.'), z.literal('')]).optional(),
  status: z.enum(['mahasiswa', 'alumni', 'kader', 'masyarakat'], {
    errorMap: () => ({ message: 'Pilih salah satu status pelapor.' }),
  }),
  kategori: z.enum(KATEGORI, {
    errorMap: () => ({ message: 'Pilih salah satu kategori masalah.' }),
  }),
  kronologi: z
    .string()
    .trim()
    .min(50, 'Kronologi minimal 50 karakter agar dapat ditindaklanjuti.')
    .max(4000),
  lampiranUrl: z
    .union([z.string().trim().url('Tautan bukti harus berupa URL yang valid.'), z.literal('')])
    .optional(),
  anonim: z.coerce.boolean().optional().default(false),
  persetujuan: z.literal(true, {
    errorMap: () => ({ message: 'Kamu perlu menyetujui pernyataan kebenaran data.' }),
  }),
});

const updateSchema = z.object({
  status: z.enum(['baru', 'verifikasi', 'pendampingan', 'selesai', 'ditolak']).optional(),
  prioritas: z.enum(['rendah', 'normal', 'tinggi', 'darurat']).optional(),
  petugasId: z.coerce.number().int().positive().nullable().optional(),
  catatanInternal: z.string().trim().max(4000).optional(),
});

/* ------------------------------------------------------------ Pembatas laju */

// Maksimal 5 pengaduan per IP per jam — cukup longgar untuk pelapor sungguhan,
// cukup ketat untuk mencegah banjir spam.
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Terlalu banyak pengaduan dari jaringan ini. Coba lagi satu jam kemudian.',
  },
});

/* ----------------------------------------------------------------- Publik */

router.post(
  '/pengaduan',
  limiter,
  verifyCaptcha,
  asyncHandler((req, res) => {
    const data = parseOrThrow(pengaduanSchema, req.body);
    const nomorTiket = nextNumber('advokasi', 'ADV');

    // Kasus kekerasan/pelecehan otomatis berprioritas tinggi agar segera ditangani
    // dan memicu notifikasi mendesak ke tim Advokasi.
    const mendesak = KATEGORI_MENDESAK.has(data.kategori);
    const prioritas = mendesak ? 'tinggi' : 'normal';

    const info = db
      .prepare(
        `INSERT INTO pengaduan
           (nomor_tiket, nama, kontak, email, status_pelapor, kategori, kronologi,
            lampiran_url, is_anonim, prioritas, ip_hash)
         VALUES (@nomorTiket, @nama, @kontak, @email, @statusPelapor, @kategori, @kronologi,
                 @lampiranUrl, @isAnonim, @prioritas, @ipHash)`
      )
      .run({
        nomorTiket,
        nama: data.nama,
        kontak: data.kontak,
        email: data.email || null,
        statusPelapor: data.status,
        kategori: data.kategori,
        kronologi: data.kronologi,
        lampiranUrl: data.lampiranUrl || null,
        isAnonim: data.anonim ? 1 : 0,
        prioritas,
        ipHash: hashOpaque(req.ip || 'unknown'),
      });

    db.prepare(
      `INSERT INTO pengaduan_log (pengaduan_id, status_baru, catatan)
       VALUES (?, 'baru', 'Pengaduan diterima melalui formulir website.')`
    ).run(info.lastInsertRowid);

    // Notifikasi dikirim tanpa menunggu (fire-and-forget): kegagalan SMTP atau
    // gateway WhatsApp tidak boleh membuat pengaduan pelapor ikut gagal.
    notifikasiPengaduanBaru({
      id: info.lastInsertRowid,
      nomorTiket,
      nama: data.nama,
      kontak: data.kontak,
      kategori: data.kategori,
      prioritas,
      mendesak,
      kronologi: data.kronologi,
    });

    return created(res, {
      nomorTiket,
      status: 'baru',
      pesan:
        'Pengaduan diterima. Tim Advokasi akan menghubungi kamu dalam 2×24 jam kerja. ' +
        'Simpan nomor tiket untuk menanyakan perkembangan kasus.',
    });
  })
);

router.get(
  '/pengaduan/:tiket',
  asyncHandler((req, res) => {
    const row = db
      .prepare(
        `SELECT nomor_tiket AS nomorTiket, kategori, status, prioritas,
                created_at AS dibuatPada, updated_at AS diperbaruiPada, closed_at AS ditutupPada
         FROM pengaduan WHERE nomor_tiket = ?`
      )
      .get(req.params.tiket);

    if (!row) throw notFound('Nomor tiket tidak ditemukan.');

    const riwayat = db
      .prepare(
        `SELECT status_baru AS status, catatan, created_at AS waktu
         FROM pengaduan_log
         WHERE pengaduan_id = (SELECT id FROM pengaduan WHERE nomor_tiket = ?)
         ORDER BY id ASC`
      )
      .all(req.params.tiket);

    // Identitas pelapor dan isi kronologi sengaja tidak dikembalikan di endpoint
    // publik: nomor tiket saja tidak cukup kuat sebagai bukti kepemilikan data.
    return ok(res, { ...row, riwayat });
  })
);

/* ---------------------------------------------------------------- Internal */

router.get(
  '/admin/pengaduan',
  requireAdmin('advokat'),
  asyncHandler((req, res) => {
    const query = parseOrThrow(
      z.object({
        status: z.enum(['baru', 'verifikasi', 'pendampingan', 'selesai', 'ditolak']).optional(),
        kategori: z.enum(KATEGORI).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query
    );

    const where = [];
    const params = {};
    if (query.status) {
      where.push('status = @status');
      params.status = query.status;
    }
    if (query.kategori) {
      where.push('kategori = @kategori');
      params.kategori = query.kategori;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM pengaduan ${clause}`).get(params);
    const rows = db
      .prepare(
        `SELECT id, nomor_tiket AS nomorTiket, nama, kontak, email,
                status_pelapor AS statusPelapor, kategori, status, prioritas,
                is_anonim AS isAnonim, petugas_id AS petugasId,
                created_at AS dibuatPada
         FROM pengaduan ${clause}
         ORDER BY CASE prioritas WHEN 'darurat' THEN 0 WHEN 'tinggi' THEN 1
                                 WHEN 'normal' THEN 2 ELSE 3 END,
                  created_at DESC
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
  '/admin/pengaduan/:id',
  requireAdmin('advokat'),
  asyncHandler((req, res) => {
    const data = parseOrThrow(updateSchema, req.body);
    const current = db.prepare('SELECT * FROM pengaduan WHERE id = ?').get(req.params.id);
    if (!current) throw notFound('Pengaduan tidak ditemukan.');

    const applyUpdate = db.transaction(() => {
      db.prepare(
        `UPDATE pengaduan SET
           status           = COALESCE(@status, status),
           prioritas        = COALESCE(@prioritas, prioritas),
           petugas_id       = COALESCE(@petugasId, petugas_id),
           catatan_internal = COALESCE(@catatanInternal, catatan_internal),
           closed_at        = CASE WHEN @status IN ('selesai','ditolak')
                                   THEN datetime('now') ELSE closed_at END,
           updated_at       = datetime('now')
         WHERE id = @id`
      ).run({
        id: current.id,
        status: data.status ?? null,
        prioritas: data.prioritas ?? null,
        petugasId: data.petugasId ?? null,
        catatanInternal: data.catatanInternal ?? null,
      });

      if (data.status && data.status !== current.status) {
        db.prepare(
          `INSERT INTO pengaduan_log (pengaduan_id, user_id, status_lama, status_baru, catatan)
           VALUES (?, ?, ?, ?, ?)`
        ).run(current.id, req.user.id, current.status, data.status, data.catatanInternal ?? null);
      }

      db.prepare(
        `INSERT INTO audit_log (user_id, aksi, entitas, entitas_id, metadata)
         VALUES (?, 'pengaduan.update', 'pengaduan', ?, ?)`
      ).run(req.user.id, current.id, JSON.stringify(data));
    });

    applyUpdate();

    return ok(res, db.prepare('SELECT * FROM pengaduan WHERE id = ?').get(current.id));
  })
);

module.exports = router;
