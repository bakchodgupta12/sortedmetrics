import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { MONTHS, emptyYear, listYears, normaliseData } from './dataModel';
import {
  apiAdminCreateUser,
  apiAdminDeleteUser,
  apiAdminListUsers,
  apiAdminResetPassword,
  apiAdminSetRole,
  apiChangePassword,
  apiGetData,
  apiGetSession,
  apiLogin,
  apiLogout,
  apiSaveData,
  apiUpdateDisplayName,
  canEditRole,
} from './api';

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
  // step: 'username' | 'login'  (admin-managed: no self-service register/reset)
  const [step, setStep] = useState('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submitUsername = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setError('');
    setPassword('');
    setStep('login');
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Password is verified server-side; no hashing or hash handling here.
      const user = await apiLogin(username, password);
      onLogin(user);
    } catch (err) {
      setError(
        err.status === 401
          ? 'Incorrect username or password.'
          : err.message || 'Login failed.'
      );
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setPassword('');
    setError('');
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
                Continue
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={submitLogin}>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Signing in as <strong>{username}</strong>.
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
function App() {
  const [user, setUser] = useState(null); // { username, display_name, role }
  const [bootstrapping, setBootstrapping] = useState(true);

  // The server session cookie is the source of truth for who is logged in.
  useEffect(() => {
    apiGetSession()
      .then((u) => {
        if (u) setUser(u);
      })
      .finally(() => setBootstrapping(false));
  }, []);

  const handleLogin = (u) => setUser(u);

  const handleLogout = async () => {
    await apiLogout();
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

// Whether the current user may edit (write). Consumed by editable cells so the
// UI matches server enforcement (admin/editor can edit; viewer is read-only).
const EditContext = React.createContext(true);

function Dashboard({ user, setUser, onLogout }) {
  const canEdit = canEditRole(user.role);

  const [data, setData] = useState(null); // loaded from the server
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const years = useMemo(() => (data ? listYears(data) : []), [data]);
  const [activeYear, setActiveYear] = useState(() => new Date().getFullYear());
  const [activeTab, setActiveTab] = useState('Dashboard');

  // Save status: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle');
  const saveTimer = useRef(null);
  const skipNextSave = useRef(true); // don't save on initial mount/load

  // Load the metrics from the server once on mount (mirrors the old read).
  useEffect(() => {
    let cancelled = false;
    apiGetData()
      .then((resp) => {
        if (cancelled) return;
        const norm = normaliseData(resp.data);
        if (Object.keys(norm.years).length === 0) {
          norm.years[String(new Date().getFullYear())] = emptyYear();
        }
        const ys = listYears(norm);
        const cur = new Date().getFullYear();
        skipNextSave.current = true;
        setData(norm);
        setActiveYear(ys.includes(cur) ? cur : ys[ys.length - 1] || cur);
        if (resp.user) setUser(resp.user); // keep role/display_name fresh
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) {
          onLogout();
          return;
        }
        setLoadError('Could not load data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(
    async (next) => {
      setSaveStatus('saving');
      try {
        await apiSaveData(next);
        setSaveStatus('saved');
      } catch (err) {
        if (err.status === 403) {
          // Not permitted (viewer). The UI is read-only for viewers, so this
          // should not normally happen — treat it as a safe no-op.
          setSaveStatus('idle');
          return;
        }
        if (err.status === 401) {
          onLogout();
          return;
        }
        setSaveStatus('error');
      }
    },
    [onLogout]
  );

  // Debounced auto-save whenever data changes.
  useEffect(() => {
    if (data == null) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(data), SAVE_DEBOUNCE_MS);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [data, persist]);

  const refresh = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const resp = await apiGetData();
      const norm = normaliseData(resp.data);
      skipNextSave.current = true;
      setData(norm);
      if (resp.user) setUser(resp.user);
      setSaveStatus('saved');
    } catch (err) {
      if (err.status === 401) {
        onLogout();
        return;
      }
      setSaveStatus('error');
    }
  }, [setUser, onLogout]);

  // Edit a single metric cell for the active year.
  const updateMetric = useCallback(
    (metricKey, month, value) => {
      if (!canEdit) return; // viewers are read-only
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

  // Year management
  const addYear = (year) => {
    setData((prev) => {
      if (!prev || prev.years[year]) return prev;
      return { ...prev, years: { ...prev.years, [year]: emptyYear() } };
    });
    setActiveYear(Number(year));
  };

  const deleteYear = (year) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, years: { ...prev.years } };
      delete next.years[year];
      return next;
    });
    setActiveYear((cur) => {
      if (Number(year) !== cur) return cur;
      const remaining = years.filter((y) => y !== Number(year));
      return remaining[remaining.length - 1] || new Date().getFullYear();
    });
  };

  if (loading || !data) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: loadError ? C.red : C.muted,
        }}
      >
        {loadError || 'Loading…'}
      </div>
    );
  }

  const yearData = data.years[String(activeYear)] || emptyYear();

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav
        user={user}
        years={years}
        activeYear={activeYear}
        onYearChange={setActiveYear}
        onAddYear={addYear}
        canEdit={canEdit}
        saveStatus={saveStatus}
        onRefresh={refresh}
        onLogout={onLogout}
        onOpenSettings={() => setActiveTab('Settings')}
        settingsActive={activeTab === 'Settings'}
      />
      <TabBar activeTab={activeTab} onChange={setActiveTab} />

      <main
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '24px 20px 64px',
        }}
      >
        <EditContext.Provider value={canEdit}>
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
            onDeleteYear={deleteYear}
            onLogout={onLogout}
          />
        </EditContext.Provider>
      </main>
    </div>
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

function TopNav({
  user,
  years,
  activeYear,
  onYearChange,
  onAddYear,
  canEdit,
  saveStatus,
  onRefresh,
  onLogout,
  onOpenSettings,
  settingsActive,
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
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <img
          src={`${process.env.PUBLIC_URL}/sorted-wordmark.svg`}
          alt="Sorted"
          style={{ height: 22, width: 'auto' }}
        />
        <div style={{ flex: 1 }} />

        <select
          value={activeYear}
          onChange={(e) => {
            if (e.target.value === '__add__') addNewYear();
            else onYearChange(Number(e.target.value));
          }}
          style={{
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
          {canEdit && <option value="__add__">+ Add year…</option>}
        </select>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 120,
            justifyContent: 'flex-end',
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: saveStatus === 'error' ? C.red : C.muted,
            }}
          >
            {saveStatusLabel(saveStatus)}
          </span>
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
        </div>

        <span style={{ fontSize: 13, color: C.text }}>
          {user.display_name || user.username}
        </span>
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
    </header>
  );
}

function TabBar({ activeTab, onChange }) {
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
          gap: 4,
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              style={{
                background: 'none',
                border: 'none',
                padding: '12px 12px',
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

function fmtByUnit(v, unit) {
  switch (unit) {
    case 'usdt':
      return fmtUSDT(v);
    case 'percent':
      return fmtPercent(v);
    case 'ratio':
      if (!isNum(v)) return DASH;
      return Math.abs(v) >= 1_000_000
        ? compact(v)
        : v.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
    default:
      return fmtNumber(v); // count, usd
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
function cumulativeSeries(s) {
  let run = 0;
  let has = false;
  return IDX.map((i) => {
    if (s[i] != null) {
      run += s[i];
      has = true;
    }
    return has ? run : null;
  });
}
// Like cumulativeSeries but seeded with a starting `base` (prior years' total),
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
function Cell({ value, unit, onCommit }) {
  const canEdit = useContext(EditContext);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused ? draft : value == null ? '' : fmtByUnit(value, unit);

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
      readOnly={!canEdit}
      tabIndex={canEdit ? undefined : -1}
      onFocus={
        canEdit
          ? () => {
              setFocused(true);
              setDraft(value == null ? '' : String(value));
            }
          : undefined
      }
      onChange={
        canEdit
          ? (e) =>
              // Allow only digits, thousands separators and a single decimal point.
              // Strips letters, symbols and minus signs as they're typed/pasted.
              setDraft(e.target.value.replace(/[^0-9.,]/g, ''))
          : undefined
      }
      onBlur={
        canEdit
          ? () => {
              commit();
              setFocused(false);
            }
          : undefined
      }
      onKeyDown={
        canEdit
          ? (e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }
          : undefined
      }
      style={{
        width: '100%',
        textAlign: 'right',
        fontFamily: 'inherit',
        fontSize: 13,
        color: C.text,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${focused && canEdit ? C.primary : 'transparent'}`,
        padding: '6px 4px',
        outline: 'none',
        cursor: canEdit ? 'text' : 'default',
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
function DividerRow() {
  return (
    <tr aria-hidden="true">
      <td colSpan={14} style={{ padding: 0 }}>
        <div style={{ height: 1, background: C.border, margin: '12px 0 2px' }} />
      </td>
    </tr>
  );
}

function MetricTable({ yearData, rows, updateMetric, totalLabel = 'YTD' }) {
  const latest = latestMonthIndex(yearData);
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
            {MONTHS.map((m) => (
              <th key={m} style={thBase}>
                {m}
              </th>
            ))}
            <th
              style={{
                ...thBase,
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
              prev && prev.kind === 'calc' && row.kind !== 'calc';

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
                    {MONTHS.map((m, i) => (
                      <td key={m} style={{ textAlign: 'right', padding: '4px 6px' }}>
                        <Cell
                          value={getVal(yearData, row.key, i)}
                          unit={row.unit}
                          onCommit={(v) => updateMetric(row.key, m, v)}
                        />
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
                  <InfoTip text={row.formula} />
                </td>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    style={{
                      textAlign: 'right',
                      fontSize: 13,
                      fontWeight: 600,
                      padding: '9px 10px',
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
      'percent',
      conversion,
      pct(nuY, ndY),
      'The rate at which new installs converted to users this month (new users this month ÷ new installs this month).'
    ),
    calc(
      'Overall',
      'percent',
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
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
  const valueKeys = ['tx_sendVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume', 'tx_otherVolume'];

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
    { kind: 'input', key: 'tx_sendVolume', label: 'Send & Receive', unit: 'usdt' },
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
    'Send & Receive': rawSeries(yearData, 'tx_sendVolume'),
    'Cash-Out': rawSeries(yearData, 'tx_cashOutVolume'),
    'Top-up Cards': rawSeries(yearData, 'tx_cardRedemptionVolume'),
    Other: rawSeries(yearData, 'tx_otherVolume'),
    'Off-Ramp Rate': successRate,
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Transactions" accent={C.amber} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Transaction Volume (USDT) & Off-Ramp Success Rate" accent={C.amber}>
        <ComposedChart data={volData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} yAxisId="left" />
          <YAxis {...yAxis({ orientation: 'right', tickFormatter: (v) => `${Math.round(v)}%`, domain: [0, 100] })} yAxisId="right" />
          <Tooltip content={<ChartTooltip fmt={fmtUSDT} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="Send & Receive" stackId="v" fill={C.amber} barSize={20} />
          <Bar yAxisId="left" dataKey="Cash-Out" stackId="v" fill={C.blue} barSize={20} />
          <Bar yAxisId="left" dataKey="Top-up Cards" stackId="v" fill={C.purple} barSize={20} />
          <Bar yAxisId="left" dataKey="Other" stackId="v" fill={C.gray400} barSize={20} radius={[4, 4, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="Off-Ramp Rate" stroke={C.green} strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards tab
// ─────────────────────────────────────────────────────────────────────────────
function CardsTab({ yearData, updateMetric }) {
  const latest = latestMonthIndex(yearData);
  const sold = rawSeries(yearData, 'c_sold');
  const redeemed = rawSeries(yearData, 'c_redeemed');
  const gross = rawSeries(yearData, 'c_grossRevenue');
  const lost = rawSeries(yearData, 'c_discountFeesLost');

  const outstanding = diffSeries(cumulativeSeries(sold), cumulativeSeries(redeemed));
  const redemptionRate = pctSeries(redeemed, sold);
  const netEarnings = diffSeries(gross, lost);

  const soldY = seriesSum(sold, latest);
  const redY = seriesSum(redeemed, latest);
  const grossY = seriesSum(gross, latest);
  const lostY = seriesSum(lost, latest);

  const rows = [
    { kind: 'subhead', label: 'Activity' },
    { kind: 'input', key: 'c_sold', label: 'Cards Sold', unit: 'count' },
    { kind: 'input', key: 'c_redeemed', label: 'Cards Redeemed', unit: 'count' },
    { kind: 'input', key: 'c_uniqueUsers', label: 'Unique Users', unit: 'count' },
    { kind: 'input', key: 'c_usdtVolume', label: 'Card USDT Volume', unit: 'usdt' },
    { kind: 'input', key: 'c_discountFeesLost', label: 'Discount & Fees Lost USD', unit: 'usd' },
    { kind: 'input', key: 'c_grossRevenue', label: 'Gross Card Revenue USD', unit: 'usd' },
    calc('Cards Outstanding', 'count', outstanding, valueAt(outstanding, latest), 'Cumulative sold − cumulative redeemed.'),
    calc('Redemption Rate', 'percent', redemptionRate, pct(redY, soldY), 'Cards redeemed ÷ cards sold.'),
    calc('Net Card Earnings', 'usd', netEarnings, grossY == null && lostY == null ? null : (grossY || 0) - (lostY || 0), 'Gross card revenue − discount & fees lost.'),
    { kind: 'subhead', label: 'By market' },
    { kind: 'input', key: 'c_mktKenya', label: 'Kenya', unit: 'count' },
    { kind: 'input', key: 'c_mktNigeria', label: 'Nigeria', unit: 'count' },
    { kind: 'input', key: 'c_mktOther', label: 'Other', unit: 'count' },
  ];

  const soldRedeemed = monthChartData({ 'Cards Sold': sold, 'Cards Redeemed': redeemed });
  const marketTotals = [
    { name: 'Kenya', value: seriesSum(rawSeries(yearData, 'c_mktKenya'), latest) || 0, color: C.purple },
    { name: 'Nigeria', value: seriesSum(rawSeries(yearData, 'c_mktNigeria'), latest) || 0, color: C.blue },
    { name: 'Other', value: seriesSum(rawSeries(yearData, 'c_mktOther'), latest) || 0, color: C.amber },
  ];
  const marketHasData = marketTotals.some((m) => m.value > 0);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Top-up Cards" accent={C.purple} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <TwoCol>
        <ChartCard title="Cards Sold vs Redeemed" accent={C.purple}>
          <BarChart data={soldRedeemed} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Cards Sold" fill={C.purple} barSize={18} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Cards Redeemed" fill={C.green} barSize={18} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Cards by Market (YTD)" accent={C.purple}>
          {marketHasData ? (
            <PieChart>
              <Pie data={marketTotals} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {marketTotals.map((m) => (
                  <RCell key={m.name} fill={m.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </TwoCol>
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
  const revKeys = ['r_transactionFees', 'r_cardRedemptionFees', 'r_other'];
  const costKeys = ['cost_ambassador', 'cost_gasFees', 'cost_cardPrinting', 'cost_infrastructure', 'cost_marketingSpend'];

  const totalRev = sumSeries(yearData, revKeys);
  const totalCost = sumSeries(yearData, costKeys);
  const netRev = diffSeries(totalRev, totalCost);
  const mau = rawSeries(yearData, 'u_mau');
  const rpu = ratioSeries(totalRev, mau);

  const revY = seriesSum(totalRev, latest);
  const costY = seriesSum(totalCost, latest);

  const rows = [
    { kind: 'subhead', label: 'Revenue' },
    { kind: 'input', key: 'r_transactionFees', label: 'Transaction Fees', unit: 'usd' },
    { kind: 'input', key: 'r_cardRedemptionFees', label: 'Card Redemption Fees', unit: 'usd' },
    { kind: 'input', key: 'r_other', label: 'Other', unit: 'usd' },
    calc('Total Revenue', 'usd', totalRev, revY, 'Sum of all revenue lines.'),
    { kind: 'subhead', label: 'Costs' },
    { kind: 'input', key: 'cost_ambassador', label: 'Ambassador Costs', unit: 'usd' },
    { kind: 'input', key: 'cost_gasFees', label: 'Gas Fees', unit: 'usd' },
    { kind: 'input', key: 'cost_cardPrinting', label: 'Card Printing', unit: 'usd' },
    { kind: 'input', key: 'cost_infrastructure', label: 'Infrastructure', unit: 'usd' },
    { kind: 'input', key: 'cost_marketingSpend', label: 'Marketing Spend', unit: 'usd' },
    calc('Total Costs', 'usd', totalCost, costY, 'Sum of all cost lines.'),
    calc('Net Revenue', 'usd', netRev, revY == null && costY == null ? null : (revY || 0) - (costY || 0), 'Total revenue − total costs.'),
    calc('Revenue Per Active User', 'ratio', rpu, safeDiv(revY, valueAt(mau, latest)), 'Total revenue ÷ MAU (latest month for YTD).'),
  ];

  const rvc = monthChartData({ Revenue: totalRev, Costs: totalCost, 'Net Revenue': netRev });
  const netData = monthChartData({ 'Net Revenue': netRev });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.primary}>
        <TabTitle title="Costs & Revenue" accent={C.green} />
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <TwoCol>
        <ChartCard title="Revenue vs Costs (with Net)" accent={C.green}>
          <ComposedChart data={rvc} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Revenue" fill={C.green} barSize={18} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Costs" fill={C.red} barSize={18} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="Net Revenue" stroke={C.purple} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Net Revenue" accent={C.green}>
          <AreaChart data={netData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {gradient('netRevGrad', C.green)}
            <CartesianGrid {...GRID} />
            <XAxis {...X_AXIS} />
            <YAxis {...yAxis()} />
            <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
            <Area type="monotone" dataKey="Net Revenue" stroke={C.green} strokeWidth={2} fill="url(#netRevGrad)" connectNulls />
          </AreaChart>
        </ChartCard>
      </TwoCol>
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

function DashboardTab({ yearData, activeYear }) {
  const latest = latestMonthIndex(yearData);
  const storeKeys = STORE_KEYS.map((s) => s[0]);
  const countKeys = ['tx_sendP2P', 'tx_receiveP2P', 'tx_cashOut', 'tx_cardRedemption', 'tx_other'];
  const valueKeys = ['tx_sendVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume', 'tx_otherVolume'];

  const newDownloads = sumSeries(yearData, storeKeys);
  const newUsers = rawSeries(yearData, 'u_newUsers');
  const mau = rawSeries(yearData, 'u_mau');
  const totalTx = sumSeries(yearData, countKeys);
  const totalVol = sumSeries(yearData, valueKeys);

  const kpis = [
    { label: 'Total Installs YTD', value: fmtNumber(seriesSum(newDownloads, latest)), accent: C.blue },
    { label: 'New Users YTD', value: fmtNumber(seriesSum(newUsers, latest)), accent: C.green },
    { label: 'MAU (latest month)', value: fmtNumber(valueAt(mau, latest)), accent: C.blue },
    { label: 'Total Transactions YTD', value: fmtNumber(seriesSum(totalTx, latest)), accent: C.amber },
    { label: 'Cards Sold YTD', value: fmtNumber(seriesSum(rawSeries(yearData, 'c_sold'), latest)), accent: C.purple },
    { label: 'Cards Redeemed YTD', value: fmtNumber(seriesSum(rawSeries(yearData, 'c_redeemed'), latest)), accent: C.purple },
    {
      label: 'Install → User Conversion (latest)',
      value: fmtPercent(pct(valueAt(newUsers, latest), valueAt(newDownloads, latest))),
      accent: C.blue,
    },
    {
      label: 'Avg Transaction Value USDT (latest)',
      value: fmtUSDT(safeDiv(valueAt(totalVol, latest), valueAt(totalTx, latest))),
      accent: C.amber,
    },
  ];

  const downloadsData = monthChartData({ Installs: newDownloads });
  const mauData = monthChartData({ MAU: mau });
  const volData = monthChartData({ Volume: totalVol });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 18 }}>Dashboard · {activeYear}</h2>
        <div style={{ flex: 1 }} />
        <DownloadButton label="Download all" />
      </div>

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
        <ChartCard title="Monthly Installs" accent={C.green}>
          <AreaChart data={downloadsData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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

      <ChartCard title="Total Transaction Volume (USDT)" accent={C.amber} height={260}>
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
  onDeleteYear,
  onLogout,
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
      return (
        <SettingsTab
          user={user}
          setUser={setUser}
          canEdit={canEdit}
          activeYear={activeYear}
          years={years}
          onDeleteYear={onDeleteYear}
          onLogout={onLogout}
        />
      );
    case 'Dashboard':
    default:
      return (
        <DashboardTab yearData={yearData} activeYear={activeYear} />
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings (shell-level: display name, password, year + account management)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Admin-only: Team / Accounts management
// ─────────────────────────────────────────────────────────────────────────────
function TeamAdmin({ currentUsername }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [nu, setNu] = useState('');
  const [nd, setNd] = useState('');
  const [np, setNp] = useState('');
  const [nr, setNr] = useState('editor');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiAdminListUsers();
      setUsers(list);
    } catch (e) {
      setErr(e.message || 'Could not load users.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m) => {
    setMsg(m);
    setErr('');
  };

  const onCreate = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (!nu.trim()) {
      setErr('Username is required.');
      return;
    }
    if (np.length < 6) {
      setErr('Password must be at least 6 characters.');
      return;
    }
    setCreating(true);
    try {
      await apiAdminCreateUser({
        username: nu.trim(),
        display_name: nd.trim(),
        password: np,
        role: nr,
      });
      setNu('');
      setNd('');
      setNp('');
      setNr('editor');
      flash('Account created.');
      await load();
    } catch (e2) {
      setErr(e2.message || 'Could not create account.');
    } finally {
      setCreating(false);
    }
  };

  const onRole = async (username, role) => {
    setErr('');
    setMsg('');
    try {
      await apiAdminSetRole(username, role);
      flash('Role updated.');
    } catch (e) {
      setErr(e.message || 'Could not change role.');
    }
    await load();
  };

  const onReset = async (username) => {
    const pw = window.prompt(`New password for ${username} (at least 6 characters):`);
    if (pw == null) return;
    setErr('');
    setMsg('');
    try {
      await apiAdminResetPassword(username, pw);
      flash(`Password reset for ${username}.`);
    } catch (e) {
      setErr(e.message || 'Could not reset password.');
    }
  };

  const onRemove = async (username) => {
    if (!window.confirm(`Remove account "${username}"? This cannot be undone.`)) return;
    setErr('');
    setMsg('');
    try {
      await apiAdminDeleteUser(username);
      flash(`Removed ${username}.`);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not remove account.');
    }
  };

  const sectionLabel = {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: C.muted,
  };
  const inp = { ...authInput, marginTop: 0 };
  const btn = {
    border: 'none',
    background: C.primary,
    color: '#fff',
    borderRadius: 8,
    padding: '8px 14px',
    fontWeight: 600,
    fontSize: 13,
  };
  const ghostBtn = {
    border: `1px solid ${C.border}`,
    background: '#fff',
    color: C.text,
    borderRadius: 7,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    marginLeft: 6,
  };
  const th = {
    ...thBase,
    textAlign: 'left',
    padding: '8px 6px',
  };
  const td = { padding: '8px 6px', fontSize: 13, verticalAlign: 'top' };

  return (
    <Card accent={C.primary}>
      <div style={sectionLabel}>Team</div>
      <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Accounts</h2>

      <form onSubmit={onCreate} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 8,
          }}
        >
          <input style={inp} placeholder="username" value={nu} onChange={(e) => setNu(e.target.value)} />
          <input style={inp} placeholder="display name" value={nd} onChange={(e) => setNd(e.target.value)} />
          <input
            style={inp}
            type="password"
            placeholder="initial password"
            value={np}
            onChange={(e) => setNp(e.target.value)}
          />
          <select style={inp} value={nr} onChange={(e) => setNr(e.target.value)}>
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
        </div>
        <div>
          <button style={{ ...btn, opacity: creating ? 0.7 : 1 }} disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>

      {users == null ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Loading…</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={th}>User</th>
                <th style={th}>Role</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.username === currentUsername;
                return (
                  <tr key={u.username} style={{ borderBottom: `1px solid ${C.bg}` }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{u.display_name || u.username}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        {u.username}
                        {isSelf ? ' (you)' : ''}
                      </div>
                    </td>
                    <td style={td}>
                      <select
                        value={u.role || ''}
                        disabled={isSelf}
                        onChange={(e) => onRole(u.username, e.target.value)}
                        style={{ ...inp, width: 'auto', opacity: isSelf ? 0.6 : 1 }}
                        title={isSelf ? "You can't change your own role" : undefined}
                      >
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={ghostBtn} onClick={() => onReset(u.username)}>
                        Reset password
                      </button>
                      {!isSelf && (
                        <button
                          style={{ ...ghostBtn, color: C.red, borderColor: C.red }}
                          onClick={() => onRemove(u.username)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {msg && <p style={{ color: C.green, fontSize: 13, marginBottom: 0 }}>{msg}</p>}
      {err && <p style={{ color: C.red, fontSize: 13, marginBottom: 0 }}>{err}</p>}
    </Card>
  );
}

function SettingsTab({ user, setUser, canEdit, activeYear, years, onDeleteYear, onLogout }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [msg, setMsg] = useState('');

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  const saveName = async () => {
    setMsg('');
    try {
      const updated = await apiUpdateDisplayName(displayName.trim() || user.username);
      setUser({ ...user, display_name: updated.display_name });
      setMsg('Display name updated.');
    } catch (e) {
      setMsg(e.message || 'Could not update.');
    }
  };

  const doChangePassword = async () => {
    setPwMsg('');
    if (newPw.length < 6) {
      setPwMsg('New password must be at least 6 characters.');
      return;
    }
    if (newPw !== newPw2) {
      setPwMsg('New passwords do not match.');
      return;
    }
    try {
      await apiChangePassword(curPw, newPw);
      setCurPw('');
      setNewPw('');
      setNewPw2('');
      setPwMsg('Password changed.');
    } catch (e) {
      setPwMsg(e.message || 'Could not change password.');
    }
  };

  const doDeleteYear = () => {
    if (years.length <= 1) {
      window.alert('You cannot delete your only year.');
      return;
    }
    if (window.confirm(`Delete all data for ${activeYear}? This cannot be undone.`)) {
      onDeleteYear(activeYear);
    }
  };

  const sectionLabel = {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: C.muted,
  };
  const settingInput = { ...authInput, maxWidth: 320 };
  const smallBtn = {
    border: 'none',
    background: C.primary,
    color: '#fff',
    borderRadius: 8,
    padding: '8px 14px',
    fontWeight: 600,
    fontSize: 13,
    marginTop: 12,
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      <Card accent={C.primary}>
        <div style={sectionLabel}>Profile</div>
        <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Display name</h2>
        <input
          style={{ ...settingInput, opacity: canEdit ? 1 : 0.6 }}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={!canEdit}
        />
        {canEdit ? (
          <div>
            <button style={smallBtn} onClick={saveName}>
              Save
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Your role is view-only, so the display name can't be changed.
          </p>
        )}
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
          Username: <strong>{user.username}</strong> (cannot be changed)
        </div>
        {msg && <p style={{ color: C.green, fontSize: 13 }}>{msg}</p>}
      </Card>

      <Card accent={C.primary}>
        <div style={sectionLabel}>Security</div>
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
          placeholder="New password"
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
          <button style={smallBtn} onClick={doChangePassword}>
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

      {canEdit && (
        <Card accent={C.primary}>
          <div style={sectionLabel}>Data</div>
          <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Delete year</h2>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>
            Permanently remove all data for the currently selected year (
            {activeYear}).
          </p>
          <button
            style={{ ...smallBtn, background: C.red, marginTop: 0 }}
            onClick={doDeleteYear}
          >
            Delete {activeYear}
          </button>
        </Card>
      )}

      {user.role === 'admin' && <TeamAdmin currentUsername={user.username} />}

      <Card>
        <button
          style={{
            border: `1px solid ${C.border}`,
            background: '#fff',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
          onClick={onLogout}
        >
          Log out
        </button>
      </Card>
    </div>
  );
}

export default App;
