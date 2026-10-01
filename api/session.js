// ─────────────────────────────────────────────────────────────────────────────
// GET /api/session
//
// Reads the session cookie, validates the session (exists AND not expired), and
// returns { ok: true, user: { username, display_name, role } } with
// display_name and role fetched fresh from metrics_data.
//
// If missing/expired/invalid: returns { ok: false }, clears the cookie, and
// deletes the expired/stale row if one was found.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const { parseCookies, COOKIE_NAME, clearCookie } = require('../lib/auth');

module.exports = async function handler(req, res) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return res.status(200).json({ ok: false });

    const supabase = getSupabaseAdmin();

    const { data: session, error } = await supabase
      .from('sessions')
      .select('token, username, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (error || !session) {
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ ok: false });
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await supabase.from('sessions').delete().eq('token', token);
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ ok: false });
    }

    // Fetch display_name and role fresh from metrics_data.
    const { data: user } = await supabase
      .from('metrics_data')
      .select('username, display_name, role')
      .eq('username', session.username)
      .maybeSingle();

    if (!user) {
      // Underlying user is gone — treat the session as invalid.
      await supabase.from('sessions').delete().eq('token', token);
      res.setHeader('Set-Cookie', clearCookie());
      return res.status(200).json({ ok: false });
    }

    return res.status(200).json({
      ok: true,
      user: {
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
    });
  } catch (err) {
    return res.status(200).json({ ok: false });
  }
};
