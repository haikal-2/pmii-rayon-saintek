/**
 * Penerbitan & verifikasi JWT.
 *
 * Audiens token ditetapkan eksplisit sebagai "admin" (subject = id users).
 * Parameter audience tetap dipertahankan agar penambahan audiens baru di
 * kemudian hari tidak perlu mengubah pemanggilnya.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'ubah-nilai-ini-di-berkas-env';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '2h';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '7d';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET wajib diset pada mode production.');
}

const signAccess = (payload, audience) =>
  jwt.sign(payload, SECRET, { audience, expiresIn: ACCESS_TTL, issuer: 'pmii-uinsgd' });

const signRefresh = (payload, audience) =>
  jwt.sign({ ...payload, typ: 'refresh' }, SECRET, {
    audience,
    expiresIn: REFRESH_TTL,
    issuer: 'pmii-uinsgd',
  });

const verify = (token, audience) =>
  jwt.verify(token, SECRET, { audience, issuer: 'pmii-uinsgd' });

/**
 * Hash satu arah untuk data yang perlu dibandingkan tetapi tidak perlu dibaca,
 * mis. alamat IP pelapor untuk keperluan anti-spam.
 */
const hashOpaque = (value) =>
  crypto
    .createHash('sha256')
    .update(`${value}:${SECRET}`)
    .digest('hex')
    .slice(0, 32);

module.exports = { signAccess, signRefresh, verify, hashOpaque };
