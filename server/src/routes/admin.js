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
const {
  ok,
  created,
  conflict,
  unauthorized,
  forbidden,
  asyncHandler,
  parseOrThrow,
} = require('../lib/http');

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

/* ------------------------------------------------- Registrasi akun pengurus */

/**
 * Pendaftaran akun pengurus.
 *
 * Sengaja TIDAK dibuka untuk publik: akun hanya bisa diterbitkan oleh
 * superadmin. Website organisasi tidak memerlukan pendaftaran admin mandiri,
 * dan endpoint registrasi terbuka adalah salah satu jalan masuk paling sering
 * dieksploitasi pada CMS kecil.
 *
 * Kata sandi di-hash dengan bcrypt cost 12. Angka ini dipilih sebagai
 * kompromi: cukup lambat (±250 ms di VPS 2 vCPU) untuk membuat serangan
 * tebak-sandi massal tidak ekonomis, tetapi tidak sampai mengganggu login.
 */
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);

router.post(
  '/users',
  requireAdmin('superadmin'),
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(
      z.object({
        nama: z.string().trim().min(3, 'Nama minimal 3 karakter.').max(100),
        email: z.string().trim().email('Format email tidak valid.').max(150),
        password: z
          .string()
          .min(10, 'Kata sandi minimal 10 karakter.')
          .max(200)
          .regex(/[a-z]/, 'Kata sandi harus memuat huruf kecil.')
          .regex(/[A-Z]/, 'Kata sandi harus memuat huruf besar.')
          .regex(/[0-9]/, 'Kata sandi harus memuat angka.'),
        role: z.enum(['superadmin', 'editor', 'advokat', 'panitia_mapaba', 'panitia_cbt']),
      }),
      req.body
    );

    const sudahAda = db
      .prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE')
      .get(data.email);
    if (sudahAda) {
      throw conflict('Email sudah terdaftar.', { email: 'Email ini sudah dipakai akun lain.' });
    }

    // Hash dibuat sebelum INSERT; kata sandi mentah tidak pernah menyentuh
    // basis data maupun log.
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);

    const info = db
      .prepare('INSERT INTO users (nama, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(data.nama, data.email, passwordHash, data.role);

    db.prepare(
      `INSERT INTO audit_log (user_id, aksi, entitas, entitas_id, metadata)
       VALUES (?, 'user.create', 'users', ?, ?)`
    ).run(req.user.id, info.lastInsertRowid, JSON.stringify({ email: data.email, role: data.role }));

    return created(res, {
      id: info.lastInsertRowid,
      nama: data.nama,
      email: data.email,
      role: data.role,
    });
  })
);

router.get(
  '/users',
  requireAdmin('superadmin'),
  asyncHandler((_req, res) =>
    ok(
      res,
      db
        .prepare(
          `SELECT id, nama, email, role, is_active AS isActive,
                  last_login_at AS lastLoginAt, created_at AS dibuatPada
           FROM users ORDER BY id`
        )
        .all()
    )
  )
);

/** Ganti kata sandi sendiri. Sandi lama wajib dibuktikan. */
router.post(
  '/auth/ubah-sandi',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(
      z.object({
        passwordLama: z.string().min(1, 'Kata sandi lama wajib diisi.'),
        passwordBaru: z
          .string()
          .min(10, 'Kata sandi baru minimal 10 karakter.')
          .max(200)
          .regex(/[a-z]/, 'Kata sandi harus memuat huruf kecil.')
          .regex(/[A-Z]/, 'Kata sandi harus memuat huruf besar.')
          .regex(/[0-9]/, 'Kata sandi harus memuat angka.'),
      }),
      req.body
    );

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const cocok = await bcrypt.compare(data.passwordLama, user.password_hash);
    if (!cocok) {
      throw unauthorized('Kata sandi lama salah.');
    }

    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      await bcrypt.hash(data.passwordBaru, BCRYPT_COST),
      req.user.id
    );

    return ok(res, { diperbarui: true });
  })
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
