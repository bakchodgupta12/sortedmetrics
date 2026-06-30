import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  MONTHS,
  PASSWORD_RULE,
  ROLES,
  changePassword,
  createAccount,
  emptyYear,
  getUser,
  getLastUpdated,
  isConfigured,
  isValidPassword,
  listAccounts,
  listYears,
  loadSharedData,
  normaliseData,
  removeAccount,
  saveData,
  setAccountRole,
  updateDisplayName,
  verifyPassword,
} from './supabase';

// Shared edit permission: false for read-only Members, true for Owners. The
// editable Cell reads this so every metric input across every tab becomes
// static text for Members without threading a prop through each table.
const EditableContext = React.createContext(true);

// ─────────────────────────────────────────────────────────────────────────────
// Number formatting
// ─────────────────────────────────────────────────────────────────────────────
export const DASH = '—';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Plain number with commas under 1,000,000; compact 1dp at/above.
export function fmtNumber(v) {
  if (!isNum(v)) return DASH;
  if (Math.abs(v) >= 1_000_000) return compact(v);
  return Math.round(v).toLocaleString('en-US');
}

export function compact(v) {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1e9).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function fmtPercent(v) {
  if (!isNum(v)) return DASH;
  return `${v.toFixed(1)}%`;
}

// 2-decimal percent — used for conversion rates (e.g. 69.50%).
export function fmtPercent2(v) {
  if (!isNum(v)) return DASH;
  return `${v.toFixed(2)}%`;
}

export function fmtUSDT(v) {
  if (!isNum(v)) return DASH;
  if (Math.abs(v) >= 1_000_000) return compact(v);
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Safe division — returns null (rendered as —) when the denominator is 0.
export function safeDiv(numerator, denominator) {
  if (!isNum(numerator) || !isNum(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

// Abbreviated money for the monthly grid and large-money columns (e.g. $403.2k,
// $1.2m, $412). One rule for every cell in a row so figures never mix
// abbreviated with full precision (which caused clipping/overlap). Full
// precision stays in the wide detail tables and while editing.
export function compactMoney(v) {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  // Always one decimal, every magnitude ($387.0k, $3.9k, -$247.0) so figures
  // read consistently down a column. Counts stay integer (fmtNumber); the
  // per-user ratio unit (CAC) keeps its 2 decimals (fmtByUnit).
  const c = (n) => n.toFixed(1);
  if (a >= 1e9) return `${s}$${c(a / 1e9)}b`;
  if (a >= 1e6) return `${s}$${c(a / 1e6)}m`;
  if (a >= 1e3) return `${s}$${c(a / 1e3)}k`;
  return `${s}$${c(a)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f7f5f0', // keep the warm cream dashboard backdrop
  card: '#fff',

  // Brand gray scale
  gray900: '#212121',
  gray800: '#424448',
  gray700: '#5c5d65',
  gray600: '#7b7d84',
  gray500: '#9da0aa',
  gray400: '#bcbfca',
  gray300: '#dfe3ed',
  gray200: '#eff2f7',
  gray100: '#f7f9fc',

  border: '#dfe3ed', // gray-300
  text: '#212121', // gray-900
  muted: '#7b7d84', // gray-600

  // Brand primary (UI chrome + primary actions) and accent red (alerts only)
  primary: '#0011a8',
  primaryDark: '#000077',
  red: '#ff0044',
  redBg: '#ffe3ea', // light red — cross-tab mismatch / validation highlight

  // Functional chart-series colours — distinct, carry meaning
  green: '#6dbb8a',
  amber: '#e8a838',
  blue: '#5b9bd5',
  blueLight: '#7eb5d6',
  purple: '#9b8ec4',
};

// Success/positive token (distinct from the alarm-red `C.red`, which is reserved
// for negatives and warnings only).
const SUCCESS = '#1f8a4d';

// Pleasant pastel categorical palette for multi-series charts. Chosen for
// legibility and a harmonious look rather than brand fidelity; alarm-red is
// never used for a data category (it stays reserved for negatives/warnings).
const PASTEL = {
  blue: '#8fa6e8', // periwinkle
  mint: '#84cdb0', // green
  sand: '#f0c674', // gold
  lavender: '#b79ce0',
  coral: '#efa08a', // warm — stands in for the old alarm-red category
  sky: '#7fc8dd',
  rose: '#e892b5',
  gray: '#c4c7d0', // neutral "other"
};

// Single shared chart palette. Every series references this so a given metric
// keeps the same colour on every tab — Installs is the same blue on the
// Dashboard and the Installs tab, Revenue the same gold everywhere, etc. Defined
// once here; never hard-code a chart colour at the call site.
const CHART_COLORS = {
  installs: '#5B8DEF', // installs / primary series
  users: '#2BC4A0', // users / active users
  revenue: '#F5A623', // revenue
  cost: '#E8557F', // cost
  transactions: '#9B7EDE', // transactions / fourth series
  cards: '#3FB9D4', // cards / fifth series
};

// Card chrome (per the reference): plain border + a soft shell shadow, NO
// coloured top edge. Used for every table/chart/KPI card across all tabs.
const CARD_BORDER = '#ecece5';
const CARD_SHADOW = '0 6px 30px rgba(20,20,40,0.07)';

function Card({ accent, style, children }) {
  // `accent` is accepted for call-site compatibility but no longer drawn — the
  // blue top edge was removed; cards are a plain border + shell shadow only.
  void accent;
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 16,
        boxShadow: CARD_SHADOW,
        padding: 20,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const TABS = [
  'Dashboard',
  'Installs & Users',
  'Retention',
  'Transactions',
  'Top-up Cards',
  'Costs & Revenue',
  'Campaigns',
];

// Short nav labels where the tab already implies context (display only — the
// tab keys/routing stay the full names).
const TAB_LABELS = {
  'Installs & Users': 'Users',
  'Top-up Cards': 'Cards',
  'Costs & Revenue': 'Revenue',
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────
const authInput = {
  width: '100%',
  padding: '10px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  background: '#fff',
  marginTop: 6,
};

const authBtn = (disabled) => ({
  width: '100%',
  padding: '11px 12px',
  border: 'none',
  borderRadius: 8,
  background: disabled ? C.gray400 : C.primary,
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  marginTop: 16,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginTop: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function AuthScreen({ onLogin }) {
  // step: 'username' | 'login'. Accounts are created by an Owner — there is no
  // self-signup and no security-question recovery.
  const [step, setStep] = useState('username');
  const [username, setUsername] = useState('');
  const [row, setRow] = useState(null); // existing account row, when known
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submitUsername = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError('');
    try {
      const existing = await getUser(username);
      if (existing) {
        setRow(existing);
        setPassword('');
        setStep('login');
      } else {
        setError('No account found for that username. Ask an Owner to create one for you.');
      }
    } catch (err) {
      setError(err.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ok = await verifyPassword(row, password);
      if (!ok) {
        setError('Incorrect password.');
        return;
      }
      onLogin(row);
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setPassword('');
    setError('');
    setRow(null);
    setStep('username');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <img
            src={`${process.env.PUBLIC_URL}/sorted-wordmark.svg`}
            alt="Sorted"
            style={{ height: 34, width: 'auto' }}
          />
        </div>
        <p
          style={{
            textAlign: 'center',
            color: C.muted,
            marginTop: 0,
            marginBottom: 20,
          }}
        >
          Wallet Metrics · Internal KPI dashboard
        </p>

        <Card accent={C.primary}>
          {!isConfigured && (
            <p style={{ color: C.red, fontSize: 13 }}>
              Supabase is not configured. Add your keys to <code>.env</code> and
              restart.
            </p>
          )}

          {step === 'username' && (
            <form onSubmit={submitUsername}>
              <Field label="Username">
                <input
                  style={authInput}
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. amara"
                />
              </Field>
              <button style={authBtn(busy)} disabled={busy}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={submitLogin}>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Welcome back, <strong>{row?.display_name || username}</strong>.
              </p>
              <Field label="Password">
                <input
                  style={authInput}
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <button style={authBtn(busy)} disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {error && (
            <p style={{ color: C.red, fontSize: 13, marginBottom: 0 }}>
              {error}
            </p>
          )}

          {step !== 'username' && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button type="button" onClick={back} style={linkBtn}>
                ← Different username
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const linkBtn = {
  background: 'none',
  border: 'none',
  color: C.primary,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// App shell
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'swm_username';

function App() {
  const [user, setUser] = useState(null); // the row
  const [bootstrapping, setBootstrapping] = useState(true);

  // Restore a session (username only — credentials are never stored).
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved || !isConfigured) {
      setBootstrapping(false);
      return;
    }
    getUser(saved)
      .then((row) => {
        if (row) setUser(row);
        else localStorage.removeItem(SESSION_KEY);
      })
      .catch(() => localStorage.removeItem(SESSION_KEY))
      .finally(() => setBootstrapping(false));
  }, []);

  const handleLogin = (row) => {
    localStorage.setItem(SESSION_KEY, row.username);
    setUser(row);
  };

  const handleLogout = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  };

  if (bootstrapping) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.muted,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) return <AuthScreen onLogin={handleLogin} />;

  return <Dashboard user={user} setUser={setUser} onLogout={handleLogout} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated dashboard shell
// ─────────────────────────────────────────────────────────────────────────────
const SAVE_DEBOUNCE_MS = 1500;

function Dashboard({ user, setUser, onLogout }) {
  // Master and Owners can edit and manage the team; Members are read-only.
  const canEdit = user.role === ROLES.MASTER || user.role === ROLES.OWNER;

  // The metrics dataset is shared team-wide and loaded once on mount.
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeYear, setActiveYear] = useState(() => new Date().getFullYear());
  const [activeTab, setActiveTab] = useState('Dashboard');

  const years = useMemo(() => (data ? listYears(data) : []), [data]);

  // Save status: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle');
  // Team-wide "last updated" timestamp (the shared dataset's updated_at).
  const [lastUpdated, setLastUpdated] = useState(null);
  const saveTimer = useRef(null);
  const skipNextSave = useRef(true); // don't save on initial mount / load

  // Best-effort refresh of the freshness indicator; never blocks the UI.
  const loadLastUpdated = useCallback(async () => {
    try {
      const ts = await getLastUpdated();
      if (ts) setLastUpdated(ts);
    } catch {
      /* non-critical — leave the existing value in place */
    }
  }, []);

  // Load the shared dataset once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadSharedData();
        const norm = normaliseData(raw || {});
        if (Object.keys(norm.years).length === 0) {
          norm.years[String(new Date().getFullYear())] = emptyYear();
        }
        if (cancelled) return;
        skipNextSave.current = true;
        setData(norm);
        const ys = listYears(norm);
        const cur = new Date().getFullYear();
        setActiveYear(ys.includes(cur) ? cur : ys[ys.length - 1] || cur);
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Could not load data.');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadLastUpdated();
  }, [loadLastUpdated]);

  const persist = useCallback(
    async (next) => {
      setSaveStatus('saving');
      try {
        await saveData(next);
        setSaveStatus('saved');
        loadLastUpdated();
      } catch (err) {
        setSaveStatus('error');
      }
    },
    [loadLastUpdated]
  );

  // Debounced auto-save whenever the shared data changes (owners only).
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (!canEdit || data == null) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(data), SAVE_DEBOUNCE_MS);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [data, persist, canEdit]);

  const refresh = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const [raw, row] = await Promise.all([loadSharedData(), getUser(user.username)]);
      const norm = normaliseData(raw || {});
      if (Object.keys(norm.years).length === 0) {
        norm.years[String(new Date().getFullYear())] = emptyYear();
      }
      skipNextSave.current = true;
      setData(norm);
      if (row) setUser(row);
      setSaveStatus('saved');
      loadLastUpdated();
    } catch {
      setSaveStatus('error');
    }
  }, [user.username, setUser, loadLastUpdated]);

  // Edit a single metric cell for the active year (owners only).
  const updateMetric = useCallback(
    (metricKey, month, value) => {
      if (!canEdit) return;
      setData((prev) => {
        if (!prev) return prev;
        const y = String(activeYear);
        const year = prev.years[y] || emptyYear();
        const metric = { ...(year[metricKey] || {}) };
        if (value === null || value === undefined || Number.isNaN(value)) {
          delete metric[month];
        } else {
          metric[month] = value;
        }
        return {
          ...prev,
          years: { ...prev.years, [y]: { ...year, [metricKey]: metric } },
        };
      });
    },
    [activeYear, canEdit]
  );

  const updateNote = useCallback(
    (month, text) => {
      if (!canEdit) return;
      setData((prev) => {
        if (!prev) return prev;
        const y = String(activeYear);
        const year = prev.years[y] || emptyYear();
        const notes = { ...(year.notes || {}) };
        if (!text || !text.trim()) delete notes[month];
        else notes[month] = text;
        return {
          ...prev,
          years: { ...prev.years, [y]: { ...year, notes } },
        };
      });
    },
    [activeYear, canEdit]
  );

  // Set a free-form field on the active year (e.g. the Campaigns list / KPI
  // strip, which don't fit the metric/month grid). Owners only.
  const updateYearField = useCallback(
    (field, value) => {
      if (!canEdit) return;
      setData((prev) => {
        if (!prev) return prev;
        const y = String(activeYear);
        const year = prev.years[y] || emptyYear();
        return { ...prev, years: { ...prev.years, [y]: { ...year, [field]: value } } };
      });
    },
    [activeYear, canEdit]
  );

  // Set a ROOT-level field (not under a year) — e.g. the Top-up Cards batch log
  // and per-country manual unique-users, which are cumulative / month-less.
  const updateRoot = useCallback(
    (field, value) => {
      if (!canEdit) return;
      setData((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [canEdit]
  );

  // Year management (owners only).
  const addYear = (year) => {
    if (!canEdit) return;
    setData((prev) => {
      if (!prev || prev.years[year]) return prev;
      return { ...prev, years: { ...prev.years, [year]: emptyYear() } };
    });
    setActiveYear(Number(year));
  };

  if (loadingData || data == null) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: loadError ? C.red : C.muted,
          padding: 20,
          textAlign: 'center',
        }}
      >
        {loadError ? `Could not load data: ${loadError}` : 'Loading…'}
      </div>
    );
  }

  const yearData = data.years[String(activeYear)] || emptyYear();

  return (
    <EditableContext.Provider value={canEdit}>
      <div style={{ minHeight: '100vh' }}>
        <TopNav
          user={user}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          years={years}
          activeYear={activeYear}
          onYearChange={setActiveYear}
          onAddYear={addYear}
          canAddYear={canEdit}
          saveStatus={saveStatus}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          onOpenSettings={() => setActiveTab('Settings')}
          onLogout={onLogout}
        />

        <main
          style={{
            maxWidth: 1600,
            margin: '0 auto',
            padding: '24px 40px 64px',
          }}
        >
          <TabContent
            tab={activeTab}
            yearData={yearData}
            activeYear={activeYear}
            years={years}
            allYears={data.years}
            user={user}
            setUser={setUser}
            canEdit={canEdit}
            updateMetric={updateMetric}
            updateNote={updateNote}
            updateYearField={updateYearField}
            updateRoot={updateRoot}
            cardBatches={data.cardBatches || []}
            cardCountryUsers={data.cardCountryUsers || {}}
          />
        </main>
      </div>
    </EditableContext.Provider>
  );
}

function saveStatusLabel(status) {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved · just now';
    case 'error':
      return 'Save failed';
    default:
      return '';
  }
}

// "2026-06-24T..." → "24 Jun 2026". Null if absent/unparseable.
function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Round avatar button (user's initial) opening a menu: account info, refresh,
// settings, and log out.
function ProfileMenu({ user, lastUpdated, saveStatus, onRefresh, onOpenSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const name = (user.display_name && user.display_name.trim()) || user.username;
  const initial = (name[0] || '?').toUpperCase();
  const lu = fmtDate(lastUpdated);

  // Save status folded onto the avatar: a small status dot + the menu line.
  const statusLabel = saveStatusLabel(saveStatus);
  const dotColor =
    saveStatus === 'saving'
      ? C.amber
      : saveStatus === 'saved'
      ? SUCCESS
      : saveStatus === 'error'
      ? C.red
      : null;

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        title={statusLabel ? `Account · ${statusLabel}` : 'Account'}
        aria-label={statusLabel ? `Account, ${statusLabel}` : 'Account'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `1px solid ${open ? C.primary : C.border}`,
          background: C.primary,
          color: '#fff',
          fontFamily: 'var(--font-head)',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {initial}
      </button>
      {dotColor && (
        <span
          aria-hidden="true"
          title={statusLabel}
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: dotColor,
            border: `2px solid ${C.bg}`,
            pointerEvents: 'none',
          }}
        />
      )}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 42,
            right: 0,
            zIndex: 40,
            background: '#fff',
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 6,
            minWidth: 210,
          }}
        >
          <div style={{ padding: '8px 12px 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{roleLabel(user.role)}</div>
            {statusLabel && (
              <div
                style={{
                  fontSize: 11.5,
                  color: saveStatus === 'error' ? C.red : C.muted,
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: dotColor || C.muted,
                    flexShrink: 0,
                  }}
                />
                {statusLabel}
              </div>
            )}
            {lu && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Last updated: {lu}</div>}
          </div>
          <div style={{ height: 1, background: C.border, margin: '2px 0 4px' }} />
          <MenuItem onClick={() => { setOpen(false); onRefresh(); }}>Refresh data</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onOpenSettings(); }}>Settings</MenuItem>
          <MenuItem danger onClick={() => { setOpen(false); onLogout(); }}>Log out</MenuItem>
        </div>
      )}
    </div>
  );
}

// Single top bar: Sorted wordmark (left), the tabs (centre), and on the right
// the year selector + a profile menu (Settings / Log out live in the menu).
function TopNav({
  user,
  activeTab,
  onTabChange,
  years,
  activeYear,
  onYearChange,
  onAddYear,
  canAddYear,
  saveStatus,
  lastUpdated,
  onRefresh,
  onOpenSettings,
  onLogout,
}) {
  const addNewYear = () => {
    const input = window.prompt('Add year (e.g. 2027):');
    if (!input) return;
    const year = parseInt(input, 10);
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      window.alert('Please enter a valid year.');
      return;
    }
    onAddYear(year);
  };

  return (
    <header
      data-no-print=""
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'rgba(247,245,240,0.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1600,
          margin: '0 auto',
          padding: '10px 40px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Left — Sorted wordmark, pulled left so its glyphs hang on the
            gridline. Equal-weight flex side so the centred nav is page-centred. */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          <img
            src={`${process.env.PUBLIC_URL}/sorted-wordmark.svg`}
            alt="Sorted"
            style={{ height: 22, width: 'auto', display: 'block', marginLeft: -6.5, flexShrink: 0 }}
          />
        </div>

        {/* Centre — tab navigation, centred in the bar. */}
        <nav style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: '0 1 auto', justifyContent: 'center' }}>
          {TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '6px 8px',
                  fontFamily: 'var(--font-head)',
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  color: active ? C.primary : C.muted,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {TAB_LABELS[tab] || tab}
              </button>
            );
          })}
        </nav>

        {/* Right — year selector + profile menu (save status lives on the avatar). */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <select
            value={activeYear}
            onChange={(e) => {
              if (e.target.value === '__add__') addNewYear();
              else onYearChange(Number(e.target.value));
            }}
            style={{
              flexShrink: 0,
              width: 'auto',
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              padding: '6px 30px 6px 12px',
              borderRadius: 9,
              border: `1px solid ${C.border}`,
              background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237b7d84' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 11px center`,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            {canAddYear && <option value="__add__">+ Add year…</option>}
          </select>
          <ProfileMenu
            user={user}
            lastUpdated={lastUpdated}
            saveStatus={saveStatus}
            onRefresh={onRefresh}
            onOpenSettings={onOpenSettings}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculation helpers (all live, never stored)
// ─────────────────────────────────────────────────────────────────────────────
const IDX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function getVal(yearData, key, i) {
  const v = yearData?.[key]?.[MONTHS[i]];
  return isNum(v) ? v : null;
}

// Prepend a "$" to a formatted money string, keeping any leading minus sign
// outside the symbol (e.g. -1,234.00 → -$1,234.00).
function withDollar(formatted) {
  if (formatted === DASH) return DASH;
  return formatted.startsWith('-') ? `-$${formatted.slice(1)}` : `$${formatted}`;
}

function fmtByUnit(v, unit) {
  switch (unit) {
    case 'usdt':
      return withDollar(fmtUSDT(v));
    case 'usd':
      return withDollar(fmtNumber(v));
    case 'percent':
      return fmtPercent(v);
    case 'percent2':
      return fmtPercent2(v);
    case 'ratio':
      if (!isNum(v)) return DASH;
      return withDollar(
        Math.abs(v) >= 1_000_000
          ? compact(v)
          : v.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
      );
    default:
      return fmtNumber(v); // count
  }
}

// Latest month index (0-11) with any data in the year, else -1.
function latestMonthIndex(yearData) {
  let latest = -1;
  for (let i = 0; i < 12; i++) {
    for (const key of Object.keys(yearData || {})) {
      if (key === 'notes') continue;
      if (isNum(yearData[key]?.[MONTHS[i]])) {
        latest = i;
        break;
      }
    }
  }
  return latest;
}

function rawSeries(yearData, key) {
  return IDX.map((i) => getVal(yearData, key, i));
}
function sumSeries(yearData, keys) {
  return IDX.map((i) => {
    let s = 0;
    let any = false;
    for (const k of keys) {
      const v = getVal(yearData, k, i);
      if (v != null) {
        s += v;
        any = true;
      }
    }
    return any ? s : null;
  });
}
function pctSeries(a, b) {
  return IDX.map((i) => {
    const r = safeDiv(a[i], b[i]);
    return r == null ? null : r * 100;
  });
}
function ratioSeries(a, b) {
  return IDX.map((i) => safeDiv(a[i], b[i]));
}
// Like a plain cumulative running total but seeded with a starting `base`
// (prior years' total),
// so a lifetime running total carries forward across years instead of resetting.
function cumulativeSeriesFrom(s, base) {
  let run = base || 0;
  let has = (base || 0) > 0;
  return IDX.map((i) => {
    if (s[i] != null) {
      run += s[i];
      has = true;
    }
    return has ? run : null;
  });
}
// Lifetime total of `keys` summed over every month of all years strictly
// before `activeYear` — the carry-forward seed for cumulative rows.
function priorYearsTotal(allYears, activeYear, keys) {
  let total = 0;
  for (const [y, yd] of Object.entries(allYears || {})) {
    if (Number(y) >= activeYear) continue;
    for (let i = 0; i < 12; i++) {
      for (const k of keys) {
        const v = yd?.[k]?.[MONTHS[i]];
        if (typeof v === 'number' && Number.isFinite(v)) total += v;
      }
    }
  }
  return total;
}
// All-time total of `keys` summed over every month of EVERY year — independent
// of the active year, so a "lifetime" figure reads identically in every view.
// Returns null when there's no data at all (so the cell shows a dash, not 0).
function allYearsTotal(allYears, keys) {
  let total = 0;
  let has = false;
  for (const yd of Object.values(allYears || {})) {
    for (let i = 0; i < 12; i++) {
      for (const k of keys) {
        const v = yd?.[k]?.[MONTHS[i]];
        if (typeof v === 'number' && Number.isFinite(v)) {
          total += v;
          has = true;
        }
      }
    }
  }
  return has ? total : null;
}
function diffSeries(a, b) {
  return IDX.map((i) => {
    if (a[i] == null && b[i] == null) return null;
    return (a[i] || 0) - (b[i] || 0);
  });
}
// Mean of a series across the months that have a value (null if none).
function seriesAvg(s) {
  let acc = 0;
  let n = 0;
  for (let i = 0; i < 12; i++) {
    if (s[i] != null) {
      acc += s[i];
      n += 1;
    }
  }
  return n === 0 ? null : acc / n;
}
// Sum of a series from Jan through `latest`.
function seriesSum(s, latest) {
  if (latest < 0) return null;
  let acc = 0;
  let any = false;
  for (let i = 0; i <= latest; i++) {
    if (s[i] != null) {
      acc += s[i];
      any = true;
    }
  }
  return any ? acc : null;
}
function pct(a, b) {
  const r = safeDiv(a, b);
  return r == null ? null : r * 100;
}
function valueAt(s, i) {
  return i >= 0 && i < 12 ? s[i] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Editable cell + info tooltip
// ─────────────────────────────────────────────────────────────────────────────
function Cell({ value, unit, onCommit, inputStyle, placeholder = DASH, compact = false, className }) {
  const editable = useContext(EditableContext);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  // Resting display: compact money in the narrow monthly grid, full elsewhere.
  const fmtRest = (v) =>
    compact && (unit === 'usd' || unit === 'usdt') ? compactMoney(v) : fmtByUnit(v, unit);

  // Read-only (Member) view: show the same figure, but as plain text — no
  // input, no focus affordance, not editable.
  if (!editable) {
    return (
      <span
        className={className}
        style={{
          display: 'block',
          textAlign: 'right',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          color: C.text,
          // Match the computed text cells' inset so Member view aligns too.
          padding: '9px 12px',
          ...inputStyle,
        }}
      >
        {value == null ? placeholder : fmtRest(value)}
      </span>
    );
  }
  // Money fields (USD / USDT / money ratios) carry a "$" prefix at rest and
  // while editing; counts and percentages do not.
  const isMoney = unit === 'usd' || unit === 'usdt' || unit === 'ratio';
  const shown = focused
    ? isMoney && draft !== ''
      ? `$${draft}`
      : draft
    : value == null
    ? ''
    : fmtRest(value);

  const commit = () => {
    const t = draft.trim().replace(/,/g, '');
    if (t === '') onCommit(null);
    else {
      const n = parseFloat(t);
      // Reject anything non-finite or negative — these fields are counts/amounts.
      onCommit(Number.isFinite(n) && n >= 0 ? n : null);
    }
  };

  return (
    <input
      value={shown}
      placeholder={placeholder}
      inputMode="decimal"
      onFocus={(e) => {
        setFocused(true);
        setDraft(value == null ? '' : String(value));
        // Drop the caret at the end of the existing value so edits start from
        // the right. Deferred so it runs after the draft re-render.
        const el = e.currentTarget;
        requestAnimationFrame(() => {
          const end = el.value.length;
          try {
            el.setSelectionRange(end, end);
          } catch {
            // setSelectionRange is unsupported on some input types — ignore.
          }
        });
      }}
      onChange={(e) =>
        // Allow only digits, thousands separators and a single decimal point.
        // Strips letters, symbols (incl. the "$"), and minus signs as typed.
        setDraft(e.target.value.replace(/[^0-9.,]/g, ''))
      }
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      // size=1 + minWidth:0 stop the input's default ~20ch intrinsic width from
      // ballooning its column in auto-layout tables (it still fills via width:100%).
      size={1}
      className={className}
      style={{
        // Constrain the input to its own cell: it fills the column but never
        // balloons past it. size=1 + minWidth:0 kill the input's default
        // ~20ch intrinsic width; box-sizing keeps the focus ring inside 100%.
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        textAlign: 'right',
        fontFamily: 'inherit',
        fontSize: 13,
        fontVariantNumeric: 'tabular-nums',
        color: focused ? '#16161f' : C.text,
        // Same padding as the computed text cells (8px 10px) so manual and
        // computed figures right-align to the same edge. The focus ring is an
        // INSET box-shadow, not a border — box-shadow doesn't take up layout
        // space, so resting and focused footprints are identical (no ~5px shift).
        background: focused ? '#fff' : 'transparent',
        border: 'none',
        boxShadow: focused ? `inset 0 0 0 1.5px ${C.primary}` : 'none',
        borderRadius: 7,
        // Roomy inset (matches the computed text cells) so the right-aligned
        // digits and caret never sit against the focus ring.
        padding: '9px 12px',
        outline: 'none',
        ...inputStyle,
      }}
    />
  );
}

function InfoTip({ text }) {
  // A cursor-following tooltip. It's rendered through a portal onto <body> so
  // it can never be clipped or stacked behind the sticky header / table cells.
  const [pos, setPos] = useState(null);
  const track = (e) => setPos({ x: e.clientX, y: e.clientY });
  const hovered = pos != null;

  return (
    <span
      onMouseEnter={track}
      onMouseMove={track}
      onMouseLeave={() => setPos(null)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: `1px solid ${hovered ? C.primary : C.muted}`,
        color: hovered ? C.primary : C.muted,
        fontSize: 9,
        marginLeft: 5,
        cursor: 'default',
        verticalAlign: 'middle',
        fontFamily: 'var(--font-head)',
        fontStyle: 'italic',
        lineHeight: 1,
      }}
    >
      i
      {hovered &&
        createPortal(
          <span
            style={{
              position: 'fixed',
              left: Math.min(pos.x + 14, window.innerWidth - 230),
              top: pos.y + 16,
              maxWidth: 220,
              background: C.gray900,
              color: '#fff',
              fontSize: 11,
              fontWeight: 400,
              fontStyle: 'normal',
              fontFamily: 'var(--font-body)',
              letterSpacing: 0,
              textTransform: 'none',
              lineHeight: 1.4,
              padding: '7px 9px',
              borderRadius: 7,
              textAlign: 'left',
              whiteSpace: 'normal',
              boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
              pointerEvents: 'none',
              zIndex: 2147483647,
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric table
// ─────────────────────────────────────────────────────────────────────────────
const thBase = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: C.muted,
  padding: '10px 10px',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

// Whitespace + a thin rule that separates a calculated block from the next
// section, so groups don't run straight into one another.
function DividerRow({ cols = 15 }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={cols} style={{ padding: 0 }}>
        <div style={{ height: 1, background: C.border, margin: '12px 0 2px' }} />
      </td>
    </tr>
  );
}

// ── Table restyle primitives (per the design reference) ─────────────────────
// Upcoming-months band tints, the reported→upcoming divider, and the muted
// sparkline colour for detail rows. Totals use the brand-blue primary.
const UP_BAND_DETAIL = 'rgba(0,17,168,0.025)';
const UP_BAND_TOTAL = 'rgba(0,17,168,0.06)';
const UP_DIVIDER = '#e2ddd2';
const CALC_ROW_BG = 'rgba(0,17,168,0.045)';
const CALC_LABEL_BG = '#f3f4fc'; // opaque ≈ CALC_ROW_BG over white (sticky col)
// Min width per reported month column — enough to hold an entered figure
// ($134.8k / 1,213) so the grid scrolls past ~7–8 months instead of clipping.
const REPORTED_MIN = 80;
// Fixed 12-month grid (Cards › By Month): a light-blue fill marks automated/calc
// rows, and the leading "Pre-launch" / trailing "Upcoming" groups get a labelled
// header strip plus a faint column tint (empty cells under them render blank).
// One shared blue token for the automated/derived-row fill AND the Upcoming
// band (label strip + column tint), so a derived row under the Upcoming band
// reads as one continuous colour instead of two clashing shades.
const CALC_FILL = '#eef0fb';
const UP_COL_TINT = CALC_FILL;
const PRE_COL_TINT = '#f4f3ef';
const UP_LABEL = '#6b74c4';
const UP_LABEL_BG = CALC_FILL;
const PRE_LABEL = '#9a9aa4';
const PRE_LABEL_BG = '#f1f0ec';
const SPARK_DETAIL = '#8a93d8';
const CURRENT_TEXT = '#16161f';
const VALUE_TEXT = '#3a3a44'; // default monthly figure colour (matches reference)
const DANGER = '#d23a52'; // sign-driven red for negative figures
// Pre-launch band — neutral grey (distinct from the brand-blue upcoming band),
// for periods before a programme started.
const PRELAUNCH_BAND = 'rgba(123,125,132,0.06)';
const PRELAUNCH_DIVIDER = '#dcd9d2';
const PRELAUNCH_LABEL = '#9a9aa4';
const OVER_100_NOTE =
  'Over 100%: more new users than installs this month — a real artifact (e.g. registration backlog or multi-device sign-ups), not an error.';

// Per-row sparkline drawn from the reported portion of a series (~60px). Muted
// blue for detail rows, solid brand blue (heavier) for total/subtotal rows.
function Sparkline({ values, color, strokeWidth = 1.6, width = 52, height = 21 }) {
  const nums = values.filter((v) => isNum(v));
  if (nums.length < 2) return null;
  const mn = Math.min(...nums);
  const mx = Math.max(...nums);
  const r = mx - mn || 1;
  const pad = 2.5;
  const h = height - pad * 2;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values
    .map((v, i) =>
      isNum(v) ? `${(i * step).toFixed(1)},${(pad + h - ((v - mn) / r) * h).toFixed(1)}` : null
    )
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

// Heat shade for an opt-in percentage cell, scaled across the row's reported
// values: brand blue at variable alpha; text flips to white above ~0.42.
function heatCell(reportedNums, v) {
  if (!isNum(v) || reportedNums.length === 0) return null;
  const mn = Math.min(...reportedNums);
  const mx = Math.max(...reportedNums);
  const r = mx - mn || 1;
  const a = 0.12 + ((v - mn) / r) * 0.72;
  return { background: `rgba(0,17,168,${a.toFixed(2)})`, color: a > 0.42 ? '#ffffff' : CURRENT_TEXT };
}

function MetricTable({ yearData, rows, updateMetric, totalLabel = 'YTD', preLaunchCols = 0, preLaunchLabel = 'Pre-launch', tintCalc = true, fixedMonths = false, emptyNote = null }) {
  const latest = latestMonthIndex(yearData);
  // Two layouts:
  // • fixedMonths (Cards › By Month): a fixed 12-column grid — every month Jan–Dec
  //   is always shown, no collapsing bands, no horizontal scroll. Months after the
  //   latest reported one are "upcoming": plain cells with a faint grey fill. The
  //   structure never changes month to month.
  // • default (other data tabs): empty periods collapse into ONE horizontal
  //   labelled band each (pre-launch grey on the left, far-future blue on the
  //   right) so the reported months flex to share the width.
  const P = Math.max(0, Math.min(12, preLaunchCols));
  const reported = [];
  if (fixedMonths) {
    for (let i = 0; i <= 11; i++) reported.push(i);
  } else {
    for (let i = P; i <= latest && i <= 11; i++) reported.push(i);
  }
  const hasPre = !fixedMonths && P > 0;
  const upStart = Math.max(P, latest + 1); // first not-yet-reported month — entered via the band
  const hasUp = !fixedMonths && upStart <= 11;
  const colCount = 3 + (hasPre ? 1 : 0) + reported.length + (hasUp ? 1 : 0);
  const isCurrent = (i) => i === latest && (fixedMonths ? latest >= 0 : latest >= P);
  // Fixed-grid bands: leading pre-launch months [0, P), trailing upcoming months
  // [upStart, 12). Both get a labelled header group + a faint column tint, and
  // their empty cells render blank (no dash). Everything between is the reported
  // region. A fully-reported year (neither band) shows no group row.
  const isPre = (i) => fixedMonths && i < P;
  const isUpcoming = (i) => fixedMonths && i >= upStart;
  const isBanded = (i) => isPre(i) || isUpcoming(i);
  const colTint = (i) => (isPre(i) ? PRE_COL_TINT : isUpcoming(i) ? UP_COL_TINT : undefined);
  const fixedPreBand = fixedMonths && P > 0;
  const fixedUpBand = fixedMonths && upStart <= 11;
  const activeSpan = upStart - P; // reported month count (between the two bands)

  // Compact money so abbreviated figures fit each cell.
  const fmtMoney = (v, unit) => (unit === 'usd' || unit === 'usdt' ? compactMoney(v) : fmtByUnit(v, unit));

  const inputYtd = (key, mode) => {
    if (latest < 0 || mode === 'none') return null;
    if (mode === 'last') return getVal(yearData, key, latest);
    const s = rawSeries(yearData, key);
    if (mode === 'avg') return seriesAvg(s);
    return seriesSum(s, latest);
  };

  // Plot the trend over the reported window only — drop leading pre-launch
  // months so the points span the full Trend cell instead of bunching at the
  // right (the nulls are filtered from the polyline but not from x-spacing).
  const sparkValues = (series) => (latest >= 0 ? series.slice(P, latest + 1) : series);
  const groupLabel = (color, bg) => ({
    textAlign: 'center',
    whiteSpace: 'nowrap',
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color,
    background: bg,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    padding: '5px 0 4px',
  });
  const summaryCell = { textAlign: 'right', padding: '12px 16px', borderLeft: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const summaryHead = { ...thBase, padding: '12px 16px', color: C.text, fontWeight: 700, borderLeft: `1px solid ${C.border}` };

  // Shared value-cell colour/weight. Ordinary computed rows render like detail
  // rows (no bold/blue); only `total` rows (calc rows on tables where tintCalc)
  // get the heavier/brand treatment. Negatives are red by the cell's own sign;
  // the current month is emphasised uniformly across all rows.
  const valStyle = (v, current, total) => {
    let color;
    let weight = total ? 600 : 400;
    // Latest reported month: bold blue text (no fill) on the fixed grid.
    if (current) weight = total || fixedMonths ? 700 : 600;
    if (isNum(v) && v < 0) color = DANGER;
    else if (current) color = fixedMonths || total ? C.primary : CURRENT_TEXT;
    else if (isNum(v) && v === 0) color = '#b0b0ba';
    else color = VALUE_TEXT;
    return { color, weight };
  };

  // Horizontal, shrink-to-label band headers + empty band body cells.
  const preHead = (
    <th style={{ ...thBase, textAlign: 'center', whiteSpace: 'nowrap', color: PRELAUNCH_LABEL, background: PRELAUNCH_BAND, borderRight: `1px solid ${PRELAUNCH_DIVIDER}` }}>
      {preLaunchLabel}
    </th>
  );
  const upHead = (
    <th style={{ ...thBase, textAlign: 'center', whiteSpace: 'nowrap', color: C.primary, background: UP_BAND_TOTAL, borderLeft: `1px solid ${UP_DIVIDER}` }}>
      {`▦ Upcoming · ${MONTHS[upStart]} – Dec`}
    </th>
  );
  const preBandCell = <td style={{ background: PRELAUNCH_BAND, borderRight: `1px solid ${PRELAUNCH_DIVIDER}` }} />;
  const upBandCell = <td style={{ background: UP_BAND_DETAIL, borderLeft: `1px solid ${UP_DIVIDER}` }} />;

  // A year fully before THIS tab began tracking. `latest` can't gate this —
  // latestMonthIndex scans the whole year's data across every tab, so a 2023
  // with Installs data but no Transactions still reports latest>=0. Instead,
  // check whether any of this tab's own rows hold a value this year.
  const tabHasData = rows.some((r) =>
    r.kind === 'input'
      ? rawSeries(yearData, r.key).some(isNum)
      : Array.isArray(r.values) && r.values.some(isNum)
  );
  // When empty: keep the metric labels but blank every month/YTD cell and float
  // one centered muted line over the month area — no dashes, no side band.
  if (fixedMonths && emptyNote && !tabHasData) {
    return (
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <colgroup>
            <col style={{ width: 166 }} />
            <col style={{ width: 70 }} />
            {reported.map((i) => (
              <col key={i} />
            ))}
            <col style={{ width: 92 }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ ...thBase, textAlign: 'left', padding: '12px 16px' }}>Metric</th>
              <th style={{ ...thBase, textAlign: 'left', padding: '12px 8px 12px 0' }}>Trend</th>
              {reported.map((i) => (
                <th key={i} style={{ ...thBase }} />
              ))}
              <th style={summaryHead}>{totalLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) =>
              row.kind === 'subhead' ? (
                <tr key={`s${ri}`}>
                  <td
                    colSpan={colCount}
                    style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: C.primary, textAlign: 'left', padding: '16px 16px 6px', whiteSpace: 'nowrap' }}
                  >
                    {row.label}
                  </td>
                </tr>
              ) : (
                <tr key={`e${ri}`} style={{ borderTop: `1px solid ${C.gray200}` }}>
                  <td style={{ textAlign: 'left', fontSize: 13, fontWeight: 500, padding: '9px 16px', whiteSpace: 'nowrap', color: C.muted }}>
                    {row.label}
                  </td>
                  <td colSpan={colCount - 1} />
                </tr>
              )
            )}
          </tbody>
        </table>
        {/* Centered note across the month area (Metric 166 + Trend 60 on the
            left, YTD 92 on the right are left clear). */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 226, right: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 13, color: C.muted }}>{emptyNote}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          width: fixedMonths || reported.length > 0 ? '100%' : 'auto',
          tableLayout: fixedMonths ? 'fixed' : 'auto',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Fixed grid: Metric/Trend/YTD fixed, the 12 months share the rest
            equally (table-layout:fixed; they all fit a 1440 screen because the
            formatters compact large values). Band layout: bands shrink to their
            label and the reported months flex with a min-width. */}
        {fixedMonths ? (
          <colgroup>
            <col style={{ width: 166 }} />
            <col style={{ width: 70 }} />
            {reported.map((i) => (
              <col key={i} />
            ))}
            <col style={{ width: 92 }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: 190 }} />
            <col style={{ width: 70 }} />
            {hasPre && <col style={{ width: 160 }} />}
            {reported.map((i) => (
              <col key={i} style={{ minWidth: REPORTED_MIN }} />
            ))}
            {hasUp && <col style={{ width: 150 }} />}
            <col style={{ width: 96 }} />
          </colgroup>
        )}
        <thead>
          {/* Fixed-grid group strip: a slim "Pre-launch" / "Upcoming" label over
              the banded month columns. Only shown when a band exists. */}
          {fixedMonths && (fixedPreBand || fixedUpBand) && (
            <tr>
              <th colSpan={2} />
              {fixedPreBand && (
                <th colSpan={P} style={groupLabel(PRE_LABEL, PRE_LABEL_BG)}>
                  Pre-launch
                </th>
              )}
              {activeSpan > 0 && <th colSpan={activeSpan} />}
              {fixedUpBand && (
                <th colSpan={12 - upStart} style={groupLabel(UP_LABEL, UP_LABEL_BG)}>
                  Upcoming
                </th>
              )}
              <th />
            </tr>
          )}
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th
              style={{
                ...thBase,
                textAlign: 'left',
                padding: '12px 16px',
                position: 'sticky',
                left: 0,
                background: C.card,
                zIndex: 1,
              }}
            >
              Metric
            </th>
            <th style={{ ...thBase, textAlign: 'left', padding: '12px 8px 12px 0' }}>Trend</th>
            {hasPre && preHead}
            {reported.map((i) => (
              <th
                key={i}
                style={{
                  ...thBase,
                  minWidth: fixedMonths ? undefined : REPORTED_MIN,
                  fontWeight: 700,
                  color: isCurrent(i) ? C.primary : isBanded(i) ? C.gray500 : C.muted,
                  background: colTint(i),
                }}
              >
                {MONTHS[i]}
              </th>
            ))}
            {hasUp && upHead}
            <th style={summaryHead}>{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            // A break (gap + rule) goes after a calculated block whenever the
            // next row starts a new group (an input or a section header).
            const prev = rows[ri - 1];
            const needsBreak =
              prev && prev.kind === 'calc' && row.kind !== 'calc' && !row.noBreak;

            if (row.kind === 'subhead') {
              return (
                <React.Fragment key={`s${ri}`}>
                  {needsBreak && <DividerRow cols={colCount} />}
                  <tr>
                    <td
                      colSpan={colCount}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: C.primary,
                        textAlign: 'left',
                        padding: '16px 16px 6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.label}
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            if (row.kind === 'input') {
              const ytd = inputYtd(row.key, row.ytd || 'sum');
              const series = rawSeries(yearData, row.key);
              const heatNums = row.heat ? sparkValues(series).filter(isNum) : null;
              return (
                <React.Fragment key={row.key}>
                  {needsBreak && <DividerRow cols={colCount} />}
                  <tr style={{ borderTop: `1px solid ${C.gray200}` }}>
                    <td
                      style={{
                        textAlign: 'left',
                        fontSize: 13,
                        fontWeight: 500,
                        padding: '8px 16px',
                        whiteSpace: fixedMonths ? 'nowrap' : undefined,
                        position: 'sticky',
                        left: 0,
                        background: C.card,
                        zIndex: 1,
                      }}
                    >
                      <div style={{ lineHeight: 1.25 }}>
                        {row.label}
                        {row.info && <InfoTip text={row.info} />}
                      </div>
                      {row.sub && (
                        <div style={{ fontSize: 10, color: '#a8a8b0', fontWeight: 500, marginTop: 2 }}>
                          {row.sub}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px 4px 0', textAlign: 'left', overflow: 'hidden' }}>
                      <Sparkline values={sparkValues(series)} color={SPARK_DETAIL} />
                    </td>
                    {hasPre && preBandCell}
                    {reported.map((i) => {
                      const m = MONTHS[i];
                      const cellVal = getVal(yearData, row.key, i);
                      // Per-row pre-launch (store not yet live) with no data renders
                      // as a faint en-dash — lighter than a genuine no-data dash,
                      // never 0. A real value is still shown so data isn't hidden.
                      const preLaunch =
                        row.preLaunchUntil != null && i < row.preLaunchUntil && !isNum(cellVal);
                      if (preLaunch) {
                        return (
                          <td key={m} style={{ textAlign: 'right', padding: '9px 12px', color: '#d4d4da' }}>
                            –
                          </td>
                        );
                      }
                      // Cross-tab drift check: flag (don't force) a mismatch
                      // against the linked metric on another tab for this month.
                      let mismatch = null;
                      if (row.compare) {
                        const other = getVal(yearData, row.compare.key, i);
                        if (cellVal != null && other != null && cellVal !== other) {
                          mismatch = row.compare.message;
                        }
                      }
                      const cur = isCurrent(i);
                      const heat = row.heat ? heatCell(heatNums, cellVal) : null;
                      const inStyle = heat
                        ? { color: heat.color, fontWeight: 600 }
                        : cur
                        ? { color: fixedMonths ? C.primary : CURRENT_TEXT, fontWeight: fixedMonths ? 700 : 600 }
                        : { color: VALUE_TEXT };
                      return (
                        <td
                          key={m}
                          title={mismatch || undefined}
                          style={{
                            textAlign: 'right',
                            minWidth: fixedMonths ? undefined : REPORTED_MIN,
                            // No td padding — the input carries the 8px 10px inset
                            // itself, so manual figures align to the same right edge
                            // as the computed/readonly text cells.
                            padding: 0,
                            background: mismatch
                              ? C.redBg
                              : heat
                              ? heat.background
                              : row.launchIdx === i
                              ? 'rgba(0,17,168,0.05)'
                              : colTint(i),
                          }}
                        >
                          <Cell
                            value={cellVal}
                            unit={row.unit}
                            onCommit={(v) => updateMetric(row.key, m, v)}
                            inputStyle={inStyle}
                            placeholder={isBanded(i) ? '' : DASH}
                            compact
                          />
                        </td>
                      );
                    })}
                    {hasUp && (
                      // The next month is entered here in the band cell (no stray
                      // column). The placeholder names the month ("Jun ·") so inline
                      // entry isn't a mystery; `dc-band-hint` styles it faint/small.
                      <td style={{ background: UP_BAND_DETAIL, borderLeft: `1px solid ${UP_DIVIDER}`, padding: 0 }}>
                        <Cell
                          value={getVal(yearData, row.key, upStart)}
                          unit={row.unit}
                          onCommit={(v) => updateMetric(row.key, MONTHS[upStart], v)}
                          placeholder={`${MONTHS[upStart]} ·`}
                          className="dc-band-hint"
                          compact
                        />
                      </td>
                    )}
                    <td style={{ ...summaryCell, fontSize: 13, fontWeight: 700, color: ytd == null ? C.gray400 : C.text }}>
                      {row.ytd === 'none' ? '' : ytd == null ? DASH : fmtMoney(ytd, row.unit)}
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            // Read-only "pulled" row: a value sourced from another tab, shown
            // (muted, non-editable) rather than entered. No input affordance.
            if (row.kind === 'readonly') {
              const ytd = latest < 0 ? null : seriesSum(row.values, latest);
              return (
                <React.Fragment key={`r${ri}`}>
                  {needsBreak && <DividerRow cols={colCount} />}
                  <tr style={{ borderTop: `1px solid ${C.gray200}` }}>
                    <td
                      style={{
                        textAlign: 'left',
                        fontSize: 13,
                        fontWeight: 500,
                        padding: '8px 16px',
                        lineHeight: 1.25,
                        whiteSpace: fixedMonths ? 'nowrap' : undefined,
                        position: 'sticky',
                        left: 0,
                        background: C.card,
                        zIndex: 1,
                      }}
                    >
                      {row.label}
                      {row.info && <InfoTip text={row.info} />}
                    </td>
                    <td style={{ padding: '4px 8px 4px 0', textAlign: 'left', overflow: 'hidden' }}>
                      <Sparkline values={sparkValues(row.values)} color={SPARK_DETAIL} />
                    </td>
                    {hasPre && preBandCell}
                    {reported.map((i) => {
                      const v = row.values[i];
                      const { color, weight } = valStyle(v, isCurrent(i), false);
                      return (
                        <td
                          key={i}
                          style={{
                            textAlign: 'right',
                            minWidth: fixedMonths ? undefined : REPORTED_MIN,
                            whiteSpace: 'nowrap',
                            padding: '9px 12px',
                            fontSize: 13,
                            fontWeight: weight,
                            color: v == null ? C.gray400 : color,
                            background: colTint(i),
                          }}
                        >
                          {v != null ? fmtMoney(v, row.unit) : isBanded(i) ? '' : DASH}
                        </td>
                      );
                    })}
                    {hasUp && upBandCell}
                    <td style={{ ...summaryCell, fontSize: 13, fontWeight: 700, color: ytd == null ? C.gray400 : C.text }}>
                      {ytd == null ? DASH : fmtMoney(ytd, row.unit)}
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            // calc row — render like detail rows by default; only `tintCalc`
            // tables (genuine totals) get the heavier/brand-blue treatment.
            const isTotalRow = tintCalc;
            const heatNums = row.heat ? sparkValues(row.values).filter(isNum) : null;
            // Fixed grid marks an automated row with a light-blue fill across the
            // whole row; the band reads as "calculated, not inputable".
            const calcBg = fixedMonths ? CALC_FILL : tintCalc ? CALC_ROW_BG : undefined;
            return (
              // Every other row type sets a top border; the calc row must too,
              // or untinted it visually merges into the row above.
              <tr key={`c${ri}`} style={{ borderTop: `1px solid ${C.gray200}`, background: calcBg }}>
                <td
                  style={{
                    textAlign: 'left',
                    fontSize: 13,
                    fontWeight: isTotalRow ? 700 : 500,
                    color: fixedMonths ? VALUE_TEXT : isTotalRow ? undefined : C.gray700,
                    padding: '8px 16px',
                    lineHeight: 1.25,
                    whiteSpace: fixedMonths ? 'nowrap' : undefined,
                    position: 'sticky',
                    left: 0,
                    background: fixedMonths ? CALC_FILL : tintCalc ? CALC_LABEL_BG : C.card,
                    zIndex: 1,
                  }}
                >
                  {row.label}
                  {row.formula && <InfoTip text={row.formula} />}
                </td>
                <td style={{ padding: '4px 8px 4px 0', textAlign: 'left', overflow: 'hidden' }}>
                  <Sparkline values={sparkValues(row.values)} color={isTotalRow ? C.primary : SPARK_DETAIL} strokeWidth={isTotalRow ? 1.8 : 1.6} />
                </td>
                {hasPre && preBandCell}
                {reported.map((i) => {
                  const v = row.values[i];
                  const cur = isCurrent(i);
                  const heat = row.heat ? heatCell(heatNums, v) : null;
                  const over100 = row.flagOver100 && isNum(v) && v > 100;
                  let style;
                  if (heat) {
                    style = { color: heat.color, fontWeight: cur ? 700 : 600, background: heat.background };
                  } else {
                    const s = valStyle(v, cur, isTotalRow);
                    style = { color: v == null ? C.gray400 : s.color, fontWeight: s.weight };
                  }
                  return (
                    <td
                      key={i}
                      title={over100 ? OVER_100_NOTE : undefined}
                      style={{
                        textAlign: 'right',
                        minWidth: fixedMonths ? undefined : REPORTED_MIN,
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                        padding: '9px 12px',
                        ...style,
                        // Banded month: the faint column tint sits over the calc
                        // row's blue fill (matches the reference's .up on .auto).
                        ...(isBanded(i) ? { background: colTint(i) } : null),
                      }}
                    >
                      {v != null ? `${fmtMoney(v, row.unit)}${over100 ? '*' : ''}` : isBanded(i) ? '' : DASH}
                    </td>
                  );
                })}
                {hasUp && upBandCell}
                <td
                  style={{
                    ...summaryCell,
                    fontSize: 13,
                    fontWeight: isTotalRow ? 800 : 700,
                    background: fixedMonths ? CALC_FILL : undefined,
                    color: isNum(row.ytd) && row.ytd < 0 ? DANGER : row.ytd == null ? C.gray400 : C.text,
                  }}
                >
                  {row.blankTotal ? '' : row.ytd == null ? DASH : fmtMoney(row.ytd, row.unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function calc(label, unit, values, ytd, formula) {
  return { kind: 'calc', label, unit, values, ytd, formula };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart kit
// ─────────────────────────────────────────────────────────────────────────────
const GRID = { strokeDasharray: '3 3', vertical: false, stroke: C.border };
const X_AXIS = {
  dataKey: 'm',
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: C.muted },
};
const yAxis = (extra = {}) => ({
  tickLine: false,
  axisLine: false,
  width: 46,
  tick: { fontSize: 11, fill: C.muted },
  tickFormatter: (v) => compact(v),
  ...extra,
});

function ChartCard({ title, height = 240, children }) {
  return (
    <Card accent={C.primary} style={{ paddingBottom: 12 }}>
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </Card>
  );
}

// Shared tooltip card chrome so every chart's hover tooltip looks identical
// (matches the app's card styling: white surface, hairline border, soft shadow).
const TOOLTIP_BOX = {
  background: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '8px 10px',
  boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
  fontSize: 12,
};

function ChartTooltip({ active, payload, label, fmt, reported }) {
  if (!active || !payload || !payload.length) return null;
  const f = fmt || fmtNumber;
  const i = MONTHS.indexOf(label);
  const upcoming = reported != null && reported >= 0 && i > reported;
  // Hide the dashed "projection" duplicate series (keys ending in __up).
  const rows = payload.filter((p) => !String(p.dataKey).endsWith('__up'));
  return (
    <div style={TOOLTIP_BOX}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {upcoming ? (
        <div style={{ color: C.muted }}>Not yet reported</div>
      ) : (
        rows.map((p) => (
          <div key={p.dataKey} style={{ color: p.color || p.stroke }}>
            {p.name}: {p.value == null ? DASH : f(p.value)}
          </div>
        ))
      )}
    </div>
  );
}

const monthChartData = (seriesMap) =>
  IDX.map((i) => {
    const row = { m: MONTHS[i] };
    for (const [name, s] of Object.entries(seriesMap)) row[name] = s[i];
    return row;
  });

// Upcoming-months treatment shared by every monthly chart: a faint band over
// the unreported region, a divider at the current-month boundary, and a small
// "Upcoming" label. Returns chart children (or null when the year is complete).
const UPCOMING_BAND = 'rgba(0,17,168,0.04)';
const UPCOMING_DIVIDER = '#d9d5cc';
const UPCOMING_LABEL = '#9a9aa4';
function upcomingRefs(reported) {
  if (reported == null || reported < 0 || reported >= 11) return null;
  return [
    <ReferenceArea
      key="up-band"
      x1={MONTHS[reported]}
      x2={MONTHS[11]}
      fill={UPCOMING_BAND}
      stroke="none"
      label={{ value: 'Upcoming', position: 'insideTopLeft', fontSize: 11, fill: UPCOMING_LABEL }}
    />,
    <ReferenceLine key="up-div" x={MONTHS[reported]} stroke={UPCOMING_DIVIDER} strokeWidth={1} />,
  ];
}

function gradient(id, color) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.25} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Installs & Users tab (internal keys keep the legacy "download" naming)
// ─────────────────────────────────────────────────────────────────────────────
// Store launch dates drive the "pre-launch" rendering in the Installs section:
// months before a store went live show a faint en-dash (not 0 / not no-data),
// and the launch month is tinted. y/m are zero-based calendar (m: 0 = Jan).
const STORE_LAUNCH = {
  dl_kaios: { y: 2023, m: 0, label: 'Live since 2023' },
  dl_googlePlay: { y: 2025, m: 2, label: 'Launched Mar 2025' },
  dl_palmStore: { y: 2025, m: 5, label: 'Launched Jun 2025' },
  dl_indusStore: { y: 2025, m: 6, label: 'Launched Jul 2025' },
  dl_vivoStore: { y: 2026, m: 3, label: 'Launched Apr 2026' },
};

// Intentional pastel palette for the store charts (NOT brand-mapped — chosen
// for legibility across 5 series). Exact hexes per the design handoff.
// Brighter per-store palette for the "Installs by Store" stacked chart. Single
// source of truth — the chart and its legend both read these.
const STORE_KEYS = [
  ['dl_kaios', 'KaiOS', '#6E8AF0'],
  ['dl_googlePlay', 'Google Play', '#3DCCA6'],
  ['dl_palmStore', 'Palm Store', '#F7B53D'],
  ['dl_indusStore', 'Indus Store', '#A98CEC'],
  ['dl_vivoStore', 'Vivo Store', '#FF6F91'],
];

// Stores live in a given year (curated): 2023–24 KaiOS only; 2025 drops Vivo;
// 2026+ all. Removes the row AND the chart series for stores not yet live.
function visibleStoresFor(year) {
  return STORE_KEYS.filter(([key]) =>
    year <= 2024 ? key === 'dl_kaios' : year === 2025 ? key !== 'dl_vivoStore' : true
  );
}

function DownloadsTab({ yearData, updateMetric, allYears, activeYear }) {
  const latest = latestMonthIndex(yearData);
  const storeKeys = STORE_KEYS.map((s) => s[0]); // all stores — lifetime carry-forward
  const visibleStores = visibleStoresFor(activeYear);
  const visibleKeys = visibleStores.map((s) => s[0]);

  const newDownloads = sumSeries(yearData, visibleKeys); // "new installs" = visible stores
  const newUsers = rawSeries(yearData, 'u_newUsers');

  // Lifetime running totals carry forward across years (this tab only): seed
  // each year's cumulative from the sum of all prior years.
  const baseInstalls = priorYearsTotal(allYears, activeYear, storeKeys);
  const baseUsers = priorYearsTotal(allYears, activeYear, ['u_newUsers']);
  const cumDownloads = cumulativeSeriesFrom(newDownloads, baseInstalls);
  const cumUsers = cumulativeSeriesFrom(newUsers, baseUsers);

  const conversion = pctSeries(newUsers, newDownloads); // monthly
  const cumConversion = pctSeries(cumUsers, cumDownloads); // all-time

  const ndY = seriesSum(newDownloads, latest); // year-to-date (this year only)
  const nuY = seriesSum(newUsers, latest);

  // Lifetime figures for the cumulative rows' total column.
  const lifeInstalls =
    latest >= 0 ? valueAt(cumDownloads, latest) : baseInstalls > 0 ? baseInstalls : null;
  const lifeUsers =
    latest >= 0 ? valueAt(cumUsers, latest) : baseUsers > 0 ? baseUsers : null;

  // Per-store pre-launch boundary for the active year: months before launch
  // render as a faint en-dash (store wasn't live), the launch month is tinted.
  // Launch-month boundary within the launch year (faint en-dash before launch,
  // tinted launch month). No sub-label — store name only, single line.
  const storeLaunchInfo = (key) => {
    const L = STORE_LAUNCH[key];
    if (!L) return { preLaunchUntil: 0, launchIdx: -1 };
    if (activeYear < L.y) return { preLaunchUntil: 12, launchIdx: -1 };
    if (activeYear > L.y) return { preLaunchUntil: 0, launchIdx: -1 };
    return { preLaunchUntil: L.m, launchIdx: L.m };
  };

  const rows = [
    { kind: 'subhead', label: 'Installs' },
    ...visibleStores.map(([key, label]) => ({
      kind: 'input',
      key,
      label,
      unit: 'count',
      ...storeLaunchInfo(key),
    })),
    calc('New Installs', 'count', newDownloads, ndY, 'Total app installs across all stores in the month.'),
    calc(
      'Total Installs',
      'count',
      cumDownloads,
      lifeInstalls,
      'Cumulative installs across all stores since launch.'
    ),
    { kind: 'subhead', label: 'Users' },
    { kind: 'input', key: 'u_newUsers', label: 'New Users', unit: 'count' },
    calc(
      'Total Users',
      'count',
      cumUsers,
      lifeUsers,
      'Cumulative registered users since launch.'
    ),
    { kind: 'subhead', label: 'User Conversion Rate' },
    {
      ...calc(
        'Monthly',
        'percent2',
        conversion,
        pct(nuY, ndY),
        'The rate at which new installs converted to users this month (new users this month ÷ new installs this month).'
      ),
      flagOver100: true,
    },
    calc(
      'Overall',
      'percent2',
      cumConversion,
      pct(lifeUsers, lifeInstalls),
      'The rate at which all-time installs have converted into registered users (total users ÷ total installs).'
    ),
  ];

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card>
        <TabTitle
          title="Installs & Users"
          onDownload={() => downloadTextFile(`sorted-installs-users-${activeYear}.csv`, metricRowsToCsv(rows, yearData, 'YTD'))}
        />
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          fixedMonths
        />
      </Card>
      <StoreInstallsChart yearData={yearData} latest={latest} stores={visibleStores} />
    </div>
  );
}

// Compact thousands label (69015 → "69k"); whole numbers under 1k as-is.
function fmtK(n) {
  return Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;
}
// Round up to a "nice" axis maximum so a 100% stack never floats to 100.0001%
// and volume ticks land on clean numbers.
function niceCeil(n) {
  if (!isNum(n) || n <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / pow;
  const nf = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : f <= 7.5 ? 7.5 : 10;
  return nf * pow;
}

// "Installs by Store" — a div-based stacked bar with a Volume / Share toggle.
// Volume: bar height = that month's real total installs (bars differ in height).
// Share: 100%-stacked (every bar full height). Future months render as clean
// empty "Upcoming" slots; reported bars end at the current month.
function StoreInstallsChart({ yearData, latest, stores: storeDefs = STORE_KEYS }) {
  const [mode, setMode] = useState('volume');
  const [hovered, setHovered] = useState(null); // month index under the cursor
  const stores = storeDefs.map(([key, label, color]) => ({
    key,
    label,
    color,
    vals: rawSeries(yearData, key),
  }));

  // Per-month totals across stores (reported months only).
  const totals = IDX.map((m) => {
    if (latest < 0 || m > latest) return null;
    let t = 0;
    let any = false;
    stores.forEach((s) => {
      if (isNum(s.vals[m])) {
        t += s.vals[m];
        any = true;
      }
    });
    return any ? t : 0;
  });
  const maxTotal = Math.max(1, ...totals.filter(isNum));
  const axisMax = niceCeil(maxTotal);
  const yTicks =
    mode === 'share'
      ? ['100%', '75%', '50%', '25%', '0']
      : [fmtK(axisMax), fmtK(axisMax * 0.75), fmtK(axisMax * 0.5), fmtK(axisMax * 0.25), '0'];

  const gridLine = (top) => (
    <div
      key={top}
      style={{ position: 'absolute', left: 0, right: 0, top: `${top}%`, height: 1, background: top === 100 ? '#e5e1d8' : '#f0ede6' }}
    />
  );

  let firstUpcoming = true;
  const bars = IDX.map((m) => {
    const isUpcoming = latest < 0 || m > latest;
    const current = m === latest;
    if (isUpcoming) {
      const showLabel = firstUpcoming;
      firstUpcoming = false;
      return { m, current, upcoming: true, showLabel };
    }
    const total = totals[m] || 0;
    const stackH = mode === 'share' ? (total > 0 ? 100 : 0) : (total / axisMax) * 100;
    const segs = stores
      .map((s) => {
        const v = s.vals[m];
        if (!isNum(v) || v <= 0 || total === 0) return null;
        return { color: s.color, h: (v / total) * 100 };
      })
      .filter(Boolean);
    return { m, current, upcoming: false, stackH, segs };
  });

  const toggleBtn = (m, label) => (
    <div
      key={m}
      onClick={() => setMode(m)}
      style={{
        padding: '5px 13px',
        borderRadius: 7,
        fontSize: 11.5,
        cursor: 'pointer',
        fontWeight: mode === m ? 600 : 500,
        background: mode === m ? C.primary : 'transparent',
        color: mode === m ? '#fff' : C.muted,
      }}
    >
      {label}
    </div>
  );

  return (
    <Card style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>
            Installs by Store
          </h3>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {mode === 'volume'
              ? 'Total new installs per store, by month.'
              : 'Share of new installs per store, by month (100% stacked).'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#f3f1ec', borderRadius: 9, padding: 3 }}>
          {toggleBtn('volume', 'Volume')}
          {toggleBtn('share', 'Share')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: 200,
            width: 36,
            fontSize: 10,
            color: '#b0b0ba',
            textAlign: 'right',
          }}
        >
          {yTicks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
        <div style={{ flex: 1, position: 'relative', height: 200 }}>
          {[0, 25, 50, 75, 100].map((t) => gridLine(t))}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {bars.map((bar) =>
              bar.upcoming ? (
                <div
                  key={bar.m}
                  style={{
                    flex: 1,
                    height: '100%',
                    background: 'rgba(0,17,168,0.03)',
                    border: '1px dashed #dedbf0',
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    paddingTop: 10,
                  }}
                >
                  {bar.showLabel && (
                    <span
                      style={{
                        fontSize: 10,
                        color: '#9aa0c0',
                        fontWeight: 600,
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                      }}
                    >
                      Upcoming
                    </span>
                  )}
                </div>
              ) : (
                <div
                  key={bar.m}
                  onMouseEnter={() => setHovered(bar.m)}
                  onMouseLeave={() => setHovered((h) => (h === bar.m ? null : h))}
                  style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative' }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: `${bar.stackH.toFixed(2)}%`,
                      display: 'flex',
                      flexDirection: 'column-reverse',
                      borderRadius: '5px 5px 0 0',
                      overflow: 'hidden',
                    }}
                  >
                    {bar.segs.map((seg, si) => (
                      <div key={si} style={{ width: '100%', height: `${seg.h.toFixed(2)}%`, background: seg.color }} />
                    ))}
                  </div>
                  {hovered === bar.m && (
                    <div
                      style={{
                        ...TOOLTIP_BOX,
                        position: 'absolute',
                        bottom: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginBottom: 8,
                        zIndex: 20,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{MONTHS[bar.m]}</div>
                      {stores.map((s) => (
                        <div key={s.key} style={{ color: s.color }}>
                          {s.label}: {isNum(s.vals[bar.m]) ? fmtNumber(s.vals[bar.m]) : DASH}
                        </div>
                      ))}
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${C.gray200}`, fontWeight: 600, color: C.text }}>
                        Total: {fmtNumber(totals[bar.m] || 0)}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8, marginLeft: 48, fontSize: 10.5, color: '#a8a8b0' }}>
        {bars.map((bar) => (
          <span
            key={bar.m}
            style={{ flex: 1, textAlign: 'center', color: bar.current ? CURRENT_TEXT : undefined, fontWeight: bar.current ? 700 : undefined }}
          >
            {MONTHS[bar.m]}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16, marginLeft: 48, fontSize: 11.5, color: C.muted }}>
        {STORE_KEYS.map(([key, label, color]) => (
          <span key={key}>
            <span style={{ color }}>●</span> {label}
          </span>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Users tab
// ─────────────────────────────────────────────────────────────────────────────
function UsersTab({ yearData, updateMetric, activeYear }) {
  const mau = rawSeries(yearData, 'u_mau');
  const dau = rawSeries(yearData, 'u_dau');
  const dauMau = pctSeries(dau, mau); // point-in-time monthly stickiness

  const rows = [
    { kind: 'subhead', label: 'Active Users' },
    { kind: 'input', key: 'u_dau', label: 'Daily Active Users', unit: 'count', ytd: 'avg' },
    { kind: 'input', key: 'u_mau', label: 'Monthly Active Users', unit: 'count', ytd: 'avg' },
    {
      ...calc(
        'DAU / MAU Ratio',
        'percent',
        dauMau,
        seriesAvg(dauMau),
        'Stickiness — the share of monthly active users who use Sorted on an average day (DAU ÷ MAU). Higher means users return more often. A wallet used for daily payments should trend higher than one used only for occasional remittance.'
      ),
      heat: true,
    },
    { kind: 'subhead', label: 'Cohort Retention' },
    {
      kind: 'input',
      key: 'u_d1Retention',
      label: 'D1 Retention',
      unit: 'percent',
      ytd: 'none',
      heat: true,
      info: 'Of users who installed this month, the share who returned the next day.',
    },
    {
      kind: 'input',
      key: 'u_d7Retention',
      label: 'D7 Retention',
      unit: 'percent',
      ytd: 'none',
      heat: true,
      info: 'Of users who installed this month, the share who returned 7 days later.',
    },
    {
      kind: 'input',
      key: 'u_d30Retention',
      label: 'D30 Retention',
      unit: 'percent',
      ytd: 'none',
      heat: true,
      info: 'Of users who installed this month, the share who returned 30 days later.',
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card accent={C.primary}>
        <TabTitle
          title="Retention"
          accent={C.green}
          onDownload={() => downloadTextFile(`sorted-retention-${activeYear}.csv`, metricRowsToCsv(rows, yearData, 'Avg'))}
        />
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          totalLabel="Avg"
          fixedMonths
        />
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions tab
// ─────────────────────────────────────────────────────────────────────────────
const TX_OTHER_INFO =
  'All other in-app activity outside the core flows, such as airtime top-ups, bill and utility payments, and other Market features.';

function TransactionsTab({ yearData, updateMetric, allYears, activeYear }) {
  const latest = latestMonthIndex(yearData);
  // tx_airtime is retired (folds into Other); kept in the model for old data.
  const countKeys = ['tx_sendP2P', 'tx_receiveP2P', 'tx_cashOut', 'tx_cardRedemption', 'tx_other'];
  const valueKeys = ['tx_sendVolume', 'tx_receiveVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume', 'tx_otherVolume'];

  const totalTx = sumSeries(yearData, countKeys);
  const totalVol = sumSeries(yearData, valueKeys);
  const avgSize = ratioSeries(totalVol, totalTx); // monthly ATS
  const attempts = rawSeries(yearData, 'tx_offrampAttempts');
  const successful = rawSeries(yearData, 'tx_offrampSuccessful');
  const successRate = pctSeries(successful, attempts);

  // Lifetime running totals carry across years (seed from all prior years).
  const baseTx = priorYearsTotal(allYears, activeYear, countKeys);
  const baseVol = priorYearsTotal(allYears, activeYear, valueKeys);
  const lifeTx = cumulativeSeriesFrom(totalTx, baseTx);
  const lifeVol = cumulativeSeriesFrom(totalVol, baseVol);
  const lifeAvg = ratioSeries(lifeVol, lifeTx);

  const txY = seriesSum(totalTx, latest);
  const volY = seriesSum(totalVol, latest);
  const attY = seriesSum(attempts, latest);
  const sucY = seriesSum(successful, latest);

  const rows = [
    { kind: 'subhead', label: 'Transaction Count' },
    { kind: 'input', key: 'tx_sendP2P', label: 'Send', unit: 'count' },
    { kind: 'input', key: 'tx_receiveP2P', label: 'Receive', unit: 'count' },
    { kind: 'input', key: 'tx_cashOut', label: 'Cash-Out', unit: 'count' },
    { kind: 'input', key: 'tx_cardRedemption', label: 'Top-up Cards', unit: 'count' },
    { kind: 'input', key: 'tx_other', label: 'Other', unit: 'count', info: TX_OTHER_INFO },
    calc('New Transactions', 'count', totalTx, txY, 'The total number of transactions in the month.'),
    {
      ...calc('Total Transactions', 'count', lifeTx, null, 'Cumulative number of transactions since we began tracking.'),
      blankTotal: true,
    },
    { kind: 'subhead', label: 'Transaction Volume' },
    { kind: 'input', key: 'tx_sendVolume', label: 'Send', unit: 'usdt' },
    { kind: 'input', key: 'tx_receiveVolume', label: 'Receive', unit: 'usdt' },
    { kind: 'input', key: 'tx_cashOutVolume', label: 'Cash-Out', unit: 'usdt' },
    { kind: 'input', key: 'tx_cardRedemptionVolume', label: 'Top-up Cards', unit: 'usdt' },
    { kind: 'input', key: 'tx_otherVolume', label: 'Other', unit: 'usdt', info: TX_OTHER_INFO },
    calc('New Volume', 'usdt', totalVol, volY, 'The total volume of USDT transacted in the month.'),
    {
      ...calc('Total Volume', 'usdt', lifeVol, null, 'The cumulative volume of USDT transacted since we began tracking.'),
      blankTotal: true,
    },
    { kind: 'subhead', label: 'Average Transaction Size' },
    calc('Monthly', 'ratio', avgSize, safeDiv(volY, txY), 'The average size of a transaction this month. Calculated as New Volume / New Transactions.'),
    {
      ...calc('Overall', 'ratio', lifeAvg, null, 'The all-time average transaction size. Calculated as Total Volume / Total Transactions.'),
      blankTotal: true,
    },
    { kind: 'subhead', label: 'Off-Ramp Health' },
    { kind: 'input', key: 'tx_offrampAttempts', label: 'Cash-Out Attempts', unit: 'count' },
    { kind: 'input', key: 'tx_offrampSuccessful', label: 'Successful Cash-Outs', unit: 'count' },
    {
      ...calc('Off-Ramp Success Rate', 'percent', successRate, pct(sucY, attY), 'Successful ÷ attempts.'),
      heat: true,
    },
  ];

  const volData = monthChartData({
    Send: rawSeries(yearData, 'tx_sendVolume'),
    Receive: rawSeries(yearData, 'tx_receiveVolume'),
    'Cash-Out': rawSeries(yearData, 'tx_cashOutVolume'),
    'Top-up Cards': rawSeries(yearData, 'tx_cardRedemptionVolume'),
    Other: rawSeries(yearData, 'tx_otherVolume'),
  });

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card accent={C.primary}>
        <TabTitle
          title="Transactions"
          accent={C.amber}
          onDownload={() => downloadTextFile(`sorted-transactions-${activeYear}.csv`, metricRowsToCsv(rows, yearData, 'YTD'))}
        />
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          fixedMonths
          emptyNote={activeYear === 2023 ? "Transactions weren't tracked in 2023" : null}
        />
      </Card>
      <ChartCard title="Transaction Volume by Category" accent={C.amber}>
        <ComposedChart data={volData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {upcomingRefs(latest)}
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} yAxisId="left" />
          <Tooltip content={<ChartTooltip fmt={(v) => withDollar(fmtUSDT(v))} reported={latest} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
          <Bar yAxisId="left" dataKey="Send" stackId="v" fill={CHART_COLORS.installs} barSize={20} />
          <Bar yAxisId="left" dataKey="Receive" stackId="v" fill={CHART_COLORS.users} barSize={20} />
          <Bar yAxisId="left" dataKey="Cash-Out" stackId="v" fill={CHART_COLORS.revenue} barSize={20} />
          <Bar yAxisId="left" dataKey="Top-up Cards" stackId="v" fill={CHART_COLORS.cards} barSize={20} />
          <Bar yAxisId="left" dataKey="Other" stackId="v" fill={CHART_COLORS.transactions} barSize={20} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards tab
// ─────────────────────────────────────────────────────────────────────────────
// Cross-tab drift flag shown when a Top-up Cards figure disagrees with the
// matching entry on the Transactions tab for the same month.
const TX_CARD_MISMATCH =
  'This figure does not match the Top-up Cards entry on the Transactions tab.';

// Top-up Cards countries (Tanzania launches Jul 1; shown from the start).
const CARD_COUNTRIES = ['Kenya', 'Nigeria', 'Tanzania'];
const CARD_COUNTRY_COLOR = { Kenya: PASTEL.lavender, Nigeria: PASTEL.blue, Tanzania: PASTEL.sand };
const CARD_COUNTRY_FLAG = { Kenya: '🇰🇪', Nigeria: '🇳🇬', Tanzania: '🇹🇿' };

// The top-up card programme launched September 2025 — a fixed boundary (not data
// driven). Periods before it render as a "pre-launch" band, never blank dashes.
const CARD_LAUNCH_YEAR = 2025;
const CARD_LAUNCH_MONTH = 8; // Sep, 0-based
const CARD_LAUNCH_LABEL = 'Programme launched Sep 2025';

// How many leading months of `activeYear` pre-date the launch (0, the launch
// month, or the whole year).
function cardPreLaunchCols(activeYear) {
  if (activeYear < CARD_LAUNCH_YEAR) return 12;
  if (activeYear === CARD_LAUNCH_YEAR) return CARD_LAUNCH_MONTH;
  return 0;
}

// Chart band marking pre-launch months grey (mirrors upcomingRefs for the
// upcoming band). Returns recharts children, or null when nothing is pre-launch.
function preLaunchRefs(P) {
  if (!P || P <= 0) return null;
  const refs = [
    <ReferenceArea
      key="pre-band"
      x1={MONTHS[0]}
      x2={MONTHS[Math.min(P, 12) - 1]}
      fill={PRELAUNCH_BAND}
      stroke="none"
      label={{ value: 'Pre-launch', position: 'insideTopLeft', fontSize: 11, fill: PRELAUNCH_LABEL }}
    />,
  ];
  if (P < 12) refs.push(<ReferenceLine key="pre-div" x={MONTHS[P]} stroke={PRELAUNCH_DIVIDER} strokeWidth={1} />);
  return refs;
}

// Tooltip for the Cards activity chart: Cards Sold as a count, Cards / User as a
// 2dp ratio; "Not yet reported" over the upcoming band.
function CardsActivityTooltip({ active, payload, label, reported }) {
  if (!active || !payload || !payload.length) return null;
  const i = MONTHS.indexOf(label);
  const upcoming = reported != null && reported >= 0 && i > reported;
  const rows = payload.filter((p) => !String(p.dataKey).endsWith('__up'));
  return (
    <div style={TOOLTIP_BOX}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {upcoming ? (
        <div style={{ color: C.muted }}>Not yet reported</div>
      ) : (
        rows.map((p) => (
          <div key={p.dataKey} style={{ color: p.color || p.stroke }}>
            {p.name}: {p.value == null ? DASH : p.dataKey === 'Cards / User' ? p.value.toFixed(2) : fmtNumber(p.value)}
          </div>
        ))
      )}
    </div>
  );
}

const num0 = (v) => (isNum(v) ? v : 0);

// ── Batch computed fields (a batch is identified by Country + Batch number) ──
// Discounts & Fees may be negative (e.g. an ambassador overpaid) — that is valid.
function batchDiscounts(b) {
  if (!isNum(b.fundsSent) && !isNum(b.fundsReceived)) return null;
  return num0(b.fundsSent) - num0(b.fundsReceived);
}
function batchAvgDisc(b) {
  const d = batchDiscounts(b);
  return d != null && isNum(b.fundsSent) && b.fundsSent !== 0 ? (d / b.fundsSent) * 100 : null;
}
function batchCac(b) {
  const d = batchDiscounts(b);
  return d != null && isNum(b.uniqueUsers) && b.uniqueUsers !== 0 ? d / b.uniqueUsers : null;
}
function nextBatchNo(country, batches) {
  let mx = 0;
  for (const b of batches) if (b.country === country && isNum(b.batchNo) && b.batchNo > mx) mx = b.batchNo;
  return mx + 1;
}
function newBatchId(batches) {
  const ids = new Set(batches.map((b) => b.id));
  let n = batches.length + 1;
  while (ids.has(`batch_${n}`)) n += 1;
  return `batch_${n}`;
}

// Country-level summary, summed from that country's batches. Unique Users is the
// MANUAL deduplicated figure (NOT summed from batches — the same user redeems
// across batches), so CAC only resolves once that manual number is entered.
function cardCountrySummary(country, batches, manualUsers) {
  const bs = batches.filter((b) => b.country === country);
  const sum = (fn) => bs.reduce((a, b) => a + num0(fn(b)), 0);
  const volume = sum((b) => b.fundsSent);
  const collected = sum((b) => b.fundsReceived);
  const discounts = volume - collected;
  const users = isNum(manualUsers) ? manualUsers : null;
  return {
    country,
    count: bs.length,
    cards: sum((b) => b.cards),
    volume,
    collected,
    discounts,
    avgDisc: volume !== 0 ? (discounts / volume) * 100 : null,
    users,
    cac: users != null && users !== 0 ? discounts / users : null,
    revenue: sum((b) => b.revenue),
  };
}

// Plain sum of a set of batches (used for the Batches-tab subtotal/total rows).
// Unique Users / CAC deliberately do NOT roll up here (country dedup is separate).
function batchSubtotal(bs) {
  const sum = (fn) => bs.reduce((a, b) => a + num0(fn(b)), 0);
  const sent = sum((b) => b.fundsSent);
  const recv = sum((b) => b.fundsReceived);
  const disc = sent - recv;
  return {
    count: bs.length,
    cards: sum((b) => b.cards),
    sent,
    recv,
    disc,
    avg: sent !== 0 ? (disc / sent) * 100 : null,
    rev: sum((b) => b.revenue),
  };
}

// Sub-tab bar used inside the Top-up Cards tab (Monthly / By Country / Batches).
function SubTabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.gray200}` }}>
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '8px 12px',
              fontFamily: 'var(--font-head)',
              fontSize: 13.5,
              fontWeight: on ? 700 : 500,
              color: on ? C.primary : C.muted,
              borderBottom: on ? `2.5px solid ${C.primary}` : '2.5px solid transparent',
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function CardsTab({ yearData, updateMetric, allYears, activeYear, cardBatches, cardCountryUsers, updateRoot }) {
  const [sub, setSub] = useState('By Month');
  // Export the currently-active sub-tab's table as CSV (raw values).
  const onDownload = () => {
    if (sub === 'By Country') {
      downloadTextFile(`sorted-cards-by-country-${activeYear}.csv`, cardsByCountryCsv(cardBatches, cardCountryUsers));
    } else if (sub === 'By Batch') {
      downloadTextFile(`sorted-cards-by-batch-${activeYear}.csv`, cardsByBatchCsv(cardBatches));
    } else {
      downloadTextFile(`sorted-cards-by-month-${activeYear}.csv`, cardsByMonthCsv(yearData));
    }
  };
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card>
        <TabTitle title="Top-up Cards" onDownload={onDownload} />
        <SubTabBar tabs={['By Month', 'By Country', 'By Batch']} active={sub} onChange={setSub} />
      </Card>
      {sub === 'By Month' && (
        <CardsMonthlyView
          yearData={yearData}
          updateMetric={updateMetric}
          allYears={allYears}
          activeYear={activeYear}
          cardBatches={cardBatches}
          cardCountryUsers={cardCountryUsers}
        />
      )}
      {sub === 'By Country' && (
        <CardsByCountryView batches={cardBatches} countryUsers={cardCountryUsers} updateRoot={updateRoot} />
      )}
      {sub === 'By Batch' && (
        <CardsBatchesView batches={cardBatches} countryUsers={cardCountryUsers} updateRoot={updateRoot} />
      )}
    </div>
  );
}

// Sub-tab 1 — Monthly. The existing manual monthly card-activity table, the
// Lifetime strip, and the monthly activity chart. Unchanged logic.
function CardsMonthlyView({ yearData, updateMetric, allYears, activeYear, cardBatches = [], cardCountryUsers }) {
  const latest = latestMonthIndex(yearData);
  const sold = rawSeries(yearData, 'c_sold');
  const cardsVolume = rawSeries(yearData, 'c_valueDistributed');
  const fundsCollected = rawSeries(yearData, 'c_fundsCollected');
  const grossRevenue = rawSeries(yearData, 'c_grossRevenue');
  const uniqueUsers = rawSeries(yearData, 'c_uniqueUsers');

  // Card-channel cost, acquisition and profitability.
  const costOfSales = diffSeries(cardsVolume, fundsCollected);
  const cacPerUser = ratioSeries(costOfSales, uniqueUsers);
  // Net Revenue only means something once Gross Revenue is entered for the
  // month — a net built from a missing gross is misleading, so blank it.
  const netRevenue = IDX.map((i) =>
    grossRevenue[i] == null ? null : grossRevenue[i] - (costOfSales[i] || 0)
  );

  // YTD figures. Cost of Sales sums; Net Revenue sums the months that have a
  // gross; unique users can't be summed, so CAC has no meaningful YTD.
  const volY = seriesSum(cardsVolume, latest);
  const fundsY = seriesSum(fundsCollected, latest);
  const costOfSalesY = volY == null && fundsY == null ? null : (volY || 0) - (fundsY || 0);
  const netRevY = seriesSum(netRevenue, latest);

  // Lifetime = all-time, the same figure in every year view (summed across ALL
  // years, not just up to the active one).
  const lifeSoldTotal = allYearsTotal(allYears, ['c_sold']);
  const lifeVolTotal = allYearsTotal(allYears, ['c_valueDistributed']);
  // Total Unique Users derives from the per-country deduplicated figures entered
  // on the By Country tab (Kenya + Nigeria + Tanzania) — assumes negligible
  // cross-country overlap (distinct markets; within-country dedup is manual).
  const lifeUsersTotal = (() => {
    let t = 0;
    let any = false;
    for (const c of CARD_COUNTRIES) {
      const v = cardCountryUsers && cardCountryUsers[c];
      if (isNum(v)) {
        t += v;
        any = true;
      }
    }
    return any ? t : null;
  })();
  // Lifetime CAC = lifetime Cost of Sales ÷ lifetime Unique Users. Cost of Sales
  // is summed across ALL batches/all time (Cards Volume − Funds Collected), the
  // same source the By Country Total row uses — so the two CACs reconcile, and
  // the denominator is the identical per-country Unique Users sum shown above.
  const lifeCostOfSales = (() => {
    const sums = CARD_COUNTRIES.map((c) => cardCountrySummary(c, cardBatches, cardCountryUsers[c]));
    if (!sums.some((s) => s.count > 0)) return null;
    return sums.reduce((a, s) => a + s.discounts, 0);
  })();
  const lifeCac =
    lifeCostOfSales != null && isNum(lifeUsersTotal) && lifeUsersTotal !== 0
      ? lifeCostOfSales / lifeUsersTotal
      : null;

  const rows = [
    { kind: 'subhead', label: 'Card Activity' },
    {
      kind: 'input',
      key: 'c_sold',
      label: 'Cards Sold',
      unit: 'count',
      compare: { key: 'tx_cardRedemption', message: TX_CARD_MISMATCH },
    },
    {
      kind: 'input',
      key: 'c_valueDistributed',
      label: 'Cards Volume',
      unit: 'usdt',
      info: 'The monthly volume of top-up cards sold.',
      compare: { key: 'tx_cardRedemptionVolume', message: TX_CARD_MISMATCH },
    },
    {
      kind: 'input',
      key: 'c_fundsCollected',
      label: 'Funds Collected',
      unit: 'usdt',
      info: 'The funds remitted back to Sorted by ambassadors and distributors.',
    },
    calc('Cost of Sales', 'usdt', costOfSales, costOfSalesY, 'The costs involved in selling the top-up cards. Calculated as Cards Volume − Funds Collected.'),
    {
      kind: 'input',
      key: 'c_uniqueUsers',
      label: 'Unique Users',
      unit: 'count',
      ytd: 'none',
      noBreak: true,
      info: 'The number of unique users who redeemed a top-up card this month.',
    },
    {
      ...calc(
        'CAC',
        'ratio',
        cacPerUser,
        null,
        'CAC per transacting user — customer acquisition cost per transacting card user this month. Calculated as Cost of Sales ÷ Unique Users.'
      ),
      blankTotal: true,
    },
    {
      kind: 'input',
      key: 'c_grossRevenue',
      label: 'Gross Revenue',
      unit: 'usdt',
      noBreak: true,
      info: 'The revenue generated via the top-up card redemptions this month.',
    },
    // Net Revenue is a derived row; negatives are coloured per-cell by valStyle,
    // so no negRed flag is needed.
    calc('Net Revenue', 'usdt', netRevenue, netRevY, 'The net value generated after deducting Cost of Sales from Gross Revenue.'),
  ];

  const preLaunchCols = cardPreLaunchCols(activeYear);
  const hasLiveData = latest >= preLaunchCols; // any reported month this year

  // Cards per Unique User — the meaningful signal (each user buying more cards
  // over time). Shown as a subordinate right-axis line alongside Cards Sold bars.
  const cardsPerUser = ratioSeries(sold, uniqueUsers);
  const liveReported = (i) => i >= preLaunchCols && i <= latest;
  const chartData = IDX.map((i) => ({
    m: MONTHS[i],
    'Cards Sold': liveReported(i) ? sold[i] : null,
    'Cards / User': liveReported(i) ? cardsPerUser[i] : null,
    'Cards / User__up': hasLiveData && i >= latest ? cardsPerUser[latest] : null,
  }));
  const latestRatio = hasLiveData ? cardsPerUser[latest] : null;

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {/* KPI strip: the Lifetime tiles pulled above the table (Option A). */}
      <LifetimeSummary
        calculated={[
          { label: 'Total Cards Sold', value: lifeSoldTotal == null ? DASH : fmtNumber(lifeSoldTotal) },
          { label: 'Total Cards Volume', value: fmtByUnit(lifeVolTotal, 'usdt') },
          {
            label: 'Total Unique Users',
            value: lifeUsersTotal == null ? DASH : fmtNumber(lifeUsersTotal),
            info: 'Sum of the per-country deduplicated unique users entered on the By Country tab. Assumes negligible cross-country overlap.',
          },
          {
            label: 'Lifetime CAC',
            value: fmtByUnit(lifeCac, 'ratio'),
            info: 'Lifetime Cost of Sales (all-time Cards Volume − Funds Collected) ÷ lifetime Unique Users.',
          },
        ]}
      />
      <Card style={{ padding: '10px 22px' }}>
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          preLaunchCols={preLaunchCols}
          tintCalc={false}
          fixedMonths
        />
      </Card>
      <Card style={{ paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>Cards Sold &amp; Cards per User</h3>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {latestRatio == null
                ? 'Monthly cards sold, with cards per unique user.'
                : `Each user now buys ${latestRatio.toFixed(1)} cards on average — up over time.`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: C.muted }}>
            <span><span style={{ color: CHART_COLORS.cards }}>●</span> Cards Sold</span>
            <span><span style={{ color: CHART_COLORS.installs }}>●</span> Cards / User</span>
          </div>
        </div>
        {hasLiveData ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              {preLaunchRefs(preLaunchCols)}
              {upcomingRefs(latest)}
              <CartesianGrid {...GRID} />
              <XAxis {...X_AXIS} />
              <YAxis {...yAxis()} yAxisId="left" />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={36}
                tick={{ fontSize: 11, fill: C.muted }}
                tickFormatter={(v) => v.toFixed(1)}
                domain={[0, (max) => Math.max(1, Math.ceil(max))]}
              />
              <Tooltip content={<CardsActivityTooltip reported={latest} />} />
              <Bar yAxisId="left" dataKey="Cards Sold" fill={CHART_COLORS.cards} barSize={18} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Cards / User" stroke={CHART_COLORS.installs} strokeWidth={2} dot={{ r: 2.5, fill: CHART_COLORS.installs, strokeWidth: 0 }} connectNulls />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Cards / User__up"
                stroke={CHART_COLORS.installs}
                strokeOpacity={0.4}
                strokeWidth={2}
                strokeDasharray="6 6"
                dot={false}
                connectNulls
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>
            {CARD_LAUNCH_LABEL}
          </div>
        )}
      </Card>
    </div>
  );
}

// Lifetime — three single all-time figures shown as compact stat cells (not a
// month grid). Two are calculated running totals; the third is a manual entry.
function LifetimeSummary({ calculated }) {
  const cellStyle = {
    flex: '1 1 0',
    minWidth: 160,
    border: `1px solid ${CARD_BORDER}`,
    borderRadius: 14,
    padding: '18px 20px',
    background: C.card,
  };
  const labelStyle = {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: C.muted,
    display: 'flex',
    alignItems: 'center',
  };
  const valueStyle = { fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, marginTop: 8 };

  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: C.primary,
          padding: '0 0 12px',
        }}
      >
        Lifetime
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {calculated.map((it) => (
          <div key={it.label} style={cellStyle}>
            <div style={labelStyle}>
              {it.label}
              {it.info && <InfoTip text={it.info} />}
            </div>
            <div style={valueStyle}>{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sub-tab 2 — By Country. Cumulative per-country summary, AUTO-FED from the
// Batches log. Every column is computed except Unique Users, which is a manual
// deduplicated per-country figure (and the denominator for CAC).
function CardsByCountryView({ batches, countryUsers, updateRoot }) {
  const summaries = CARD_COUNTRIES.map((c) => cardCountrySummary(c, batches, countryUsers[c]));
  const total = summaries.reduce(
    (t, s) => {
      t.cards += s.cards;
      t.volume += s.volume;
      t.collected += s.collected;
      t.discounts += s.discounts;
      t.revenue += s.revenue;
      if (isNum(s.users)) {
        t.users += s.users;
        t.anyUser = true;
      }
      if (s.count > 0) t.anyBatch = true;
      return t;
    },
    { cards: 0, volume: 0, collected: 0, discounts: 0, revenue: 0, users: 0, anyUser: false, anyBatch: false }
  );
  const totalAvgDisc = total.volume !== 0 ? (total.discounts / total.volume) * 100 : null;
  const totalCac = total.anyUser && total.users !== 0 ? total.discounts / total.users : null;

  const pie = summaries
    .filter((s) => s.cards > 0)
    .map((s) => ({ name: s.country, value: s.cards, color: CARD_COUNTRY_COLOR[s.country] }));
  const pieTotal = pie.reduce((a, p) => a + p.value, 0);
  const ranked = [...pie].sort((a, b) => b.value - a.value);

  const head = (label, alignLeft) => (
    <th style={{ ...thBase, textAlign: alignLeft ? 'left' : 'right', padding: alignLeft ? '12px 16px' : '12px 12px' }}>
      {label}
    </th>
  );
  // Discounts & Fees and CAC can be negative by design — colour negatives red
  // per cell, matching the By Month grid.
  const num = (val, unit, bold) => (
    <td style={{ textAlign: 'right', fontSize: 13, fontWeight: bold ? 700 : 600, padding: '12px 12px', color: isNum(val) && val < 0 ? DANGER : undefined }}>
      {val == null ? DASH : fmtByUnit(val, unit)}
    </td>
  );

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.primary, padding: '0 0 4px' }}>
          By Country
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Card distribution and redemption totals for each country.
        </div>
        <div style={{ overflowX: 'auto', border: `1px solid ${CARD_BORDER}`, borderRadius: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ background: C.gray100 }}>
                {head('Country', true)}
                {head('Cards Sold')}
                {head('Cards Volume')}
                {head('Discounts & Fees')}
                {head('Avg Discount %')}
                {head('Unique Users')}
                {head('CAC')}
                {head('Revenue')}
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const empty = s.count === 0;
                return (
                  <tr key={s.country} style={{ borderTop: `1px solid ${C.gray200}` }}>
                    <td style={{ textAlign: 'left', fontSize: 13, fontWeight: 500, padding: '8px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{ marginRight: 7 }}>{CARD_COUNTRY_FLAG[s.country]}</span>
                      {s.country}
                    </td>
                    {num(empty ? null : s.cards, 'count')}
                    {num(empty ? null : s.volume, 'usdt')}
                    {num(empty ? null : s.discounts, 'usdt')}
                    {num(empty ? null : s.avgDisc, 'percent2')}
                    {empty ? (
                      // Not launched / no data → "—" in every column, including
                      // the (otherwise manual) Unique Users figure.
                      num(null, 'count')
                    ) : (
                      <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                        <Cell
                          value={isNum(countryUsers[s.country]) ? countryUsers[s.country] : null}
                          unit="count"
                          onCommit={(v) => updateRoot('cardCountryUsers', { ...countryUsers, [s.country]: v })}
                        />
                      </td>
                    )}
                    {num(empty ? null : s.cac, 'ratio')}
                    {/* Revenue isn't wired yet (all 0) — show "—" until real
                        revenue is entered, not a hard $0.00 that looks like data. */}
                    {num(empty || !(s.revenue > 0) ? null : s.revenue, 'usdt')}
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.border}`, background: CALC_ROW_BG }}>
                <td style={{ textAlign: 'left', fontSize: 13, fontWeight: 700, padding: '12px 16px' }}>Total</td>
                {num(total.anyBatch ? total.cards : null, 'count', true)}
                {num(total.anyBatch ? total.volume : null, 'usdt', true)}
                {num(total.anyBatch ? total.discounts : null, 'usdt', true)}
                {num(totalAvgDisc, 'percent2', true)}
                {num(total.anyUser ? total.users : null, 'count', true)}
                {num(totalCac, 'ratio', true)}
                {num(total.revenue > 0 ? total.revenue : null, 'usdt', true)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      {pie.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>
              Cards Sold by Country
            </h3>
            <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
              {fmtNumber(pieTotal)} total
            </span>
          </div>
          {/* Compact 100%-stacked share bar — clearer than a donut for 2–3 segments. */}
          <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
            {ranked.map((m) => (
              <div
                key={m.name}
                title={`${m.name}: ${fmtNumber(m.value)} (${((m.value / pieTotal) * 100).toFixed(1)}%)`}
                style={{ width: `${(m.value / pieTotal) * 100}%`, background: m.color }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px' }}>
            {ranked.map((m) => (
              <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color, flexShrink: 0 }} />
                <span>{CARD_COUNTRY_FLAG[m.name]}</span>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtNumber(m.value)}</span>
                <span style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                  · {((m.value / pieTotal) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// Sub-tab 3 — Batches. A paginated, country-filterable batch log. Batches are
// month-less and numbered per country (Kenya Batch 1 ≠ Nigeria Batch 1). Totals
// reflect every batch (computed from the full set), not just the visible page.
const BATCH_PAGE_SIZE = 25;

function CardsBatchesView({ batches, countryUsers, updateRoot }) {
  const editable = useContext(EditableContext);
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(0);
  const [hoveredId, setHoveredId] = useState(null); // row hover reveals edit controls

  const setBatches = (next) => updateRoot('cardBatches', next);
  const updateBatch = (id, patch) => setBatches(batches.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBatch = (id) => setBatches(batches.filter((b) => b.id !== id));
  const addBatch = () => {
    const country = filter === 'All' ? 'Kenya' : filter;
    const next = [
      ...batches,
      {
        id: newBatchId(batches),
        country,
        batchNo: nextBatchNo(country, batches),
        cards: null,
        fundsSent: null,
        fundsReceived: null,
        uniqueUsers: null,
        revenue: null,
      },
    ];
    setBatches(next);
    // Surface the new row: focus its country and jump to that country's last page.
    setFilter(country);
    const countAfter = next.filter((b) => b.country === country).length;
    setPage(Math.ceil(countAfter / BATCH_PAGE_SIZE) - 1);
  };
  const changeCountry = (id, country) => {
    const others = batches.filter((b) => b.id !== id);
    updateBatch(id, { country, batchNo: nextBatchNo(country, others) });
  };
  const selectFilter = (f) => {
    setFilter(f);
    setPage(0);
  };

  // Sorted by country then per-country batch number, then paginated.
  const sorted = [...batches].sort((a, b) =>
    a.country === b.country ? num0(a.batchNo) - num0(b.batchNo) : String(a.country).localeCompare(String(b.country))
  );
  const filtered = filter === 'All' ? sorted : sorted.filter((b) => b.country === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / BATCH_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * BATCH_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + BATCH_PAGE_SIZE);

  // Footer total row — computed across ALL batches for the current filter (not
  // just the page). Unique Users / CAC come from the manual per-country dedup
  // figures entered on the By Country tab (batch unique-users do NOT roll up).
  const footerRow = (label, bs, users) => {
    const st = batchSubtotal(bs);
    return { label, ...st, users, cac: users != null && users !== 0 ? st.disc / users : null };
  };
  let footer = [];
  if (filter === 'All') {
    if (batches.length > 0) {
      const anyUser = CARD_COUNTRIES.some((c) => isNum(countryUsers[c]));
      const usersSum = CARD_COUNTRIES.reduce((a, c) => a + (isNum(countryUsers[c]) ? countryUsers[c] : 0), 0);
      footer = [footerRow('All countries', batches, anyUser ? usersSum : null)];
    }
  } else if (filtered.length > 0) {
    footer = [footerRow(`${filter} total`, filtered, isNum(countryUsers[filter]) ? countryUsers[filter] : null)];
  }

  // Sticky header so the column labels stay visible while scrolling a long list.
  const head = (label, align = 'right') => (
    <th
      style={{
        ...thBase,
        textAlign: align,
        padding: align === 'left' ? '12px 14px' : '12px 8px',
        position: 'sticky',
        top: 0,
        zIndex: 2,
        background: C.gray100,
      }}
    >
      {label}
    </th>
  );
  const mCell = (b, key, unit) => (
    <td style={{ textAlign: 'right', padding: '4px 6px' }}>
      <Cell value={isNum(b[key]) ? b[key] : null} unit={unit} onCommit={(v) => updateBatch(b.id, { [key]: v })} />
    </td>
  );
  // Computed batch cells (Discounts & Fees, CAC) can be negative — red per cell.
  const cCell = (val, unit) => (
    <td style={{ textAlign: 'right', fontSize: 13, padding: '8px 8px', color: isNum(val) && val < 0 ? DANGER : C.text }}>
      {val == null ? DASH : fmtByUnit(val, unit)}
    </td>
  );
  // Pinned (sticky-bottom) totals row — opaque background so rows don't show
  // through while scrolling.
  const FOOTER_BG = CALC_LABEL_BG;
  const fStick = { position: 'sticky', bottom: 0, zIndex: 1, background: FOOTER_BG };
  const fCell = (val, unit) => (
    <td style={{ ...fStick, textAlign: 'right', fontSize: 13, fontWeight: 700, padding: '10px 8px', color: isNum(val) && val < 0 ? DANGER : undefined }}>
      {val == null ? DASH : fmtByUnit(val, unit)}
    </td>
  );

  const colCount = editable ? 11 : 10;

  const pill = (label, active) => (
    <button
      key={label}
      type="button"
      onClick={() => selectFilter(label)}
      style={{
        padding: '5px 13px',
        borderRadius: 7,
        fontSize: 12,
        cursor: 'pointer',
        fontWeight: active ? 600 : 500,
        background: active ? C.primary : '#fff',
        color: active ? '#fff' : C.muted,
        border: active ? 'none' : `1px solid ${C.border}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.primary }}>
            Batches
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Each batch is one distribution run (month-less). Numbering is per country. Totals cover every batch.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', ...CARD_COUNTRIES].map((c) => pill(c, filter === c))}
        </div>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 520, border: `1px solid ${CARD_BORDER}`, borderRadius: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1040, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              {head('Country', 'left')}
              {head('Batch')}
              {head('Cards')}
              {head('Cards Volume')}
              {head('Funds Collected')}
              {head('Discounts & Fees')}
              {head('Avg Discount %')}
              {head('Unique Users')}
              {head('CAC')}
              {head('Revenue')}
              {editable && (
                <th style={{ ...thBase, width: 34, padding: '12px 6px', position: 'sticky', top: 0, zIndex: 2, background: C.gray100 }} />
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr style={{ borderTop: `1px solid ${C.gray200}` }}>
                <td colSpan={colCount} style={{ padding: '20px 16px', color: C.muted, fontSize: 13, textAlign: 'center' }}>
                  No batches yet.{editable ? ' Add one below to get started.' : ''}
                </td>
              </tr>
            ) : (
              pageRows.map((b) => {
                const showEdit = editable && hoveredId === b.id;
                return (
                  <tr
                    key={b.id}
                    style={{ borderTop: `1px solid ${C.gray200}` }}
                    onMouseEnter={editable ? () => setHoveredId(b.id) : undefined}
                    onMouseLeave={editable ? () => setHoveredId(null) : undefined}
                  >
                    <td style={{ textAlign: 'left', padding: '4px 14px', whiteSpace: 'nowrap' }}>
                      {showEdit ? (
                        // Edit affordance revealed on hover (Owners/Masters only).
                        <select
                          value={b.country}
                          onChange={(e) => changeCountry(b.id, e.target.value)}
                          style={{
                            fontFamily: 'inherit',
                            fontSize: 13,
                            color: C.text,
                            background: '#fff',
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            padding: '3px 6px',
                            outline: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {CARD_COUNTRIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 13 }}>
                          <span style={{ marginRight: 7 }}>{CARD_COUNTRY_FLAG[b.country]}</span>
                          {b.country}
                        </span>
                      )}
                    </td>
                    {mCell(b, 'batchNo', 'count')}
                    {mCell(b, 'cards', 'count')}
                    {mCell(b, 'fundsSent', 'usdt')}
                    {mCell(b, 'fundsReceived', 'usdt')}
                    {cCell(batchDiscounts(b), 'usdt')}
                    {cCell(batchAvgDisc(b), 'percent2')}
                    {mCell(b, 'uniqueUsers', 'count')}
                    {cCell(batchCac(b), 'ratio')}
                    {mCell(b, 'revenue', 'usdt')}
                    {editable && (
                      <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                        {showEdit && (
                          <button
                            type="button"
                            onClick={() => removeBatch(b.id)}
                            title="Remove batch"
                            style={{ border: 'none', background: 'transparent', color: C.gray400, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer.length > 0 && (
            <tfoot>
              {footer.map((f) => (
                <tr key={f.label} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...fStick, textAlign: 'left', fontSize: 13, fontWeight: 700, padding: '10px 14px', whiteSpace: 'nowrap' }}>{f.label}</td>
                  <td style={fStick} />
                  {fCell(f.cards, 'count')}
                  {fCell(f.sent, 'usdt')}
                  {fCell(f.recv, 'usdt')}
                  {fCell(f.disc, 'usdt')}
                  {fCell(f.avg, 'percent2')}
                  {fCell(f.users, 'count')}
                  {fCell(f.cac, 'ratio')}
                  {fCell(f.rev, 'usdt')}
                  {editable && <td style={fStick} />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: C.muted }}>
          {filtered.length === 0
            ? '0 batches'
            : `Showing ${start + 1}–${Math.min(start + BATCH_PAGE_SIZE, filtered.length)} of ${filtered.length} batch${filtered.length === 1 ? '' : 'es'}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pageCount > 1 && (
            <>
              <button type="button" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} style={pagerBtn(safePage === 0)}>
                ‹ Prev
              </button>
              <span style={{ fontSize: 12, color: C.muted }}>
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                style={pagerBtn(safePage >= pageCount - 1)}
              >
                Next ›
              </button>
            </>
          )}
          {editable && (
            <button
              type="button"
              onClick={addBatch}
              style={{ border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, color: C.primary, cursor: 'pointer' }}
            >
              + Add batch
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function pagerBtn(disabled) {
  return {
    border: `1px solid ${C.border}`,
    background: '#fff',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: disabled ? C.gray400 : C.text,
    cursor: disabled ? 'default' : 'pointer',
  };
}

function EmptyChart() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: C.muted,
        fontSize: 13,
      }}
    >
      No data yet
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue tab
// ─────────────────────────────────────────────────────────────────────────────
function RevenueTab({ yearData, updateMetric, activeYear }) {
  const latest = latestMonthIndex(yearData);
  // Top-up card fee revenue is pulled from the Top-up Cards tab, not entered.
  const topupRev = rawSeries(yearData, 'c_grossRevenue');
  const revKeys = ['c_grossRevenue', 'r_offramps', 'r_other'];
  const costKeys = ['cost_ambassador', 'cost_saas', 'cost_digitalMarketing', 'cost_campaigns'];

  const totalRev = sumSeries(yearData, revKeys);
  const totalCost = sumSeries(yearData, costKeys);
  const netRev = diffSeries(totalRev, totalCost);
  // Net margin = net revenue ÷ total revenue (monthly), as a percentage.
  const netMargin = pctSeries(netRev, totalRev);

  const revY = seriesSum(totalRev, latest);
  const costY = seriesSum(totalCost, latest);
  const netRevY = revY == null && costY == null ? null : (revY || 0) - (costY || 0);
  const netMarginY = pct(netRevY, revY);

  const rows = [
    { kind: 'subhead', label: 'Revenue' },
    {
      kind: 'readonly',
      label: 'Top-up Cards',
      unit: 'usd',
      values: topupRev,
      info: 'Top-up card fee revenue, carried over automatically from the Top-up Cards tab.',
    },
    { kind: 'input', key: 'r_offramps', label: 'Off-ramps', unit: 'usd' },
    { kind: 'input', key: 'r_other', label: 'Others', unit: 'usd' },
    calc('Total Revenue', 'usd', totalRev, revY, 'The total revenue generated across all sources this month.'),
    { kind: 'subhead', label: 'Cost of Revenue' },
    { kind: 'input', key: 'cost_ambassador', label: 'Ambassador Salaries', unit: 'usd' },
    { kind: 'input', key: 'cost_saas', label: 'SaaS Subscriptions', unit: 'usd' },
    { kind: 'input', key: 'cost_digitalMarketing', label: 'Digital Marketing', unit: 'usd' },
    { kind: 'input', key: 'cost_campaigns', label: 'Campaigns', unit: 'usd' },
    calc('Cost of Revenue', 'usd', totalCost, costY, 'The total direct costs incurred this month.'),
    { kind: 'subhead', label: 'Net Position' },
    {
      ...calc('Net Revenue', 'usd', netRev, netRevY, 'Revenue remaining after costs. Calculated as Total Revenue − Cost of Revenue.'),
      negRed: true,
    },
    {
      ...calc('Net Margin', 'percent', netMargin, netMarginY, 'Net revenue as a share of total revenue. Calculated as Net Revenue ÷ Total Revenue.'),
      heat: true,
      negRed: true,
    },
  ];

  const rvc = monthChartData({ Revenue: totalRev, 'Cost of Revenue': totalCost });

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card accent={C.primary}>
        <TabTitle
          title="Costs & Revenue"
          accent={C.green}
          onDownload={() => downloadTextFile(`sorted-costs-revenue-${activeYear}.csv`, metricRowsToCsv(rows, yearData, 'YTD'))}
        />
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          fixedMonths
        />
      </Card>
      <ChartCard title="Revenue vs Costs" accent={C.green}>
        <ComposedChart data={rvc} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {upcomingRefs(latest)}
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} />
          <Tooltip content={<ChartTooltip fmt={(v) => withDollar(fmtNumber(v))} reported={latest} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
          <Bar dataKey="Revenue" fill={CHART_COLORS.revenue} barSize={18} radius={[4, 4, 0, 0]} />
          <Bar dataKey="Cost of Revenue" fill={CHART_COLORS.cost} barSize={18} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns tab — a manual KPI strip over an editable campaign list. Every
// field (KPIs included) is entered by hand for now; attribution and computed
// CPI come in a later phase. Data lives on the year as `campaignKpis` +
// `campaigns` (free-form, persisted via updateYearField).
// ─────────────────────────────────────────────────────────────────────────────
const CAMPAIGN_KPIS = [
  { key: 'active', label: 'Active Campaigns', unit: 'count' },
  { key: 'spend', label: 'Total Spend', unit: 'usd' },
  { key: 'installs', label: 'Attributed Installs', unit: 'count' },
  { key: 'cpi', label: 'Blended CPI', unit: 'ratio' },
];

const CAMPAIGN_STATUSES = ['Active', 'Paused', 'Ended'];
const STATUS_STYLE = {
  Active: { background: 'rgba(31,138,77,0.12)', color: '#1f8a4d' },
  Paused: { background: 'rgba(160,140,40,0.14)', color: '#9a7a10' },
  Ended: { background: 'rgba(120,120,130,0.12)', color: '#6a6a74' },
};

function newCampaignId(existing) {
  // Stable-enough unique id without colliding with existing rows.
  let n = existing.length + 1;
  const has = (id) => existing.some((c) => c.id === id);
  while (has(`camp_${n}`)) n += 1;
  return `camp_${n}`;
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.Ended;
  return (
    <span
      style={{
        ...s,
        padding: '4px 11px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}

// A free-text cell used for campaign name / channel (the metric Cell is numeric
// only). Mirrors Cell's read-only behaviour for Members.
function TextCell({ value, placeholder, onCommit, bold }) {
  const editable = useContext(EditableContext);
  const [draft, setDraft] = useState(null);
  if (!editable) {
    return (
      <span style={{ fontSize: 13, fontWeight: bold ? 600 : 400, color: value ? C.text : C.gray400 }}>
        {value || DASH}
      </span>
    );
  }
  return (
    <input
      value={draft == null ? value || '' : draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      style={{
        width: '100%',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: bold ? 600 : 400,
        color: C.text,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px dashed ${C.gray300}`,
        padding: '5px 2px',
        outline: 'none',
      }}
    />
  );
}

function CampaignsTab({ yearData, updateYearField, activeYear }) {
  const editable = useContext(EditableContext);
  const campaigns = Array.isArray(yearData.campaigns) ? yearData.campaigns : [];
  const kpis = yearData.campaignKpis || {};

  const setKpi = (key, value) => updateYearField('campaignKpis', { ...kpis, [key]: value });
  const setCampaigns = (next) => updateYearField('campaigns', next);
  const updateRow = (id, patch) =>
    setCampaigns(campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addRow = () =>
    setCampaigns([
      ...campaigns,
      {
        id: newCampaignId(campaigns),
        name: '',
        channel: '',
        spend: null,
        installs: null,
        cpi: null,
        conv: null,
        status: 'Active',
      },
    ]);
  const removeRow = (id) => setCampaigns(campaigns.filter((c) => c.id !== id));

  const th = (label, align = 'right', pad = '13px 12px') => (
    <th style={{ ...thBase, textAlign: align, padding: pad }}>{label}</th>
  );
  const numTd = (row, key, unit) => (
    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
      <Cell value={row[key]} unit={unit} onCommit={(v) => updateRow(row.id, { [key]: v })} />
    </td>
  );

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Card accent={C.primary}>
        <TabTitle
          title="Campaigns"
          accent={C.blue}
          downloadLabel="Download all"
          onDownload={() => downloadTextFile(`sorted-campaigns-${activeYear}.csv`, campaignsCsv(yearData))}
        />
        <p style={{ fontSize: 13, color: C.muted, marginTop: -4, marginBottom: 16 }}>
          Acquisition campaigns and performance. All figures are entered manually
          for now — attribution and computed CPI come in a later phase.
        </p>

        {/* KPI strip — manual headline figures */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          {CAMPAIGN_KPIS.map((k) => (
            <div
              key={k.key}
              style={{
                background: C.card,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 14,
                padding: '16px 18px',
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: C.muted,
                }}
              >
                {k.label}
              </div>
              <div style={{ marginTop: 8 }}>
                <Cell
                  value={kpis[k.key] == null ? null : kpis[k.key]}
                  unit={k.unit}
                  onCommit={(v) => setKpi(k.key, v)}
                  inputStyle={{
                    fontFamily: 'var(--font-head)',
                    fontSize: 26,
                    fontWeight: 700,
                    textAlign: 'left',
                    padding: 0,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Campaign list */}
      <Card accent={C.primary} style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
            <thead>
              <tr style={{ background: C.gray100 }}>
                {th('Campaign', 'left', '13px 16px')}
                {th('Channel', 'left')}
                {th('Spend')}
                {th('Installs')}
                {th('CPI')}
                {th('Conv.')}
                {th('Status')}
                {editable && <th style={{ ...thBase, width: 36, padding: '13px 8px' }} />}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr style={{ borderTop: `1px solid ${C.gray200}` }}>
                  <td
                    colSpan={editable ? 8 : 7}
                    style={{ padding: '20px 16px', color: C.muted, fontSize: 13, textAlign: 'center' }}
                  >
                    No campaigns yet.{editable ? ' Add one below to get started.' : ''}
                  </td>
                </tr>
              ) : (
                campaigns.map((row) => (
                  <tr key={row.id} style={{ borderTop: `1px solid ${C.gray200}` }}>
                    <td style={{ textAlign: 'left', padding: '6px 16px', minWidth: 150 }}>
                      <TextCell
                        value={row.name}
                        placeholder="Campaign name"
                        bold
                        onCommit={(v) => updateRow(row.id, { name: v })}
                      />
                    </td>
                    <td style={{ textAlign: 'left', padding: '6px 12px', minWidth: 110 }}>
                      <TextCell
                        value={row.channel}
                        placeholder="Channel"
                        onCommit={(v) => updateRow(row.id, { channel: v })}
                      />
                    </td>
                    {numTd(row, 'spend', 'usd')}
                    {numTd(row, 'installs', 'count')}
                    {numTd(row, 'cpi', 'ratio')}
                    {numTd(row, 'conv', 'percent')}
                    <td style={{ textAlign: 'right', padding: '6px 12px' }}>
                      {editable ? (
                        <select
                          value={row.status || 'Active'}
                          onChange={(e) => updateRow(row.id, { status: e.target.value })}
                          style={{
                            ...(STATUS_STYLE[row.status] || STATUS_STYLE.Active),
                            border: 'none',
                            borderRadius: 20,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: 'inherit',
                            cursor: 'pointer',
                            outline: 'none',
                          }}
                        >
                          {CAMPAIGN_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill status={row.status || 'Active'} />
                      )}
                    </td>
                    {editable && (
                      <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          title="Remove campaign"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: C.gray400,
                            cursor: 'pointer',
                            fontSize: 16,
                            lineHeight: 1,
                            padding: 2,
                          }}
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.gray200}` }}>
            <button
              type="button"
              onClick={addRow}
              style={{
                border: `1px solid ${C.border}`,
                background: '#fff',
                borderRadius: 8,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: C.primary,
                cursor: 'pointer',
              }}
            >
              + Add campaign
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export seam — the per-tab "Download" and "Download all" exports are planned
// for a later phase. The button is rendered (disabled) so the placement and
// data wiring are in place; hook up `onClick` when the feature is built.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Export helpers — CSV for the data tables (raw/full-precision values, not the
// abbreviated display strings) and a print-to-PDF for the Dashboard. Available
// to every role (download is not gated by canEdit).
// ─────────────────────────────────────────────────────────────────────────────
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Generic MetricTable export: one row per metric (raw month values + the
// summary/YTD), section subheads on their own line. Mirrors how MetricTable
// resolves each row so the CSV matches what's on screen.
function metricRowsToCsv(rows, yearData, totalLabel) {
  const latest = latestMonthIndex(yearData);
  const out = [['Metric', ...MONTHS, totalLabel || 'YTD']];
  for (const row of rows) {
    if (row.kind === 'subhead') {
      out.push([row.label]);
      continue;
    }
    let months;
    let ytd;
    if (row.kind === 'input') {
      const s = rawSeries(yearData, row.key);
      months = IDX.map((i) => s[i]);
      const mode = row.ytd || 'sum';
      ytd =
        latest < 0 || mode === 'none'
          ? null
          : mode === 'last'
          ? getVal(yearData, row.key, latest)
          : mode === 'avg'
          ? seriesAvg(s)
          : seriesSum(s, latest);
    } else if (row.kind === 'readonly') {
      months = IDX.map((i) => row.values[i]);
      ytd = latest < 0 ? null : seriesSum(row.values, latest);
    } else {
      months = IDX.map((i) => row.values[i]);
      ytd = row.blankTotal ? null : row.ytd;
    }
    out.push([row.label, ...months, ytd]);
  }
  return toCsv(out);
}

// Cards › By Month — recomputes the same 8 metric rows for export.
function cardsByMonthCsv(yearData) {
  const sold = rawSeries(yearData, 'c_sold');
  const vol = rawSeries(yearData, 'c_valueDistributed');
  const funds = rawSeries(yearData, 'c_fundsCollected');
  const gross = rawSeries(yearData, 'c_grossRevenue');
  const users = rawSeries(yearData, 'c_uniqueUsers');
  const cost = diffSeries(vol, funds);
  const cac = ratioSeries(cost, users);
  const net = IDX.map((i) => (gross[i] == null ? null : gross[i] - (cost[i] || 0)));
  const latest = latestMonthIndex(yearData);
  const sum = (s) => seriesSum(s, latest);
  const volY = sum(vol);
  const fundsY = sum(funds);
  const costY = volY == null && fundsY == null ? null : (volY || 0) - (fundsY || 0);
  const defs = [
    ['Cards Sold', sold, sum(sold)],
    ['Cards Volume', vol, volY],
    ['Funds Collected', funds, fundsY],
    ['Cost of Sales', cost, costY],
    ['Unique Users', users, null],
    ['CAC', cac, null],
    ['Gross Revenue', gross, sum(gross)],
    ['Net Revenue', net, sum(net)],
  ];
  const out = [['Metric', ...MONTHS, 'YTD']];
  for (const [label, s, ytd] of defs) out.push([label, ...IDX.map((i) => s[i]), ytd]);
  return toCsv(out);
}

// Cards › By Country — per-country summary + a Total row.
function cardsByCountryCsv(batches, countryUsers) {
  const out = [
    ['Country', 'Cards Sold', 'Cards Volume', 'Discounts & Fees', 'Avg Discount %', 'Unique Users', 'CAC', 'Revenue'],
  ];
  const t = { cards: 0, volume: 0, discounts: 0, users: 0, anyUser: false, revenue: 0, anyBatch: false };
  for (const c of CARD_COUNTRIES) {
    const s = cardCountrySummary(c, batches, countryUsers[c]);
    const empty = s.count === 0;
    out.push([
      c,
      empty ? null : s.cards,
      empty ? null : s.volume,
      empty ? null : s.discounts,
      empty ? null : s.avgDisc,
      empty ? null : s.users,
      empty ? null : s.cac,
      empty || !(s.revenue > 0) ? null : s.revenue,
    ]);
    t.cards += s.cards;
    t.volume += s.volume;
    t.discounts += s.discounts;
    t.revenue += s.revenue;
    if (s.count > 0) t.anyBatch = true;
    if (isNum(s.users)) {
      t.users += s.users;
      t.anyUser = true;
    }
  }
  const totalAvg = t.volume !== 0 ? (t.discounts / t.volume) * 100 : null;
  const totalCac = t.anyUser && t.users !== 0 ? t.discounts / t.users : null;
  out.push([
    'Total',
    t.anyBatch ? t.cards : null,
    t.anyBatch ? t.volume : null,
    t.anyBatch ? t.discounts : null,
    totalAvg,
    t.anyUser ? t.users : null,
    totalCac,
    t.revenue > 0 ? t.revenue : null,
  ]);
  return toCsv(out);
}

// Cards › By Batch — one row per batch (sorted by country then batch number).
function cardsByBatchCsv(batches) {
  const out = [
    ['Country', 'Batch', 'Cards', 'Cards Volume', 'Funds Collected', 'Discounts & Fees', 'Avg Discount %', 'Unique Users', 'CAC', 'Revenue'],
  ];
  const sorted = [...batches].sort((a, b) =>
    a.country === b.country ? num0(a.batchNo) - num0(b.batchNo) : String(a.country).localeCompare(String(b.country))
  );
  for (const b of sorted) {
    out.push([
      b.country,
      b.batchNo,
      b.cards,
      b.fundsSent,
      b.fundsReceived,
      batchDiscounts(b),
      batchAvgDisc(b),
      b.uniqueUsers,
      batchCac(b),
      b.revenue,
    ]);
  }
  return toCsv(out);
}

// Campaigns — the manual KPI strip plus the campaign list.
function campaignsCsv(yearData) {
  const kpis = yearData.campaignKpis || {};
  const campaigns = Array.isArray(yearData.campaigns) ? yearData.campaigns : [];
  const out = [
    ['Campaign KPIs'],
    ['Active Campaigns', kpis.active],
    ['Total Spend', kpis.spend],
    ['Attributed Installs', kpis.installs],
    ['Blended CPI', kpis.cpi],
    [],
    ['Campaign', 'Channel', 'Status', 'Spend', 'Installs', 'CPI', 'Conversion'],
  ];
  for (const c of campaigns) out.push([c.name, c.channel, c.status, c.spend, c.installs, c.cpi, c.conv]);
  return toCsv(out);
}

function DownloadButton({ label = 'Download', onClick }) {
  const disabled = !onClick;
  return (
    <button
      type="button"
      data-no-print=""
      disabled={disabled}
      onClick={onClick}
      title={disabled ? 'Export — coming in a later phase' : 'Export'}
      style={{
        border: `1px solid ${C.border}`,
        background: '#fff',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        color: disabled ? C.muted : C.primary,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      ↓ {label}
    </button>
  );
}

function TabTitle({ title, accent, downloadLabel, onDownload }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      <div style={{ flex: 1 }} />
      <DownloadButton label={downloadLabel || 'Download'} onClick={onDownload} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard tab
// ─────────────────────────────────────────────────────────────────────────────
// ── Editorial dashboard pieces (Exec at-a-glance styling) ───────────────────
const DASH_KPI_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  color: C.muted,
};

// Small group label above each KPI band so the timeframe (lifetime vs the
// selected window) is unmistakable.
const BAND_LABEL = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.7px',
  textTransform: 'uppercase',
  color: C.muted,
  paddingLeft: 2,
};

// Shared plain card shell for the dashboard charts (1px border + soft shadow,
// no accent edge).
const DASH_CHART_SHELL = {
  background: C.card,
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  padding: '20px 24px',
};

// Small ▲/▼ delta token. The ARROW points the literal direction of change; the
// COLOUR follows whether that move is good or bad (`delta.good`). For most
// metrics up = good, but for cost-like metrics (Marketing Spend, CAC) a fall is
// good — so a falling cost reads green and a rising CAC reads red. Falls back to
// up=good when `good` isn't supplied. `none` renders nothing.
function DeltaToken({ delta, size = 12 }) {
  if (!delta || delta.dir === 'none' || !delta.text) return null;
  const good = delta.good != null ? delta.good : delta.dir === 'up';
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 700,
        color: good ? C.green : C.red,
        whiteSpace: 'nowrap',
      }}
    >
      {delta.text}
    </span>
  );
}

// Hero metric: large headline value + delta token + muted comparison line.
function HeroMetric({ label, value, delta, compare, divider }) {
  return (
    <div style={{ padding: '24px 26px', borderRight: divider ? `1px solid ${C.border}` : undefined, minWidth: 0 }}>
      <div style={DASH_KPI_LABEL}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--font-head)',
          fontWeight: 700,
          fontSize: 42,
          letterSpacing: '-1.5px',
          lineHeight: 1,
          marginTop: 6,
          color: C.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <DeltaToken delta={delta} size={12.5} />
        {compare && <span style={{ fontSize: 12.5, color: C.muted }}>{compare}</span>}
      </div>
    </div>
  );
}

// Secondary metric: smaller card, value + inline delta token.
function StatCard({ label, value, delta }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${CARD_BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '15px 18px' }}>
      <div style={{ ...DASH_KPI_LABEL, fontSize: 10.5, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            fontSize: 24,
            color: C.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <DeltaToken delta={delta} size={11.5} />
      </div>
    </div>
  );
}

// Trend-chart tooltip: real monthly values, or "Not yet reported" for the
// upcoming (dashed-band) months.
function TrendTooltip({ active, label, reported, installs, users }) {
  if (!active || label == null) return null;
  const i = MONTHS.indexOf(label);
  const upcoming = reported >= 0 && i > reported;
  return (
    <div
      style={TOOLTIP_BOX}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {upcoming ? (
        <div style={{ color: C.muted }}>Not yet reported</div>
      ) : (
        <>
          <div style={{ color: CHART_COLORS.installs }}>Installs: {installs[i] == null ? DASH : fmtNumber(installs[i])}</div>
          <div style={{ color: CHART_COLORS.users }}>Active Users: {users[i] == null ? DASH : fmtNumber(users[i])}</div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard range helpers — operate across ALL years (a range may span years),
// independent of the top-right year dropdown.
// ─────────────────────────────────────────────────────────────────────────────
const PERIOD = (y, m) => y * 12 + m;
const toPeriod = (idx) => ({ y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 });
const addMonths = (p, n) => toPeriod(PERIOD(p.y, p.m) + n);
const fmtPeriod = (p) => `${MONTHS[p.m]} ${p.y}`;

function parseMonthInput(s) {
  if (!s) return null;
  const [y, m] = String(s).split('-').map(Number);
  if (!y || !m) return null;
  return { y, m: m - 1 };
}
const toMonthInput = (p) => (p ? `${p.y}-${String(p.m + 1).padStart(2, '0')}` : '');

function periodHasAnyData(allYears, y, m) {
  const yd = allYears[String(y)];
  if (!yd) return false;
  for (const k of Object.keys(yd)) {
    if (k === 'notes') continue;
    if (isNum(yd[k]?.[MONTHS[m]])) return true;
  }
  return false;
}

function dataExtent(allYears) {
  let earliest = null;
  let latest = null;
  for (const yStr of Object.keys(allYears)) {
    const y = Number(yStr);
    if (Number.isNaN(y)) continue;
    for (let m = 0; m < 12; m++) {
      if (!periodHasAnyData(allYears, y, m)) continue;
      const idx = PERIOD(y, m);
      if (earliest == null || idx < PERIOD(earliest.y, earliest.m)) earliest = { y, m };
      if (latest == null || idx > PERIOD(latest.y, latest.m)) latest = { y, m };
    }
  }
  return { earliest, latest };
}

function periodsBetween(from, to) {
  const out = [];
  for (let p = PERIOD(from.y, from.m); p <= PERIOD(to.y, to.m); p++) out.push(toPeriod(p));
  return out;
}

// Latest completed month = current calendar month − 1, falling back to the most
// recent earlier month that actually has data.
function latestCompletedPeriod(allYears) {
  const now = new Date();
  const start = addMonths({ y: now.getFullYear(), m: now.getMonth() }, -1);
  let p = start;
  for (let i = 0; i < 600; i++) {
    if (periodHasAnyData(allYears, p.y, p.m)) return p;
    p = addMonths(p, -1);
  }
  return start;
}

function sumKeysAt(allYears, keys, p) {
  let s = 0;
  let any = false;
  for (const k of keys) {
    const v = getVal(allYears[String(p.y)], k, p.m);
    if (v != null) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

function sumKeysOver(allYears, keys, periods) {
  let s = 0;
  let any = false;
  for (const p of periods) {
    const v = sumKeysAt(allYears, keys, p);
    if (v != null) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
}

// Lifetime cumulative of `keys` from the earliest data through `end` inclusive.
function lifetimeThrough(allYears, keys, end) {
  if (!end) return null;
  const endIdx = PERIOD(end.y, end.m);
  let s = 0;
  let any = false;
  for (const yStr of Object.keys(allYears)) {
    const y = Number(yStr);
    if (Number.isNaN(y)) continue;
    for (let m = 0; m < 12; m++) {
      if (PERIOD(y, m) > endIdx) continue;
      const v = sumKeysAt(allYears, keys, { y, m });
      if (v != null) {
        s += v;
        any = true;
      }
    }
  }
  return any ? s : null;
}

// Point-in-time aggregation (MAU/DAU) over a multi-month range: use the latest
// value in the range (a snapshot can't be summed/averaged meaningfully — over
// All Time this resolves to the most recent reported figure). Change here later.
const POINT_IN_TIME_AGG = 'last';
function aggregatePointInTime(values) {
  if (!values.length) return null;
  if (POINT_IN_TIME_AGG === 'last') return values[values.length - 1];
  if (POINT_IN_TIME_AGG === 'max') return Math.max(...values);
  return values.reduce((a, b) => a + b, 0) / values.length; // 'avg'
}
function pointInTimeOver(allYears, key, periods) {
  const vals = [];
  for (const p of periods) {
    const v = getVal(allYears[String(p.y)], key, p.m);
    if (v != null) vals.push(v);
  }
  return aggregatePointInTime(vals);
}

const DASH_PRESETS = [
  ['lastMonth', 'Last Month'],
  ['last3', 'Last 3 Months'],
  ['last6', 'Last 6 Months'],
  ['ytd', 'YTD'],
  ['allTime', 'All Time'],
];

function buildPresetRanges(allYears) {
  const now = new Date();
  const y0 = now.getFullYear();
  const m0 = now.getMonth();
  const lc = latestCompletedPeriod(allYears); // most recent completed month (data-aware)
  const ext = dataExtent(allYears);
  return {
    lastMonth: { from: lc, to: lc },
    last3: { from: addMonths(lc, -2), to: lc },
    last6: { from: addMonths(lc, -5), to: lc },
    ytd: { from: { y: y0, m: 0 }, to: { y: y0, m: m0 } },
    allTime: ext.earliest && ext.latest ? { from: ext.earliest, to: ext.latest } : null,
  };
}

function DashboardTab({ allYears }) {
  const storeKeys = STORE_KEYS.map((s) => s[0]);
  const countKeys = ['tx_sendP2P', 'tx_receiveP2P', 'tx_cashOut', 'tx_cardRedemption', 'tx_other'];
  const valueKeys = ['tx_sendVolume', 'tx_receiveVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume', 'tx_otherVolume'];
  const revKeys = ['c_grossRevenue', 'r_offramps', 'r_other'];
  const costKeys = ['cost_ambassador', 'cost_saas', 'cost_digitalMarketing', 'cost_campaigns'];
  // Marketing/acquisition spend (cost-like: down is good). Distinct keys, so no
  // double counting against the Costs tab's ambassador line.
  const marketingKeys = ['dl_ambassadorCosts', 'dl_paidCampaignSpend', 'cost_digitalMarketing', 'cost_campaigns'];

  const presets = useMemo(() => buildPresetRanges(allYears), [allYears]);
  const defaultPeriod = useMemo(() => latestCompletedPeriod(allYears), [allYears]);
  const allTimeEnd = useMemo(() => dataExtent(allYears).latest, [allYears]);

  // Last Month is the default selection.
  const [sel, setSel] = useState('lastMonth'); // preset key | 'custom'
  const [customFrom, setCustomFrom] = useState(() => toMonthInput(latestCompletedPeriod(allYears)));
  const [customTo, setCustomTo] = useState(() => toMonthInput(latestCompletedPeriod(allYears)));
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!customOpen) return;
    const close = () => setCustomOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [customOpen]);

  // Resolve the active range. null only when there's no data to span.
  let range = null;
  if (sel === 'custom') {
    const f = parseMonthInput(customFrom);
    const t = parseMonthInput(customTo);
    if (f && t) {
      range = PERIOD(f.y, f.m) <= PERIOD(t.y, t.m) ? { from: f, to: t } : { from: t, to: f };
    }
  } else {
    range = presets[sel] || null;
  }

  const selectPreset = (key) => {
    setSel(key);
    const r = presets[key];
    if (r) {
      setCustomFrom(toMonthInput(r.from));
      setCustomTo(toMonthInput(r.to));
    }
  };

  // Periods in the active window; fall back to the latest completed month only
  // when there's no resolvable range (e.g. an empty dataset).
  const periods = range ? periodsBetween(range.from, range.to) : [defaultPeriod];

  // Current window vs the immediately-preceding comparable window (for deltas).
  const periodCount = periods.length;
  const compFrom = addMonths(periods[0], -periodCount);
  const compTo = addMonths(periods[0], -1);
  const compPeriods = periodsBetween(compFrom, compTo);

  const curPrev = (def) => {
    if (def.type === 'lifetime') {
      const curEnd = range ? range.to : allTimeEnd;
      if (!curEnd) return [null, null];
      return [
        lifetimeThrough(allYears, def.keys, curEnd),
        lifetimeThrough(allYears, def.keys, addMonths(curEnd, -periodCount)),
      ];
    }
    if (def.type === 'additive') {
      return [sumKeysOver(allYears, def.keys, periods), sumKeysOver(allYears, def.keys, compPeriods)];
    }
    if (def.type === 'ratio') {
      const isPct = def.unit === 'percent' || def.unit === 'percent2';
      const cn = sumKeysOver(allYears, def.num, periods);
      const cd = sumKeysOver(allYears, def.den, periods);
      const pn = sumKeysOver(allYears, def.num, compPeriods);
      const pd = sumKeysOver(allYears, def.den, compPeriods);
      return [isPct ? pct(cn, cd) : safeDiv(cn, cd), isPct ? pct(pn, pd) : safeDiv(pn, pd)];
    }
    if (def.type === 'diffratio') {
      // (Σplus − Σminus) ÷ Σden — e.g. card CAC = (Volume − Funds) ÷ Unique Users.
      const calc = (ps) =>
        safeDiv(
          (sumKeysOver(allYears, def.plus, ps) || 0) - (sumKeysOver(allYears, def.minus, ps) || 0),
          sumKeysOver(allYears, def.den, ps)
        );
      return [calc(periods), calc(compPeriods)];
    }
    return [pointInTimeOver(allYears, def.key, periods), pointInTimeOver(allYears, def.key, compPeriods)];
  };

  // Delta vs the comparison window. Percentage metrics report points (pp);
  // everything else reports relative %. The arrow is the literal direction; the
  // colour follows good/bad via def.goodDir ('up' default, 'down' for costs).
  const deltaOf = (def, cur, prev) => {
    if (cur == null || prev == null) return { dir: 'none', text: null };
    const isPP = def.unit === 'percent' || def.unit === 'percent2';
    let up;
    let text;
    if (isPP) {
      const d = cur - prev;
      up = d >= 0;
      text = `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}pp`;
    } else {
      if (prev === 0) return { dir: 'none', text: null };
      const d = ((cur - prev) / Math.abs(prev)) * 100;
      up = d >= 0;
      text = `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`;
    }
    const good = def.goodDir === 'down' ? !up : up;
    return { dir: up ? 'up' : 'down', good, text };
  };

  const comparePhrase = range ? 'previous period' : 'last month';
  const buildMetric = (def, withCompare) => {
    const [cur, prev] = curPrev(def);
    const compare = withCompare && prev != null ? `vs ${fmtByUnit(prev, def.unit)} ${comparePhrase}` : null;
    return { label: def.label, value: fmtByUnit(cur, def.unit), delta: deltaOf(def, cur, prev), compare };
  };

  // Three question-driven bands. Row 1 = lifetime headline scale (hero); rows 2
  // and 3 = the selected window (default: latest completed month), MoM-style.
  const heroDefs = [
    { label: 'Total Installs', type: 'lifetime', keys: storeKeys, unit: 'count' },
    { label: 'Total Users', type: 'lifetime', keys: ['u_newUsers'], unit: 'count' },
    {
      label: (
        <>
          Total Cards Volume <span style={{ color: C.gray400, fontWeight: 600 }}>USDT</span>
        </>
      ),
      type: 'lifetime',
      keys: ['c_valueDistributed'],
      unit: 'usdt',
    },
  ];
  const engagementDefs = [
    { label: 'Install → User Conversion', type: 'ratio', num: ['u_newUsers'], den: storeKeys, unit: 'percent2' },
    { label: 'Transaction Count', type: 'additive', keys: countKeys, unit: 'count' },
    { label: 'Transaction Volume (USDT)', type: 'additive', keys: valueKeys, unit: 'usdt' },
    { label: 'MAU', type: 'point', key: 'u_mau', unit: 'count' },
  ];
  const economicsDefs = [
    { label: 'Total Revenue', type: 'additive', keys: revKeys, unit: 'usd' },
    { label: 'Marketing Spend', type: 'additive', keys: marketingKeys, unit: 'usd', goodDir: 'down' },
    {
      label: 'CAC · Top-up Cards',
      type: 'diffratio',
      plus: ['c_valueDistributed'],
      minus: ['c_fundsCollected'],
      den: ['c_uniqueUsers'],
      unit: 'ratio',
      goodDir: 'down',
    },
  ];
  const heroMetrics = heroDefs.map((d) => buildMetric(d, true));
  const engagementMetrics = engagementDefs.map((d) => buildMetric(d, false));
  const economicsMetrics = economicsDefs.map((d) => buildMetric(d, false));

  // Timeframe suffix so the two windows are unmistakable (single month vs
  // range). Leads the band labels after the one-word category. The month tracks
  // the selected window — by default the latest completed month, dynamically.
  const windowSuffix =
    periodCount === 1
      ? fmtPeriod(periods[0])
      : `${fmtPeriod(periods[0])} – ${fmtPeriod(periods[periods.length - 1])}`;

  // Combined trend chart: a 12-month calendar year, solid through the latest
  // reported month then a softly-shaded "upcoming" band with dashed lines.
  const chartYear = range ? range.to.y : new Date().getFullYear();
  const chartYearData = allYears[String(chartYear)] || {};
  const reported = latestMonthIndex(chartYearData);
  const installsByMonth = IDX.map((i) => sumKeysAt(allYears, storeKeys, { y: chartYear, m: i }));
  const usersByMonth = IDX.map((i) => getVal(chartYearData, 'u_mau', i));
  const lastInstall = reported >= 0 ? installsByMonth[reported] : null;
  const lastUser = reported >= 0 ? usersByMonth[reported] : null;
  const trendData = IDX.map((i) => ({
    m: MONTHS[i],
    installsSolid: reported >= 0 && i <= reported ? installsByMonth[i] : null,
    installsDash: reported >= 0 && i >= reported ? lastInstall : null,
    usersSolid: reported >= 0 && i <= reported ? usersByMonth[i] : null,
    usersDash: reported >= 0 && i >= reported ? lastUser : null,
  }));
  const renderMonthTick = ({ x, y, payload }) => {
    const i = MONTHS.indexOf(payload.value);
    const isReported = i === reported;
    const isUpcoming = reported >= 0 && i > reported;
    return (
      <text
        x={x}
        y={y + 12}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={isReported ? 700 : 400}
        fontFamily="var(--font-body)"
        fill={isReported ? C.text : isUpcoming ? C.gray400 : C.muted}
      >
        {payload.value}
      </text>
    );
  };

  // Chart 2 — Revenue vs Cost grouped bars (reported months only).
  const revByMonth = IDX.map((i) => sumKeysAt(allYears, revKeys, { y: chartYear, m: i }));
  const costByMonth = IDX.map((i) => sumKeysAt(allYears, costKeys, { y: chartYear, m: i }));
  const revCostData = IDX.map((i) => ({
    m: MONTHS[i],
    Revenue: reported >= 0 && i <= reported ? revByMonth[i] : null,
    Cost: reported >= 0 && i <= reported ? costByMonth[i] : null,
  }));
  // Chart 3 — Transaction Volume (USDT) monthly trend (reported months only).
  const txVolByMonth = IDX.map((i) => sumKeysAt(allYears, valueKeys, { y: chartYear, m: i }));
  const txVolData = IDX.map((i) => ({
    m: MONTHS[i],
    Volume: reported >= 0 && i <= reported ? txVolByMonth[i] : null,
  }));

  const pillStyle = (active) => ({
    border: `1px solid ${active ? C.primary : C.border}`,
    background: active ? C.primary : '#fff',
    color: active ? '#fff' : C.text,
    borderRadius: 9,
    padding: '7px 14px',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  const monthInput = {
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    padding: '7px 10px',
    fontSize: 12.5,
    fontFamily: 'inherit',
    color: C.text,
    background: '#fff',
  };

  // Print-to-PDF the whole Dashboard view. We set document.title so the browser's
  // "Save as PDF" suggests a meaningful filename, and rely on the @media print
  // rules (index.css) to drop the top nav / buttons from the capture.
  const exportPdf = () => {
    const prev = document.title;
    document.title = `sorted-dashboard-${chartYear}`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1000); // fallback if afterprint doesn't fire
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 22, margin: 0 }}>Overview</h2>
        <div style={{ flex: 1 }} />
        <DownloadButton label="Download PDF" onClick={exportPdf} />
      </div>

      {/* Date-range control: preset pills + a single collapsible Custom range. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {DASH_PRESETS.map(([key, label]) => {
          if (key === 'allTime' && !presets.allTime) return null;
          return (
            <button key={key} style={pillStyle(sel === key)} onClick={() => selectPreset(key)}>
              {label}
            </button>
          );
        })}
        <div style={{ position: 'relative' }}>
          <button
            style={pillStyle(sel === 'custom')}
            onClick={(e) => {
              e.stopPropagation();
              setCustomOpen((o) => !o);
            }}
          >
            {sel === 'custom' && range
              ? `${fmtPeriod(range.from)} – ${fmtPeriod(range.to)} ▾`
              : 'Custom range ▾'}
          </button>
          {customOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 40,
                left: 0,
                zIndex: 30,
                background: '#fff',
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                padding: 14,
                display: 'grid',
                gap: 10,
                minWidth: 200,
              }}
            >
              {['From', 'To'].map((lbl) => (
                <label
                  key={lbl}
                  style={{
                    display: 'grid',
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: C.muted,
                  }}
                >
                  {lbl}
                  <input
                    type="month"
                    style={monthInput}
                    value={lbl === 'From' ? customFrom : customTo}
                    onChange={(e) => {
                      if (lbl === 'From') setCustomFrom(e.target.value);
                      else setCustomTo(e.target.value);
                      setSel('custom');
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        <DownloadButton label="Download all" />
      </div>

      {/* ── ROW 1 · Lifetime headline scale (hero) ───────────────────────── */}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={BAND_LABEL}>Scale · Lifetime</div>
        <div
          style={{
            background: C.card,
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 18,
            boxShadow: CARD_SHADOW,
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
          }}
        >
          {heroMetrics.map((m, i) => (
            <HeroMetric key={i} {...m} divider={i < heroMetrics.length - 1} />
          ))}
        </div>
      </div>

      {/* ── ROW 2 · Engagement (selected window) ─────────────────────────── */}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={BAND_LABEL}>Engagement · {windowSuffix}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {engagementMetrics.map((m, i) => (
            <StatCard key={i} {...m} />
          ))}
        </div>
      </div>

      {/* ── ROW 3 · Economics (selected window) ──────────────────────────── */}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={BAND_LABEL}>Economics · {windowSuffix}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {economicsMetrics.map((m, i) => (
            <StatCard key={i} {...m} />
          ))}
        </div>
      </div>

      {/* ── Chart 1 · Installs & Active Users (full width) ───────────────── */}
      <div style={DASH_CHART_SHELL}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>
            Installs &amp; Active Users
          </h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: C.muted }}>
            <span>
              <span style={{ color: CHART_COLORS.installs }}>●</span> Installs
            </span>
            <span>
              <span style={{ color: CHART_COLORS.users }}>●</span> Active Users
            </span>
            <span style={{ color: UPCOMING_LABEL }}>▦ Upcoming</span>
          </div>
        </div>
        {reported < 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={trendData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              {gradient('dashTrendInstalls', CHART_COLORS.installs)}
              <CartesianGrid {...GRID} />
              {reported < 11 && (
                <ReferenceArea
                  x1={MONTHS[reported]}
                  x2={MONTHS[11]}
                  fill={UPCOMING_BAND}
                  stroke="none"
                  label={{ value: 'Upcoming', position: 'insideTopLeft', fontSize: 11, fill: UPCOMING_LABEL }}
                />
              )}
              {reported < 11 && <ReferenceLine x={MONTHS[reported]} stroke={UPCOMING_DIVIDER} strokeWidth={1} />}
              <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} tick={renderMonthTick} />
              <YAxis yAxisId="left" hide />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip
                content={(p) => (
                  <TrendTooltip {...p} reported={reported} installs={installsByMonth} users={usersByMonth} />
                )}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="installsSolid"
                stroke={CHART_COLORS.installs}
                strokeWidth={2.4}
                fill="url(#dashTrendInstalls)"
                dot={false}
                connectNulls={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="installsDash"
                stroke={CHART_COLORS.installs}
                strokeOpacity={0.4}
                strokeWidth={2}
                strokeDasharray="6 6"
                dot={false}
                connectNulls={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="usersSolid"
                stroke={CHART_COLORS.users}
                strokeWidth={2.4}
                dot={false}
                connectNulls={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="usersDash"
                stroke={CHART_COLORS.users}
                strokeOpacity={0.4}
                strokeWidth={2}
                strokeDasharray="6 6"
                dot={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Charts 2 & 3 · Revenue vs Cost + Transaction Volume ──────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* Chart 2 · Revenue vs Cost — grouped bars by month */}
        <div style={DASH_CHART_SHELL}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>Revenue vs Cost</h3>
            <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: C.muted }}>
              <span>
                <span style={{ color: CHART_COLORS.revenue }}>●</span> Revenue
              </span>
              <span>
                <span style={{ color: CHART_COLORS.cost }}>●</span> Cost
              </span>
            </div>
          </div>
          {reported < 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={revCostData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} tick={renderMonthTick} />
                <YAxis {...yAxis()} />
                <Tooltip content={(p) => <ChartTooltip {...p} fmt={(v) => withDollar(fmtNumber(v))} reported={reported} />} />
                <Bar dataKey="Revenue" fill={CHART_COLORS.revenue} radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Cost" fill={CHART_COLORS.cost} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart 3 · Transaction Volume — monthly USDT trend */}
        <div style={DASH_CHART_SHELL}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16, margin: 0 }}>
              Transaction Volume <span style={{ color: C.gray400, fontWeight: 600, fontSize: 12 }}>USDT</span>
            </h3>
          </div>
          {reported < 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={txVolData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                {gradient('dashTxVol', CHART_COLORS.transactions)}
                <CartesianGrid {...GRID} />
                <XAxis dataKey="m" tickLine={false} axisLine={false} interval={0} tick={renderMonthTick} />
                <YAxis {...yAxis()} />
                <Tooltip content={(p) => <ChartTooltip {...p} fmt={(v) => withDollar(fmtUSDT(v))} reported={reported} />} />
                <Area
                  type="monotone"
                  dataKey="Volume"
                  stroke={CHART_COLORS.transactions}
                  strokeWidth={2.4}
                  fill="url(#dashTxVol)"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function TabContent({
  tab,
  yearData,
  activeYear,
  years,
  user,
  setUser,
  canEdit,
  updateMetric,
  updateNote,
  updateYearField,
  updateRoot,
  cardBatches,
  cardCountryUsers,
  allYears,
}) {
  const common = { yearData, activeYear, updateMetric, updateNote, allYears };
  switch (tab) {
    case 'Installs & Users':
      return <DownloadsTab {...common} />;
    case 'Retention':
      return <UsersTab {...common} />;
    case 'Transactions':
      return <TransactionsTab {...common} />;
    case 'Top-up Cards':
      return (
        <CardsTab
          {...common}
          cardBatches={cardBatches}
          cardCountryUsers={cardCountryUsers}
          updateRoot={updateRoot}
        />
      );
    case 'Costs & Revenue':
      return <RevenueTab {...common} />;
    case 'Campaigns':
      return <CampaignsTab yearData={yearData} updateYearField={updateYearField} activeYear={activeYear} />;
    case 'Settings':
      return <SettingsTab user={user} setUser={setUser} canEdit={canEdit} />;
    case 'Dashboard':
    default:
      return <DashboardTab allYears={allYears} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — profile + password for everyone; team management for owners.
// ─────────────────────────────────────────────────────────────────────────────
const settingsSectionLabel = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: C.muted,
};
const settingsSmallBtn = {
  border: 'none',
  background: C.primary,
  color: '#fff',
  borderRadius: 8,
  padding: '8px 14px',
  fontWeight: 600,
  fontSize: 13,
  marginTop: 12,
  cursor: 'pointer',
};

// 'master' → 'Master', 'owner' → 'Owner', anything else → 'Member'.
function roleLabel(role) {
  if (role === ROLES.MASTER) return 'Master';
  if (role === ROLES.OWNER) return 'Owner';
  return 'Member';
}

function SettingsTab({ user, setUser, canEdit }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [msg, setMsg] = useState('');

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  const settingInput = { ...authInput, maxWidth: 320 };

  const saveName = async () => {
    setMsg('');
    try {
      const name = displayName.trim() || user.username;
      await updateDisplayName(user.username, name);
      setUser({ ...user, display_name: name });
      setMsg('Display name updated.');
    } catch (e) {
      setMsg(e.message || 'Could not update.');
    }
  };

  const doChangePassword = async () => {
    setPwMsg('');
    try {
      const ok = await verifyPassword(user, curPw);
      if (!ok) {
        setPwMsg('Current password is incorrect.');
        return;
      }
      if (!isValidPassword(newPw)) {
        setPwMsg(`New password must be ${PASSWORD_RULE}.`);
        return;
      }
      if (newPw !== newPw2) {
        setPwMsg('New passwords do not match.');
        return;
      }
      await changePassword(user.username, newPw);
      const refreshed = await getUser(user.username);
      setUser(refreshed);
      setCurPw('');
      setNewPw('');
      setNewPw2('');
      setPwMsg('Password changed.');
    } catch (e) {
      setPwMsg(e.message || 'Could not change password.');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <Card accent={C.primary}>
        <div style={settingsSectionLabel}>Profile</div>
        <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Display name</h2>
        <input
          style={settingInput}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <div>
          <button style={settingsSmallBtn} onClick={saveName}>
            Save
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
          Username: <strong>{user.username}</strong> (cannot be changed) · Role:{' '}
          <strong>{roleLabel(user.role)}</strong>
        </div>
        {msg && <p style={{ color: C.green, fontSize: 13 }}>{msg}</p>}
      </Card>

      <Card accent={C.primary}>
        <div style={settingsSectionLabel}>Security</div>
        <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Change password</h2>
        <input
          style={{ ...settingInput, marginTop: 0 }}
          type="password"
          placeholder="Current password"
          value={curPw}
          onChange={(e) => setCurPw(e.target.value)}
        />
        <input
          style={settingInput}
          type="password"
          placeholder={`New password (${PASSWORD_RULE})`}
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
        />
        <input
          style={settingInput}
          type="password"
          placeholder="Confirm new password"
          value={newPw2}
          onChange={(e) => setNewPw2(e.target.value)}
        />
        <div>
          <button style={settingsSmallBtn} onClick={doChangePassword}>
            Update password
          </button>
        </div>
        {pwMsg && (
          <p
            style={{
              color: pwMsg.includes('changed') ? C.green : C.red,
              fontSize: 13,
            }}
          >
            {pwMsg}
          </p>
        )}
      </Card>

      {canEdit && <TeamPanel user={user} />}
    </div>
  );
}

// Team management for Master and Owners. The role hierarchy is Master > Owner >
// Member. The Master can manage everyone (and is itself protected); Owners can
// manage Members only — never another Owner or the Master.
function RoleBadge({ role }) {
  const map = {
    [ROLES.MASTER]: { background: C.primary, color: '#fff' },
    [ROLES.OWNER]: { background: 'rgba(0,17,168,0.10)', color: C.primary },
    [ROLES.MEMBER]: { background: C.gray200, color: C.gray600 },
  };
  const s = map[role] || map[ROLES.MEMBER];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '3px 9px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        ...s,
      }}
    >
      {roleLabel(role)}
    </span>
  );
}

// A single row-action in the kebab menu, with a subtle hover.
function MenuItem({ onClick, danger, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderRadius: 6,
        background: hover ? C.gray100 : 'transparent',
        color: danger ? C.red : C.text,
        padding: '8px 12px',
        fontSize: 13,
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function TeamPanel({ user }) {
  const isMaster = user.role === ROLES.MASTER;

  const [accounts, setAccounts] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState(ROLES.MEMBER);
  const [addMsg, setAddMsg] = useState('');

  const [resetFor, setResetFor] = useState(null); // username with the reset form open
  const [resetPw, setResetPw] = useState('');
  const [resetErr, setResetErr] = useState('');
  const [resetDone, setResetDone] = useState(null); // { username, name, pw }

  const [openMenu, setOpenMenu] = useState(null); // username whose kebab menu is open
  const [showAdd, setShowAdd] = useState(false); // add-member form collapsed by default

  const settingInput = { ...authInput, maxWidth: 320, marginTop: 0 };

  // Close the open kebab menu on any outside click.
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenu]);

  const reload = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch (e) {
      setErr(e.message || 'Could not load the team.');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // The "Account created" / form messages auto-dismiss — the new row in the
  // list above is the lasting confirmation.
  useEffect(() => {
    if (!addMsg) return;
    const t = setTimeout(() => setAddMsg(''), 3500);
    return () => clearTimeout(t);
  }, [addMsg]);

  // Display name with a capitalised first letter (display-only; the stored
  // username is unchanged). Falls back to the username when no display name.
  const nameOf = (a) => {
    const base = a.display_name && a.display_name.trim() ? a.display_name.trim() : a.username;
    return base.charAt(0).toUpperCase() + base.slice(1);
  };

  // What the current user may do to a given account, per the hierarchy.
  const actionsFor = (a) => {
    if (a.role === ROLES.MASTER) return { protected: true };
    if (a.role === ROLES.OWNER) {
      return isMaster ? { demote: true, reset: true, remove: true } : { protected: true };
    }
    return { promote: true, reset: true, remove: true }; // Member
  };

  const addMember = async () => {
    setAddMsg('');
    const uname = newUsername.trim().toLowerCase();
    if (!uname) {
      setAddMsg('Enter a username.');
      return;
    }
    if (!isValidPassword(newPassword)) {
      setAddMsg(`Password must be ${PASSWORD_RULE}.`);
      return;
    }
    // Owners may only create Members; the Owner option is hidden for them too.
    const role = isMaster && newRole === ROLES.OWNER ? ROLES.OWNER : ROLES.MEMBER;
    setBusy(true);
    try {
      await createAccount({ username: uname, password: newPassword, displayName: uname, role });
      setNewUsername('');
      setNewPassword('');
      setNewRole(ROLES.MEMBER);
      setAddMsg('');
      setShowAdd(false); // collapse the form; the new row is the confirmation
      await reload();
    } catch (e) {
      const dup = String(e.message || '').toLowerCase().includes('duplicate');
      setAddMsg(dup ? 'That username already exists.' : e.message || 'Could not add member.');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (a, role, confirmMsg) => {
    setErr('');
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await setAccountRole(a.username, role);
      await reload();
    } catch (e) {
      setErr(e.message || 'Could not change role.');
    } finally {
      setBusy(false);
    }
  };

  const promote = (a) =>
    changeRole(
      a,
      ROLES.OWNER,
      `Make ${nameOf(a)} an Owner? Owners have full edit and team-management access. Only the Master can later demote an Owner.`
    );

  const demote = (a) =>
    changeRole(
      a,
      ROLES.MEMBER,
      `Make ${nameOf(a)} a Member? They will lose edit and team-management access.`
    );

  const remove = async (a) => {
    setErr('');
    if (!window.confirm(`Remove ${nameOf(a)}? They will lose access immediately.`)) return;
    setBusy(true);
    try {
      await removeAccount(a.username);
      if (resetFor === a.username) setResetFor(null);
      await reload();
    } catch (e) {
      setErr(e.message || 'Could not remove member.');
    } finally {
      setBusy(false);
    }
  };

  const openReset = (a) => {
    setResetDone(null);
    setResetErr('');
    setResetPw('');
    setResetFor(a.username);
  };

  const submitReset = async (a) => {
    setResetErr('');
    if (!isValidPassword(resetPw)) {
      setResetErr(`Password must be ${PASSWORD_RULE}.`);
      return;
    }
    setBusy(true);
    try {
      await changePassword(a.username, resetPw);
      setResetDone({ username: a.username, name: nameOf(a), pw: resetPw });
      setResetFor(null);
      setResetPw('');
    } catch (e) {
      setResetErr(e.message || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  const actionBtn = (variant) => ({
    width: 92,
    border: `1px solid ${variant === 'danger' ? C.red : C.border}`,
    background: '#fff',
    color: variant === 'danger' ? C.red : C.text,
    borderRadius: 7,
    padding: '5px 6px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <Card accent={C.primary}>
      <div style={{ ...settingsSectionLabel, marginBottom: 10 }}>Team</div>

      {accounts == null ? (
        <p style={{ fontSize: 13, color: C.muted }}>Loading team…</p>
      ) : (
        <div>
          {accounts.map((a) => {
            const name = nameOf(a);
            const showUsername = name.toLowerCase() !== a.username.toLowerCase();
            const isSelf = a.username === user.username;
            const can = actionsFor(a);
            return (
              <React.Fragment key={a.username}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '9px 0',
                    borderBottom: `1px solid ${C.bg}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {name}
                      {isSelf && <span style={{ color: C.muted, fontWeight: 400 }}> · you</span>}
                    </div>
                    {showUsername && (
                      <div style={{ fontSize: 12, color: C.muted }}>@{a.username}</div>
                    )}
                  </div>
                  <div style={{ width: 70, display: 'flex', justifyContent: 'flex-end' }}>
                    <RoleBadge role={a.role} />
                  </div>
                  <div
                    style={{
                      width: 92,
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      position: 'relative',
                    }}
                  >
                    {can.protected ? (
                      <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
                        Protected
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          title="Actions"
                          aria-label="Actions"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenu(openMenu === a.username ? null : a.username);
                          }}
                          style={{
                            border: 'none',
                            background: openMenu === a.username ? C.gray200 : 'transparent',
                            borderRadius: 7,
                            width: 28,
                            height: 28,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: C.gray600,
                            fontSize: 18,
                            lineHeight: 1,
                            cursor: 'pointer',
                          }}
                        >
                          ⋮
                        </button>
                        {openMenu === a.username && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              top: 32,
                              right: 0,
                              zIndex: 30,
                              background: '#fff',
                              border: `1px solid ${C.border}`,
                              borderRadius: 10,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                              padding: 4,
                              minWidth: 170,
                            }}
                          >
                            {can.promote && (
                              <MenuItem onClick={() => { setOpenMenu(null); promote(a); }}>
                                Make Owner
                              </MenuItem>
                            )}
                            {can.demote && (
                              <MenuItem onClick={() => { setOpenMenu(null); demote(a); }}>
                                Make Member
                              </MenuItem>
                            )}
                            {can.reset && (
                              <MenuItem onClick={() => { setOpenMenu(null); openReset(a); }}>
                                Reset password
                              </MenuItem>
                            )}
                            {can.remove && (
                              <MenuItem danger onClick={() => { setOpenMenu(null); remove(a); }}>
                                Remove
                              </MenuItem>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {resetFor === a.username && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 0 12px',
                      borderBottom: `1px solid ${C.bg}`,
                    }}
                  >
                    <span style={{ fontSize: 12, color: C.muted }}>
                      New password for <strong>{name}</strong>:
                    </span>
                    <input
                      style={{ ...settingInput, width: 150 }}
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      placeholder={PASSWORD_RULE}
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                    />
                    <button
                      style={{ ...settingsSmallBtn, marginTop: 0 }}
                      disabled={busy}
                      onClick={() => submitReset(a)}
                    >
                      Set password
                    </button>
                    <button
                      style={{ ...actionBtn(), width: 'auto', padding: '5px 10px' }}
                      onClick={() => {
                        setResetFor(null);
                        setResetErr('');
                      }}
                    >
                      Cancel
                    </button>
                    {resetErr && <span style={{ color: C.red, fontSize: 12 }}>{resetErr}</span>}
                  </div>
                )}

                {resetDone && resetDone.username === a.username && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 12px',
                      margin: '8px 0',
                      background: 'rgba(109,187,138,0.14)',
                      border: `1px solid ${C.green}`,
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      New password set for <strong>{resetDone.name}</strong>:{' '}
                      <strong>{resetDone.pw}</strong> — share it with them to log in.
                    </span>
                    <button
                      style={{ ...actionBtn(), width: 'auto', padding: '4px 10px' }}
                      onClick={() => setResetDone(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}

      <div style={{ marginTop: 14 }}>
        {showAdd ? (
          <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 2px' }}>Add a member</h3>
            <input
              style={settingInput}
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
            <input
              style={settingInput}
              type="password"
              placeholder={`Initial password (${PASSWORD_RULE})`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <select
              style={{ ...settingInput, cursor: 'pointer' }}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value={ROLES.MEMBER}>Member</option>
              {isMaster && <option value={ROLES.OWNER}>Owner</option>}
            </select>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={{ ...settingsSmallBtn, marginTop: 0 }} disabled={busy} onClick={addMember}>
                {busy ? 'Working…' : 'Add member'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setAddMsg('');
                  setNewUsername('');
                  setNewPassword('');
                  setNewRole(ROLES.MEMBER);
                }}
                style={{
                  border: `1px solid ${C.border}`,
                  background: '#fff',
                  color: C.text,
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
            {addMsg && (
              <p style={{ color: C.red, fontSize: 13, margin: '4px 0 0' }}>{addMsg}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAddMsg('');
              setShowAdd(true);
            }}
            style={{
              border: `1px solid ${C.border}`,
              background: '#fff',
              color: C.primary,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add a member
          </button>
        )}
      </div>
    </Card>
  );
}

export default App;
