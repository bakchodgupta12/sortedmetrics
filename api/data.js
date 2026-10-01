// ─────────────────────────────────────────────────────────────────────────────
// /api/data — protected read/write of the SHARED company dataset
//
//   GET  /api/data  → load the shared metrics (any valid role)
//   POST /api/data  → save the shared metrics (admin or editor only)
//
// Metrics now live in a single shared row: public.app_data where id = 1
// (column `data`). Identity/permissions still come from the session user's
// metrics_data row ({ username, display_name, role }), which is returned
// alongside the shared data so the response shape is unchanged.
//
// Only the server-only secret-key client can touch app_data (RLS blocks all
// else). Password hashes, salts, security answers and tokens are never returned.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const { getSession, readJsonBody } = require('../lib/auth');

const CAN_WRITE = new Set(['admin', 'editor']);
const APP_DATA_ID = 1;

module.exports = async function handler(req, res) {
  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const supabase = getSupabaseAdmin();

  // ── Read (any valid role) ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Identity/permissions from the user's own row.
    const { data: userRow, error: userError } = await supabase
      .from('metrics_data')
      .select('username, display_name, role')
      .eq('username', session.username)
      .maybeSingle();
    if (userError) return res.status(500).json({ ok: false, error: 'Could not load data' });
    if (!userRow) return res.status(404).json({ ok: false, error: 'User not found' });

    // Metrics from the shared company row.
    const { data: shared, error: dataError } = await supabase
      .from('app_data')
      .select('data')
      .eq('id', APP_DATA_ID)
      .maybeSingle();
    if (dataError) return res.status(500).json({ ok: false, error: 'Could not load data' });

    return res.status(200).json({
      ok: true,
      user: {
        username: userRow.username,
        display_name: userRow.display_name,
        role: userRow.role,
      },
      data: shared ? shared.data : null,
    });
  }

  // ── Write (admin or editor only) ───────────────────────────────────────────
  if (req.method === 'POST') {
    if (!CAN_WRITE.has(session.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }

    const body = await readJsonBody(req);
    const data = body ? body.data : undefined;

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ ok: false, error: 'Invalid data payload' });
    }

    const { error } = await supabase
      .from('app_data')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', APP_DATA_ID);

    if (error) return res.status(500).json({ ok: false, error: 'Could not save data' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
