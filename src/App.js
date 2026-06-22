import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

// Placeholder tab content — each tab is built out in its own phase.
function TabContent({
  tab,
  yearData,
  activeYear,
  years,
  user,
  setUser,
  onDeleteYear,
  onLogout,
}) {
  if (tab === 'Settings') {
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
  }
  return (
    <Card accent={C.blue}>
      <h2 style={{ fontSize: 20, marginBottom: 6 }}>{tab}</h2>
      <p style={{ color: C.muted, margin: 0 }}>
        The {tab} tab is coming next. Viewing data for {activeYear}.
      </p>
    </Card>
  );
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
