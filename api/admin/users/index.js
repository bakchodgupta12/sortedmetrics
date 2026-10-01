// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/users — admin only
//
//   GET  → list accounts: [{ username, display_name, role }]  (never hashes)
//   POST → create account: { username, display_name, password, role }
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../../../lib/supabaseServer');
const {
  getSession,
  readJsonBody,
  generateSalt,
  hashPassword,
} = require('../../../lib/auth');

const ROLES = new Set(['admin', 'editor', 'viewer']);

module.exports = async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  if (session.role !== 'admin') return res.status(403).json({ ok: false, error: 'Not authorized' });

  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('metrics_data')
      .select('username, display_name, role')
      .order('username', { ascending: true });
    if (error) return res.status(500).json({ ok: false, error: 'Could not list users' });
    return res.status(200).json({ ok: true, users: data || [] });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const username = String((body && body.username) || '').trim().toLowerCase();
    const displayName = String((body && body.display_name) || '').trim();
    const password = String((body && body.password) || '');
    const role = String((body && body.role) || '');

    if (!username) return res.status(400).json({ ok: false, error: 'Username is required.' });
    if (!ROLES.has(role)) return res.status(400).json({ ok: false, error: 'Invalid role.' });
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
    }

    // Reject duplicates up front for a clear message.
    const { data: existing } = await supabase
      .from('metrics_data')
      .select('username')
      .eq('username', username)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'That username already exists.' });
    }

    const salt = generateSalt();
    const password_hash = hashPassword(password, salt);

    // security_question / security_answer_hash are NOT NULL in the schema but
    // unused in the admin-managed model — store empty placeholders.
    const { error } = await supabase.from('metrics_data').insert({
      username,
      display_name: displayName || username,
      password_hash,
      salt,
      security_question: '',
      security_answer_hash: '',
      role,
    });
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, error: 'That username already exists.' });
      }
      return res.status(500).json({ ok: false, error: 'Could not create account.' });
    }

    return res.status(200).json({
      ok: true,
      user: { username, display_name: displayName || username, role },
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
