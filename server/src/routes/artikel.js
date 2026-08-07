/**
 * CMS Artikel.
 *
 * Publik:
 *   GET /api/v1/artikel                 daftar artikel terbit (filter, cari, paginasi)
 *   GET /api/v1/artikel/:slug           detail artikel + penambahan penghitung dilihat
 *   GET /api/v1/artikel/meta/kategori   daftar kategori
 *
 * Internal (role: editor / superadmin):
 *   POST   /api/v1/artikel/admin        buat artikel
 *   PATCH  /api/v1/artikel/admin/:id    ubah artikel / terbitkan
 *   DELETE /api/v1/artikel/admin/:id    soft delete
 */
const express = require('express');
const { z } = require('zod');

const { db } = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { ok, created, notFound, asyncHandler, parseOrThrow } = require('../lib/http');

const router = express.Router();

/** Ubah judul menjadi slug URL yang aman. */
const slugify = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 90);

const SELECT_PUBLIK = `
  SELECT a.id, a.slug, a.judul, a.ringkasan, a.cover_url AS coverUrl,
         a.is_unggulan AS isUnggulan, a.dilihat, a.published_at AS publishedAt,
         k.nama AS kategori, k.slug AS kategoriSlug,
         COALESCE(a.penulis_nama, u.nama) AS penulis
  FROM artikel a
  LEFT JOIN kategori k ON k.id = a.kategori_id
  LEFT JOIN users u    ON u.id = a.penulis_id
  WHERE a.status = 'published' AND a.deleted_at IS NULL`;

router.get(
  '/',
  asyncHandler((req, res) => {
    const query = parseOrThrow(
      z.object({
        kategori: z.string().trim().max(50).optional(),
        q: z.string().trim().max(100).optional(),
        unggulan: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(9),
      }),
      req.query
    );

    const where = [];
    const params = {};
    if (query.kategori) {
      where.push('k.slug = @kategori');
      params.kategori = query.kategori;
    }
    if (query.q) {
      where.push('(a.judul LIKE @q OR a.ringkasan LIKE @q)');
      params.q = `%${query.q}%`;
    }
    if (query.unggulan) where.push('a.is_unggulan = 1');
    const extra = where.length ? ` AND ${where.join(' AND ')}` : '';

    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total FROM artikel a
         LEFT JOIN kategori k ON k.id = a.kategori_id
         WHERE a.status = 'published' AND a.deleted_at IS NULL${extra}`
      )
      .get(params);

    const rows = db
      .prepare(
        `${SELECT_PUBLIK}${extra}
         ORDER BY a.is_unggulan DESC, a.published_at DESC
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

router.get(
  '/meta/kategori',
  asyncHandler((_req, res) =>
    ok(
      res,
      db
        .prepare(
          `SELECT k.id, k.nama, k.slug,
                  (SELECT COUNT(*) FROM artikel a
                    WHERE a.kategori_id = k.id AND a.status = 'published' AND a.deleted_at IS NULL) AS jumlah
           FROM kategori k ORDER BY k.nama`
        )
        .all()
    )
  )
);

router.get(
  '/:slug',
  asyncHandler((req, res) => {
    const row = db
      .prepare(`${SELECT_PUBLIK} AND a.slug = @slug`)
      .get({ slug: req.params.slug });
    if (!row) throw notFound('Artikel tidak ditemukan.');

    const { konten } = db.prepare('SELECT konten FROM artikel WHERE id = ?').get(row.id);
    db.prepare('UPDATE artikel SET dilihat = dilihat + 1 WHERE id = ?').run(row.id);

    const terkait = db
      .prepare(
        `${SELECT_PUBLIK} AND a.kategori_id = (SELECT kategori_id FROM artikel WHERE id = @id)
           AND a.id <> @id
         ORDER BY a.published_at DESC LIMIT 3`
      )
      .all({ id: row.id });

    return ok(res, { ...row, konten, terkait });
  })
);

/* ---------------------------------------------------------------- Internal */

const artikelSchema = z.object({
  judul: z.string().trim().min(5, 'Judul minimal 5 karakter.').max(200),
  ringkasan: z.string().trim().min(20, 'Ringkasan minimal 20 karakter.').max(500),
  konten: z.string().trim().min(50, 'Isi artikel minimal 50 karakter.'),
  kategoriId: z.coerce.number().int().positive().optional(),
  coverUrl: z.union([z.string().trim().url(), z.literal('')]).optional(),
  penulisNama: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'review', 'published', 'archived']).default('draft'),
  isUnggulan: z.coerce.boolean().optional().default(false),
});

router.post(
  '/admin',
  requireAdmin('editor'),
  asyncHandler((req, res) => {
    const data = parseOrThrow(artikelSchema, req.body);

    // Jamin slug unik dengan menambahkan sufiks angka bila perlu.
    let slug = slugify(data.judul);
    let suffix = 1;
    while (db.prepare('SELECT 1 FROM artikel WHERE slug = ?').get(slug)) {
      slug = `${slugify(data.judul)}-${++suffix}`;
    }

    const info = db
      .prepare(
        `INSERT INTO artikel
           (slug, judul, ringkasan, konten, cover_url, kategori_id, penulis_id, penulis_nama,
            status, is_unggulan, published_at)
         VALUES (@slug, @judul, @ringkasan, @konten, @coverUrl, @kategoriId, @penulisId, @penulisNama,
                 @status, @isUnggulan,
                 CASE WHEN @status = 'published' THEN datetime('now') ELSE NULL END)`
      )
      .run({
        slug,
        judul: data.judul,
        ringkasan: data.ringkasan,
        konten: data.konten,
        coverUrl: data.coverUrl || null,
        kategoriId: data.kategoriId ?? null,
        penulisId: req.user.id,
        penulisNama: data.penulisNama || null,
        status: data.status,
        isUnggulan: data.isUnggulan ? 1 : 0,
      });

    return created(res, db.prepare('SELECT * FROM artikel WHERE id = ?').get(info.lastInsertRowid));
  })
);

router.patch(
  '/admin/:id',
  requireAdmin('editor'),
  asyncHandler((req, res) => {
    const data = parseOrThrow(artikelSchema.partial(), req.body);
    const current = db
      .prepare('SELECT * FROM artikel WHERE id = ? AND deleted_at IS NULL')
      .get(req.params.id);
    if (!current) throw notFound('Artikel tidak ditemukan.');

    db.prepare(
      `UPDATE artikel SET
         judul        = COALESCE(@judul, judul),
         ringkasan    = COALESCE(@ringkasan, ringkasan),
         konten       = COALESCE(@konten, konten),
         cover_url    = COALESCE(@coverUrl, cover_url),
         kategori_id  = COALESCE(@kategoriId, kategori_id),
         penulis_nama = COALESCE(@penulisNama, penulis_nama),
         status       = COALESCE(@status, status),
         is_unggulan  = COALESCE(@isUnggulan, is_unggulan),
         -- Tanggal terbit hanya diisi sekali, saat pertama kali dipublikasikan.
         published_at = CASE WHEN @status = 'published' AND published_at IS NULL
                            THEN datetime('now') ELSE published_at END,
         updated_at   = datetime('now')
       WHERE id = @id`
    ).run({
      id: current.id,
      judul: data.judul ?? null,
      ringkasan: data.ringkasan ?? null,
      konten: data.konten ?? null,
      coverUrl: data.coverUrl ?? null,
      kategoriId: data.kategoriId ?? null,
      penulisNama: data.penulisNama ?? null,
      status: data.status ?? null,
      isUnggulan: data.isUnggulan === undefined ? null : data.isUnggulan ? 1 : 0,
    });

    return ok(res, db.prepare('SELECT * FROM artikel WHERE id = ?').get(current.id));
  })
);

router.delete(
  '/admin/:id',
  requireAdmin('editor'),
  asyncHandler((req, res) => {
    const info = db
      .prepare("UPDATE artikel SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
      .run(req.params.id);
    if (!info.changes) throw notFound('Artikel tidak ditemukan.');
    return ok(res, { dihapus: true });
  })
);

module.exports = router;
