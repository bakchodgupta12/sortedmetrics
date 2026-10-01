// ─────────────────────────────────────────────────────────────────────────────
// /api/data — protected metrics read/write (mirrors the current app behavior)
//
//   GET  /api/data  → load the signed-in user's metrics (any valid role)
//   POST /api/data  → save the metrics `data` blob (admin or editor only)
//
// Mirrors the frontend's existing operations exactly:
//   - read:  metrics_data, keyed by username  (app uses row.data + display_name)
//   - write: metrics_data update({ data }), keyed by username
//
// The row is ALWAYS keyed by the session's own username (from the validated
// sw_session cookie), never by anything the client sends — a user can only read
// or write their own row. Password hashes, salts, security answers and session
// tokens are never returned.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const { getSession, readJsonBody } = require('../lib/auth');

const CAN_WRITE = new Set(['admin', 'editor']);

module.exports = async function handler(req, res) {
  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const supabase = getSupabaseAdmin();

  // ── Read (any valid role) ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: row, error } = await supabase
      .from('metrics_data')
      .select('username, display_name, role, data')
      .eq('username', session.username)
      .maybeSingle();

    if (error) return res.status(500).json({ ok: false, error: 'Could not load data' });
    if (!row) return res.status(404).json({ ok: false, error: 'User not found' });

    return res.status(200).json({
      ok: true,
      user: {
        username: row.username,
        display_name: row.display_name,
        role: row.role,
      },
      data: row.data,
    });
  }

  // ── Write (admin or editor only) ───────────────────────────────────────────
  if (req.method === 'POST') {
    if (!CAN_WRITE.has(session.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }

    const body = await readJsonBody(req);
    const data = body ? body.data : undefined;

    // Mirror the frontend: `data` is the metrics object ({ years: {...} }).
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ ok: false, error: 'Invalid data payload' });
    }

    const { error } = await supabase
      .from('metrics_data')
      .update({ data })
      .eq('username', session.username);

    if (error) return res.status(500).json({ ok: false, error: 'Could not save data' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
