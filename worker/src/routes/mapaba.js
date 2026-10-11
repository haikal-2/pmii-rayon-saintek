import {
  createRegistration,
  getActiveWave,
  getRegistrationByNumber,
  getUpload,
} from '../lib/db.js';
import { ApiError, errorResponse, jsonResponse } from '../lib/http.js';
import { notifyMapabaSubmission } from '../lib/notifications.js';
import { checkRateLimit, verifyCaptcha } from '../lib/security.js';
import { validateRegistration } from '../lib/validation.js';

function conflictResponse(message, errors) {
  return errorResponse(409, message, errors);
}

function registrationNumberError(number) {
  return conflictResponse('NIM ini sudah terdaftar pada gelombang ini.', {
    nim: `Sudah terdaftar dengan nomor registrasi ${number}.`,
  });
}

function tooManyResponse(retryAfter) {
  const response = errorResponse(
    429,
    'Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi nanti.'
  );
  response.headers.set('Retry-After', String(retryAfter));
  return response;
}

function openingError(wave, now) {
  const opensAt = Date.parse(wave.bukaAt);
  const closesAt = Date.parse(wave.tutupAt);
  if (now.getTime() < opensAt) return new ApiError(400, 'Pendaftaran belum dibuka.');
  if (now.getTime() > closesAt) return new ApiError(400, 'Pendaftaran sudah ditutup.');
  if (!wave.sedangDibuka) return new ApiError(400, 'Jadwal pendaftaran tidak valid.');
  return null;
}

async function failedRegistrationResponse(db, wave, data, now) {
  const duplicate = await db
    .prepare(
      `SELECT nomor_registrasi FROM mapaba_pendaftar
       WHERE gelombang_id = ? AND nim = ?`
    )
    .bind(wave.id, data.nim)
    .first();
  if (duplicate) return registrationNumberError(duplicate.nomor_registrasi);

  const activeWave = await getActiveWave(db, now);
  if (!activeWave || activeWave.id !== wave.id) {
    return errorResponse(409, 'Gelombang pendaftaran berubah. Silakan coba lagi.');
  }
  if (activeWave.sisaKuota <= 0) {
    return conflictResponse('Kuota peserta sudah terpenuhi.');
  }

  for (const [field, url] of [
    ['pasFotoUrl', data.pasFotoUrl],
    ['ktmUrl', data.ktmUrl],
  ]) {
    if (!url) continue;
    const upload = await getUpload(db, url.split('/').at(-1));
    if (!upload || upload.claimedAt) {
      return errorResponse(400, 'Referensi berkas tidak dapat digunakan.', {
        [field]: 'Unggah kembali berkas ini sebelum mendaftar.',
      });
    }
  }

  return conflictResponse('Pendaftaran tidak dapat diproses. Silakan coba lagi.');
}

async function submitRegistration(request, env, ctx) {
  const rateLimit = await checkRateLimit(
    env,
    'mapaba-registration',
    request.headers.get('CF-Connecting-IP'),
    10,
    60 * 60
  );
  if (!rateLimit.allowed) return tooManyResponse(rateLimit.retryAfter);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Body pendaftaran harus berupa JSON yang valid.');
  }

  await verifyCaptcha(body?.captchaToken, request, env);
  const parsed = validateRegistration(body);
  if (!parsed.success) {
    return errorResponse(400, 'Data yang dikirim belum lengkap atau tidak valid.', parsed.errors);
  }

  const data = parsed.data;
  const now = new Date();
  const wave = await getActiveWave(env.DB, now);
  if (!wave) return errorResponse(400, 'Pendaftaran MAPABA belum dibuka.');

  const timeError = openingError(wave, now);
  if (timeError) return errorResponse(timeError.status, timeError.message);
  if (wave.sisaKuota <= 0) return conflictResponse('Kuota peserta sudah terpenuhi.');

  try {
    const created = await createRegistration(env.DB, wave, data, now);
    if (!created) return failedRegistrationResponse(env.DB, wave, data, now);

    const notificationData = {
      id: created.id,
      nomorRegistrasi: created.nomorRegistrasi,
      ...data,
    };
    notifyMapabaSubmission(ctx, env, notificationData);

    return jsonResponse(
      {
        nomorRegistrasi: created.nomorRegistrasi,
        status: created.status,
        biaya: wave.biaya,
        pesan:
          'Pendaftaran diterima. Panitia akan menghubungi kamu melalui WhatsApp untuk verifikasi ' +
          'dan petunjuk teknis kegiatan.',
      },
      201
    );
  } catch (error) {
    const message = String(error?.message || '');
    if (
      message.includes('UNIQUE constraint failed: mapaba_pendaftar.gelombang_id, mapaba_pendaftar.nim')
    ) {
      const duplicate = await env.DB.prepare(
        `SELECT nomor_registrasi FROM mapaba_pendaftar
         WHERE gelombang_id = ? AND nim = ?`
      )
        .bind(wave.id, data.nim)
        .first();
      if (duplicate) return registrationNumberError(duplicate.nomor_registrasi);
    }
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.message, error.errors);
    }
    throw error;
  }
}

export async function handleMapabaPublic(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/v1/mapaba/gelombang-aktif') {
    const wave = await getActiveWave(env.DB);
    if (!wave) return errorResponse(404, 'Belum ada gelombang pendaftaran yang dibuka.');
    return jsonResponse(wave);
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/mapaba/pendaftaran') {
    return submitRegistration(request, env, ctx);
  }

  const match = /^\/api\/v1\/mapaba\/pendaftaran\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && match) {
    let number;
    try {
      number = decodeURIComponent(match[1]);
    } catch {
      return errorResponse(400, 'Nomor registrasi tidak valid.');
    }
    const registration = await getRegistrationByNumber(env.DB, number);
    if (!registration) return errorResponse(404, 'Nomor registrasi tidak ditemukan.');
    return jsonResponse(registration);
  }

  return null;
}
