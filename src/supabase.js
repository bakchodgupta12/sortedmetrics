import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isConfigured) {
  // Helps during local setup — the app shows a friendly message instead of
  // throwing deep inside the Supabase client.
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase is not configured. Set REACT_APP_SUPABASE_URL and ' +
      'REACT_APP_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const TABLE = 'metrics_data';

// ─────────────────────────────────────────────────────────────────────────────
// Hashing — SHA-256 with a per-user salt, all done client-side via Web Crypto.
// ─────────────────────────────────────────────────────────────────────────────
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}

export function hashPassword(password, salt) {
  return sha256Hex(`${salt}::${password}`);
}

// Security answers are normalised so "Fluffy" and " fluffy " match.
export function hashSecurityAnswer(answer, salt) {
  return sha256Hex(`${salt}::${String(answer).trim().toLowerCase()}`);
}

export const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  'What city were you born in?',
  "What is your mother's maiden name?",
  'What was the name of your first school?',
  'What is your favourite book?',
  'What was your childhood nickname?',
];

// ─────────────────────────────────────────────────────────────────────────────
// Data model
// ─────────────────────────────────────────────────────────────────────────────
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Section accent colours (CSS custom-property names live in index.css).
export const SECTION_COLORS = {
  downloads: '#5b9bd5', // blue
  users: '#6dbb8a', // green
  transactions: '#e8a838', // amber
  cards: '#9b8ec4', // purple
  revenue: '#6dbb8a', // green (paired with red for costs)
};

// Every input metric, grouped by the section/table it belongs to. Each metric
// is stored as a { month: number } map inside a year. `unit` controls number
// formatting downstream ('count' | 'usdt' | 'usd').
export const METRIC_GROUPS = {
  downloads: [
    {
      title: 'Downloads by store',
      metrics: [
        { key: 'dl_kaios', label: 'KaiOS', unit: 'count' },
        { key: 'dl_googlePlay', label: 'Google Play', unit: 'count' },
        { key: 'dl_palmStore', label: 'Palm Store', unit: 'count' },
        { key: 'dl_indusStore', label: 'Indus Store', unit: 'count' },
        { key: 'dl_vivoStore', label: 'Vivo Store', unit: 'count' },
      ],
    },
    {
      title: 'Acquisition',
      metrics: [
        { key: 'dl_ambassadorCosts', label: 'Ambassador Costs', unit: 'usd' },
        {
          key: 'dl_paidCampaignSpend',
          label: 'Paid Campaign Spend',
          unit: 'usd',
        },
      ],
    },
  ],
  users: [
    {
      title: 'Users',
      metrics: [
        { key: 'u_newUsers', label: 'New Users', unit: 'count' },
        { key: 'u_mau', label: 'MAU', unit: 'count' },
        { key: 'u_dau', label: 'DAU', unit: 'count' },
        { key: 'u_churned', label: 'Churned Users', unit: 'count' },
        { key: 'u_d1Retention', label: 'D1 Retention', unit: 'percent' },
        { key: 'u_d7Retention', label: 'D7 Retention', unit: 'percent' },
        { key: 'u_d30Retention', label: 'D30 Retention', unit: 'percent' },
      ],
    },
  ],
  transactions: [
    {
      title: 'Volume (counts)',
      metrics: [
        { key: 'tx_sendP2P', label: 'Send P2P', unit: 'count' },
        { key: 'tx_receiveP2P', label: 'Receive P2P', unit: 'count' },
        { key: 'tx_cashOut', label: 'Cash-Out', unit: 'count' },
        { key: 'tx_airtime', label: 'Airtime Top-Up', unit: 'count' },
        { key: 'tx_cardRedemption', label: 'Card Redemption', unit: 'count' },
        { key: 'tx_other', label: 'Other', unit: 'count' },
      ],
    },
    {
      title: 'Value (USDT)',
      metrics: [
        { key: 'tx_sendVolume', label: 'Send Volume', unit: 'usdt' },
        { key: 'tx_receiveVolume', label: 'Receive Volume', unit: 'usdt' },
        { key: 'tx_cashOutVolume', label: 'Cash-Out Volume', unit: 'usdt' },
        {
          key: 'tx_cardRedemptionVolume',
          label: 'Card Redemption Volume',
          unit: 'usdt',
        },
        { key: 'tx_otherVolume', label: 'Other Volume', unit: 'usdt' },
      ],
    },
    {
      title: 'Off-ramp',
      metrics: [
        { key: 'tx_offrampAttempts', label: 'Attempts', unit: 'count' },
        { key: 'tx_offrampSuccessful', label: 'Successful', unit: 'count' },
        { key: 'tx_offrampFailed', label: 'Failed', unit: 'count' },
      ],
    },
  ],
  cards: [
    {
      title: 'Activity',
      metrics: [
        { key: 'c_sold', label: 'Cards Sold', unit: 'count' },
        { key: 'c_valueDistributed', label: 'Cards Volume', unit: 'usdt' },
        { key: 'c_fundsCollected', label: 'Funds Collected', unit: 'usdt' },
        { key: 'c_grossRevenue', label: 'Gross Revenue', unit: 'usdt' },
        { key: 'c_uniqueUsers', label: 'Unique Users', unit: 'count' },
        // Retired Activity fields — kept in the model so historical data loads.
        { key: 'c_redeemed', label: 'Cards Redeemed', unit: 'count' },
        { key: 'c_usdtVolume', label: 'Card USDT Volume', unit: 'usdt' },
        {
          key: 'c_discountFeesLost',
          label: 'Discount & Fees Lost USD',
          unit: 'usd',
        },
      ],
    },
    {
      title: 'Lifetime',
      metrics: [
        // Manual deduplicated all-time figure — NOT a sum of monthly uniques.
        { key: 'c_lifetimeUniqueUsers', label: 'Total Unique Users', unit: 'count' },
      ],
    },
    {
      title: 'By market',
      metrics: [
        // Per-country snapshot totals (entered directly, not tracked monthly).
        { key: 'c_mktKE_sold', label: 'Kenya — Cards Sold', unit: 'count' },
        { key: 'c_mktKE_value', label: 'Kenya — Cards Volume', unit: 'usdt' },
        { key: 'c_mktKE_users', label: 'Kenya — Unique Users', unit: 'count' },
        { key: 'c_mktKE_disc', label: 'Kenya — Average Discount %', unit: 'percent' },
        { key: 'c_mktKE_cac', label: 'Kenya — CAC', unit: 'usdt' },
        { key: 'c_mktNG_sold', label: 'Nigeria — Cards Sold', unit: 'count' },
        { key: 'c_mktNG_value', label: 'Nigeria — Cards Volume', unit: 'usdt' },
        { key: 'c_mktNG_users', label: 'Nigeria — Unique Users', unit: 'count' },
        { key: 'c_mktNG_disc', label: 'Nigeria — Average Discount %', unit: 'percent' },
        { key: 'c_mktNG_cac', label: 'Nigeria — CAC', unit: 'usdt' },
        { key: 'c_mktTZ_sold', label: 'Tanzania — Cards Sold', unit: 'count' },
        { key: 'c_mktTZ_value', label: 'Tanzania — Cards Volume', unit: 'usdt' },
        { key: 'c_mktTZ_users', label: 'Tanzania — Unique Users', unit: 'count' },
        { key: 'c_mktTZ_disc', label: 'Tanzania — Average Discount %', unit: 'percent' },
        { key: 'c_mktTZ_cac', label: 'Tanzania — CAC', unit: 'usdt' },
        // Retired per-country Funds Collected — kept so historical data loads.
        { key: 'c_mktKE_funds', label: 'Kenya — Funds Collected', unit: 'usdt' },
        { key: 'c_mktNG_funds', label: 'Nigeria — Funds Collected', unit: 'usdt' },
        { key: 'c_mktTZ_funds', label: 'Tanzania — Funds Collected', unit: 'usdt' },
        // Retired monthly by-market counts — kept so historical data loads.
        { key: 'c_mktKenya', label: 'Kenya', unit: 'count' },
        { key: 'c_mktNigeria', label: 'Nigeria', unit: 'count' },
        { key: 'c_mktOther', label: 'Other', unit: 'count' },
      ],
    },
  ],
  revenue: [
    {
      title: 'Revenue',
      metrics: [
        { key: 'r_offramps', label: 'Off-ramps', unit: 'usd' },
        { key: 'r_other', label: 'Others', unit: 'usd' },
        // Retired revenue lines — kept so historical data loads. Top-up card
        // revenue is now pulled from the Top-up Cards tab (c_grossRevenue).
        { key: 'r_transactionFees', label: 'Transaction Fees', unit: 'usd' },
        {
          key: 'r_cardRedemptionFees',
          label: 'Card Redemption Fees',
          unit: 'usd',
        },
      ],
    },
    {
      title: 'Cost of Revenue',
      metrics: [
        { key: 'cost_ambassador', label: 'Ambassador Salaries', unit: 'usd' },
        { key: 'cost_saas', label: 'SaaS Subscriptions', unit: 'usd' },
        { key: 'cost_digitalMarketing', label: 'Digital Marketing', unit: 'usd' },
        { key: 'cost_campaigns', label: 'Campaigns', unit: 'usd' },
        // Retired cost lines — kept so historical data loads.
        { key: 'cost_gasFees', label: 'Gas Fees', unit: 'usd' },
        { key: 'cost_cardPrinting', label: 'Card Printing', unit: 'usd' },
        { key: 'cost_infrastructure', label: 'Infrastructure', unit: 'usd' },
        { key: 'cost_marketingSpend', label: 'Marketing Spend', unit: 'usd' },
      ],
    },
  ],
};

// Flat list of every metric key (used to initialise empty years).
export const ALL_METRIC_KEYS = Object.values(METRIC_GROUPS)
  .flat()
  .flatMap((group) => group.metrics.map((m) => m.key));

// A fresh, empty year: every metric is an empty month→number map, plus notes.
export function emptyYear() {
  const year = {};
  for (const key of ALL_METRIC_KEYS) year[key] = {};
  year.notes = {};
  return year;
}

export function emptyData(initialYear) {
  const data = { years: {} };
  if (initialYear != null) data.years[String(initialYear)] = emptyYear();
  return data;
}

// Defensive: normalise a loaded `data` blob so missing keys never crash the UI.
export function normaliseData(data) {
  const safe = data && typeof data === 'object' ? data : {};
  const years = safe.years && typeof safe.years === 'object' ? safe.years : {};
  const out = { years: {} };
  for (const [year, yearData] of Object.entries(years)) {
    const base = emptyYear();
    if (yearData && typeof yearData === 'object') {
      for (const key of ALL_METRIC_KEYS) {
        if (yearData[key] && typeof yearData[key] === 'object') {
          base[key] = { ...yearData[key] };
        }
      }
      if (yearData.notes && typeof yearData.notes === 'object') {
        base.notes = { ...yearData.notes };
      }
    }
    out.years[year] = base;
  }
  return out;
}

export function listYears(data) {
  return Object.keys(data.years || {})
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD / auth
// ─────────────────────────────────────────────────────────────────────────────
function requireClient() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add REACT_APP_SUPABASE_URL and ' +
        'REACT_APP_SUPABASE_ANON_KEY to your .env and restart.'
    );
  }
}

export function normaliseUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase();
}

// Returns the row for a username, or null if it does not exist.
export async function getUser(username) {
  requireClient();
  const uname = normaliseUsername(username);
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('username', uname)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Most recent updated_at across the whole table — team-wide data freshness,
// independent of the current session's own save. Null if the table is empty.
export async function getLastUpdated() {
  requireClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.updated_at || null;
}

// First-login registration: creates the row with hashed credentials.
export async function createUser({
  username,
  password,
  securityQuestion,
  securityAnswer,
  displayName,
  initialYear,
}) {
  requireClient();
  const uname = normaliseUsername(username);
  const salt = generateSalt();
  const [password_hash, security_answer_hash] = await Promise.all([
    hashPassword(password, salt),
    hashSecurityAnswer(securityAnswer, salt),
  ]);
  const row = {
    username: uname,
    display_name: displayName || username,
    password_hash,
    salt,
    security_question: securityQuestion,
    security_answer_hash,
    data: emptyData(initialYear),
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Verifies a password against a stored row. Returns boolean.
export async function verifyPassword(row, password) {
  const hash = await hashPassword(password, row.salt);
  return hash === row.password_hash;
}

export async function verifySecurityAnswer(row, answer) {
  const hash = await hashSecurityAnswer(answer, row.salt);
  return hash === row.security_answer_hash;
}

// Persists the metrics JSON blob for a user.
export async function saveData(username, data) {
  requireClient();
  const uname = normaliseUsername(username);
  const { error } = await supabase
    .from(TABLE)
    .update({ data })
    .eq('username', uname);
  if (error) throw error;
}

export async function updateDisplayName(username, displayName) {
  requireClient();
  const uname = normaliseUsername(username);
  const { error } = await supabase
    .from(TABLE)
    .update({ display_name: displayName })
    .eq('username', uname);
  if (error) throw error;
}

// Changes a password (caller verifies the current password first).
export async function changePassword(username, newPassword) {
  requireClient();
  const uname = normaliseUsername(username);
  const salt = generateSalt();
  const password_hash = await hashPassword(newPassword, salt);
  const { error } = await supabase
    .from(TABLE)
    .update({ salt, password_hash })
    .eq('username', uname);
  if (error) throw error;
}

// Forgot-password reset (caller verifies the security answer first).
export async function resetPassword(username, newPassword) {
  return changePassword(username, newPassword);
}

export async function deleteAccount(username) {
  requireClient();
  const uname = normaliseUsername(username);
  const { error } = await supabase.from(TABLE).delete().eq('username', uname);
  if (error) throw error;
}
