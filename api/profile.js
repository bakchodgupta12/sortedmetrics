// ─────────────────────────────────────────────────────────────────────────────
// POST /api/profile — update the signed-in user's display name
//
// Mirrors the frontend's Settings "display name" write:
//   metrics_data update({ display_name }) keyed by username.
//
// Same protection rule as the metrics write: a valid session is required and the
// role must be admin or editor. Always keyed by the session's own username.
//
// NOTE: in the current app ANY logged-in user can change their own display name.
// Per this piece's uniform rule (admin-or-editor for writes), a viewer is
// blocked here. Nothing is wired to this yet, so there is no behavior change —
// flagging it so you can decide later whether display-name edits should be
// self-service for viewers.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');
const { getSession, readJsonBody } = require('../lib/auth');

const CAN_WRITE = new Set(['admin', 'editor']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }
  if (!CAN_WRITE.has(session.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }

  const body = await readJsonBody(req);
  const displayName = String((body && body.display_name) || '').trim();
  if (!displayName) {
    return res.status(400).json({ ok: false, error: 'display_name is required' });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('metrics_data')
    .update({ display_name: displayName })
    .eq('username', session.username);

  if (error) return res.status(500).json({ ok: false, error: 'Could not update profile' });

  return res.status(200).json({
    ok: true,
    user: {
      username: session.username,
      display_name: displayName,
      role: session.role,
    },
  });
};
