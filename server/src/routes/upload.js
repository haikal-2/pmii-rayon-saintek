/**
 * Unggah berkas.
 *
 *   POST /api/v1/upload            publik terbatas — pas foto & KTM pendaftar MAPABA
 *   POST /api/v1/upload/admin      admin — cover artikel, foto galeri, dokumen PDF
 *
 * Alur yang dipakai front-end: berkas diunggah lebih dulu ke endpoint ini, lalu
 * URL yang dikembalikan disertakan pada payload JSON formulir. Dengan begitu
 * formulir tetap ringan, unggahan bisa dipantau progresnya, dan penyimpanan bisa
 * dipindah ke S3/Cloudinary tanpa mengubah endpoint formulir sama sekali.
 *
 * Lapisan validasi berkas (semua wajib lolos):
 *   1. Batas ukuran ditegakkan Multer sebelum berkas selesai dibaca.
 *   2. MIME type dari peramban disaring pada fileFilter.
 *   3. Magic bytes isi berkas diperiksa ulang — MIME dari klien bisa dipalsukan.
 *   4. Nama berkas hasil ditentukan server (acak), tidak memakai nama dari klien,
 *      sehingga tidak ada celah path traversal atau berkas .php/.html yang dieksekusi.
 */
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const { db } = require('../lib/db');
const { simpanBerkas, DRIVER } = require('../lib/storage');
const { hashOpaque } = require('../lib/tokens');
const { requireAdmin } = require('../middleware/auth');
const { ok, badRequest, asyncHandler } = require('../lib/http');

const router = express.Router();

const MAKS_GAMBAR = 3 * 1024 * 1024; // 3 MB
const MAKS_DOKUMEN = 10 * 1024 * 1024; // 10 MB

const MIME_GAMBAR = ['image/jpeg', 'image/png', 'image/webp'];
const MIME_DOKUMEN = [...MIME_GAMBAR, 'application/pdf'];

/**
 * Tanda tangan biner (magic bytes) tiap format yang diizinkan.
 * Pemeriksaan ini menangkap berkas yang menyamar, mis. skrip berekstensi .jpg.
 */
const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
};

/** Berkas ditahan di memori, lalu diteruskan ke driver penyimpanan. */
const uploadGambar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAKS_GAMBAR, files: 1 },
  fileFilter: (_req, file, cb) =>
    MIME_GAMBAR.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Format berkas harus JPG, PNG, atau WebP.')),
});

const uploadDokumen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAKS_DOKUMEN, files: 1 },
  fileFilter: (_req, file, cb) =>
    MIME_DOKUMEN.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Format berkas harus JPG, PNG, WebP, atau PDF.')),
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Terlalu banyak unggahan dari jaringan ini. Coba lagi nanti.' },
});

/**
 * Bungkus middleware Multer agar galatnya menjadi respons API yang rapi.
 * Batas ukuran diteruskan eksplisit karena Multer tidak menyertakannya pada galat.
 */
const tangani = (mw, maksByte) => (req, res, next) =>
  mw(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maks = `${Math.round(maksByte / 1024 / 1024)} MB`;
      return next(badRequest(`Ukuran berkas melebihi batas ${maks}.`, { file: `Maksimal ${maks}.` }));
    }
    return next(badRequest(error.message, { file: error.message }));
  });

function validasiIsi(file) {
  const pemeriksa = MAGIC[file.mimetype];
  if (!pemeriksa || !pemeriksa(file.buffer)) {
    throw badRequest('Isi berkas tidak cocok dengan formatnya.', {
      file: 'Berkas rusak atau bukan gambar/PDF yang sah.',
    });
  }
}

async function proses(req, tujuan, pengunggah) {
  if (!req.file) throw badRequest('Tidak ada berkas yang dikirim.', { file: 'Pilih berkas dulu.' });
  validasiIsi(req.file);

  const hasil = await simpanBerkas(req.file, tujuan);

  db.prepare(
    `INSERT INTO berkas (driver, kunci, url, nama_asli, mime, ukuran_byte, tujuan, pengunggah)
     VALUES (@driver, @kunci, @url, @namaAsli, @mime, @ukuranByte, @tujuan, @pengunggah)`
  ).run({ ...hasil, tujuan, pengunggah });

  return hasil;
}

/* ----------------------------------------------------------------- Publik */

/**
 * Unggahan dari formulir MAPABA (pas foto / KTM).
 *
 * Terbuka untuk publik karena calon anggota belum punya akun, tetapi dibatasi:
 * hanya gambar, maksimal 3 MB, 20 unggahan per IP per 15 menit, dan `tujuan`
 * dipaksa ke 'mapaba' sehingga tidak bisa dipakai menitipkan berkas sembarangan.
 */
router.post(
  '/',
  limiter,
  tangani(uploadGambar.single('file'), MAKS_GAMBAR),
  asyncHandler(async (req, res) => {
    const hasil = await proses(req, 'mapaba', hashOpaque(req.ip || 'unknown'));
    return ok(res, { url: hasil.url, kunci: hasil.kunci, ukuranByte: hasil.ukuranByte });
  })
);

/* ---------------------------------------------------------------- Internal */

router.post(
  '/admin',
  requireAdmin(),
  tangani(uploadDokumen.single('file'), MAKS_DOKUMEN),
  asyncHandler(async (req, res) => {
    const tujuan = ['galeri', 'artikel', 'dokumen'].includes(req.query.tujuan)
      ? req.query.tujuan
      : 'umum';
    const hasil = await proses(req, tujuan, `user:${req.user.id}`);
    return ok(res, hasil);
  })
);

router.get(
  '/admin/berkas',
  requireAdmin(),
  asyncHandler((req, res) =>
    ok(res, {
      driver: DRIVER,
      berkas: db
        .prepare(
          `SELECT id, driver, kunci, url, nama_asli AS namaAsli, mime,
                  ukuran_byte AS ukuranByte, tujuan, created_at AS dibuatPada
           FROM berkas ORDER BY id DESC LIMIT 100`
        )
        .all(),
    })
  )
);

module.exports = router;
