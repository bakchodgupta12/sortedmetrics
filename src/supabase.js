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

// Accounts (credentials + role) live in `metrics_data`; the team's metrics are
// a single shared dataset in `shared_metrics` (one row, id = 1).
const TABLE = 'metrics_data';
const SHARED = 'shared_metrics';
const SHARED_ID = 1;

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

// Passwords are short numeric PINs: 4 to 6 digits.
export const PASSWORD_RULE = '4 to 6 digits';
export function isValidPassword(password) {
  return /^\d{4,6}$/.test(String(password || ''));
}

export const ROLES = { MASTER: 'master', OWNER: 'owner', MEMBER: 'member' };

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

// A fresh, empty year: every metric is an empty month→number map, plus notes
// and the Campaigns tab's manual data (a campaign list + a manual KPI strip).
export function emptyYear() {
  const year = {};
  for (const key of ALL_METRIC_KEYS) year[key] = {};
  year.notes = {};
  year.campaigns = [];
  year.campaignKpis = {};
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
      // Campaigns tab — a manual campaign list and KPI strip (free-form, so
      // carried through as-is rather than coerced to the metric/month grid).
      if (Array.isArray(yearData.campaigns)) {
        base.campaigns = yearData.campaigns.filter((c) => c && typeof c === 'object');
      }
      if (yearData.campaignKpis && typeof yearData.campaignKpis === 'object') {
        base.campaignKpis = { ...yearData.campaignKpis };
      }
    }
    out.years[year] = base;
  }
  // Top-up Cards batches live at the ROOT (not under a year): batches are
  // month-less and country-scoped, feeding the cumulative By-Country summary.
  out.cardBatches = Array.isArray(safe.cardBatches)
    ? safe.cardBatches.filter((b) => b && typeof b === 'object')
    : [];
  // Manual deduplicated unique-users per country (cannot be summed from batches).
  // The Cards lifetime "Total Unique Users" is derived as the sum of these.
  out.cardCountryUsers =
    safe.cardCountryUsers && typeof safe.cardCountryUsers === 'object'
      ? { ...safe.cardCountryUsers }
      : {};
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

// Most recent change to the shared dataset — team-wide data freshness,
// independent of the current session's own save. Null if not yet seeded.
export async function getLastUpdated() {
  requireClient();
  const { data, error } = await supabase
    .from(SHARED)
    .select('updated_at')
    .eq('id', SHARED_ID)
    .maybeSingle();
  if (error) throw error;
  return data?.updated_at || null;
}

// Verifies a password against a stored account row. Returns boolean.
export async function verifyPassword(row, password) {
  const hash = await hashPassword(password, row.salt);
  return hash === row.password_hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared dataset — one team-wide metrics blob every account reads/writes.
// ─────────────────────────────────────────────────────────────────────────────
export async function loadSharedData() {
  requireClient();
  const { data, error } = await supabase
    .from(SHARED)
    .select('data')
    .eq('id', SHARED_ID)
    .maybeSingle();
  if (error) throw error;
  return data?.data || null;
}

// Persists the shared metrics JSON blob (owners only — enforced in the UI).
export async function saveData(blob) {
  requireClient();
  const { error } = await supabase
    .from(SHARED)
    .update({ data: blob })
    .eq('id', SHARED_ID);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts — credentials + role on top of the shared data.
// ─────────────────────────────────────────────────────────────────────────────
// Owner-created account. No self-signup, no security question.
export async function createAccount({ username, password, displayName, role }) {
  requireClient();
  const uname = normaliseUsername(username);
  const salt = generateSalt();
  const password_hash = await hashPassword(password, salt);
  const row = {
    username: uname,
    display_name: displayName?.trim() || uname,
    password_hash,
    salt,
    role: role === ROLES.OWNER ? ROLES.OWNER : ROLES.MEMBER,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Every account with its role, oldest first (used by the owner Team panel).
export async function listAccounts() {
  requireClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('username, display_name, role, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setAccountRole(username, role) {
  requireClient();
  const uname = normaliseUsername(username);
  const { error } = await supabase
    .from(TABLE)
    .update({ role: role === ROLES.OWNER ? ROLES.OWNER : ROLES.MEMBER })
    .eq('username', uname);
  if (error) throw error;
}

export async function removeAccount(username) {
  requireClient();
  const uname = normaliseUsername(username);
  const { error } = await supabase.from(TABLE).delete().eq('username', uname);
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
