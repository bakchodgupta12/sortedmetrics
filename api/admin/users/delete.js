// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/delete — remove an account (admin only)
// Body: { username }
// Safeguards: an admin cannot delete their own account, and the last remaining
// admin cannot be deleted. Also deletes the user's sessions.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../../../lib/supabaseServer');
const { getSession, readJsonBody } = require('../../../lib/auth');

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

  if (!username) return res.status(400).json({ ok: false, error: 'Username is required.' });
  if (username === session.username) {
    return res.status(400).json({ ok: false, error: 'You cannot delete your own account.' });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: target, error: findErr } = await supabase
      .from('metrics_data')
      .select('username, role')
      .eq('username', username)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!target) return res.status(404).json({ ok: false, error: 'User not found.' });

    if (target.role === 'admin') {
      const { count, error: countErr } = await supabase
        .from('metrics_data')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (countErr) throw countErr;
      if ((count || 0) <= 1) {
        return res.status(400).json({ ok: false, error: 'Cannot delete the last admin.' });
      }
    }

    // Remove the user's sessions first, then the account.
    await supabase.from('sessions').delete().eq('username', username);
    const { error } = await supabase.from('metrics_data').delete().eq('username', username);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not delete account.' });
  }
};
