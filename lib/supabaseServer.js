// ─────────────────────────────────────────────────────────────────────────────
// Server-only Supabase client (privileged "secret" key).
//
// This module must ONLY ever be imported by files inside /api (Vercel
// Serverless Functions). It is intentionally placed outside /src so the
// Create React App build never bundles it into the browser, and outside the
// routable part of /api so it is never exposed as an HTTP endpoint.
//
// It reads SERVER-ONLY environment variables (no REACT_APP_ prefix), so these
// values are never shipped to the client:
//   - SUPABASE_URL          the project URL
//   - SUPABASE_SECRET_KEY   the privileged Supabase secret key
//
// The client is created lazily and cached, so simply importing this file never
// throws — it only validates the env vars when a function actually uses it.
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      'Server Supabase is not configured. Set SUPABASE_URL and ' +
        'SUPABASE_SECRET_KEY as server-side environment variables.'
    );
  }

  cachedClient = createClient(url, secretKey, {
    // This is a stateless server context — no session storage or refresh.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

module.exports = { getSupabaseAdmin };
