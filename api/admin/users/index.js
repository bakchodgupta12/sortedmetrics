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

    // Discover the real columns on metrics_data (don't assume the schema — the
    // security-question columns were removed in a prior stage). An existing row
    // (e.g. the admin) exposes the actual column names as its keys.
    const { data: sampleRows } = await supabase
      .from('metrics_data')
      .select('*')
      .limit(1);
    const existingCols =
      sampleRows && sampleRows[0] ? new Set(Object.keys(sampleRows[0])) : null;

    // Candidate values; only those whose column actually exists are inserted.
    // security_question/security_answer_hash are included ONLY as a fallback in
    // case the live table still has them as NOT NULL.
    const candidate = {
      username,
      display_name: displayName || username,
      password_hash,
      salt,
      role,
      data: {},
      security_question: '',
      security_answer_hash: '',
    };
    // Core columns always sent if schema discovery returns nothing.
    const fallback = ['username', 'display_name', 'password_hash', 'salt', 'role', 'data'];

    const insertRow = {};
    for (const [k, v] of Object.entries(candidate)) {
      const include = existingCols ? existingCols.has(k) : fallback.includes(k);
      if (include) insertRow[k] = v;
    }

    const { error } = await supabase.from('metrics_data').insert(insertRow);
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ ok: false, error: 'That username already exists.' });
      }
      // eslint-disable-next-line no-console
      console.error('[admin/users] insert failed', {
        payloadKeys: Object.keys(insertRow),
        error,
      });
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
