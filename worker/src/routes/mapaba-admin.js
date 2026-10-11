import {
  countRegistrations,
  getAdminRegistration,
  getMapabaAdminSummary,
  isMapabaUploadAttached,
  listRegistrations,
  updateRegistration,
} from '../lib/db.js';
import { authenticateAdmin } from '../lib/security.js';
import { streamPrivateImage } from '../lib/cloudinary.js';
import { notifyMapabaStatus } from '../lib/notifications.js';
import { ApiError, jsonResponse } from '../lib/http.js';
import { validateAdminQuery, validateStatusChange } from '../lib/validation.js';

const ADMIN_PATH = '/api/v1/mapaba/admin';

function workerFileUrl(id) {
  return id ? `${ADMIN_PATH}/files/${encodeURIComponent(id)}` : '';
}

function registrationPayload(registration) {
  const { pasFotoId, ktmId, catatanAdmin, createdAt, ...details } = registration;
  return {
    ...details,
    pasFotoUrl: workerFileUrl(pasFotoId),
    ktmUrl: workerFileUrl(ktmId),
    catatanPanitia: catatanAdmin,
    dibuatPada: createdAt,
  };
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'Body permintaan harus berupa JSON yang valid.');
  }
}

async function handleList(request, env) {
  const parsed = validateAdminQuery(new URL(request.url).searchParams);
  if (!parsed.success) {
    throw new ApiError(400, 'Parameter daftar pendaftar tidak valid.', parsed.errors);
  }

  const { page, limit, ...filters } = parsed.data;
  const offset = (page - 1) * limit;
  const [total, registrations] = await Promise.all([
    countRegistrations(env.DB, filters),
    listRegistrations(env.DB, { ...filters, limit, offset }),
  ]);

  return jsonResponse(
    registrations.map(registrationPayload),
    200,
    { page, limit, total, totalPage: Math.ceil(total / limit) }
  );
}

async function handleStatusUpdate(request, env, ctx, id) {
  const parsed = validateStatusChange(await requestJson(request));
  if (!parsed.success) {
    throw new ApiError(400, 'Perubahan status tidak valid.', parsed.errors);
  }

  const result = await updateRegistration(env.DB, id, parsed.data, 'worker-admin');
  if (!result.changes) throw new ApiError(404, 'Pendaftar tidak ditemukan.');

  const registration = await getAdminRegistration(env.DB, id);
  if (
    parsed.data.status &&
    result.previousStatus !== parsed.data.status &&
    (parsed.data.status === 'terverifikasi' || parsed.data.status === 'ditolak')
  ) {
    notifyMapabaStatus(
      ctx,
      env,
      registration,
      parsed.data.status,
      parsed.data.catatanAdmin
    );
  }

  return jsonResponse({ message: 'Data pendaftar berhasil diperbarui.' });
}

export async function handleMapabaAdmin(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== ADMIN_PATH && !url.pathname.startsWith(`${ADMIN_PATH}/`)) return null;

  if (!(await authenticateAdmin(request, env))) {
    throw new ApiError(401, 'Token admin tidak valid.');
  }

  if (request.method === 'GET' && url.pathname === `${ADMIN_PATH}/ringkasan`) {
    return jsonResponse(await getMapabaAdminSummary(env.DB));
  }
  if (request.method === 'GET' && url.pathname === `${ADMIN_PATH}/pendaftar`) {
    return handleList(request, env);
  }

  const registrationMatch = new RegExp(`^${ADMIN_PATH}/pendaftar/(\\d+)$`).exec(url.pathname);
  if (request.method === 'PATCH' && registrationMatch) {
    const id = Number(registrationMatch[1]);
    if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(404, 'Pendaftar tidak ditemukan.');
    return handleStatusUpdate(request, env, ctx, id);
  }

  const fileMatch = new RegExp(`^${ADMIN_PATH}/files/([A-Fa-f0-9-]{36})$`).exec(
    url.pathname
  );
  if (request.method === 'GET' && fileMatch) {
    const uploadId = fileMatch[1];
    if (!(await isMapabaUploadAttached(env.DB, uploadId))) {
      throw new ApiError(404, 'Berkas tidak ditemukan.');
    }
    return streamPrivateImage(env, uploadId);
  }

  throw new ApiError(404, `Endpoint ${request.method} ${url.pathname} tidak ditemukan.`);
}
