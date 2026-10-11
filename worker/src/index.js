import { ApiError, errorResponse, jsonResponse } from './lib/http.js';
import { handleMapabaAdmin } from './routes/mapaba-admin.js';
import { handleMapabaPublic } from './routes/mapaba.js';
import { handleUpload } from './routes/upload.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'OPTIONS'];
const ALLOWED_HEADERS = ['authorization', 'content-type'];

function configuredOrigins(env) {
  return (env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function addCorsHeaders(response, origin, preflight = false) {
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    const vary = headers.get('Vary');
    if (!vary || !vary.split(',').some((value) => value.trim().toLowerCase() === 'origin')) {
      headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
    }
  }

  if (preflight) {
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','));
    headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAllowedPreflight(request) {
  const requestedMethod = request.headers.get('Access-Control-Request-Method');
  if (requestedMethod && !ALLOWED_METHODS.includes(requestedMethod.toUpperCase())) return false;

  const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);

  return requestedHeaders.every((header) => ALLOWED_HEADERS.includes(header));
}

async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/v1/health') {
    return jsonResponse({ status: 'sehat' });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/upload') {
    return handleUpload(request, env);
  }
  if (url.pathname === '/api/v1/mapaba/admin' || url.pathname.startsWith('/api/v1/mapaba/admin/')) {
    return handleMapabaAdmin(request, env, ctx);
  }
  if (url.pathname.startsWith('/api/v1/mapaba/')) {
    const response = await handleMapabaPublic(request, env, ctx);
    if (response) return response;
  }

  return errorResponse(404, `Endpoint ${request.method} ${url.pathname} tidak ditemukan.`);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = origin && configuredOrigins(env).includes(origin) ? origin : null;

    if (origin && !allowedOrigin) {
      return errorResponse(403, 'Origin tidak diizinkan.');
    }

    try {
      if (request.method === 'OPTIONS') {
        if (!isAllowedPreflight(request)) {
          return addCorsHeaders(errorResponse(403, 'Preflight tidak diizinkan.'), allowedOrigin);
        }

        return addCorsHeaders(new Response(null, { status: 204 }), allowedOrigin, true);
      }

      return addCorsHeaders(await routeRequest(request, env, ctx), allowedOrigin);
    } catch (error) {
      if (error instanceof ApiError) {
        return addCorsHeaders(errorResponse(error.status, error.message, error.errors), allowedOrigin);
      }

      console.error('[worker] unhandled request failure:', error?.name || 'Error');
      return addCorsHeaders(errorResponse(500, 'Terjadi kesalahan internal.'), allowedOrigin);
    }
  },
};
