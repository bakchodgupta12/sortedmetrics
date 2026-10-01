// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health
//
// A tiny end-to-end check that the serverless layer works and that the server
// can reach Supabase using the privileged secret key. It performs a trivial,
// safe read — a HEAD count of the metrics_data table — and returns only the
// row count. No row data, credentials, or sensitive fields are exposed.
//
// This endpoint is standalone: it does NOT touch the login flow, the existing
// frontend reads/writes, or any database policy.
// ─────────────────────────────────────────────────────────────────────────────
const { getSupabaseAdmin } = require('../lib/supabaseServer');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabaseAdmin();

    // head: true returns no rows — only an exact count. Nothing sensitive.
    const { count, error } = await supabase
      .from('metrics_data')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    res.status(200).json({ ok: true, metricsDataRowCount: count ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
