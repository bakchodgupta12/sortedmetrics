// ─────────────────────────────────────────────────────────────────────────────
// Shared server-side auth helpers (used only by /api serverless functions).
//
// Lives outside /src so it is never bundled into the browser, and outside the
// routable part of /api so it is never exposed as an HTTP endpoint.
//
// Responsibilities:
//   - password hashing that matches the existing app scheme
//     (SHA-256 of `${salt}::${password}`), verified in constant time
//   - session cookie parsing / building (HttpOnly, Secure, SameSite=Strict)
//   - JSON body reading that works on Vercel and under `vercel dev`
//   - getSession(req): validate the session cookie against the `sessions`
//     table (exists AND not expired) and return { username, role } or null.
//     Reusable by later pieces to protect read/write endpoints.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { getSupabaseAdmin } = require('./supabaseServer');

const COOKIE_NAME = 'sw_session';
const MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

// ── Hashing (must match src/supabase.js: sha256(`${salt}::${password}`)) ──────
function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// A valid 64-hex dummy so we always do the same hashing work and compare equal-
// length buffers even when the user does not exist — keeps timing uniform so we
// never leak whether a username exists.
const DUMMY_SALT = '0'.repeat(32);
const DUMMY_HASH = sha256Hex(`${DUMMY_SALT}::dummy-password`);

// Constant-time password check. Accepts a (possibly null) metrics_data row.
function passwordMatches(row, password) {
  const salt = (row && row.salt) || DUMMY_SALT;
  const storedHash = (row && row.password_hash) || DUMMY_HASH;
  const computedHex = sha256Hex(`${salt}::${password}`);

  let a;
  let b;
  try {
    a = Buffer.from(computedHex, 'hex');
    b = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;

  const equal = crypto.timingSafeEqual(a, b);
  // Only a real row can succeed; the dummy work above just equalises timing.
  return Boolean(row) && equal;
}

// ── Tokens ───────────────────────────────────────────────────────────────────
function generateToken() {
  // 32 random bytes, URL/cookie-safe encoding.
  return crypto.randomBytes(32).toString('base64url');
}

// ── Salt + hashing for creating/updating passwords ───────────────────────────
// Matches the stored scheme: 16-byte hex salt, SHA-256 of `${salt}::${password}`.
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function hashPassword(password, salt) {
  return sha256Hex(`${salt}::${password}`);
}

// ── Cookies ──────────────────────────────────────────────────────────────────
function parseCookies(req) {
  const header = (req && req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    if (!k) return;
    out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sessionCookie(token) {
  return (
    `${COOKIE_NAME}=${token}; Max-Age=${MAX_AGE_SECONDS}; Path=/; ` +
    'HttpOnly; Secure; SameSite=Strict'
  );
}

function clearCookie() {
  return (
    `${COOKIE_NAME}=; Max-Age=0; Path=/; ` +
    'HttpOnly; Secure; SameSite=Strict'
  );
}

// ── Request body ─────────────────────────────────────────────────────────────
function readJsonBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve({});
      }
    }
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ── Session validation (reusable by later read/write endpoints) ───────────────
// Reads the session cookie, confirms the session exists and has not expired,
// and returns { username, role, token } or null. Read-only: it does not mutate
// cookies or delete rows (endpoints that need that do it themselves).
async function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('sessions')
    .select('token, username, role, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  return { username: data.username, role: data.role, token };
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SECONDS,
  sha256Hex,
  passwordMatches,
  generateToken,
  generateSalt,
  hashPassword,
  parseCookies,
  sessionCookie,
  clearCookie,
  readJsonBody,
  getSession,
};
