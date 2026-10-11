import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

const ADMIN_TOKEN = 'test-mapaba-admin-token';

function testEnv(overrides = {}) {
  return { DB: env.DB, ADMIN_TOKEN, ...overrides };
}

function adminRequest(path, { method = 'GET', token = ADMIN_TOKEN, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://worker.example/api/v1/mapaba/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

async function callAdmin(request, workerEnv = testEnv()) {
  const context = waitUntilContext();
  const response = await worker.fetch(request, workerEnv, context);
  await Promise.all(context.pending);
  return response;
}

let fixtureNumber = 0;

async function insertRegistration({ status = 'menunggu', name, waveId } = {}) {
  const unique = `${Date.now()}-${++fixtureNumber}`;
  if (waveId === undefined) {
    const wave = await env.DB.prepare(
      `INSERT INTO mapaba_gelombang
         (nama, tahun, buka_at, tutup_at, lokasi, kuota, biaya, is_aktif)
       VALUES (?, 2099, '2025-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 'Sekretariat', 5, 0, 1)`
    )
      .bind(`Gelombang admin ${unique}`)
      .run();
    waveId = wave.meta.last_row_id;
  }
  const number = `MPB-2099-${String(fixtureNumber).padStart(4, '0')}`;
  const result = await env.DB.prepare(
    `INSERT INTO mapaba_pendaftar
       (nomor_registrasi, gelombang_id, nama_lengkap, nim, angkatan, universitas,
        fakultas, prodi, jenis_kelamin, whatsapp, email, motivasi, kesediaan,
        persetujuan_data, status)
     VALUES (?, ?, ?, ?, 2099, 'UIN Sunan Gunung Djati Bandung', 'Sains dan Teknologi',
             'Informatika', 'P', '08123456789', ?, 'Motivasi fixture yang cukup panjang.',
             1, 1, ?)`
  )
    .bind(number, waveId, name || `Peserta ${unique}`, String(Date.now() + fixtureNumber), `admin-${unique}@example.test`, status)
    .run();
  return { id: result.meta.last_row_id, waveId, number };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MAPABA admin endpoints', () => {
  it('rejects unauthenticated summary, list, status, and file requests before provider access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const requests = [
      adminRequest('/ringkasan', { token: null }),
      adminRequest('/pendaftar', { token: 'wrong-token' }),
      adminRequest('/pendaftar/1', { method: 'PATCH', token: null, body: { status: 'ditolak' } }),
      adminRequest(`/files/${crypto.randomUUID()}`, { token: 'wrong-token' }),
    ];

    const responses = await Promise.all(requests.map((request) => callAdmin(request)));

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns MAPABA summary counts and remaining quota from D1', async () => {
    const waiting = await insertRegistration();
    await insertRegistration({ status: 'terverifikasi', waveId: waiting.waveId });
    await insertRegistration({ status: 'batal', waveId: waiting.waveId });
    const countBefore = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'menunggu' THEN 1 ELSE 0 END) AS menunggu,
              SUM(CASE WHEN status = 'terverifikasi' THEN 1 ELSE 0 END) AS terverifikasi
       FROM mapaba_pendaftar`
    ).first();

    const response = await callAdmin(adminRequest('/ringkasan'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        total: Number(countBefore.total),
        menunggu: Number(countBefore.menunggu),
        terverifikasi: Number(countBefore.terverifikasi),
        sisaKuota: 3,
      },
    });
    expect(waiting.waveId).toBeTruthy();
  });

  it('filters the admin list and returns bounded pagination with private file proxy references', async () => {
    const match = await insertRegistration({ name: 'Nama Target Admin' });
    await insertRegistration({ name: 'Nama Lain Admin', status: 'ditolak' });

    const response = await callAdmin(
      adminRequest(`/pendaftar?gelombangId=${match.waveId}&status=menunggu&q=Target&page=1&limit=1`)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      meta: { page: 1, limit: 1, total: 1, totalPage: 1 },
    });
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: match.id,
      nomorRegistrasi: match.number,
      namaLengkap: 'Nama Target Admin',
      status: 'menunggu',
      pasFotoUrl: '',
      ktmUrl: '',
      catatanPanitia: null,
    });
    expect(JSON.stringify(payload)).not.toContain('cloudinary');
  });

  it('updates the status, note, and audit record, and notifies only changed decision statuses', async () => {
    const registration = await insertRegistration();
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const notificationEnv = testEnv({
      RESEND_API_KEY: 'test-resend-key',
      MAIL_FROM: 'mapaba@example.test',
      WA_API_URL: 'https://wa.example.test/send',
      WA_API_TOKEN: 'test-wa-token',
    });

    const accepted = await callAdmin(
      adminRequest(`/pendaftar/${registration.id}`, {
        method: 'PATCH',
        body: { status: 'terverifikasi', catatanPanitia: 'Dokumen lengkap.' },
      }),
      notificationEnv
    );
    expect(accepted.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await callAdmin(
      adminRequest(`/pendaftar/${registration.id}`, {
        method: 'PATCH',
        body: { status: 'terverifikasi' },
      }),
      notificationEnv
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await callAdmin(
      adminRequest(`/pendaftar/${registration.id}`, {
        method: 'PATCH',
        body: { status: 'hadir' },
      }),
      notificationEnv
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await callAdmin(
      adminRequest(`/pendaftar/${registration.id}`, {
        method: 'PATCH',
        body: { status: 'ditolak' },
      }),
      notificationEnv
    );
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const row = await env.DB.prepare(
      'SELECT status, catatan_admin AS note FROM mapaba_pendaftar WHERE id = ?'
    )
      .bind(registration.id)
      .first();
    const audit = await env.DB.prepare(
      `SELECT actor, action, entity, entity_id, metadata
       FROM audit_log WHERE entity_id = ? ORDER BY id DESC LIMIT 1`
    )
      .bind(String(registration.id))
      .first();

    expect(row).toEqual({ status: 'ditolak', note: 'Dokumen lengkap.' });
    expect(audit).toMatchObject({
      actor: 'worker-admin',
      action: 'mapaba.registration.update',
      entity: 'mapaba_pendaftar',
      entity_id: String(registration.id),
    });
  });

  it('rejects invalid status input and returns 404 for an unknown registration', async () => {
    const invalid = await callAdmin(
      adminRequest('/pendaftar/1', { method: 'PATCH', body: { status: 'invalid' } })
    );
    const missing = await callAdmin(
      adminRequest('/pendaftar/999999999', { method: 'PATCH', body: { status: 'ditolak' } })
    );

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it('rejects invalid list filters and notes longer than 1000 characters', async () => {
    const query = await callAdmin(adminRequest('/pendaftar?page=0&limit=201'));
    const note = await callAdmin(
      adminRequest('/pendaftar/1', {
        method: 'PATCH',
        body: { catatanPanitia: 'x'.repeat(1001) },
      })
    );

    expect(query.status).toBe(400);
    expect(note.status).toBe(400);
  });

  it('streams only an associated upload after admin authentication', async () => {
    const registration = await insertRegistration();
    const uploadId = crypto.randomUUID();
    const publicId = `mapaba_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, 'jpg', 'image/jpeg', 3)`
    )
      .bind(uploadId, publicId)
      .run();
    await env.DB.prepare('UPDATE mapaba_pendaftar SET pas_foto_id = ? WHERE id = ?')
      .bind(uploadId, registration.id)
      .run();
    let providerUrl;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        providerUrl = String(url);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
      })
    );

    const response = await callAdmin(
      adminRequest(`/files/${uploadId}`),
      testEnv({
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(providerUrl).toContain(publicId);
    expect(providerUrl).not.toContain('test-cloudinary-secret');
  });

  it('returns 404 for uploads that are not attached to a MAPABA registration', async () => {
    const uploadId = crypto.randomUUID();
    const fetchSpy = vi.fn();
    await env.DB.prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, 'jpg', 'image/jpeg', 3)`
    )
      .bind(uploadId, `mapaba_${crypto.randomUUID()}`)
      .run();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await callAdmin(
      adminRequest(`/files/${uploadId}`),
      testEnv({
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
      })
    );

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
