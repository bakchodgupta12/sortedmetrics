// ─────────────────────────────────────────────────────────────────────────────
// Database-backed login rate limiting.
//
// Serverless functions share no memory, so attempt state lives in the
// `login_attempts` table (secret-key client only; RLS blocks everyone else).
//
// We track TWO identifiers per login attempt — the attempted username and the
// client IP — so neither "hammer one username" nor "rotate usernames from one
// IP" can slip through. Either identifier reaching the threshold locks that
// identifier.
//
// Policy:
//   - MAX_FAILURES failed attempts within WINDOW_MS  → lock for LOCK_MS
//   - a lock expires automatically once locked_until passes
//   - a stale counter (last attempt older than WINDOW_MS) resets on next failure
//   - a successful login clears both identifiers' counters
//
// Fail-open: if the store itself errors (e.g. the table isn't created yet), we
// log and allow the request rather than locking everyone out. The table is
// behind RLS, so the only realistic error is a missing/unavailable table.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('./supabaseServer');

const MAX_FAILURES = 5; // failed attempts allowed within the window
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // 15 minute lockout

const TABLE = 'login_attempts';

// Best-effort client IP from Vercel's proxy headers.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return 'unknown';
}

// The two identifiers to rate-limit a given attempt by.
function identifiersFor(username, ip) {
  return [`user:${username}`, `ip:${ip}`];
}

// Returns { locked: boolean, retryAfterSeconds } — locked if ANY identifier has
// locked_until in the future.
async function isLocked(identifiers) {
  try {
    const supabase = getSupabaseAdmin();
    const now = Date.now();
    const { data, error } = await supabase
      .from(TABLE)
      .select('identifier, locked_until')
      .in('identifier', identifiers);
    if (error) throw error;
    let until = 0;
    for (const row of data || []) {
      if (row.locked_until) {
        const t = new Date(row.locked_until).getTime();
        if (t > now && t > until) until = t;
      }
    }
    if (until > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rateLimit] isLocked failed (allowing):', err.message || err);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

// Record one failed attempt against each identifier, locking when the threshold
// is reached within the window.
async function registerFailure(identifiers) {
  const supabase = getSupabaseAdmin();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  for (const identifier of identifiers) {
    try {
      const { data: row } = await supabase
        .from(TABLE)
        .select('identifier, attempt_count, first_attempt_at, last_attempt_at')
        .eq('identifier', identifier)
        .maybeSingle();

      if (!row) {
        await supabase.from(TABLE).insert({
          identifier,
          attempt_count: 1,
          first_attempt_at: nowIso,
          last_attempt_at: nowIso,
          locked_until: null,
        });
        continue;
      }

      const last = new Date(row.last_attempt_at).getTime();
      const windowExpired = now - last > WINDOW_MS;
      const count = windowExpired ? 1 : (row.attempt_count || 0) + 1;
      const firstAt = windowExpired ? nowIso : row.first_attempt_at;
      const locked_until =
        count >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null;

      await supabase
        .from(TABLE)
        .update({
          attempt_count: count,
          first_attempt_at: firstAt,
          last_attempt_at: nowIso,
          locked_until,
        })
        .eq('identifier', identifier);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[rateLimit] registerFailure failed:', err.message || err);
    }
  }
}

// Clear counters for both identifiers after a successful login.
async function clearAttempts(identifiers) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from(TABLE).delete().in('identifier', identifiers);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rateLimit] clearAttempts failed:', err.message || err);
  }
}

module.exports = {
  MAX_FAILURES,
  WINDOW_MS,
  LOCK_MS,
  getClientIp,
  identifiersFor,
  isLocked,
  registerFailure,
  clearAttempts,
};
