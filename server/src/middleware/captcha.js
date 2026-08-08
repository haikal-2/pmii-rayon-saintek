/**
 * Verifikasi CAPTCHA untuk formulir publik (Advokasi & MAPABA).
 *
 * Mendukung tiga penyedia lewat satu variabel `CAPTCHA_PROVIDER`:
 *   - `turnstile`   Cloudflare Turnstile (rekomendasi: gratis, tanpa pelacakan)
 *   - `recaptcha`   Google reCAPTCHA v2 checkbox
 *   - `recaptcha3`  Google reCAPTCHA v3 (skor; ambang batas CAPTCHA_MIN_SCORE)
 *   - `none`        (default) verifikasi dilewati — untuk pengembangan lokal
 *
 * Front-end mengirim token pada body dengan kunci `captchaToken`.
 * Bila penyedia aktif tetapi token kosong/tidak sah, permintaan ditolak 400
 * dengan `errors.captchaToken` sehingga pesan tampil di bawah widget.
 *
 * CAPTCHA adalah lapis kedua, bukan pengganti rate limiting: keduanya dipasang
 * berbarengan pada endpoint yang sama.
 */
const { badRequest } = require('../lib/http');

const ENDPOINT = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  recaptcha3: 'https://www.google.com/recaptcha/api/siteverify',
};

const provider = () => (process.env.CAPTCHA_PROVIDER || 'none').toLowerCase();

async function verifyCaptcha(req, _res, next) {
  const jenis = provider();
  if (jenis === 'none' || !ENDPOINT[jenis]) return next();

  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) {
    // Salah konfigurasi tidak boleh diam-diam mematikan proteksi.
    console.error('[captcha] CAPTCHA_PROVIDER aktif tetapi CAPTCHA_SECRET_KEY kosong.');
    return next(badRequest('Verifikasi anti-spam belum dikonfigurasi. Hubungi pengelola situs.'));
  }

  const token = req.body?.captchaToken;
  if (!token) {
    return next(
      badRequest('Verifikasi anti-spam belum selesai.', {
        captchaToken: 'Selesaikan verifikasi "Saya bukan robot" terlebih dahulu.',
      })
    );
  }

  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: req.ip || '' });
    const response = await fetch(ENDPOINT[jenis], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const hasil = await response.json();

    if (!hasil.success) {
      return next(
        badRequest('Verifikasi anti-spam gagal.', {
          captchaToken: 'Verifikasi kedaluwarsa. Silakan ulangi.',
        })
      );
    }

    // reCAPTCHA v3 mengembalikan skor 0.0–1.0; makin rendah makin mirip bot.
    if (jenis === 'recaptcha3') {
      const minimum = Number(process.env.CAPTCHA_MIN_SCORE || 0.5);
      if (typeof hasil.score === 'number' && hasil.score < minimum) {
        console.warn(`[captcha] skor rendah (${hasil.score}) dari IP ${req.ip}`);
        return next(
          badRequest('Permintaan terdeteksi sebagai otomatis.', {
            captchaToken: 'Verifikasi gagal. Coba lagi atau hubungi kami melalui Instagram.',
          })
        );
      }
    }

    req.captcha = { provider: jenis, score: hasil.score };
    return next();
  } catch (error) {
    // Gateway CAPTCHA sedang bermasalah. Untuk formulir pengaduan, menolak
    // laporan hanya karena layanan pihak ketiga tumbang lebih berbahaya daripada
    // meloloskan sedikit spam — rate limiting tetap berlaku.
    console.error('[captcha] gagal menghubungi penyedia:', error.message);
    if (process.env.CAPTCHA_FAIL_OPEN === 'false') {
      return next(badRequest('Verifikasi anti-spam tidak dapat dilakukan. Coba lagi nanti.'));
    }
    return next();
  }
}

module.exports = { verifyCaptcha };
