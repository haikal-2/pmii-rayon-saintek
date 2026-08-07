/**
 * Pembantu respons HTTP & penanganan galat.
 *
 * Bentuk respons konsisten di seluruh API:
 *   Sukses → { ok: true, data, meta? }
 *   Gagal  → { ok: false, message, errors? }
 *
 * `errors` berbentuk { namaKolom: "pesan" } sehingga front-end
 * (public/assets/js/forms.js) dapat langsung menempelkannya di bawah input.
 */

class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

const badRequest = (message, errors) => new ApiError(400, message, errors);
const unauthorized = (message = 'Sesi tidak valid. Silakan login kembali.') =>
  new ApiError(401, message);
const forbidden = (message = 'Kamu tidak memiliki hak akses untuk aksi ini.') =>
  new ApiError(403, message);
const notFound = (message = 'Data tidak ditemukan.') => new ApiError(404, message);
const conflict = (message, errors) => new ApiError(409, message, errors);
const tooMany = (message = 'Terlalu banyak permintaan. Coba lagi nanti.') =>
  new ApiError(429, message);

const ok = (res, data, meta) =>
  res.json(meta ? { ok: true, data, meta } : { ok: true, data });

const created = (res, data) => res.status(201).json({ ok: true, data });

/** Bungkus handler async agar galat otomatis diteruskan ke error handler. */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Validasi body/query dengan skema Zod dan ubah galatnya menjadi
 * { namaKolom: pesan } agar dapat dipakai langsung oleh front-end.
 */
function parseOrThrow(schema, payload) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  throw badRequest('Data yang dikirim belum lengkap atau tidak valid.', errors);
}

/** Middleware error terakhir. Harus terdaftar setelah semua route. */
function errorHandler(error, req, res, _next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      ok: false,
      message: error.message,
      ...(error.errors ? { errors: error.errors } : {}),
    });
  }

  // Pelanggaran UNIQUE pada SQLite → 409 dengan pesan yang bisa dibaca pengguna.
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({
      ok: false,
      message: 'Data sudah pernah tercatat sebelumnya.',
    });
  }

  console.error('[API] Galat tak tertangani:', error);
  return res.status(500).json({
    ok: false,
    message: 'Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.',
  });
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  ok,
  created,
  asyncHandler,
  parseOrThrow,
  errorHandler,
};
