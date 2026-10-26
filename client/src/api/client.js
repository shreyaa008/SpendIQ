// Topic 38/39: one fetch wrapper → consistent success/error handling for every API call.
export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }
}

const listeners = new Set();
export const onUnauthorized = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function request(method, path, { params, body, form, raw } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const init = { method, credentials: 'include', headers: {} };
  if (form) init.body = form; // multipart: the browser sets the boundary
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and that the API is running.', { code: 'NETWORK' });
  }
  if (raw) {
    if (!res.ok) throw await toError(res);
    return res;
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || !json?.success) {
    const err = await toError(res, json);
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) listeners.forEach((fn) => fn());
    throw err;
  }
  return { data: json.data, meta: json.meta };
}

async function toError(res, parsed) {
  let json = parsed;
  if (!json) { try { json = await res.clone().json(); } catch { json = null; } }
  const e = json?.error;
  return new ApiError(res.status, e?.message || `Request failed (${res.status})`, { code: e?.code, details: e?.details });
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path, params, body) => request('DELETE', path, { params, body }),
  upload: (path, form) => request('POST', path, { form }),
  download: async (path, params, filename) => {
    const res = await request('GET', path, { params, raw: true });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  },
  blob: async (path) => (await request('GET', path, { raw: true })).blob(),
};