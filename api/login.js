// ─────────────────────────────────────────────────────────────────────────────
// POST /api/login
//
// Body: { username, password }
// Verifies the password server-side against metrics_data using the existing
// scheme (SHA-256 of `${salt}::${password}`), then creates a session row and
// sets an HttpOnly / Secure / SameSite=Strict cookie.
//
// Never returns password_hash, salt, or security answer. Failures are generic
// and timing-uniform so they do not reveal whether a username exists.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const {
  readJsonBody,
  passwordMatches,
  generateToken,
  sessionCookie,
  MAX_AGE_SECONDS,
} = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const invalid = () =>
    res.status(401).json({ ok: false, error: 'Invalid username or password' });

  try {
    const body = await readJsonBody(req);
    // Usernames are stored lower-cased by the app; match that here.
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    const supabase = getSupabaseAdmin();

    // Always run the lookup (even for an empty username) so timing is uniform.
    const { data: row } = await supabase
      .from('metrics_data')
      .select('username, display_name, role, password_hash, salt')
      .eq('username', username)
      .maybeSingle();

    // Always performs hashing work, whether or not the row exists.
    if (!passwordMatches(row, password)) return invalid();

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MAX_AGE_SECONDS * 1000);

    const { error: insertError } = await supabase.from('sessions').insert({
      token,
      username: row.username,
      role: row.role,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    if (insertError) throw insertError;

    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.status(200).json({
      ok: true,
      user: {
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      },
    });
  } catch (err) {
    // Do not leak internals.
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
};
