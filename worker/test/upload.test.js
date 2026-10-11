import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { ApiError } from '../src/lib/http.js';
import {
  signDeliveryPath,
  streamPrivateImage,
  uploadPrivateImage,
} from '../src/lib/cloudinary.js';
import { handleUpload } from '../src/routes/upload.js';

const CLOUDINARY = {
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-api-key',
  CLOUDINARY_API_SECRET: 'test-api-secret',
};

function jpegFile(size = 8) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return new File([bytes], 'client-name.jpg', { type: 'image/jpeg' });
}

function testEnv(overrides = {}) {
  return {
    DB: env.DB,
    RATE_LIMIT_SECRET: 'test-rate-limit-secret',
    ...CLOUDINARY,
    ...overrides,
  };
}

function uploadRequest(file, extraEntries = []) {
  const form = new FormData();
  if (file) form.append('file', file);
  for (const [name, value] of extraEntries) form.append(name, value);
  return new Request('https://worker.example/api/v1/upload', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.20' },
    body: form,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('private Cloudinary image storage', () => {
  it('signs authenticated delivery paths using Cloudinary URL signature format', async () => {
    await expect(
      signDeliveryPath('c_fill,w_300,h_250/e_grayscale/sample-authenticated.png', 'abcd')
    ).resolves.toBe('iDy_JeBq');
  });

  it('uploads a validated JPEG as authenticated and returns only a Worker reference', async () => {
    let uploadForm;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        expect(String(url)).toContain('/image/upload');
        uploadForm = options.body;
        return new Response(
          JSON.stringify({
            public_id: uploadForm.get('public_id'),
            format: 'jpg',
            bytes: 8,
          }),
          { status: 200 }
        );
      })
    );

    const uploaded = await uploadPrivateImage(testEnv(), jpegFile());

    expect(uploadForm.get('type')).toBe('authenticated');
    expect(uploadForm.get('api_key')).toBe('test-api-key');
    expect(uploadForm.get('timestamp')).toMatch(/^\d+$/);
    expect(uploadForm.get('signature')).toMatch(/^[a-f0-9]{40}$/);
    expect(uploaded).toMatchObject({
      id: expect.any(String),
      key: expect.any(String),
      url: expect.stringMatching(/^\/api\/v1\/mapaba\/admin\/files\//),
      sizeBytes: 8,
    });
    expect(uploaded).not.toHaveProperty('cloudinaryPublicId');
    expect(JSON.stringify(uploaded)).not.toContain('test-api-secret');
    expect(JSON.stringify(uploaded)).not.toContain(uploadForm.get('public_id'));
    await expect(
      env.DB.prepare('SELECT cloudinary_public_id FROM mapaba_uploads WHERE id = ?')
        .bind(uploaded.id)
        .first()
    ).resolves.toMatchObject({ cloudinary_public_id: uploadForm.get('public_id') });
  });

  it('rejects oversized files, unsupported MIME, and mismatched magic bytes before Cloudinary', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const oversize = jpegFile(3 * 1024 * 1024 + 1);
    const unsupported = new File([new Uint8Array([1, 2, 3])], 'image.gif', {
      type: 'image/gif',
    });
    const invalidPng = new File([new Uint8Array([1, 2, 3])], 'image.png', {
      type: 'image/png',
    });

    await expect(uploadPrivateImage(testEnv(), oversize)).rejects.toMatchObject({ status: 400 });
    await expect(uploadPrivateImage(testEnv(), unsupported)).rejects.toMatchObject({ status: 400 });
    await expect(uploadPrivateImage(testEnv(), invalidPng)).rejects.toMatchObject({ status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires Cloudinary credentials and sanitizes provider failures', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'test-api-secret' } }), { status: 401 })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      uploadPrivateImage(testEnv({ CLOUDINARY_API_SECRET: '' }), jpegFile())
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchSpy).not.toHaveBeenCalled();

    let error;
    try {
      await uploadPrivateImage(testEnv(), jpegFile());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain('test-api-secret');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('proxies a stored private image without exposing the Cloudinary URL', async () => {
    const id = crypto.randomUUID();
    const publicId = `mapaba_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, 'jpg', 'image/jpeg', 3)`
    )
      .bind(id, publicId)
      .run();

    let providerUrl;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        providerUrl = String(url);
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      })
    );

    const response = await streamPrivateImage(testEnv(), id);

    expect(providerUrl).toContain('/image/authenticated/s--');
    expect(providerUrl).toContain(`${publicId}.jpg`);
    expect(providerUrl).not.toContain('test-api-secret');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Location')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(providerUrl).not.toContain('test-api-secret');
  });

  it('returns a safe 404 for missing uploads without calling the provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(streamPrivateImage(testEnv(), crypto.randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MAPABA upload route', () => {
  it('routes POST /api/v1/upload through the Worker entry point', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        const form = options.body;
        return new Response(
          JSON.stringify({
            public_id: form.get('public_id'),
            format: 'jpg',
            bytes: 8,
          }),
          { status: 200 }
        );
      })
    );

    const response = await worker.fetch(uploadRequest(jpegFile()), testEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { ukuranByte: 8 },
    });
  });

  it('accepts exactly one file field and returns the established response shape', async () => {
    let uploadForm;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        uploadForm = options.body;
        return new Response(
          JSON.stringify({
            public_id: uploadForm.get('public_id'),
            format: 'jpg',
            bytes: 8,
          }),
          { status: 200 }
        );
      })
    );

    const response = await handleUpload(uploadRequest(jpegFile()), testEnv());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        url: expect.stringMatching(/^\/api\/v1\/mapaba\/admin\/files\//),
        kunci: expect.any(String),
        ukuranByte: 8,
      },
    });
    expect(payload.data).not.toHaveProperty('cloudinaryPublicId');
  });

  it('rejects extra fields, absent files, and non-file values', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const textFileForm = new FormData();
    textFileForm.append('file', 'not-a-file');

    const extraFieldResponse = await handleUpload(
      uploadRequest(jpegFile(), [['unexpected', 'value']]),
      testEnv()
    );
    const absentResponse = await handleUpload(uploadRequest(null), testEnv());
    const textFileResponse = await handleUpload(
      new Request('https://worker.example/api/v1/upload', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.20' },
        body: textFileForm,
      }),
      testEnv()
    );

    expect(extraFieldResponse.status).toBe(400);
    expect(absentResponse.status).toBe(400);
    expect(textFileResponse.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared request before parsing its body', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const request = new Request('https://worker.example/api/v1/upload', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '198.51.100.20',
        'Content-Length': String(3 * 1024 * 1024 + 33 * 1024),
      },
      body: 'not parsed',
    });

    const response = await handleUpload(request, testEnv());

    expect(response.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
