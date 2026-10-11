import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorResponse } from '../src/lib/http.js';
import {
  authenticateAdmin,
  checkRateLimit,
  verifyCaptcha,
} from '../src/lib/security.js';
import {
  validateAdminQuery,
  validateRegistration,
  validateStatusChange,
} from '../src/lib/validation.js';

const validRegistration = {
  namaLengkap: 'Siti Aisyah',
  nim: '1234567890',
  angkatan: new Date().getFullYear(),
  fakultas: 'Sains dan Teknologi',
  prodi: 'Informatika',
  jenisKelamin: 'P',
  whatsapp: '081234567890',
  email: 'siti@example.test',
  motivasi: 'Ingin belajar berorganisasi dan memperluas jaringan kader.',
  kesediaan: true,
  persetujuanData: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MAPABA validation', () => {
  it('rejects a non-digit or too-short NIM', () => {
    const result = validateRegistration({ ...validRegistration, nim: '123abc' });

    expect(result.success).toBe(false);
    expect(result.errors.nim).toBeTruthy();
  });

  it('rejects an invalid email and motivation that is too short', () => {
    const result = validateRegistration({
      ...validRegistration,
      email: 'not-an-email',
      motivasi: 'Pendek',
    });

    expect(result.success).toBe(false);
    expect(result.errors.email).toBeTruthy();
    expect(result.errors.motivasi).toBeTruthy();
  });

  it('requires data consent and Worker-owned file references', () => {
    const result = validateRegistration({
      ...validRegistration,
      persetujuanData: false,
      pasFotoUrl: 'https://cloudinary.example/private/image.jpg',
    });

    expect(result.success).toBe(false);
    expect(result.errors.persetujuanData).toBeTruthy();
    expect(result.errors.pasFotoUrl).toBeTruthy();
  });

  it('applies the university default and accepts only the Worker file route', () => {
    const result = validateRegistration({
      ...validRegistration,
      pasFotoUrl: '/api/v1/mapaba/admin/files/12345678-1234-4234-8234-123456789abc',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        universitas: 'UIN Sunan Gunung Djati Bandung',
        pasFotoUrl: '/api/v1/mapaba/admin/files/12345678-1234-4234-8234-123456789abc',
      },
    });
  });

  it('validates admin filters and rejects unsupported status changes', () => {
    expect(validateAdminQuery(new URLSearchParams('page=2&limit=25&status=menunggu'))).toMatchObject({
      success: true,
      data: { page: 2, limit: 25, status: 'menunggu' },
    });
    expect(validateAdminQuery({ limit: '201' }).success).toBe(false);
    expect(validateStatusChange({ status: 'invalid' }).success).toBe(false);
    expect(
      validateStatusChange({ status: 'terverifikasi', catatanPanitia: 'Dokumen lengkap.' })
    ).toMatchObject({
      success: true,
      data: { status: 'terverifikasi', catatanAdmin: 'Dokumen lengkap.' },
    });
  });
});

describe('Worker security helpers', () => {
  it('authenticates only a configured Bearer token', async () => {
    const envWithSecret = { ADMIN_TOKEN: 'private-admin-token' };
    const valid = new Request('https://worker.example/admin', {
      headers: { Authorization: 'Bearer private-admin-token' },
    });
    const wrong = new Request('https://worker.example/admin', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const missing = new Request('https://worker.example/admin');

    await expect(authenticateAdmin(valid, envWithSecret)).resolves.toBe(true);
    await expect(authenticateAdmin(wrong, envWithSecret)).resolves.toBe(false);
    await expect(authenticateAdmin(missing, envWithSecret)).resolves.toBe(false);
  });

  it('reports missing admin configuration as an internal error', async () => {
    await expect(authenticateAdmin(new Request('https://worker.example'), {})).rejects.toMatchObject({
      status: 500,
    });
  });

  it('counts requests atomically within a window and resets at the next window', async () => {
    const scope = `registration-${Date.now()}`;
    const clientIp = '203.0.113.7';
    const rateEnv = { DB: env.DB, RATE_LIMIT_SECRET: 'test-rate-secret' };

    await expect(checkRateLimit(rateEnv, scope, clientIp, 2, 60, 120_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkRateLimit(rateEnv, scope, clientIp, 2, 60, 120_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkRateLimit(rateEnv, scope, clientIp, 2, 60, 120_000)).resolves.toMatchObject({
      allowed: false,
      retryAfter: 60,
    });
    await expect(checkRateLimit(rateEnv, scope, clientIp, 2, 60, 180_000)).resolves.toMatchObject({
      allowed: true,
    });

    const buckets = await env.DB.prepare(
      'SELECT ip_hash FROM rate_limit_buckets WHERE scope = ? ORDER BY window_start'
    )
      .bind(scope)
      .all();
    expect(buckets.results).toHaveLength(2);
    expect(buckets.results.every(({ ip_hash }) => ip_hash !== clientIp)).toBe(true);
  });

  it('does not allow concurrent requests to exceed the configured rate limit', async () => {
    const rateEnv = { DB: env.DB, RATE_LIMIT_SECRET: 'test-rate-secret' };
    const scope = `concurrent-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkRateLimit(rateEnv, scope, '203.0.113.9', 2, 60, 240_000)
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.filter((result) => !result.allowed)).toHaveLength(6);
  });

  it('fails closed when rate-limit configuration is missing or D1 is unavailable', async () => {
    await expect(checkRateLimit({ DB: env.DB }, 'scope', '203.0.113.8', 1, 60)).rejects.toMatchObject({
      status: 500,
    });
    await expect(
      checkRateLimit(
        { DB: null, RATE_LIMIT_SECRET: 'test-rate-secret' },
        'scope',
        '203.0.113.8',
        1,
        60
      )
    ).rejects.toMatchObject({ status: 500 });
  });

  it('skips provider calls only when CAPTCHA provider is none', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verifyCaptcha('', new Request('https://worker.example'), { CAPTCHA_PROVIDER: 'none' }))
      .resolves.toMatchObject({ success: true, provider: 'none' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an active CAPTCHA provider without a secret', async () => {
    await expect(
      verifyCaptcha('captcha-token', new Request('https://worker.example'), {
        CAPTCHA_PROVIDER: 'turnstile',
      })
    ).rejects.toMatchObject({ status: 500 });
  });

  it('rejects an invalid provider token without exposing provider secrets', async () => {
    const token = 'captcha-token-that-must-not-leak';
    const secret = 'captcha-secret-that-must-not-leak';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    );

    let error;
    try {
      await verifyCaptcha(token, new Request('https://worker.example'), {
        CAPTCHA_PROVIDER: 'turnstile',
        CAPTCHA_SECRET_KEY: secret,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400 });
    const response = await errorResponse(error.status, error.message, error.errors).json();
    expect(JSON.stringify(response)).not.toContain(token);
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  it('enforces the configured reCAPTCHA v3 minimum score', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, score: 0.2 }), { status: 200 }))
    );

    await expect(
      verifyCaptcha('token', new Request('https://worker.example'), {
        CAPTCHA_PROVIDER: 'recaptcha3',
        CAPTCHA_SECRET_KEY: 'test-secret',
        CAPTCHA_MIN_SCORE: '0.5',
      })
    ).rejects.toMatchObject({ status: 400, errors: { captchaToken: expect.any(String) } });
  });

  it('uses the configured fail-open policy only for provider network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('provider unavailable');
    }));
    const request = new Request('https://worker.example');

    await expect(
      verifyCaptcha('token', request, {
        CAPTCHA_PROVIDER: 'turnstile',
        CAPTCHA_SECRET_KEY: 'test-secret',
        CAPTCHA_FAIL_OPEN: 'true',
      })
    ).resolves.toMatchObject({ success: true, failOpen: true });
    await expect(
      verifyCaptcha('token', request, {
        CAPTCHA_PROVIDER: 'turnstile',
        CAPTCHA_SECRET_KEY: 'test-secret',
        CAPTCHA_FAIL_OPEN: 'false',
      })
    ).rejects.toMatchObject({ status: 503 });
  });
});
