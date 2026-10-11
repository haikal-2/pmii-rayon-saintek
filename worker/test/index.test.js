import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Worker HTTP entry point', () => {
  it('returns the health response', async () => {
    const response = await SELF.fetch('http://example.test/api/v1/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { status: 'sehat' },
    });
  });

  it('allows the configured origin and required preflight headers', async () => {
    const response = await SELF.fetch(
      new Request('http://example.test/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:4321',
          'Access-Control-Request-Method': 'PATCH',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4321');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PATCH,OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization,Content-Type');
  });

  it('rejects an origin that is not configured', async () => {
    const response = await SELF.fetch(
      new Request('http://example.test/api/v1/health', {
        headers: { Origin: 'https://attacker.example' },
      })
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows a server-to-server request without Origin', async () => {
    const response = await SELF.fetch('http://example.test/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns JSON 404 for an unknown route', async () => {
    const response = await SELF.fetch('http://example.test/api/v1/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.any(String),
    });
  });
});
