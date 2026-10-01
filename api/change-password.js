// ─────────────────────────────────────────────────────────────────────────────
// POST /api/change-password — any logged-in user changes their own password
//
// Body: { currentPassword, newPassword }
// Verifies currentPassword against the session user's stored hash, then stores a
// new random salt + hash. Never returns hashes/salts. Min new length: 6.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const {
  getSession,
  readJsonBody,
  passwordMatches,
  generateSalt,
  hashPassword,
} = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const body = await readJsonBody(req);
  const currentPassword = String((body && body.currentPassword) || '');
  const newPassword = String((body && body.newPassword) || '');

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ ok: false, error: 'New password must be at least 6 characters.' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from('metrics_data')
      .select('username, password_hash, salt')
      .eq('username', session.username)
      .maybeSingle();
    if (error || !row) {
      return res.status(400).json({ ok: false, error: 'Could not change password.' });
    }

    if (!passwordMatches(row, currentPassword)) {
      return res.status(400).json({ ok: false, error: 'Current password is incorrect.' });
    }

    const salt = generateSalt();
    const password_hash = hashPassword(newPassword, salt);
    const { error: updErr } = await supabase
      .from('metrics_data')
      .update({ salt, password_hash })
      .eq('username', session.username);
    if (updErr) throw updErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not change password.' });
  }
};
