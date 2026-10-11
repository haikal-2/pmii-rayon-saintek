export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

export function jsonResponse(data, status = 200, meta) {
  const body = { ok: true, data };
  if (meta !== undefined) body.meta = meta;

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(status, message, errors) {
  const body = { ok: false, message };
  if (errors !== undefined) body.errors = errors;

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
