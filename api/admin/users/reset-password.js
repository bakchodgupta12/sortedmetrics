// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/reset-password — set a new password for any user (admin)
// Body: { username, newPassword }  (min length 6)
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../../../lib/supabaseServer');
const {
  getSession,
  readJsonBody,
  generateSalt,
  hashPassword,
} = require('../../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  if (session.role !== 'admin') return res.status(403).json({ ok: false, error: 'Not authorized' });

  const body = await readJsonBody(req);
  const username = String((body && body.username) || '').trim().toLowerCase();
  const newPassword = String((body && body.newPassword) || '');

  if (!username) return res.status(400).json({ ok: false, error: 'Username is required.' });
  if (newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: target } = await supabase
      .from('metrics_data')
      .select('username')
      .eq('username', username)
      .maybeSingle();
    if (!target) return res.status(404).json({ ok: false, error: 'User not found.' });

    const salt = generateSalt();
    const password_hash = hashPassword(newPassword, salt);
    const { error } = await supabase
      .from('metrics_data')
      .update({ salt, password_hash })
      .eq('username', username);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not reset password.' });
  }
};
