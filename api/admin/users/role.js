// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/role — change a user's role (admin only)
// Body: { username, role }
// Safeguards: an admin cannot change their own role, and the last remaining
// admin cannot be demoted.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../../../lib/supabaseServer');
const { getSession, readJsonBody } = require('../../../lib/auth');

const ROLES = new Set(['admin', 'editor', 'viewer']);

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
  const role = String((body && body.role) || '');

  if (!username) return res.status(400).json({ ok: false, error: 'Username is required.' });
  if (!ROLES.has(role)) return res.status(400).json({ ok: false, error: 'Invalid role.' });
  if (username === session.username) {
    return res.status(400).json({ ok: false, error: 'You cannot change your own role.' });
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

    // Prevent demoting the last admin.
    if (target.role === 'admin' && role !== 'admin') {
      const { count, error: countErr } = await supabase
        .from('metrics_data')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (countErr) throw countErr;
      if ((count || 0) <= 1) {
        return res.status(400).json({ ok: false, error: 'Cannot remove the last admin.' });
      }
    }

    const { error } = await supabase
      .from('metrics_data')
      .update({ role })
      .eq('username', username);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Could not change role.' });
  }
};
