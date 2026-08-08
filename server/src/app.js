/**
 * Konfigurasi aplikasi Express.
 *
 * Dipisahkan dari index.js agar dapat diimpor langsung oleh berkas pengujian
 * tanpa membuka port jaringan.
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFound } = require('./lib/http');

const app = express();
const PREFIX = process.env.API_PREFIX || '/api/v1';

// Dibutuhkan agar req.ip benar ketika berada di belakang Nginx/Cloudflare.
app.set('trust proxy', 1);
app.disable('x-powered-by');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4321')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Permintaan tanpa Origin (curl, health check) tetap diizinkan.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} tidak diizinkan oleh kebijakan CORS.`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

/**
 * Header keamanan.
 *
 * `crossOriginResourcePolicy: cross-origin` diperlukan karena berkas di /uploads
 * dimuat oleh front-end yang berada di domain berbeda (mis. Vercel → API VPS).
 * CSP untuk halaman HTML diatur di Nginx (lihat deploy/nginx.conf); di sini CSP
 * dimatikan agar tidak berbenturan dengan respons JSON.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// Pembatas laju global; endpoint sensitif punya pembatas sendiri di route-nya.
app.use(
  PREFIX,
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' },
  })
);

app.get(`${PREFIX}/health`, (_req, res) =>
  res.json({ ok: true, data: { status: 'sehat', waktu: new Date().toISOString() } })
);

app.use(`${PREFIX}/upload`, require('./routes/upload'));
app.use(`${PREFIX}/artikel`, require('./routes/artikel'));
app.use(`${PREFIX}/advokasi`, require('./routes/advokasi'));
app.use(`${PREFIX}/mapaba`, require('./routes/mapaba'));
app.use(`${PREFIX}/admin`, require('./routes/admin'));
app.use(PREFIX, require('./routes/konten'));

// Berkas unggahan (dokumen PDF, foto galeri). Di produksi sebaiknya dilayani
// oleh Nginx atau object storage (S3/R2) alih-alih proses Node.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), { maxAge: '7d', index: false })
);

// Sajikan front-end statis bila API dan web dijalankan pada satu proses.
if (process.env.SERVE_STATIC === 'true') {
  app.use(express.static(path.join(__dirname, '../../public'), { extensions: ['html'] }));
}

app.use((req, _res, next) => next(notFound(`Endpoint ${req.method} ${req.originalUrl} tidak ada.`)));
app.use(errorHandler);

module.exports = { app, PREFIX };
