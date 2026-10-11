import { ApiError, errorResponse, jsonResponse } from '../lib/http.js';
import { checkRateLimit } from '../lib/security.js';
import { uploadPrivateImage } from '../lib/cloudinary.js';

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 32 * 1024;

function uploadError(message, status = 400, errors) {
  return errorResponse(status, message, errors);
}

export async function handleUpload(request, env) {
  const rateLimit = await checkRateLimit(
    env,
    'mapaba-upload',
    request.headers.get('CF-Connecting-IP'),
    20,
    15 * 60
  );
  if (!rateLimit.allowed) {
    const response = uploadError('Terlalu banyak unggahan dari jaringan ini. Coba lagi nanti.', 429);
    response.headers.set('Retry-After', String(rateLimit.retryAfter));
    return response;
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return uploadError('Ukuran permintaan tidak valid.');
    }
    if (length > MAX_REQUEST_SIZE) {
      return uploadError('Ukuran berkas melebihi batas 3 MB.', 413, {
        file: 'Maksimal 3 MB.',
      });
    }
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return uploadError('Form unggahan tidak valid.', 400, {
      file: 'Kirim satu berkas pada field file.',
    });
  }

  const entries = [...form.entries()];
  const files = form.getAll('file');
  if (
    entries.length !== 1 ||
    entries[0][0] !== 'file' ||
    files.length !== 1 ||
    !(files[0] instanceof File)
  ) {
    return uploadError('Form unggahan harus berisi satu berkas pada field file.', 400, {
      file: 'Kirim satu berkas pada field file.',
    });
  }

  try {
    const uploaded = await uploadPrivateImage(env, files[0]);
    return jsonResponse({
      url: uploaded.url,
      kunci: uploaded.key,
      ukuranByte: uploaded.sizeBytes,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.message, error.errors);
    }
    throw error;
  }
}
