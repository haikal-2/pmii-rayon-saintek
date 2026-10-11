import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

let fixtureNumber = 0;

function testEnv(overrides = {}) {
  return {
    DB: env.DB,
    RATE_LIMIT_SECRET: 'test-rate-limit-secret',
    CAPTCHA_PROVIDER: 'none',
    ...overrides,
  };
}

async function insertWave({ opensAt, closesAt, quota = 5, fee = 75000 } = {}) {
  await env.DB.prepare('UPDATE mapaba_gelombang SET is_aktif = 0').run();
  const now = Date.now();
  const wave = {
    year: new Date(now).getFullYear(),
    opensAt: opensAt || new Date(now - 60_000).toISOString(),
    closesAt: closesAt || new Date(now + 60 * 60_000).toISOString(),
    quota,
    fee,
  };
  const result = await env.DB.prepare(
    `INSERT INTO mapaba_gelombang
       (nama, tahun, buka_at, tutup_at, mulai_acara, selesai_acara, lokasi, kuota, biaya, is_aktif)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      `MAPABA Test ${++fixtureNumber}`,
      wave.year,
      wave.opensAt,
      wave.closesAt,
      new Date(now + 2 * 60 * 60_000).toISOString(),
      new Date(now + 4 * 60 * 60_000).toISOString(),
      'Sekretariat PR PMII Saintek',
      wave.quota,
      wave.fee
    )
    .run();

  return { id: result.meta.last_row_id, ...wave };
}

function registration(overrides = {}) {
  const number = Date.now() + ++fixtureNumber;
  return {
    namaLengkap: 'Siti Aisyah',
    nim: String(number),
    angkatan: new Date().getFullYear(),
    fakultas: 'Sains dan Teknologi',
    prodi: 'Informatika',
    jenisKelamin: 'P',
    whatsapp: '081234567890',
    email: `siti-${number}@example.test`,
    motivasi: 'Ingin belajar berorganisasi dan memperluas jaringan kader.',
    kesediaan: true,
    persetujuanData: true,
    ...overrides,
  };
}

function registrationRequest(body, ip = '192.0.2.10') {
  return new Request('https://worker.example/api/v1/mapaba/pendaftaran', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

function trackingRequest(number) {
  return new Request(
    `https://worker.example/api/v1/mapaba/pendaftaran/${encodeURIComponent(number)}`
  );
}

function waitUntilContext() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

async function callWorker(request, workerEnv = testEnv()) {
  const context = waitUntilContext();
  const response = await worker.fetch(request, workerEnv, context);
  await Promise.all(context.pending);
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public MAPABA endpoints', () => {
  it('returns the active wave details and available quota', async () => {
    const wave = await insertWave({ quota: 4, fee: 50000 });
    const response = await worker.fetch(
      new Request('https://worker.example/api/v1/mapaba/gelombang-aktif'),
      testEnv()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: wave.id,
        nama: expect.stringContaining('MAPABA Test'),
        tahun: wave.year,
        bukaAt: wave.opensAt,
        tutupAt: wave.closesAt,
        mulaiAcara: expect.any(String),
        selesaiAcara: expect.any(String),
        lokasi: 'Sekretariat PR PMII Saintek',
        kuota: 4,
        terpakai: 0,
        sisaKuota: 4,
        biaya: 50000,
        sedangDibuka: true,
      },
    });
  });

  it('returns 404 when no active wave exists and rejects registration', async () => {
    await env.DB.prepare('UPDATE mapaba_gelombang SET is_aktif = 0').run();
    const getResponse = await worker.fetch(
      new Request('https://worker.example/api/v1/mapaba/gelombang-aktif'),
      testEnv()
    );
    const postResponse = await callWorker(registrationRequest(registration()));

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(400);
  });

  it('creates a registration with the established response and a private tracking projection', async () => {
    const wave = await insertWave({ fee: 65000 });
    const payload = registration();
    const response = await callWorker(registrationRequest(payload));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result).toMatchObject({
      ok: true,
      data: {
        nomorRegistrasi: new RegExp(`^MPB-${wave.year}-\\d{4}$`),
        status: 'menunggu',
        biaya: 65000,
        pesan: expect.any(String),
      },
    });

    const tracking = await worker.fetch(trackingRequest(result.data.nomorRegistrasi), testEnv());
    const publicData = (await tracking.json()).data;
    expect(tracking.status).toBe(200);
    expect(publicData).toMatchObject({
      nomorRegistrasi: result.data.nomorRegistrasi,
      namaLengkap: payload.namaLengkap,
      status: 'menunggu',
    });
    for (const field of ['nim', 'email', 'whatsapp', 'motivasi', 'pasFotoId', 'ktmId']) {
      expect(publicData).not.toHaveProperty(field);
    }
  });

  it('rejects registration before the opening time and after the closing time', async () => {
    const now = Date.now();
    await insertWave({
      opensAt: new Date(now + 60 * 60_000).toISOString(),
      closesAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    });
    const beforeOpen = await callWorker(registrationRequest(registration()));

    await insertWave({
      opensAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      closesAt: new Date(now - 60 * 60_000).toISOString(),
    });
    const afterClose = await callWorker(registrationRequest(registration()));

    expect(beforeOpen.status).toBe(400);
    expect(afterClose.status).toBe(400);
  });

  it('returns a field error for duplicate NIM', async () => {
    await insertWave({ quota: 5 });
    const payload = registration();
    const first = await callWorker(registrationRequest(payload, '192.0.2.11'));
    const duplicate = await callWorker(registrationRequest(payload, '192.0.2.12'));
    const second = await callWorker(registrationRequest(registration(), '192.0.2.14'));
    const firstNumber = (await first.json()).data.nomorRegistrasi;
    const secondNumber = (await second.json()).data.nomorRegistrasi;

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(second.status).toBe(201);
    expect(Number(secondNumber.slice(-4))).toBe(Number(firstNumber.slice(-4)) + 1);
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: false,
      errors: { nim: expect.any(String) },
    });
  });

  it('enforces the registration limit of ten requests per IP each hour', async () => {
    await insertWave({ quota: 20 });
    const responses = [];
    for (let index = 0; index < 10; index += 1) {
      responses.push(
        await callWorker(registrationRequest(registration(), '192.0.2.40'))
      );
    }
    const limited = await callWorker(registrationRequest(registration(), '192.0.2.40'));

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('rejects external and unknown Worker file references', async () => {
    await insertWave({ quota: 5 });
    const external = await callWorker(
      registrationRequest(registration({ pasFotoUrl: 'https://cloudinary.example/photo.jpg' }))
    );
    const unknown = await callWorker(
      registrationRequest(
        registration({
          pasFotoUrl: `/api/v1/mapaba/admin/files/${crypto.randomUUID()}`,
        }),
        '192.0.2.13'
      )
    );

    expect(external.status).toBe(400);
    expect(unknown.status).toBe(400);
    await expect(external.json()).resolves.toMatchObject({
      errors: { pasFotoUrl: expect.any(String) },
    });
    await expect(unknown.json()).resolves.toMatchObject({
      errors: { pasFotoUrl: expect.any(String) },
    });
  });

  it('rejects an invalid CAPTCHA token', async () => {
    await insertWave({ quota: 5 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    );
    const response = await callWorker(
      registrationRequest(registration({ captchaToken: 'invalid-captcha' })),
      testEnv({
        CAPTCHA_PROVIDER: 'turnstile',
        CAPTCHA_SECRET_KEY: 'test-captcha-secret',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errors: { captchaToken: expect.any(String) },
    });
  });

  it('allows only one simultaneous registration for the last seat', async () => {
    await insertWave({ quota: 1 });
    const responses = await Promise.all([
      callWorker(registrationRequest(registration(), '192.0.2.21')),
      callWorker(registrationRequest(registration(), '192.0.2.22')),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM mapaba_pendaftar
       WHERE gelombang_id = (SELECT id FROM mapaba_gelombang WHERE is_aktif = 1)`
    ).all();
    expect(results[0].count).toBe(1);
  });

  it('allows only one registration to claim a shared upload', async () => {
    const wave = await insertWave({ quota: 5 });
    const uploadId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, 'jpg', 'image/jpeg', 8)`
    )
      .bind(uploadId, `mapaba_${uploadId}`)
      .run();
    const fileReference = `/api/v1/mapaba/admin/files/${uploadId}`;

    const responses = await Promise.all([
      callWorker(
        registrationRequest(registration({ pasFotoUrl: fileReference }), '192.0.2.31')
      ),
      callWorker(
        registrationRequest(registration({ pasFotoUrl: fileReference }), '192.0.2.32')
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    const claimed = await env.DB.prepare('SELECT claimed_at FROM mapaba_uploads WHERE id = ?')
      .bind(uploadId)
      .first();
    expect(claimed.claimed_at).toBeTruthy();
    const registrations = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM mapaba_pendaftar WHERE gelombang_id = ?'
    )
      .bind(wave.id)
      .first();
    expect(registrations.count).toBe(1);
  });

  it('does not fail registration when notification providers fail and logs safe labels', async () => {
    await insertWave({ quota: 5 });
    const providerToken = 'test-wa-provider-secret';
    const webhookUrl = 'https://sheets.example/private-webhook-token';
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        calls.push(String(url));
        if (String(url) === 'https://api.resend.com/emails') {
          return new Response('provider error containing private data', { status: 500 });
        }
        if (String(url) === webhookUrl) throw new Error(providerToken);
        return new Response('{}', { status: 200 });
      })
    );
    const response = await callWorker(registrationRequest(registration()), testEnv({
      RESEND_API_KEY: 'test-resend-secret',
      MAIL_FROM: 'MAPABA <test@example.test>',
      MAPABA_NOTIFY_EMAIL: 'committee@example.test',
      WA_API_URL: 'https://wa.example/send',
      WA_API_TOKEN: providerToken,
      GOOGLE_SHEETS_MAPABA_WEBHOOK_URL: webhookUrl,
    }));
    const notifications = await env.DB.prepare(
      `SELECT channel, destination, status, error FROM notification_log
       WHERE entity = 'mapaba_pendaftar' ORDER BY id DESC LIMIT 3`
    ).all();

    expect(response.status).toBe(201);
    expect(calls).toHaveLength(3);
    expect(notifications.results.map(({ status }) => status).sort()).toEqual([
      'gagal',
      'gagal',
      'terkirim',
    ]);
    const logText = JSON.stringify(notifications.results);
    expect(logText).not.toContain(webhookUrl);
    expect(logText).not.toContain(providerToken);
    expect(logText).not.toContain('test-resend-secret');
    expect(notifications.results.every(({ destination }) => !destination.includes('@'))).toBe(true);
  });
});
