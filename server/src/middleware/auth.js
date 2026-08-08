/**
 * Middleware autentikasi berbasis Bearer token.
 *
 *   requirePeserta          → hanya peserta CBT yang aktif
 *   requireAdmin(...roles)  → pengurus/panitia; tanpa argumen berarti semua role
 */
const { db } = require('../lib/db');
const { verify } = require('../lib/tokens');
const { unauthorized, forbidden } = require('../lib/http');

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function requirePeserta(req, _res, next) {
  const token = bearer(req);
  if (!token) return next(unauthorized('Token akses tidak ditemukan.'));

  let payload;
  try {
    payload = verify(token, 'cbt');
  } catch {
    return next(unauthorized('Token akses tidak valid atau sudah kedaluwarsa.'));
  }
  if (payload.typ === 'refresh') return next(unauthorized('Gunakan access token, bukan refresh token.'));

  const peserta = db
    .prepare('SELECT id, nomor_peserta, nama, email, is_active FROM cbt_peserta WHERE id = ?')
    .get(payload.sub);

  if (!peserta || !peserta.is_active) return next(unauthorized('Akun peserta tidak aktif.'));

  req.peserta = peserta;
  return next();
}

const requireAdmin =
  (...roles) =>
  (req, _res, next) => {
    const token = bearer(req);
    if (!token) return next(unauthorized('Token akses tidak ditemukan.'));

    let payload;
    try {
      payload = verify(token, 'admin');
    } catch {
      return next(unauthorized('Token akses tidak valid atau sudah kedaluwarsa.'));
    }

    const user = db
      .prepare('SELECT id, nama, email, role, is_active FROM users WHERE id = ?')
      .get(payload.sub);

    if (!user || !user.is_active) return next(unauthorized('Akun pengurus tidak aktif.'));
    if (roles.length && !roles.includes(user.role) && user.role !== 'superadmin') {
      return next(forbidden());
    }

    req.user = user;
    return next();
  };

module.exports = { requirePeserta, requireAdmin };
