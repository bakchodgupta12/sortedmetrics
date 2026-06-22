import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  MONTHS,
  SECURITY_QUESTIONS,
  changePassword,
  createUser,
  deleteAccount,
  emptyYear,
  getUser,
  isConfigured,
  listYears,
  normaliseData,
  resetPassword,
  saveData,
  updateDisplayName,
  verifyPassword,
  verifySecurityAnswer,
} from './supabase';

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
  bg: '#f7f5f0',
  card: '#fff',
  border: '#e8e4dc',
  green: '#6dbb8a',
  red: '#d96b6b',
  amber: '#e8a838',
  blue: '#5b9bd5',
  blueLight: '#7eb5d6',
  purple: '#9b8ec4',
  text: '#2c2a26',
  muted: '#9e9890',
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
  'Downloads',
  'Users',
  'Transactions',
  'Cards',
  'Revenue',
  'Settings',
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
  background: disabled ? '#c9cfd6' : C.blue,
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
  // step: 'username' | 'login' | 'register' | 'forgot'
  const [step, setStep] = useState('username');
  const [username, setUsername] = useState('');
  const [row, setRow] = useState(null); // existing user row, when known
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // form fields
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [question, setQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [answer, setAnswer] = useState('');

  const reset = () => {
    setPassword('');
    setPassword2('');
    setDisplayName('');
    setAnswer('');
    setError('');
  };

  const submitUsername = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError('');
    try {
      const existing = await getUser(username);
      reset();
      if (existing) {
        setRow(existing);
        setStep('login');
      } else {
        setStep('register');
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

  const submitRegister = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== password2) {
      setError('Passwords do not match.');
      return;
    }
    if (!answer.trim()) {
      setError('Please answer your security question.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await createUser({
        username,
        password,
        securityQuestion: question,
        securityAnswer: answer,
        displayName: displayName.trim() || username.trim(),
        initialYear: new Date().getFullYear(),
      });
      onLogin(created);
    } catch (err) {
      setError(err.message || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== password2) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ok = await verifySecurityAnswer(row, answer);
      if (!ok) {
        setError('That answer does not match.');
        return;
      }
      await resetPassword(username, password);
      const refreshed = await getUser(username);
      onLogin(refreshed);
    } catch (err) {
      setError(err.message || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    reset();
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
        <h1
          style={{
            fontFamily: 'var(--font-head)',
            fontSize: 26,
            textAlign: 'center',
            marginBottom: 4,
          }}
        >
          Sorted Wallet Metrics
        </h1>
        <p
          style={{
            textAlign: 'center',
            color: C.muted,
            marginTop: 0,
            marginBottom: 20,
          }}
        >
          Internal KPI dashboard
        </p>

        <Card accent={C.blue}>
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
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setStep('forgot');
                  }}
                  style={linkBtn}
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {step === 'register' && (
            <form onSubmit={submitRegister}>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Setting up <strong>{username}</strong>. Choose a password and a
                security question.
              </p>
              <Field label="Display name">
                <input
                  style={authInput}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={username}
                />
              </Field>
              <Field label="Password">
                <input
                  style={authInput}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  style={authInput}
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </Field>
              <Field label="Security question">
                <select
                  style={authInput}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                >
                  {SECURITY_QUESTIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Answer">
                <input
                  style={authInput}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </Field>
              <button style={authBtn(busy)} disabled={busy}>
                {busy ? 'Creating…' : 'Create account'}
              </button>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={submitForgot}>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Reset password for <strong>{username}</strong>.
              </p>
              <Field label={row?.security_question || 'Security question'}>
                <input
                  style={authInput}
                  autoFocus
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </Field>
              <Field label="New password">
                <input
                  style={authInput}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  style={authInput}
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </Field>
              <button style={authBtn(busy)} disabled={busy}>
                {busy ? 'Resetting…' : 'Reset password'}
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
  color: C.blue,
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
  const [data, setData] = useState(() => {
    const norm = normaliseData(user.data);
    if (Object.keys(norm.years).length === 0) {
      norm.years[String(new Date().getFullYear())] = emptyYear();
    }
    return norm;
  });

  const years = useMemo(() => listYears(data), [data]);
  const [activeYear, setActiveYear] = useState(() => {
    const current = new Date().getFullYear();
    const ys = listYears(data);
    return ys.includes(current) ? current : ys[ys.length - 1] || current;
  });
  const [activeTab, setActiveTab] = useState('Dashboard');

  // Save status: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle');
  const saveTimer = useRef(null);
  const skipNextSave = useRef(true); // don't save on initial mount

  const persist = useCallback(
    async (next) => {
      setSaveStatus('saving');
      try {
        await saveData(user.username, next);
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error');
      }
    },
    [user.username]
  );

  // Debounced auto-save whenever data changes.
  useEffect(() => {
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
      const row = await getUser(user.username);
      if (row) {
        const norm = normaliseData(row.data);
        skipNextSave.current = true;
        setData(norm);
        setUser(row);
        setSaveStatus('saved');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [user.username, setUser]);

  // Edit a single metric cell for the active year.
  const updateMetric = useCallback(
    (metricKey, month, value) => {
      setData((prev) => {
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
    [activeYear]
  );

  const updateNote = useCallback(
    (month, text) => {
      setData((prev) => {
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
    [activeYear]
  );

  // Year management
  const addYear = (year) => {
    setData((prev) => {
      if (prev.years[year]) return prev;
      return { ...prev, years: { ...prev.years, [year]: emptyYear() } };
    });
    setActiveYear(Number(year));
  };

  const deleteYear = (year) => {
    setData((prev) => {
      const next = { ...prev, years: { ...prev.years } };
      delete next.years[year];
      return next;
    });
    setActiveYear((cur) => {
      if (Number(year) !== cur) return cur;
      const remaining = listYears(data).filter((y) => y !== Number(year));
      return remaining[remaining.length - 1] || new Date().getFullYear();
    });
  };

  const yearData = data.years[String(activeYear)] || emptyYear();

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav
        user={user}
        years={years}
        activeYear={activeYear}
        onYearChange={setActiveYear}
        onAddYear={addYear}
        saveStatus={saveStatus}
        onRefresh={refresh}
        onLogout={onLogout}
      />
      <TabBar activeTab={activeTab} onChange={setActiveTab} />

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
          user={user}
          setUser={setUser}
          updateMetric={updateMetric}
          updateNote={updateNote}
          onDeleteYear={deleteYear}
          onLogout={onLogout}
        />
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
  saveStatus,
  onRefresh,
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
        <div
          style={{
            fontFamily: 'var(--font-head)',
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          Sorted Wallet Metrics
        </div>
        <div style={{ flex: 1 }} />

        <select
          value={activeYear}
          onChange={(e) => {
            if (e.target.value === '__add__') addNewYear();
            else onYearChange(Number(e.target.value));
          }}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: '#fff',
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
          <option value="__add__">+ Add year…</option>
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
                color: active ? C.text : C.muted,
                borderBottom: active
                  ? `2px solid ${C.text}`
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
function diffSeries(a, b) {
  return IDX.map((i) => {
    if (a[i] == null && b[i] == null) return null;
    return (a[i] || 0) - (b[i] || 0);
  });
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
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const shown = focused ? draft : value == null ? '' : fmtByUnit(value, unit);

  const commit = () => {
    const t = draft.trim().replace(/,/g, '');
    if (t === '') onCommit(null);
    else {
      const n = parseFloat(t);
      onCommit(Number.isFinite(n) ? n : null);
    }
  };

  return (
    <input
      value={shown}
      placeholder={DASH}
      inputMode="decimal"
      onFocus={() => {
        setFocused(true);
        setDraft(value == null ? '' : String(value));
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        commit();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      style={{
        width: 62,
        textAlign: 'right',
        fontFamily: 'inherit',
        fontSize: 13,
        color: C.text,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${focused ? C.blueLight : 'transparent'}`,
        padding: '5px 3px',
        outline: 'none',
      }}
    />
  );
}

function InfoTip({ text }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: `1px solid ${C.muted}`,
        color: C.muted,
        fontSize: 9,
        marginLeft: 5,
        cursor: 'help',
        verticalAlign: 'middle',
        fontFamily: 'var(--font-head)',
        fontStyle: 'italic',
        lineHeight: 1,
      }}
    >
      i
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
  padding: '8px 4px',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

function MetricTable({ yearData, rows, updateMetric }) {
  const latest = latestMonthIndex(yearData);

  const inputYtd = (key, mode) => {
    if (latest < 0 || mode === 'none') return null;
    if (mode === 'last') return getVal(yearData, key, latest);
    const s = rawSeries(yearData, key);
    return seriesSum(s, latest);
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 920 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th
              style={{
                ...thBase,
                textAlign: 'left',
                paddingLeft: 8,
                position: 'sticky',
                left: 0,
                background: C.card,
                minWidth: 190,
              }}
            />
            {MONTHS.map((m) => (
              <th key={m} style={thBase}>
                {m}
              </th>
            ))}
            <th style={{ ...thBase, borderLeft: `1px solid ${C.border}` }}>
              YTD
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            if (row.kind === 'subhead') {
              return (
                <tr key={`s${ri}`}>
                  <td
                    colSpan={14}
                    style={{
                      ...thBase,
                      textAlign: 'left',
                      paddingLeft: 8,
                      paddingTop: 16,
                      color: C.text,
                    }}
                  >
                    {row.label}
                  </td>
                </tr>
              );
            }

            if (row.kind === 'input') {
              const ytd = inputYtd(row.key, row.ytd || 'sum');
              return (
                <tr key={row.key} style={{ borderBottom: `1px solid ${C.bg}` }}>
                  <td
                    style={{
                      textAlign: 'left',
                      fontSize: 13,
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                      position: 'sticky',
                      left: 0,
                      background: C.card,
                    }}
                  >
                    {row.label}
                  </td>
                  {MONTHS.map((m, i) => (
                    <td key={m} style={{ textAlign: 'right', padding: '0 1px' }}>
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
                      padding: '2px 6px',
                      borderLeft: `1px solid ${C.border}`,
                      color: C.muted,
                    }}
                  >
                    {ytd == null ? DASH : fmtByUnit(ytd, row.unit)}
                  </td>
                </tr>
              );
            }

            // calc row
            return (
              <tr key={`c${ri}`} style={{ background: 'rgba(232,228,220,0.4)' }}>
                <td
                  style={{
                    textAlign: 'left',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '6px 8px',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    background: '#f3f1ea',
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
                      padding: '6px 5px',
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
                    padding: '6px 6px',
                    borderLeft: `1px solid ${C.border}`,
                  }}
                >
                  {row.ytd == null ? DASH : fmtByUnit(row.ytd, row.unit)}
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

function ChartCard({ title, accent, height = 240, children }) {
  return (
    <Card accent={accent} style={{ paddingBottom: 12 }}>
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
// Downloads tab
// ─────────────────────────────────────────────────────────────────────────────
const STORE_KEYS = [
  ['dl_kaios', 'KaiOS', C.blue],
  ['dl_googlePlay', 'Google Play', C.green],
  ['dl_palmStore', 'Palm Store', C.amber],
  ['dl_indusStore', 'Indus Store', C.purple],
  ['dl_vivoStore', 'Vivo Store', C.red],
];

function DownloadsTab({ yearData, updateMetric }) {
  const latest = latestMonthIndex(yearData);
  const storeKeys = STORE_KEYS.map((s) => s[0]);
  const acqKeys = ['dl_ambassadorCosts', 'dl_paidCampaignSpend'];

  const newDownloads = sumSeries(yearData, storeKeys);
  const cumDownloads = cumulativeSeries(newDownloads);
  const newUsers = rawSeries(yearData, 'u_newUsers');
  const conversion = pctSeries(newUsers, newDownloads);
  const totalMarketing = sumSeries(yearData, acqKeys);
  const cpnd = ratioSeries(totalMarketing, newDownloads);
  const cpnu = ratioSeries(totalMarketing, newUsers);

  const ndY = seriesSum(newDownloads, latest);
  const nuY = seriesSum(newUsers, latest);
  const tmY = seriesSum(totalMarketing, latest);

  const rows = [
    { kind: 'subhead', label: 'Downloads by store' },
    ...STORE_KEYS.map(([key, label]) => ({ kind: 'input', key, label, unit: 'count' })),
    calc('New Downloads', 'count', newDownloads, ndY, 'Sum of all store downloads for the month.'),
    calc(
      'Cumulative Downloads',
      'count',
      cumDownloads,
      valueAt(cumDownloads, latest),
      'Running total of new downloads from January.'
    ),
    { kind: 'subhead', label: 'Acquisition' },
    { kind: 'input', key: 'dl_ambassadorCosts', label: 'Ambassador Costs', unit: 'usd' },
    { kind: 'input', key: 'dl_paidCampaignSpend', label: 'Paid Campaign Spend', unit: 'usd' },
    calc('Total Marketing Spend', 'usd', totalMarketing, tmY, 'Ambassador costs + paid campaign spend.'),
    calc('Download → User Conversion', 'percent', conversion, pct(nuY, ndY), 'New users ÷ new downloads.'),
    calc('Cost Per New Download', 'ratio', cpnd, safeDiv(tmY, ndY), 'Total marketing spend ÷ new downloads.'),
    calc('Cost Per New User', 'ratio', cpnu, safeDiv(tmY, nuY), 'Total marketing spend ÷ new users.'),
  ];

  const storeData = monthChartData(
    Object.fromEntries(STORE_KEYS.map(([key, label]) => [label, rawSeries(yearData, key)]))
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.blue}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Downloads</h2>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Downloads by store" accent={C.blue}>
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
  const latest = latestMonthIndex(yearData);
  const newUsers = rawSeries(yearData, 'u_newUsers');
  const mau = rawSeries(yearData, 'u_mau');
  const dau = rawSeries(yearData, 'u_dau');
  const churned = rawSeries(yearData, 'u_churned');

  const dauMau = pctSeries(dau, mau);
  const netGrowth = diffSeries(newUsers, churned);
  const cumUsers = cumulativeSeries(newUsers);

  const nuY = seriesSum(newUsers, latest);
  const chY = seriesSum(churned, latest);

  const rows = [
    { kind: 'input', key: 'u_newUsers', label: 'New Users', unit: 'count' },
    { kind: 'input', key: 'u_mau', label: 'MAU', unit: 'count', ytd: 'last' },
    { kind: 'input', key: 'u_dau', label: 'DAU', unit: 'count', ytd: 'last' },
    { kind: 'input', key: 'u_churned', label: 'Churned Users', unit: 'count' },
    calc('DAU / MAU', 'percent', dauMau, pct(valueAt(dau, latest), valueAt(mau, latest)), 'DAU ÷ MAU (latest month for YTD).'),
    calc('Net User Growth', 'count', netGrowth, nuY == null && chY == null ? null : (nuY || 0) - (chY || 0), 'New users − churned users.'),
    calc('Cumulative Total Users', 'count', cumUsers, valueAt(cumUsers, latest), 'Running total of new users from January.'),
  ];

  const data = monthChartData({ MAU: mau, 'New Users': newUsers, 'Cumulative Users': cumUsers });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.green}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Users</h2>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="MAU vs new users (with cumulative users)" accent={C.green}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} yAxisId="left" />
          <YAxis {...yAxis({ orientation: 'right' })} yAxisId="right" />
          <Tooltip content={<ChartTooltip fmt={fmtNumber} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="MAU" fill={C.blue} barSize={18} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="left" dataKey="New Users" fill={C.green} barSize={18} radius={[4, 4, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="Cumulative Users" stroke={C.purple} strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions tab
// ─────────────────────────────────────────────────────────────────────────────
function TransactionsTab({ yearData, updateMetric }) {
  const latest = latestMonthIndex(yearData);
  const countKeys = ['tx_sendP2P', 'tx_receiveP2P', 'tx_cashOut', 'tx_airtime', 'tx_cardRedemption', 'tx_other'];
  const valueKeys = ['tx_sendVolume', 'tx_cashOutVolume', 'tx_cardRedemptionVolume'];

  const totalTx = sumSeries(yearData, countKeys);
  const totalVol = sumSeries(yearData, valueKeys);
  const avgSize = ratioSeries(totalVol, totalTx);
  const attempts = rawSeries(yearData, 'tx_offrampAttempts');
  const successful = rawSeries(yearData, 'tx_offrampSuccessful');
  const successRate = pctSeries(successful, attempts);

  const txY = seriesSum(totalTx, latest);
  const volY = seriesSum(totalVol, latest);
  const attY = seriesSum(attempts, latest);
  const sucY = seriesSum(successful, latest);

  const rows = [
    { kind: 'subhead', label: 'Volume (counts)' },
    { kind: 'input', key: 'tx_sendP2P', label: 'Send P2P', unit: 'count' },
    { kind: 'input', key: 'tx_receiveP2P', label: 'Receive P2P', unit: 'count' },
    { kind: 'input', key: 'tx_cashOut', label: 'Cash-Out', unit: 'count' },
    { kind: 'input', key: 'tx_airtime', label: 'Airtime Top-Up', unit: 'count' },
    { kind: 'input', key: 'tx_cardRedemption', label: 'Card Redemption', unit: 'count' },
    { kind: 'input', key: 'tx_other', label: 'Other', unit: 'count' },
    calc('Total Transactions', 'count', totalTx, txY, 'Sum of all transaction counts.'),
    { kind: 'subhead', label: 'Value (USDT)' },
    { kind: 'input', key: 'tx_sendVolume', label: 'Send Volume', unit: 'usdt' },
    { kind: 'input', key: 'tx_cashOutVolume', label: 'Cash-Out Volume', unit: 'usdt' },
    { kind: 'input', key: 'tx_cardRedemptionVolume', label: 'Card Redemption Volume', unit: 'usdt' },
    calc('Total Volume', 'usdt', totalVol, volY, 'Sum of all value lines (USDT).'),
    calc('Average Transaction Size', 'ratio', avgSize, safeDiv(volY, txY), 'Total volume ÷ total transactions.'),
    { kind: 'subhead', label: 'Off-ramp' },
    { kind: 'input', key: 'tx_offrampAttempts', label: 'Attempts', unit: 'count' },
    { kind: 'input', key: 'tx_offrampSuccessful', label: 'Successful', unit: 'count' },
    { kind: 'input', key: 'tx_offrampFailed', label: 'Failed', unit: 'count' },
    calc('Off-Ramp Success Rate', 'percent', successRate, pct(sucY, attY), 'Successful ÷ attempts.'),
  ];

  const volData = monthChartData({
    'Send Volume': rawSeries(yearData, 'tx_sendVolume'),
    'Cash-Out Volume': rawSeries(yearData, 'tx_cashOutVolume'),
    'Card Redemption Volume': rawSeries(yearData, 'tx_cardRedemptionVolume'),
    'Off-Ramp Rate': successRate,
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card accent={C.amber}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Transactions</h2>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <ChartCard title="Transaction volume (USDT) & off-ramp success rate" accent={C.amber}>
        <ComposedChart data={volData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...X_AXIS} />
          <YAxis {...yAxis()} yAxisId="left" />
          <YAxis {...yAxis({ orientation: 'right', tickFormatter: (v) => `${Math.round(v)}%`, domain: [0, 100] })} yAxisId="right" />
          <Tooltip content={<ChartTooltip fmt={fmtUSDT} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="Send Volume" stackId="v" fill={C.amber} barSize={20} />
          <Bar yAxisId="left" dataKey="Cash-Out Volume" stackId="v" fill={C.blue} barSize={20} />
          <Bar yAxisId="left" dataKey="Card Redemption Volume" stackId="v" fill={C.purple} barSize={20} radius={[4, 4, 0, 0]} />
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
      <Card accent={C.purple}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Cards</h2>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <TwoCol>
        <ChartCard title="Cards sold vs redeemed" accent={C.purple}>
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
        <ChartCard title="Cards by market (YTD)" accent={C.purple}>
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
      <Card accent={C.green}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Revenue</h2>
        <MetricTable yearData={yearData} rows={rows} updateMetric={updateMetric} />
      </Card>
      <TwoCol>
        <ChartCard title="Revenue vs costs (with net)" accent={C.green}>
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
        <ChartCard title="Net revenue" accent={C.green}>
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

function TabContent({
  tab,
  yearData,
  activeYear,
  years,
  user,
  setUser,
  updateMetric,
  updateNote,
  onDeleteYear,
  onLogout,
}) {
  const common = { yearData, activeYear, updateMetric, updateNote };
  switch (tab) {
    case 'Downloads':
      return <DownloadsTab {...common} />;
    case 'Users':
      return <UsersTab {...common} />;
    case 'Transactions':
      return <TransactionsTab {...common} />;
    case 'Cards':
      return <CardsTab {...common} />;
    case 'Revenue':
      return <RevenueTab {...common} />;
    case 'Settings':
      return (
        <SettingsTab
          user={user}
          setUser={setUser}
          activeYear={activeYear}
          years={years}
          onDeleteYear={onDeleteYear}
          onLogout={onLogout}
        />
      );
    case 'Dashboard':
    default:
      return (
        <Card accent={C.blue}>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>Dashboard</h2>
          <p style={{ color: C.muted, margin: 0 }}>
            The Dashboard is built in the next phase. Viewing {activeYear}.
          </p>
        </Card>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings (shell-level: display name, password, year + account management)
// ─────────────────────────────────────────────────────────────────────────────
function SettingsTab({ user, setUser, activeYear, years, onDeleteYear, onLogout }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [msg, setMsg] = useState('');

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  const [confirmDelete, setConfirmDelete] = useState('');

  const saveName = async () => {
    setMsg('');
    try {
      await updateDisplayName(user.username, displayName.trim() || user.username);
      setUser({ ...user, display_name: displayName.trim() || user.username });
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
      if (newPw.length < 6) {
        setPwMsg('New password must be at least 6 characters.');
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

  const doDeleteYear = () => {
    if (years.length <= 1) {
      window.alert('You cannot delete your only year.');
      return;
    }
    if (window.confirm(`Delete all data for ${activeYear}? This cannot be undone.`)) {
      onDeleteYear(activeYear);
    }
  };

  const doDeleteAccount = async () => {
    if (confirmDelete !== 'DELETE') return;
    try {
      await deleteAccount(user.username);
      onLogout();
    } catch (e) {
      window.alert(e.message || 'Could not delete account.');
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
    background: C.blue,
    color: '#fff',
    borderRadius: 8,
    padding: '8px 14px',
    fontWeight: 600,
    fontSize: 13,
    marginTop: 12,
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      <Card accent={C.blue}>
        <div style={sectionLabel}>Profile</div>
        <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Display name</h2>
        <input
          style={settingInput}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <div>
          <button style={smallBtn} onClick={saveName}>
            Save
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
          Username: <strong>{user.username}</strong> (cannot be changed)
        </div>
        {msg && <p style={{ color: C.green, fontSize: 13 }}>{msg}</p>}
      </Card>

      <Card accent={C.blue}>
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
        <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>
          Security question: <strong>{user.security_question}</strong>
        </div>
      </Card>

      <Card accent={C.amber}>
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

      <Card accent={C.red}>
        <div style={sectionLabel}>Danger zone</div>
        <h2 style={{ fontSize: 18, margin: '4px 0 12px' }}>Delete account</h2>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 0 }}>
          This permanently deletes your account and all metrics. Type{' '}
          <strong>DELETE</strong> to confirm.
        </p>
        <input
          style={{ ...settingInput, marginTop: 0 }}
          value={confirmDelete}
          onChange={(e) => setConfirmDelete(e.target.value)}
          placeholder="DELETE"
        />
        <div>
          <button
            style={{
              ...smallBtn,
              background: confirmDelete === 'DELETE' ? C.red : '#c9cfd6',
              cursor: confirmDelete === 'DELETE' ? 'pointer' : 'not-allowed',
            }}
            onClick={doDeleteAccount}
            disabled={confirmDelete !== 'DELETE'}
          >
            Delete my account
          </button>
        </div>
      </Card>

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
