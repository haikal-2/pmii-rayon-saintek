import { ApiError } from './http.js';

const CAPTCHA_ENDPOINTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  recaptcha3: 'https://www.google.com/recaptcha/api/siteverify',
};

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));

  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticateAdmin(request, env) {
  const expectedToken = env.ADMIN_TOKEN;
  if (typeof expectedToken !== 'string' || !expectedToken.trim()) {
    console.error('[security] ADMIN_TOKEN is not configured.');
    throw new ApiError(500, 'Autentikasi admin tidak tersedia.');
  }

  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match) return false;

  const [actualDigest, expectedDigest] = await Promise.all([
    digest(match[1]),
    digest(expectedToken),
  ]);
  let difference = 0;
  for (let index = 0; index < actualDigest.length; index += 1) {
    difference |= actualDigest[index] ^ expectedDigest[index];
  }

  return difference === 0;
}

export async function checkRateLimit(
  env,
  scope,
  clientIp,
  max,
  windowSeconds,
  now = Date.now()
) {
  const secret = env.RATE_LIMIT_SECRET;
  if (typeof secret !== 'string' || !secret.trim()) {
    console.error('[security] RATE_LIMIT_SECRET is not configured.');
    throw new ApiError(500, 'Pembatasan laju tidak tersedia.');
  }
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new TypeError('Rate-limit max and windowSeconds must be positive integers.');
  }
  if (typeof clientIp !== 'string' || !clientIp.trim()) {
    throw new ApiError(400, 'Informasi jaringan permintaan tidak tersedia.');
  }

  const nowSeconds = Math.floor(now / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;

  try {
    const ipHash = await hmac(secret, clientIp);
    const result = await env.DB.prepare(
      `INSERT INTO rate_limit_buckets (scope, ip_hash, window_start, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(scope, ip_hash, window_start)
       DO UPDATE SET count = rate_limit_buckets.count + 1
       RETURNING count`
    )
      .bind(scope, ipHash, windowStart)
      .first();

    if (!result) throw new Error('Rate-limit counter did not return a value.');
    return {
      allowed: Number(result.count) <= max,
      retryAfter: Math.max(0, windowStart + windowSeconds - nowSeconds),
    };
  } catch (error) {
    console.error('[security] rate-limit storage failed:', error?.name || 'Error');
    throw new ApiError(500, 'Pembatasan laju tidak tersedia.');
  }
}

export async function verifyCaptcha(token, request, env) {
  const provider = String(env.CAPTCHA_PROVIDER || 'none').toLowerCase();
  if (provider === 'none') return { success: true, provider };

  const endpoint = CAPTCHA_ENDPOINTS[provider];
  if (!endpoint) {
    console.error('[captcha] CAPTCHA_PROVIDER is not supported.');
    throw new ApiError(500, 'Verifikasi anti-spam belum dikonfigurasi.');
  }

  const secret = env.CAPTCHA_SECRET_KEY;
  if (typeof secret !== 'string' || !secret.trim()) {
    console.error('[captcha] CAPTCHA_SECRET_KEY is not configured.');
    throw new ApiError(500, 'Verifikasi anti-spam belum dikonfigurasi.');
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new ApiError(400, 'Verifikasi anti-spam belum selesai.', {
      captchaToken: 'Selesaikan verifikasi terlebih dahulu.',
    });
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: request.headers.get('CF-Connecting-IP') || '',
  });
  let result;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('CAPTCHA provider returned an error status.');
    result = await response.json();
  } catch (error) {
    console.warn('[captcha] provider verification failed:', error?.name || 'Error');
    if (String(env.CAPTCHA_FAIL_OPEN).toLowerCase() === 'true') {
      return { success: true, provider, failOpen: true };
    }
    throw new ApiError(503, 'Verifikasi anti-spam sementara tidak tersedia. Coba lagi nanti.');
  }

  if (result?.success !== true) {
    throw new ApiError(400, 'Verifikasi anti-spam gagal.', {
      captchaToken: 'Verifikasi kedaluwarsa. Silakan ulangi.',
    });
  }

  if (provider === 'recaptcha3') {
    const minimum = Number(env.CAPTCHA_MIN_SCORE ?? 0.5);
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) {
      console.error('[captcha] CAPTCHA_MIN_SCORE is invalid.');
      throw new ApiError(500, 'Verifikasi anti-spam belum dikonfigurasi.');
    }
    if (typeof result.score !== 'number' || result.score < minimum) {
      throw new ApiError(400, 'Permintaan terdeteksi sebagai otomatis.', {
        captchaToken: 'Verifikasi gagal. Coba lagi.',
      });
    }
  }

  return { success: true, provider, score: result.score };
}
