import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell as RCell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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

function Card({ accent, style, children }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        borderTop: accent ? `3px solid ${accent}` : `1px solid ${C.border}`,
        padding: 20,
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
          saveStatus={saveStatus}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          onLogout={onLogout}
          onOpenSettings={() => setActiveTab('Settings')}
          settingsActive={activeTab === 'Settings'}
        />
        <TabBar
          activeTab={activeTab}
          onChange={setActiveTab}
          years={years}
          activeYear={activeYear}
          onYearChange={setActiveYear}
          onAddYear={addYear}
          canAddYear={canEdit}
        />

        <main
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '24px 20px 64px',
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

function TopNav({ saveStatus, lastUpdated, onRefresh, onLogout, onOpenSettings, settingsActive }) {
  const statusLabel = saveStatusLabel(saveStatus);
  const lastUpdatedLabel = fmtDate(lastUpdated);

  return (
    <header
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
          maxWidth: 1120,
          margin: '0 auto',
          padding: '12px 20px',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Left — Sorted wordmark. Pulled left by the SVG's internal left
            whitespace so its glyphs hang on the shared 20px content gridline. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src={`${process.env.PUBLIC_URL}/sorted-wordmark.svg`}
            alt="Sorted"
            style={{ height: 22, width: 'auto', display: 'block', marginLeft: -6.5 }}
          />
        </div>

        {/* Center — dashboard title (brand sits in the wordmark on the left). */}
        <div style={{ textAlign: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--font-head)',
              fontSize: 16,
              fontWeight: 600,
              color: C.text,
              whiteSpace: 'nowrap',
            }}
          >
            Metrics Dashboard
          </span>
        </div>

        {/* Right — save status, team-wide freshness, refresh, settings, logout. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          {statusLabel && (
            <span style={{ fontSize: 12, color: saveStatus === 'error' ? C.red : C.muted }}>
              {statusLabel}
            </span>
          )}
          {lastUpdatedLabel && (
            <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>
              Last updated: {lastUpdatedLabel}
            </span>
          )}
          <button
            onClick={onRefresh}
            title="Refresh from server"
            style={{
              border: `1px solid ${C.border}`,
              background: '#fff',
              borderRadius: 7,
              width: 28,
              height: 28,
              lineHeight: 1,
            }}
          >
            ↻
          </button>
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            style={{
              border: `1px solid ${settingsActive ? C.primary : C.border}`,
              background: settingsActive ? 'rgba(0,17,168,0.10)' : '#fff',
              color: settingsActive ? C.primary : C.text,
              borderRadius: 8,
              width: 32,
              height: 32,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ⚙
          </button>
          <button
            onClick={onLogout}
            style={{
              border: `1px solid ${C.border}`,
              background: '#fff',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
            }}
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

function TabBar({ activeTab, onChange, years, activeYear, onYearChange, onAddYear, canAddYear }) {
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
    <nav
      style={{
        position: 'sticky',
        top: 53,
        zIndex: 19,
        background: 'rgba(247,245,240,0.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
          {TABS.map((tab, i) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                onClick={() => onChange(tab)}
                style={{
                  background: 'none',
                  border: 'none',
                  // First tab hangs flush on the shared left gridline (no left
                  // inset) so it lines up with the wordmark and page content.
                  padding: i === 0 ? '12px 12px 12px 0' : '12px 12px',
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  color: active ? C.primary : C.muted,
                  borderBottom: active
                    ? `2px solid ${C.primary}`
                    : '2px solid transparent',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

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
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237b7d84' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 11px center`,
            fontFamily: 'inherit',
            fontSize: 14,
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
      </div>
    </nav>
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
function Cell({ value, unit, onCommit, inputStyle }) {
  const editable = useContext(EditableContext);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  // Read-only (Member) view: show the same figure, but as plain text — no
  // input, no focus affordance, not editable.
  if (!editable) {
    return (
      <span
        style={{
          display: 'block',
          textAlign: 'right',
          fontSize: 13,
          color: C.text,
          padding: '6px 4px',
          ...inputStyle,
        }}
      >
        {value == null ? DASH : fmtByUnit(value, unit)}
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
    : fmtByUnit(value, unit);

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
      placeholder={DASH}
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
      style={{
        width: '100%',
        textAlign: 'right',
        fontFamily: 'inherit',
        fontSize: 13,
        color: C.text,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${focused ? C.primary : 'transparent'}`,
        padding: '6px 4px',
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

// Subtle translucent grey for future/unentered month columns. Translucent so it
// darkens both white input rows and the grey calc rows consistently.
const FUTURE_BG = 'rgba(123, 125, 132, 0.08)';

// Whitespace + a thin rule that separates a calculated block from the next
// section, so groups don't run straight into one another.
function DividerRow() {
  return (
    <tr aria-hidden="true">
      <td colSpan={14} style={{ padding: 0 }}>
        <div style={{ height: 1, background: C.border, margin: '12px 0 2px' }} />
      </td>
    </tr>
  );
}

// Standalone section break (whitespace + a thin rule) for separating blocks
// that live outside a single MetricTable, e.g. the Top-up Cards sub-sections.
function SectionDivider() {
  return <div aria-hidden="true" style={{ height: 1, background: C.border, margin: '16px 0 0' }} />;
}

function MetricTable({ yearData, rows, updateMetric, totalLabel = 'YTD' }) {
  const latest = latestMonthIndex(yearData);
  // Months after the latest one with data are "not yet entered" — greyed out.
  // Dynamic: as new months are filled, `latest` advances and the band shrinks.
  const isFuture = (i) => latest >= 0 && i > latest;
  // Calculated rows get a subtle brand-gray tint (not an accent fill).
  const calcBg = C.gray200;
  const calcLabelBg = C.gray200;

  const inputYtd = (key, mode) => {
    if (latest < 0 || mode === 'none') return null;
    if (mode === 'last') return getVal(yearData, key, latest);
    const s = rawSeries(yearData, key);
    if (mode === 'avg') return seriesAvg(s);
    return seriesSum(s, latest);
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          tableLayout: 'fixed',
          minWidth: 880,
        }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th
              style={{
                ...thBase,
                textAlign: 'left',
                padding: '10px 16px',
                width: 184, // fixed; the 13 numeric columns split the rest evenly
                position: 'sticky',
                left: 0,
                background: C.card,
              }}
            />
            {MONTHS.map((m, i) => (
              <th
                key={m}
                style={isFuture(i) ? { ...thBase, background: FUTURE_BG, color: C.gray400 } : thBase}
              >
                {m}
              </th>
            ))}
            <th
              style={{
                ...thBase,
                // Reserve a dedicated width: under table-layout:fixed the total
                // column otherwise shares a month column's narrow width, so the
                // (largest) total values overflow it and padding-right can't
                // create visible spacing. A fixed width lets the value sit
                // inside the cell with its right padding showing.
                width: 110,
                paddingRight: 16,
                borderLeft: `1px solid ${C.border}`,
              }}
            >
              {totalLabel}
            </th>
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
                  {needsBreak && <DividerRow />}
                  <tr>
                    <td
                      colSpan={14}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: C.text,
                        textAlign: 'left',
                        padding: '14px 8px 6px',
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
              return (
                <React.Fragment key={row.key}>
                  {needsBreak && <DividerRow />}
                  <tr style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <td
                      style={{
                        textAlign: 'left',
                        fontSize: 13,
                        padding: '7px 16px',
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        left: 0,
                        background: C.card,
                      }}
                    >
                      {row.label}
                      {row.info && <InfoTip text={row.info} />}
                    </td>
                    {MONTHS.map((m, i) => {
                      const cellVal = getVal(yearData, row.key, i);
                      // Cross-tab drift check: flag (don't force) a mismatch
                      // against the linked metric on another tab for this month.
                      let mismatch = null;
                      if (row.compare) {
                        const other = getVal(yearData, row.compare.key, i);
                        if (cellVal != null && other != null && cellVal !== other) {
                          mismatch = row.compare.message;
                        }
                      }
                      return (
                        <td
                          key={m}
                          title={mismatch || undefined}
                          style={{
                            textAlign: 'right',
                            padding: '4px 6px',
                            background: mismatch ? C.redBg : isFuture(i) ? FUTURE_BG : undefined,
                          }}
                        >
                          <Cell
                            value={cellVal}
                            unit={row.unit}
                            onCommit={(v) => updateMetric(row.key, m, v)}
                          />
                        </td>
                      );
                    })}
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: 13,
                        padding: '7px 16px',
                        borderLeft: `1px solid ${C.border}`,
                        color: C.muted,
                      }}
                    >
                      {row.ytd === 'none'
                        ? ''
                        : ytd == null
                        ? DASH
                        : fmtByUnit(ytd, row.unit)}
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
                  {needsBreak && <DividerRow />}
                  <tr style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <td
                      style={{
                        textAlign: 'left',
                        fontSize: 13,
                        padding: '7px 16px',
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        left: 0,
                        background: C.card,
                      }}
                    >
                      {row.label}
                      {row.info && <InfoTip text={row.info} />}
                    </td>
                    {MONTHS.map((m, i) => (
                      <td
                        key={m}
                        style={{
                          textAlign: 'right',
                          padding: '7px 10px',
                          fontSize: 13,
                          color: C.muted,
                          background: isFuture(i) ? FUTURE_BG : undefined,
                        }}
                      >
                        {row.values[i] == null ? DASH : fmtByUnit(row.values[i], row.unit)}
                      </td>
                    ))}
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: 13,
                        padding: '7px 16px',
                        borderLeft: `1px solid ${C.border}`,
                        color: C.muted,
                      }}
                    >
                      {ytd == null ? DASH : fmtByUnit(ytd, row.unit)}
                    </td>
                  </tr>
                </React.Fragment>
              );
            }

            // calc row
            return (
              <tr key={`c${ri}`} style={{ background: calcBg }}>
                <td
                  style={{
                    textAlign: 'left',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '9px 16px',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    background: calcLabelBg,
                  }}
                >
                  {row.label}
                  {row.formula && <InfoTip text={row.formula} />}
                </td>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    style={{
                      textAlign: 'right',
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '9px 10px',
                      color: row.negRed && isNum(v) && v < 0 ? C.red : undefined,
                      background: isFuture(i) ? FUTURE_BG : undefined,
                    }}
                  >
                    {v == null ? DASH : fmtByUnit(v, row.unit)}
                  </td>
                ))}
                <td
                  style={{
                    textAlign: 'right',
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '9px 16px',
                    borderLeft: `1px solid ${C.border}`,
                    color: row.negRed && isNum(row.ytd) && row.ytd < 0 ? C.red : undefined,
                  }}
                >
                  {row.blankTotal
                    ? ''
                    : row.ytd == null
                    ? DASH
                    : fmtByUnit(row.ytd, row.unit)}
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

function ChartTooltip({ active, payload, label, fmt }) {
  if (!active || !payload || !payload.length) return null;
  const f = fmt || fmtNumber;
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '8px 10px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || p.stroke }}>
          {p.name}: {p.value == null ? DASH : f(p.value)}
        </div>
      ))}
    </div>
  );
}

const monthChartData = (seriesMap) =>
  IDX.map((i) => {
    const row = { m: MONTHS[i] };
    for (const [name, s] of Object.entries(seriesMap)) row[name] = s[i];
    return row;
  });

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

const TwoCol = ({ children }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 16,
    }}
  >
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Installs & Users tab (internal keys keep the legacy "download" naming)
// ─────────────────────────────────────────────────────────────────────────────
const STORE_KEYS = [
  ['dl_kaios', 'KaiOS', C.blue],
  ['dl_googlePlay', 'Google Play', C.green],
  ['dl_palmStore', 'Palm Store', C.amber],
  ['dl_indusStore', 'Indus Store', C.purple],
  ['dl_vivoStore', 'Vivo Store', C.red],
];

function DownloadsTab({ yearData, updateMetric, allYears, activeYear }) {
  const latest = latestMonthIndex(yearData);
  const storeKeys = STORE_KEYS.map((s) => s[0]);

  const newDownloads = sumSeries(yearData, storeKeys); // "new installs" (display)
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

  const rows = [
    { kind: 'subhead', label: 'Installs' },
    ...STORE_KEYS.map(([key, label]) => ({ kind: 'input', key, label, unit: 'count' })),
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
    calc(
      'Monthly',
      'percent2',
      conversion,
      pct(nuY, ndY),
      'The rate at which new installs converted to users this month (new users this month ÷ new installs this month).'
    ),
    calc(
      'Overall',
      'percent2',
      cumConversion,
      pct(lifeUsers, lifeInstalls),
      'The rate at which all-time installs have converted into registered users (total users ÷ total installs).'
    ),
  ];

  const storeData = monthChartData(
    Object.fromEntries(STORE_KEYS.map(([key, label]) => [label, rawSeries(yearData, key)]))
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Installs & Users" accent={C.blue} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Installs by Store" accent={C.blue}>
        <LineChart data={storeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} />
          <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
          {STORE_KEYS.map(([key, label, color]) => (
            <Line
              key={key}
              type="monotone"
              dataKey={label}
              stroke={color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Users tab
// ─────────────────────────────────────────────────────────────────────────────
function UsersTab({ yearData, updateMetric }) {
  const mau = rawSeries(yearData, 'u_mau');
  const dau = rawSeries(yearData, 'u_dau');
  const dauMau = pctSeries(dau, mau); // point-in-time monthly stickiness

  const rows = [
    { kind: 'subhead', label: 'Active Users' },
    { kind: 'input', key: 'u_dau', label: 'Daily Active Users', unit: 'count', ytd: 'avg' },
    { kind: 'input', key: 'u_mau', label: 'Monthly Active Users', unit: 'count', ytd: 'avg' },
    calc(
      'DAU / MAU Ratio',
      'percent',
      dauMau,
      seriesAvg(dauMau),
      'Stickiness — the share of monthly active users who use Sorted on an average day (DAU ÷ MAU). Higher means users return more often. A wallet used for daily payments should trend higher than one used only for occasional remittance.'
    ),
    { kind: 'subhead', label: 'Cohort Retention' },
    {
      kind: 'input',
      key: 'u_d1Retention',
      label: 'D1 Retention',
      unit: 'percent',
      ytd: 'none',
      info: 'Of users who installed this month, the share who returned the next day.',
    },
    {
      kind: 'input',
      key: 'u_d7Retention',
      label: 'D7 Retention',
      unit: 'percent',
      ytd: 'none',
      info: 'Of users who installed this month, the share who returned 7 days later.',
    },
    {
      kind: 'input',
      key: 'u_d30Retention',
      label: 'D30 Retention',
      unit: 'percent',
      ytd: 'none',
      info: 'Of users who installed this month, the share who returned 30 days later.',
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Retention" accent={C.green} />
        <MetricTable
          yearData={yearData}
          rows={rows}
          updateMetric={updateMetric}
          totalLabel="Avg"
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
    calc('Off-Ramp Success Rate', 'percent', successRate, pct(sucY, attY), 'Successful ÷ attempts.'),
  ];

  const volData = monthChartData({
    Send: rawSeries(yearData, 'tx_sendVolume'),
    Receive: rawSeries(yearData, 'tx_receiveVolume'),
    'Cash-Out': rawSeries(yearData, 'tx_cashOutVolume'),
    'Top-up Cards': rawSeries(yearData, 'tx_cardRedemptionVolume'),
    Other: rawSeries(yearData, 'tx_otherVolume'),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Transactions" accent={C.amber} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Transaction Volume by Category" accent={C.amber}>
        <ComposedChart data={volData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} yAxisId="left" />
          <Tooltip content={<ChartTooltip fmt={fmtUSDT} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
          <Bar yAxisId="left" dataKey="Send" stackId="v" fill={C.amber} barSize={20} />
          <Bar yAxisId="left" dataKey="Receive" stackId="v" fill={C.green} barSize={20} />
          <Bar yAxisId="left" dataKey="Cash-Out" stackId="v" fill={C.blue} barSize={20} />
          <Bar yAxisId="left" dataKey="Top-up Cards" stackId="v" fill={C.purple} barSize={20} />
          <Bar yAxisId="left" dataKey="Other" stackId="v" fill={C.gray400} barSize={20} radius={[4, 4, 0, 0]} />
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

// By-market is a snapshot, not a time series: each country's figures are single
// totals stored in the first month slot. Colours follow the table row order.
const SNAP_IDX = 0;
const MARKETS = [
  { name: 'Kenya', color: C.purple, sold: 'c_mktKE_sold', value: 'c_mktKE_value', users: 'c_mktKE_users', disc: 'c_mktKE_disc', cac: 'c_mktKE_cac' },
  { name: 'Nigeria', color: C.blue, sold: 'c_mktNG_sold', value: 'c_mktNG_value', users: 'c_mktNG_users', disc: 'c_mktNG_disc', cac: 'c_mktNG_cac' },
  { name: 'Tanzania', color: C.amber, sold: 'c_mktTZ_sold', value: 'c_mktTZ_value', users: 'c_mktTZ_users', disc: 'c_mktTZ_disc', cac: 'c_mktTZ_cac' },
];

function CardsTab({ yearData, updateMetric, allYears, activeYear }) {
  const latest = latestMonthIndex(yearData);
  const sold = rawSeries(yearData, 'c_sold');
  const cardsVolume = rawSeries(yearData, 'c_valueDistributed');
  const fundsCollected = rawSeries(yearData, 'c_fundsCollected');
  const grossRevenue = rawSeries(yearData, 'c_grossRevenue');
  const uniqueUsers = rawSeries(yearData, 'c_uniqueUsers');

  // Card-channel cost, acquisition and profitability.
  const costOfSales = diffSeries(cardsVolume, fundsCollected);
  const cacPerUser = ratioSeries(costOfSales, uniqueUsers);
  const netRevenue = diffSeries(grossRevenue, costOfSales);

  // YTD figures. Cost of Sales and Net Revenue sum; unique users can't be
  // summed, so CAC has no meaningful YTD.
  const volY = seriesSum(cardsVolume, latest);
  const fundsY = seriesSum(fundsCollected, latest);
  const grossY = seriesSum(grossRevenue, latest);
  const costOfSalesY = volY == null && fundsY == null ? null : (volY || 0) - (fundsY || 0);
  const netRevY = grossY == null && costOfSalesY == null ? null : (grossY || 0) - (costOfSalesY || 0);

  // Lifetime totals carry forward across years; each is a single figure (the
  // final value of the running total). Total Unique Users is a manual entry.
  const lifeSold = cumulativeSeriesFrom(sold, priorYearsTotal(allYears, activeYear, ['c_sold']));
  const lifeVolume = cumulativeSeriesFrom(cardsVolume, priorYearsTotal(allYears, activeYear, ['c_valueDistributed']));
  const lastNonNull = (s) => {
    for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i];
    return null;
  };
  const lifeSoldTotal = lastNonNull(lifeSold);
  const lifeVolTotal = lastNonNull(lifeVolume);
  const lifeUsersTotal = getVal(yearData, 'c_lifetimeUniqueUsers', SNAP_IDX);

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
      ...calc('CAC per Transacting User', 'ratio', cacPerUser, null, ''),
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
    {
      ...calc('Net Revenue', 'usdt', netRevenue, netRevY, 'The net value generated after deducting Cost of Sales from Gross Revenue.'),
      negRed: true,
    },
  ];

  // Charts: monthly activity on a dual axis (cards vs users differ by orders of
  // magnitude), and the by-country snapshot.
  const activityChart = monthChartData({ 'Cards Sold': sold, 'Unique Users': uniqueUsers });
  const countryTotals = MARKETS.map((mk) => ({
    name: mk.name,
    value: getVal(yearData, mk.sold, SNAP_IDX) || 0,
    color: mk.color,
  }));
  const countryHasData = countryTotals.some((m) => m.value > 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Top-up Cards" accent={C.purple} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
        <SectionDivider />
        <LifetimeSummary
          calculated={[
            { label: 'Total Cards Sold', value: lifeSoldTotal == null ? DASH : fmtNumber(lifeSoldTotal) },
            { label: 'Total Cards Volume', value: fmtByUnit(lifeVolTotal, 'usdt') },
          ]}
          manual={{
            label: 'Total Unique Users',
            value: lifeUsersTotal,
            onCommit: (v) => updateMetric('c_lifetimeUniqueUsers', MONTHS[SNAP_IDX], v),
            info: 'A deduplicated all-time count of unique card users. Entered manually — it cannot be summed from the monthly Unique Users figures.',
          }}
        />
        <SectionDivider />
        <MarketSummaryTable yearData={yearData} updateMetric={updateMetric} />
      </Card>
      <TwoCol>
        <ChartCard title="Cards Sold & Unique Users" accent={C.purple}>
          <ComposedChart data={activityChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} yAxisId="left" />
            <YAxis {...yAxis({ orientation: 'right' })} yAxisId="right" />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
            <Bar yAxisId="left" dataKey="Cards Sold" fill={C.purple} barSize={18} radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="Unique Users" stroke={C.blue} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Cards Sold by Country" accent={C.purple}>
          {countryHasData ? (
            <PieChart>
              <Pie data={countryTotals} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {countryTotals.map((m) => (
                  <RCell key={m.name} fill={m.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
            </PieChart>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </TwoCol>
    </div>
  );
}

// Lifetime — three single all-time figures shown as compact stat cells (not a
// month grid). Two are calculated running totals; the third is a manual entry.
function LifetimeSummary({ calculated, manual }) {
  const cellStyle = {
    flex: '1 1 0',
    minWidth: 160,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '12px 14px',
    background: C.gray100,
  };
  const labelStyle = {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: C.muted,
    display: 'flex',
    alignItems: 'center',
  };
  const valueStyle = { fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 600, marginTop: 6 };

  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: C.text,
          padding: '0 0 10px',
        }}
      >
        Lifetime
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {calculated.map((it) => (
          <div key={it.label} style={cellStyle}>
            <div style={labelStyle}>{it.label}</div>
            <div style={valueStyle}>{it.value}</div>
          </div>
        ))}
        <div style={cellStyle}>
          <div style={labelStyle}>
            {manual.label}
            {manual.info && <InfoTip text={manual.info} />}
          </div>
          <div style={{ marginTop: 6 }}>
            <Cell
              value={manual.value}
              unit="count"
              onCommit={manual.onCommit}
              inputStyle={{
                fontFamily: 'var(--font-head)',
                fontSize: 22,
                fontWeight: 600,
                textAlign: 'left',
                padding: 0,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Section 3 — By Country. A per-country snapshot summary table (not a month
// grid). Every figure is a manual total entered per country; the Total row
// sums the additive columns and leaves the per-country rates blank.
function MarketSummaryTable({ yearData, updateMetric }) {
  const read = (key) => getVal(yearData, key, SNAP_IDX);

  const sumCol = (k) => {
    let acc = 0;
    let any = false;
    for (const mk of MARKETS) {
      const v = read(mk[k]);
      if (v != null) {
        acc += v;
        any = true;
      }
    }
    return any ? acc : null;
  };
  const tSold = sumCol('sold');
  const tValue = sumCol('value');
  const tUsers = sumCol('users');

  const headCell = (label, alignLeft) => (
    <th
      style={{
        ...thBase,
        textAlign: alignLeft ? 'left' : 'right',
        padding: alignLeft ? '10px 16px' : '10px 12px',
      }}
    >
      {label}
    </th>
  );

  const numCell = (val, unit, bold) => (
    <td
      style={{
        textAlign: 'right',
        fontSize: 13,
        fontWeight: bold ? 700 : 600,
        padding: '9px 12px',
        background: C.gray200,
      }}
    >
      {val == null ? DASH : fmtByUnit(val, unit)}
    </td>
  );

  // Averaging manual per-country rates isn't meaningful, so the Total row's
  // rate columns are intentionally left blank.
  const blankCell = () => <td style={{ background: C.gray200, padding: '9px 12px' }} />;

  const editCell = (key, unit) => (
    <td style={{ textAlign: 'right', padding: '4px 8px' }}>
      <Cell value={read(key)} unit={unit} onCommit={(v) => updateMetric(key, MONTHS[SNAP_IDX], v)} />
    </td>
  );

  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: C.text,
          padding: '0 0 2px',
        }}
      >
        By Country
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
        The cumulative totals per country.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {headCell('Country', true)}
              {headCell('Cards Sold')}
              {headCell('Cards Volume')}
              {headCell('Unique Users')}
              {headCell('Average Discount %')}
              {headCell('CAC per Transacting User')}
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((mk) => (
              <tr key={mk.name} style={{ borderBottom: `1px solid ${C.bg}` }}>
                <td style={{ textAlign: 'left', fontSize: 13, padding: '7px 16px', whiteSpace: 'nowrap' }}>
                  {mk.name}
                </td>
                {editCell(mk.sold, 'count')}
                {editCell(mk.value, 'usdt')}
                {editCell(mk.users, 'count')}
                {editCell(mk.disc, 'percent')}
                {editCell(mk.cac, 'ratio')}
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ textAlign: 'left', fontSize: 13, fontWeight: 700, padding: '9px 16px' }}>Total</td>
              {numCell(tSold, 'count', true)}
              {numCell(tValue, 'usdt', true)}
              {numCell(tUsers, 'count', true)}
              {blankCell()}
              {blankCell()}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
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
function RevenueTab({ yearData, updateMetric }) {
  const latest = latestMonthIndex(yearData);
  // Top-up card fee revenue is pulled from the Top-up Cards tab, not entered.
  const topupRev = rawSeries(yearData, 'c_grossRevenue');
  const revKeys = ['c_grossRevenue', 'r_offramps', 'r_other'];
  const costKeys = ['cost_ambassador', 'cost_saas', 'cost_digitalMarketing', 'cost_campaigns'];

  const totalRev = sumSeries(yearData, revKeys);
  const totalCost = sumSeries(yearData, costKeys);
  const netRev = diffSeries(totalRev, totalCost);

  const revY = seriesSum(totalRev, latest);
  const costY = seriesSum(totalCost, latest);
  const netRevY = revY == null && costY == null ? null : (revY || 0) - (costY || 0);

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
  ];

  const rvc = monthChartData({ Revenue: totalRev, 'Cost of Revenue': totalCost });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Costs & Revenue" accent={C.green} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Revenue vs Costs" accent={C.green}>
        <ComposedChart data={rvc} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} />
          <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} itemSorter={null} />
          <Bar dataKey="Revenue" fill={C.green} barSize={18} radius={[4, 4, 0, 0]} />
          <Bar dataKey="Cost of Revenue" fill={C.red} barSize={18} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns tab (stub) — holds the relocated Acquisition section for now;
// per-campaign tracking (spend / CAC / ROI by channel) comes in a later phase.
// ─────────────────────────────────────────────────────────────────────────────
function CampaignsTab({ yearData, updateMetric }) {
  const latest = latestMonthIndex(yearData);
  const storeKeys = STORE_KEYS.map((s) => s[0]);
  const acqKeys = ['dl_ambassadorCosts', 'dl_paidCampaignSpend'];

  const newDownloads = sumSeries(yearData, storeKeys);
  const newUsers = rawSeries(yearData, 'u_newUsers');
  const totalMarketing = sumSeries(yearData, acqKeys);
  const cpnd = ratioSeries(totalMarketing, newDownloads);
  const cpnu = ratioSeries(totalMarketing, newUsers);

  const ndY = seriesSum(newDownloads, latest);
  const nuY = seriesSum(newUsers, latest);
  const tmY = seriesSum(totalMarketing, latest);

  const rows = [
    { kind: 'subhead', label: 'Acquisition' },
    { kind: 'input', key: 'dl_ambassadorCosts', label: 'Ambassador Costs', unit: 'usd' },
    { kind: 'input', key: 'dl_paidCampaignSpend', label: 'Paid Campaign Spend', unit: 'usd' },
    calc('Total Marketing Spend', 'usd', totalMarketing, tmY, 'Ambassador costs + paid campaign spend.'),
    calc('Cost Per New Install', 'ratio', cpnd, safeDiv(tmY, ndY), 'Total marketing spend ÷ new installs.'),
    calc('Cost Per New User', 'ratio', cpnu, safeDiv(tmY, nuY), 'Total marketing spend ÷ new users.'),
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Campaigns" accent={C.blue} />
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0, marginBottom: 16 }}>
          Per-campaign tracking — individual campaign spend, CAC and ROI by
          channel — is coming soon. For now, overall acquisition spend and the
          blended cost metrics live here.
        </p>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export seam — the per-tab "Download" and "Download all" exports are planned
// for a later phase. The button is rendered (disabled) so the placement and
// data wiring are in place; hook up `onClick` when the feature is built.
// ─────────────────────────────────────────────────────────────────────────────
function DownloadButton({ label = 'Download' }) {
  return (
    <button
      type="button"
      disabled
      title="Export — coming in a later phase"
      style={{
        border: `1px solid ${C.border}`,
        background: '#fff',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        color: C.muted,
        cursor: 'not-allowed',
        whiteSpace: 'nowrap',
      }}
    >
      ↓ {label}
    </button>
  );
}

function TabTitle({ title, accent, downloadLabel }) {
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
      <DownloadButton label={downloadLabel || 'Download'} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard tab
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ label, value }) {
  return (
    <Card accent={C.primary} style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-head)',
          fontSize: 26,
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </Card>
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

// Point-in-time aggregation (MAU/DAU) over a multi-month range is provisional.
// Change this one function to refine the rule later (e.g. 'last' or 'max').
const POINT_IN_TIME_AGG = 'avg';
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
  ['default', 'Default'],
  ['thisMonth', 'This Month'],
  ['last3', 'Last 3 Months'],
  ['last6', 'Last 6 Months'],
  ['ytd', 'YTD'],
  ['fullYear', 'Full Year'],
  ['allTime', 'All Time'],
];

function buildPresetRanges(allYears) {
  const now = new Date();
  const y0 = now.getFullYear();
  const m0 = now.getMonth();
  const lc = addMonths({ y: y0, m: m0 }, -1);
  const ext = dataExtent(allYears);
  return {
    thisMonth: { from: { y: y0, m: m0 }, to: { y: y0, m: m0 } },
    last3: { from: addMonths(lc, -2), to: lc },
    last6: { from: addMonths(lc, -5), to: lc },
    ytd: { from: { y: y0, m: 0 }, to: { y: y0, m: m0 } },
    fullYear: { from: { y: y0, m: 0 }, to: { y: y0, m: 11 } },
    allTime: ext.earliest && ext.latest ? { from: ext.earliest, to: ext.latest } : null,
  };
}

function DashboardTab({ allYears }) {
  const storeKeys = STORE_KEYS.map((s) => s[0]);
  const countKeys = ['tx_sendP2P', 'tx_receiveP2P', 'tx_cashOut', 'tx_cardRedemption', 'tx_other'];
  const valueKeys = ['tx_sendVolume', 'tx_receiveVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume', 'tx_otherVolume'];
  const revKeys = ['c_grossRevenue', 'r_offramps', 'r_other'];

  const presets = useMemo(() => buildPresetRanges(allYears), [allYears]);
  const defaultPeriod = useMemo(() => latestCompletedPeriod(allYears), [allYears]);
  const allTimeEnd = useMemo(() => dataExtent(allYears).latest, [allYears]);

  const [sel, setSel] = useState('default'); // preset key | 'custom' | 'default'
  const [customFrom, setCustomFrom] = useState(() => toMonthInput(latestCompletedPeriod(allYears)));
  const [customTo, setCustomTo] = useState(() => toMonthInput(latestCompletedPeriod(allYears)));

  // Resolve the active range. null === default behaviour.
  let range = null;
  if (sel === 'custom') {
    const f = parseMonthInput(customFrom);
    const t = parseMonthInput(customTo);
    if (f && t) {
      range = PERIOD(f.y, f.m) <= PERIOD(t.y, t.m) ? { from: f, to: t } : { from: t, to: f };
    }
  } else if (sel !== 'default') {
    range = presets[sel] || null;
  }

  const selectPreset = (key) => {
    setSel(key);
    const r = key === 'default' ? { from: defaultPeriod, to: defaultPeriod } : presets[key];
    if (r) {
      setCustomFrom(toMonthInput(r.from));
      setCustomTo(toMonthInput(r.to));
    }
  };

  const periods = range ? periodsBetween(range.from, range.to) : [defaultPeriod];
  const multiMonth = periods.length > 1;

  const kpiValue = (kpi) => {
    if (kpi.type === 'lifetime') {
      return lifetimeThrough(allYears, kpi.keys, range ? range.to : allTimeEnd);
    }
    if (kpi.type === 'additive') {
      return sumKeysOver(allYears, kpi.keys, periods);
    }
    if (kpi.type === 'ratio') {
      const n = sumKeysOver(allYears, kpi.num, periods);
      const d = sumKeysOver(allYears, kpi.den, periods);
      const isPct = kpi.unit === 'percent' || kpi.unit === 'percent2';
      return isPct ? pct(n, d) : safeDiv(n, d);
    }
    return pointInTimeOver(allYears, kpi.key, periods); // point-in-time
  };

  const kpiDefs = [
    { label: 'Total Installs', type: 'lifetime', keys: storeKeys, unit: 'count' },
    { label: 'Total Users', type: 'lifetime', keys: ['u_newUsers'], unit: 'count' },
    { label: 'Total Top-up Cards Sold', type: 'lifetime', keys: ['c_sold'], unit: 'count' },
    { label: 'New Installs', type: 'additive', keys: storeKeys, unit: 'count' },
    { label: 'New Users', type: 'additive', keys: ['u_newUsers'], unit: 'count' },
    { label: 'Transactions', type: 'additive', keys: countKeys, unit: 'count' },
    { label: 'Revenue', type: 'additive', keys: revKeys, unit: 'usd' },
    { label: 'Install → User Conversion', type: 'ratio', num: ['u_newUsers'], den: storeKeys, unit: 'percent2' },
    { label: 'Avg Transaction Value', type: 'ratio', num: valueKeys, den: countKeys, unit: 'usdt' },
    { label: 'MAU', type: 'point', key: 'u_mau', unit: 'count' },
    { label: 'DAU', type: 'point', key: 'u_dau', unit: 'count' },
  ];

  const kpis = kpiDefs.map((kpi) => {
    const pointSuffix = kpi.type === 'point' && multiMonth ? ` (${POINT_IN_TIME_AGG})` : '';
    return { label: kpi.label + pointSuffix, value: fmtByUnit(kpiValue(kpi), kpi.unit) };
  });

  // Charts follow the range; default to the current calendar year.
  const now = new Date();
  const chartPeriods = range
    ? periods
    : periodsBetween({ y: now.getFullYear(), m: 0 }, { y: now.getFullYear(), m: 11 });
  const spanYears =
    chartPeriods.length > 0 && chartPeriods[0].y !== chartPeriods[chartPeriods.length - 1].y;
  const labelOf = (p) => (spanYears ? `${MONTHS[p.m]} '${String(p.y).slice(2)}` : MONTHS[p.m]);
  const installsData = chartPeriods.map((p) => ({ m: labelOf(p), Installs: sumKeysAt(allYears, storeKeys, p) }));
  const mauData = chartPeriods.map((p) => ({ m: labelOf(p), MAU: getVal(allYears[String(p.y)], 'u_mau', p.m) }));
  const volData = chartPeriods.map((p) => ({ m: labelOf(p), Volume: sumKeysAt(allYears, valueKeys, p) }));

  const caption = range
    ? PERIOD(range.from.y, range.from.m) === PERIOD(range.to.y, range.to.m)
      ? fmtPeriod(range.from)
      : `${fmtPeriod(range.from)} – ${fmtPeriod(range.to)}`
    : `Latest month: ${fmtPeriod(defaultPeriod)} · lifetime totals all-time`;

  const pillStyle = (active) => ({
    border: `1px solid ${active ? C.primary : C.border}`,
    background: active ? C.primary : '#fff',
    color: active ? '#fff' : C.text,
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  const monthInput = {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'inherit',
    color: C.text,
    background: '#fff',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Dashboard</h2>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{caption}</div>
        </div>
        <div style={{ flex: 1 }} />
        <DownloadButton label="Download all" />
      </div>

      <Card accent={C.primary} style={{ padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {DASH_PRESETS.map(([key, label]) => {
            if (key === 'allTime' && !presets.allTime) return null;
            return (
              <button key={key} style={pillStyle(sel === key)} onClick={() => selectPreset(key)}>
                {label}
              </button>
            );
          })}
          <div style={{ width: 1, height: 22, background: C.border, margin: '0 4px' }} />
          <span style={{ fontSize: 12, color: C.muted }}>From</span>
          <input
            type="month"
            style={monthInput}
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              setSel('custom');
            }}
          />
          <span style={{ fontSize: 12, color: C.muted }}>To</span>
          <input
            type="month"
            style={monthInput}
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              setSel('custom');
            }}
          />
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
        }}
      >
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <TwoCol>
        <ChartCard title="Installs" accent={C.green}>
          <AreaChart data={installsData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {gradient('dashDownloads', C.green)}
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Area type="monotone" dataKey="Installs" stroke={C.green} strokeWidth={2} fill="url(#dashDownloads)" connectNulls />
          </AreaChart>
        </ChartCard>
        <ChartCard title="Monthly Active Users" accent={C.blue}>
          <AreaChart data={mauData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {gradient('dashMau', C.blue)}
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Area type="monotone" dataKey="MAU" stroke={C.blue} strokeWidth={2} fill="url(#dashMau)" connectNulls />
          </AreaChart>
        </ChartCard>
      </TwoCol>

      <ChartCard title="Transaction Volume (USDT)" accent={C.amber} height={260}>
        <AreaChart data={volData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          {gradient('dashVol', C.amber)}
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} />
          <Tooltip content={<ChartTooltip fmt={fmtUSDT} />} />
          <Area type="monotone" dataKey="Volume" stroke={C.amber} strokeWidth={2} fill="url(#dashVol)" connectNulls />
        </AreaChart>
      </ChartCard>
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
      return <CardsTab {...common} />;
    case 'Costs & Revenue':
      return <RevenueTab {...common} />;
    case 'Campaigns':
      return <CampaignsTab {...common} />;
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
