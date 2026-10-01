// ─────────────────────────────────────────────────────────────────────────────
// POST /api/logout
//
// Reads the session cookie, deletes that session row, and clears the cookie.
// Always succeeds from the client's point of view.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const { parseCookies, COOKIE_NAME, clearCookie } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      const supabase = getSupabaseAdmin();
      await supabase.from('sessions').delete().eq('token', token);
    }
  } catch {
    // Ignore — we still clear the cookie below.
  }

  res.setHeader('Set-Cookie', clearCookie());
  return res.status(200).json({ ok: true });
};
