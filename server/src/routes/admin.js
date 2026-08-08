/**
 * Autentikasi pengurus/panitia dan ringkasan dashboard admin.
 *
 *   POST /api/v1/admin/auth/login   login pengurus
 *   GET  /api/v1/admin/me           profil pengurus yang sedang login
 *   GET  /api/v1/admin/ringkasan    angka ringkas untuk dashboard internal
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { db } = require('../lib/db');
const { signAccess } = require('../lib/tokens');
const { requireAdmin } = require('../middleware/auth');
const { ok, unauthorized, forbidden, asyncHandler, parseOrThrow } = require('../lib/http');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Terlalu banyak percobaan login. Coba lagi nanti.' },
});

router.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(
      z.object({
        email: z.string().trim().email('Format email tidak valid.'),
        password: z.string().min(8, 'Kata sandi minimal 8 karakter.'),
      }),
      req.body
    );

    const user = db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .get(data.email);

    if (!user) throw unauthorized('Email atau kata sandi salah.');
    if (!user.is_active) throw forbidden('Akun dinonaktifkan.');

    const cocok = await bcrypt.compare(data.password, user.password_hash);
    if (!cocok) throw unauthorized('Email atau kata sandi salah.');

    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

    return ok(res, {
      accessToken: signAccess({ sub: user.id, role: user.role }, 'admin'),
      user: { id: user.id, nama: user.nama, email: user.email, role: user.role },
    });
  })
);

router.get(
  '/me',
  requireAdmin(),
  asyncHandler((req, res) => ok(res, req.user))
);

router.get(
  '/ringkasan',
  requireAdmin(),
  asyncHandler((_req, res) =>
    ok(res, {
      artikel: db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS terbit,
             SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draf
           FROM artikel WHERE deleted_at IS NULL`
        )
        .get(),
      pengaduan: db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'baru' THEN 1 ELSE 0 END) AS baru,
             SUM(CASE WHEN status IN ('verifikasi','pendampingan') THEN 1 ELSE 0 END) AS proses,
             SUM(CASE WHEN status = 'selesai' THEN 1 ELSE 0 END) AS selesai
           FROM pengaduan`
        )
        .get(),
      mapaba: db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'menunggu' THEN 1 ELSE 0 END) AS menunggu,
             SUM(CASE WHEN status = 'terverifikasi' THEN 1 ELSE 0 END) AS terverifikasi
           FROM mapaba_pendaftar`
        )
        .get(),
      cbt: db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM cbt_peserta WHERE is_active = 1) AS peserta,
             (SELECT COUNT(*) FROM cbt_paket WHERE is_aktif = 1) AS paket,
             (SELECT COUNT(*) FROM cbt_sesi WHERE status = 'berjalan') AS sesiBerjalan,
             (SELECT COUNT(*) FROM cbt_sesi WHERE status = 'selesai') AS sesiSelesai`
        )
        .get(),
    })
  )
);

module.exports = router;
