import { ApiError } from './http.js';
import { createUpload, getUpload } from './db.js';

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const IMAGE_FORMATS = {
  'image/jpeg': { format: 'jpg', extension: 'jpg' },
  'image/png': { format: 'png', extension: 'png' },
  'image/webp': { format: 'webp', extension: 'webp' },
};
const MIME_BY_FORMAT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function uploadError(status, message, errors) {
  return new ApiError(status, message, errors);
}

async function validImageFormat(file) {
  if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') {
    throw uploadError(400, 'Tidak ada berkas gambar yang dikirim.', {
      file: 'Pilih berkas JPG, PNG, atau WebP.',
    });
  }
  if (file.size <= 0) {
    throw uploadError(400, 'Berkas gambar kosong.', { file: 'Pilih berkas gambar yang valid.' });
  }
  if (file.size > MAX_FILE_SIZE) {
    throw uploadError(400, 'Ukuran berkas melebihi batas 3 MB.', { file: 'Maksimal 3 MB.' });
  }

  const image = IMAGE_FORMATS[file.type];
  if (!image) {
    throw uploadError(400, 'Format berkas harus JPG, PNG, atau WebP.', {
      file: 'Format berkas tidak diizinkan.',
    });
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches =
    (file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (file.type === 'image/png' &&
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a) ||
    (file.type === 'image/webp' &&
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');

  if (!matches) {
    throw uploadError(400, 'Isi berkas tidak cocok dengan formatnya.', {
      file: 'Berkas rusak atau bukan gambar yang sah.',
    });
  }

  return image;
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toUrlSafeBase64(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha1(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  );
}

export async function signDeliveryPath(path, secret) {
  const digest = await sha1(`${path}${secret}`);
  return toUrlSafeBase64(digest).slice(0, 8);
}

async function signUploadParams(params, secret) {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return toHex(await sha1(`${serialized}${secret}`));
}

function cloudinaryCredentials(env, { requireApiKey = false } = {}) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (
    typeof cloudName !== 'string' ||
    !cloudName.trim() ||
    (requireApiKey && (typeof apiKey !== 'string' || !apiKey.trim())) ||
    typeof apiSecret !== 'string' ||
    !apiSecret.trim()
  ) {
    console.error('[cloudinary] required credentials are not configured.');
    throw uploadError(500, 'Penyimpanan berkas tidak tersedia.');
  }
  return { cloudName, apiKey, apiSecret };
}

export async function uploadPrivateImage(env, file) {
  const image = await validImageFormat(file);
  if (!env.DB) throw uploadError(500, 'Penyimpanan berkas tidak tersedia.');

  const { cloudName, apiKey, apiSecret } = cloudinaryCredentials(env, {
    requireApiKey: true,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const internalId = crypto.randomUUID();
  const cloudinaryPublicId = `mapaba_${crypto.randomUUID()}`;
  const params = {
    public_id: cloudinaryPublicId,
    timestamp,
    type: 'authenticated',
  };
  const signature = await signUploadParams(params, apiSecret);
  const form = new FormData();
  form.set('file', file.slice(0, file.size, file.type), `image.${image.extension}`);
  form.set('api_key', apiKey);
  form.set('public_id', cloudinaryPublicId);
  form.set('timestamp', String(timestamp));
  form.set('type', 'authenticated');
  form.set('signature', signature);

  let response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      { method: 'POST', body: form }
    );
  } catch (error) {
    console.error('[cloudinary] upload request failed:', error?.name || 'Error');
    throw uploadError(502, 'Unggahan berkas ke penyimpanan gagal.');
  }

  if (!response.ok) {
    console.error('[cloudinary] upload provider rejected request:', response.status);
    throw uploadError(502, 'Unggahan berkas ke penyimpanan gagal.');
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error('[cloudinary] upload response was invalid:', error?.name || 'Error');
    throw uploadError(502, 'Respons penyimpanan berkas tidak valid.');
  }

  if (result?.public_id !== cloudinaryPublicId || result?.format !== image.format) {
    console.error('[cloudinary] upload response metadata did not match request.');
    throw uploadError(502, 'Respons penyimpanan berkas tidak valid.');
  }

  await createUpload(env.DB, {
    id: internalId,
    cloudinaryPublicId,
    format: image.format,
    mime: file.type,
    sizeBytes: file.size,
  });

  return {
    id: internalId,
    url: `/api/v1/mapaba/admin/files/${internalId}`,
    key: internalId,
    sizeBytes: file.size,
  };
}

export async function streamPrivateImage(env, uploadId) {
  if (!env.DB) throw uploadError(500, 'Penyimpanan berkas tidak tersedia.');
  const upload = await getUpload(env.DB, uploadId);
  if (!upload) throw uploadError(404, 'Berkas tidak ditemukan.');
  if (MIME_BY_FORMAT[upload.format] !== upload.mime) {
    throw uploadError(500, 'Metadata berkas tidak valid.');
  }

  const { cloudName, apiSecret } = cloudinaryCredentials(env);
  const path = `${upload.cloudinaryPublicId}.${upload.format}`;
  const signature = await signDeliveryPath(path, apiSecret);
  const url =
    `https://res.cloudinary.com/${encodeURIComponent(cloudName)}` +
    `/image/authenticated/s--${signature}--/${path}`;

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error('[cloudinary] private image request failed:', error?.name || 'Error');
    throw uploadError(502, 'Berkas tidak dapat diambil dari penyimpanan.');
  }
  if (!response.ok) {
    console.error('[cloudinary] private image provider rejected request:', response.status);
    throw uploadError(502, 'Berkas tidak dapat diambil dari penyimpanan.');
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': upload.mime,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
