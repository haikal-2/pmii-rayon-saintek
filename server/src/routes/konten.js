/**
 * Endpoint konten publik lain: galeri, dokumen landasan hukum, dan pengurus.
 * Semuanya hanya-baca dari sisi pengunjung; pengelolaan dilakukan lewat panel
 * admin (lihat docs/BACKEND-SPEC.md bagian 5).
 */
const express = require('express');
const { z } = require('zod');

const { db } = require('../lib/db');
const { ok, notFound, asyncHandler, parseOrThrow } = require('../lib/http');

const router = express.Router();

/* ----------------------------------------------------------------- Galeri */

router.get(
  '/galeri/album',
  asyncHandler((req, res) => {
    const query = parseOrThrow(
      z.object({
        kategori: z.string().trim().max(50).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(48).default(12),
      }),
      req.query
    );

    const params = { limit: query.limit, offset: (query.page - 1) * query.limit };
    let filter = '';
    if (query.kategori) {
      filter = ' AND kategori = @kategori';
      params.kategori = query.kategori;
    }

    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total FROM galeri_album
         WHERE is_publik = 1 AND deleted_at IS NULL${filter}`
      )
      .get(params);

    const rows = db
      .prepare(
        `SELECT id, slug, judul, deskripsi, kategori, tanggal, cover_url AS coverUrl,
                (SELECT COUNT(*) FROM galeri_media m WHERE m.album_id = galeri_album.id) AS jumlahMedia
         FROM galeri_album
         WHERE is_publik = 1 AND deleted_at IS NULL${filter}
         ORDER BY tanggal DESC
         LIMIT @limit OFFSET @offset`
      )
      .all(params);

    return ok(res, rows, {
      page: query.page,
      limit: query.limit,
      total,
      totalPage: Math.ceil(total / query.limit),
    });
  })
);

router.get(
  '/galeri/album/:slug',
  asyncHandler((req, res) => {
    const album = db
      .prepare(
        `SELECT id, slug, judul, deskripsi, kategori, tanggal, cover_url AS coverUrl
         FROM galeri_album
         WHERE slug = ? AND is_publik = 1 AND deleted_at IS NULL`
      )
      .get(req.params.slug);
    if (!album) throw notFound('Album tidak ditemukan.');

    const media = db
      .prepare(
        `SELECT id, tipe, url, thumb_url AS thumbUrl, caption
         FROM galeri_media WHERE album_id = ? ORDER BY urutan, id`
      )
      .all(album.id);

    return ok(res, { ...album, media });
  })
);

/* --------------------------------------------------------------- Dokumen */

router.get(
  '/dokumen',
  asyncHandler((req, res) => {
    const query = parseOrThrow(
      z.object({
        kategori: z
          .enum(['konstitusi', 'ndp', 'peraturan', 'kaderisasi', 'lainnya'])
          .optional(),
      }),
      req.query
    );

    const params = {};
    let filter = '';
    if (query.kategori) {
      filter = ' AND kategori = @kategori';
      params.kategori = query.kategori;
    }

    const rows = db
      .prepare(
        `SELECT id, judul, deskripsi, kategori, file_url AS fileUrl, mime,
                ukuran_byte AS ukuranByte, tahun, diunduh
         FROM dokumen WHERE is_publik = 1${filter}
         ORDER BY urutan, judul`
      )
      .all(params);

    return ok(res, rows);
  })
);

/**
 * Catat unduhan lalu arahkan ke berkas aslinya. Dipakai pada tombol "Unduh"
 * halaman Landasan Hukum agar statistik pemakaian dokumen terekam.
 */
router.get(
  '/dokumen/:id/unduh',
  asyncHandler((req, res) => {
    const row = db
      .prepare('SELECT file_url AS fileUrl FROM dokumen WHERE id = ? AND is_publik = 1')
      .get(req.params.id);
    if (!row) throw notFound('Dokumen tidak ditemukan.');

    db.prepare('UPDATE dokumen SET diunduh = diunduh + 1 WHERE id = ?').run(req.params.id);
    return res.redirect(302, row.fileUrl);
  })
);

/* -------------------------------------------------------------- Pengurus */

router.get(
  '/pengurus',
  asyncHandler((req, res) => {
    const periodeLabel = req.query.periode;

    const periode = periodeLabel
      ? db.prepare('SELECT * FROM periode WHERE label = ?').get(periodeLabel)
      : db.prepare('SELECT * FROM periode WHERE is_aktif = 1 ORDER BY id DESC LIMIT 1').get();

    if (!periode) throw notFound('Periode kepengurusan tidak ditemukan.');

    const rows = db
      .prepare(
        `SELECT id, nama, jabatan, bidang, foto_url AS fotoUrl
         FROM pengurus WHERE periode_id = ? ORDER BY urutan, id`
      )
      .all(periode.id);

    return ok(res, { periode: periode.label, pengurus: rows });
  })
);

module.exports = router;
