// ─────────────────────────────────────────────────────────────────────────────
// Pure data-model helpers and constants — no Supabase client, no network, no
// keys. The frontend imports from here so it never needs the anon key.
// (All read/write now goes through the server endpoints in src/api.js.)
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

// Every input metric, grouped by the section/table it belongs to.
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
        { key: 'dl_paidCampaignSpend', label: 'Paid Campaign Spend', unit: 'usd' },
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
        { key: 'tx_cashOutVolume', label: 'Cash-Out Volume', unit: 'usdt' },
        { key: 'tx_cardRedemptionVolume', label: 'Card Redemption Volume', unit: 'usdt' },
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
        { key: 'c_redeemed', label: 'Cards Redeemed', unit: 'count' },
        { key: 'c_uniqueUsers', label: 'Unique Users', unit: 'count' },
        { key: 'c_usdtVolume', label: 'Card USDT Volume', unit: 'usdt' },
        { key: 'c_discountFeesLost', label: 'Discount & Fees Lost USD', unit: 'usd' },
        { key: 'c_grossRevenue', label: 'Gross Card Revenue USD', unit: 'usd' },
      ],
    },
    {
      title: 'By market',
      metrics: [
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
        { key: 'r_transactionFees', label: 'Transaction Fees', unit: 'usd' },
        { key: 'r_cardRedemptionFees', label: 'Card Redemption Fees', unit: 'usd' },
        { key: 'r_other', label: 'Other', unit: 'usd' },
      ],
    },
    {
      title: 'Costs',
      metrics: [
        { key: 'cost_ambassador', label: 'Ambassador Costs', unit: 'usd' },
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
  return Object.keys((data && data.years) || {})
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}
