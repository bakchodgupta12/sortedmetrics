// ─────────────────────────────────────────────────────────────────────────────
// Thin client for the server endpoints (Stage D cutover).
//
// Every call includes credentials so the HttpOnly `sw_session` cookie is sent
// and received. The browser never sees password hashes, salts, or the token —
// authentication and authorization happen on the server.
// ─────────────────────────────────────────────────────────────────────────────
async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

function errorWithStatus(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// POST /api/login → { user: { username, display_name, role } }
export async function apiLogin(username, password) {
  const { status, ok, body } = await jsonFetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!ok || !body || !body.ok) {
    throw errorWithStatus((body && body.error) || 'Login failed', status);
  }
  return body.user;
}

// POST /api/logout
export async function apiLogout() {
  try {
    await jsonFetch('/api/logout', { method: 'POST' });
  } catch {
    // Non-fatal: local state is cleared regardless.
  }
}

// GET /api/session → the user object, or null if no valid session.
export async function apiGetSession() {
  try {
    const { ok, body } = await jsonFetch('/api/session');
    if (ok && body && body.ok) return body.user;
  } catch {
    // treat as logged out
  }
  return null;
}

// GET /api/data → { user, data }
export async function apiGetData() {
  const { status, ok, body } = await jsonFetch('/api/data');
  if (!ok || !body || !body.ok) {
    throw errorWithStatus((body && body.error) || 'Could not load data', status);
  }
  return body;
}

// POST /api/data  { data }
export async function apiSaveData(data) {
  const { status, ok, body } = await jsonFetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!ok || !body || !body.ok) {
    throw errorWithStatus((body && body.error) || 'Could not save data', status);
  }
  return true;
}

// POST /api/profile  { display_name } → updated user
export async function apiUpdateDisplayName(displayName) {
  const { status, ok, body } = await jsonFetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!ok || !body || !body.ok) {
    throw errorWithStatus((body && body.error) || 'Could not update profile', status);
  }
  return body.user;
}

// Role → can this role edit (write) data? admin/editor yes, viewer (or unknown) no.
export function canEditRole(role) {
  return role === 'admin' || role === 'editor';
}
