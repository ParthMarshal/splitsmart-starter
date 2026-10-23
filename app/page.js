'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const DEFAULT_PARTICIPANTS = ['Aisha', 'Raj', 'You'];

const money = (value) => '₹' + Number(value || 0).toLocaleString('en-IN');

const formatDateKey = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (dateString, amount) => {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return formatDateKey(d);
};

const prettyDate = (dateString) => {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const dayLabel = (dateString) => {
  const today = formatDateKey(new Date());
  const yesterday = addDays(today, -1);

  if (dateString === today) return 'Today';
  if (dateString === yesterday) return 'Yesterday';
  return prettyDate(dateString);
};

const buildSeedExpenses = () => {
  const today = formatDateKey(new Date());
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);

  return [
    {
      id: 'seed-1',
      title: 'Dinner',
      category: 'Food',
      amount: 1800,
      paidBy: 'Aisha',
      splitType: 'equal',
      splitBetween: ['Aisha', 'Raj', 'You'],
      customShares: { Aisha: 600, Raj: 600, You: 600 },
      date: today,
    },
    {
      id: 'seed-2',
      title: 'Cab Ride',
      category: 'Travel',
      amount: 450,
      paidBy: 'Raj',
      splitType: 'custom',
      splitBetween: ['Aisha', 'Raj', 'You'],
      customShares: { Aisha: 150, Raj: 150, You: 150 },
      date: yesterday,
    },
    {
      id: 'seed-3',
      title: 'Groceries',
      category: 'House',
      amount: 980,
      paidBy: 'You',
      splitType: 'equal',
      splitBetween: ['Aisha', 'Raj', 'You'],
      customShares: { Aisha: 326.67, Raj: 326.67, You: 326.66 },
      date: twoDaysAgo,
    },
  ];
};

const createDefaultForm = (participants) => ({
  title: '',
  category: 'Food',
  amount: '',
  paidBy: participants[0] || 'You',
  splitType: 'equal',
  splitBetween: [...participants],
  date: formatDateKey(new Date()),
  customShares: Object.fromEntries((participants || []).map((person) => [person, 0])),
});

const normalizeShares = (amount, participants, currentShares = {}) => {
  const selected = participants.length ? participants : ['You'];
  const totalSelected = selected.reduce((sum, person) => sum + (Number(currentShares[person] || 0) || 0), 0);
  const normalized = { ...currentShares };

  if (!selected.length) return normalized;

  if (!totalSelected || Number(amount) <= 0) {
    const even = Number(amount || 0) / selected.length;
    selected.forEach((person) => {
      normalized[person] = Number((even || 0).toFixed(2));
    });
    return normalized;
  }

  const remaining = Number(amount) - totalSelected;
  const last = selected[selected.length - 1];
  normalized[last] = Number((Number(normalized[last] || 0) + remaining).toFixed(2));
  return normalized;
};

const mapSupabaseExpense = (expense) => ({
  id: expense.id,
  title: expense.title,
  category: expense.category || 'General',
  amount: Number(expense.amount || 0),
  paidBy: expense.paid_by || expense.paidBy || 'You',
  splitType: expense.split_type || expense.splitType || 'equal',
  splitBetween: Array.isArray(expense.split_between) ? expense.split_between : (Array.isArray(expense.splitBetween) ? expense.splitBetween : []),
  customShares: expense.custom_shares || expense.customShares || {},
  date: expense.date || formatDateKey(new Date()),
});

const localExpenseStorageKey = (username) => `brokeBrosExpenses:${encodeURIComponent(username)}`;

const readLocalExpenses = (username) => {
  try {
    const storedExpenses = localStorage.getItem(localExpenseStorageKey(username));
    const parsedExpenses = storedExpenses ? JSON.parse(storedExpenses) : [];
    return Array.isArray(parsedExpenses) ? parsedExpenses : [];
  } catch (error) {
    console.error('Unable to read saved expenses:', error);
    return [];
  }
};

const writeLocalExpenses = (username, expenses) => {
  try {
    localStorage.setItem(localExpenseStorageKey(username), JSON.stringify(expenses));
    return true;
  } catch (error) {
    console.error('Unable to save expenses on this device:', error);
    return false;
  }
};

export default function Home() {
  const [participants, setParticipants] = useState(DEFAULT_PARTICIPANTS);
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState(createDefaultForm(DEFAULT_PARTICIPANTS));
  const [newParticipant, setNewParticipant] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [expenseFeedback, setExpenseFeedback] = useState('');
  const [expenseFeedbackError, setExpenseFeedbackError] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const storedCredentials = localStorage.getItem('splitSmartCredentials');
    if (!storedCredentials) {
      setIsReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedCredentials);
      if (parsed?.username && parsed?.password) {
        setUser({
          id: parsed.username,
          username: parsed.username,
        });
      }
    } catch (error) {
      console.error('Unable to parse stored credentials:', error);
      localStorage.removeItem('splitSmartCredentials');
    }

    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!user) {
      setExpenses([]);
      return;
    }

    let isCurrent = true;
    const fetchExpenses = async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase fetch error:', error);
        const localExpenses = readLocalExpenses(user.username);
        if (isCurrent) {
          setExpenses(localExpenses);
          setExpenseFeedback(localExpenses.length
            ? 'Showing expenses saved on this device. Supabase could not be reached.'
            : 'Supabase could not be reached. New expenses will be saved on this device.');
          setExpenseFeedbackError(true);
        }
        return;
      }

      const rows = (data || []).map(mapSupabaseExpense);
      const localExpenses = readLocalExpenses(user.username);
      const remoteIds = new Set(rows.map((expense) => expense.id));
      const mergedExpenses = [...localExpenses.filter((expense) => !remoteIds.has(expense.id)), ...rows];
      if (isCurrent) {
        setExpenses(mergedExpenses);
        setExpenseFeedback(localExpenses.length ? 'Some expenses are saved only on this device.' : '');
        setExpenseFeedbackError(false);
      }
    };

    fetchExpenses();

    return () => {
      isCurrent = false;
    };
  }, [user]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      paidBy: participants.includes(current.paidBy) ? current.paidBy : participants[0] || 'You',
      splitBetween: current.splitBetween.filter((person) => participants.includes(person)).length
        ? current.splitBetween.filter((person) => participants.includes(person))
        : [...participants],
      customShares: Object.fromEntries((participants || []).map((person) => [person, current.customShares?.[person] ?? 0])),
    }));
  }, [participants]);

  const totalSpent = useMemo(() => expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0), [expenses]);

  const dailyGroups = useMemo(() => {
    const grouped = {};
    expenses.forEach((expense) => {
      const key = expense.date || formatDateKey(new Date());
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(expense);
    });

    return Object.entries(grouped)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .map(([date, items]) => ({
        date,
        label: dayLabel(date),
        total: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        entries: items.sort((a, b) => new Date(b.date) - new Date(a.date)),
      }));
  }, [expenses]);

  const overallBalances = useMemo(() => {
    const balances = Object.fromEntries(participants.map((person) => [person, 0]));

    expenses.forEach((expense) => {
      const selected = expense.splitBetween || participants;
      const perPersonShare = expense.splitType === 'custom'
        ? selected.reduce((acc, person) => {
            acc[person] = Number(expense.customShares?.[person] || 0);
            return acc;
          }, {})
        : selected.reduce((acc, person) => {
            acc[person] = Number(expense.amount || 0) / selected.length;
            return acc;
          }, {});

      selected.forEach((person) => {
        balances[person] -= Number(perPersonShare[person] || 0);
      });

      balances[expense.paidBy] += Number(expense.amount || 0);
    });

    return balances;
  }, [expenses, participants]);

  const overallSettle = useMemo(() => {
    const creditors = [];
    const debtors = [];

    Object.entries(overallBalances).forEach(([person, amount]) => {
      if (amount > 0) creditors.push({ person, amount });
      if (amount < 0) debtors.push({ person, amount: Math.abs(amount) });
    });

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const rows = [];
    let i = 0;
    let j = 0;

    while (i < creditors.length && j < debtors.length) {
      const creditor = creditors[i];
      const debtor = debtors[j];
      const transfer = Math.min(creditor.amount, debtor.amount);

      if (transfer > 0) {
        rows.push({
          from: debtor.person,
          to: creditor.person,
          amount: transfer,
        });
      }

      creditor.amount -= transfer;
      debtor.amount -= transfer;

      if (creditor.amount <= 0.01) i += 1;
      if (debtor.amount <= 0.01) j += 1;
    }

    return rows;
  }, [overallBalances]);

  const addParticipant = () => {
    const value = newParticipant.trim();
    if (!value || participants.includes(value)) {
      setNewParticipant('');
      return;
    }
    const nextParticipants = [...participants, value];
    setParticipants(nextParticipants);
    setForm((current) => ({
      ...current,
      paidBy: current.paidBy || value,
      splitBetween: current.splitBetween.includes(value) ? current.splitBetween : [...current.splitBetween, value],
      customShares: {
        ...current.customShares,
        [value]: 0,
      },
    }));
    setNewParticipant('');
  };

  const updateSplitParticipant = (person, checked) => {
    setForm((current) => {
      const currentSplit = new Set(current.splitBetween);
      if (checked) {
        currentSplit.add(person);
      } else {
        currentSplit.delete(person);
      }

      const nextSplit = [...currentSplit];
      return {
        ...current,
        splitBetween: nextSplit,
        customShares: {
          ...current.customShares,
          [person]: Number(current.customShares?.[person] || 0),
        },
      };
    });
  };

  const handleLogin = (event) => {
    event.preventDefault();
    setAuthMessage('');
    setAuthError('');

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setAuthError('Please enter both username and password.');
      return;
    }

    const credentials = {
      username: trimmedUsername,
      password: trimmedPassword,
    };

    localStorage.setItem('splitSmartCredentials', JSON.stringify(credentials));
    setUser({
      id: trimmedUsername,
      username: trimmedUsername,
    });
    setAuthMessage('Signed in successfully.');
    setUsername('');
    setPassword('');
  };

  const handleSignOut = () => {
    localStorage.removeItem('splitSmartCredentials');
    setUser(null);
    setExpenses([]);
    setExpenseFeedback('');
  };

  const addExpense = async (event) => {
    event.preventDefault();
    setExpenseFeedback('');
    setExpenseFeedbackError(false);
    if (!user) return;

    const amount = Number(form.amount || 0);
    if (!form.title.trim() || amount <= 0 || !form.paidBy) {
      setExpenseFeedback('Enter a title and an amount greater than zero.');
      setExpenseFeedbackError(true);
      return;
    }

    const selectedParticipants = form.splitBetween.length ? form.splitBetween : [form.paidBy];
    const normalizedCustom = normalizeShares(amount, selectedParticipants, form.customShares || {});

    const payload = {
      title: form.title.trim(),
      category: form.category,
      amount,
      paid_by: form.paidBy,
      split_type: form.splitType,
      split_between: selectedParticipants,
      custom_shares: normalizedCustom,
      date: form.date,
      user_id: user.id,
      created_at: new Date().toISOString(),
    };

    setIsSavingExpense(true);
    let savedExpense = null;
    let fallbackReason = '';

    try {
      const { data, error } = await supabase.from('expenses').insert(payload).select().single();
      if (error) {
        console.error('Supabase insert error:', error);
        fallbackReason = error.message;
      } else {
        savedExpense = mapSupabaseExpense(data);
      }
    } catch (error) {
      console.error('Supabase insert error:', error);
      fallbackReason = error instanceof Error ? error.message : 'Database request failed.';
    }

    if (!savedExpense) {
      const localExpense = mapSupabaseExpense({ ...payload, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}` });
      const localExpenses = readLocalExpenses(user.username);
      if (writeLocalExpenses(user.username, [localExpense, ...localExpenses])) {
        savedExpense = localExpense;
        setExpenseFeedback(`Saved on this device. Database error: ${fallbackReason}`);
        setExpenseFeedbackError(true);
      } else {
        setExpenseFeedback('Could not save the expense. Check browser storage and Supabase settings.');
        setExpenseFeedbackError(true);
      }
    }

    if (savedExpense) {
      setExpenses((current) => [savedExpense, ...current.filter((expense) => expense.id !== savedExpense.id)]);
      setForm((current) => ({
        ...createDefaultForm(participants),
        paidBy: current.paidBy,
        splitBetween: [...participants],
        customShares: Object.fromEntries((participants || []).map((person) => [person, 0])),
        date: current.date,
      }));
    }
    setIsSavingExpense(false);
  };

  const removeExpense = async (id) => {
    if (String(id).startsWith('local-')) {
      const nextLocalExpenses = readLocalExpenses(user.username).filter((expense) => expense.id !== id);
      writeLocalExpenses(user.username, nextLocalExpenses);
      setExpenses((current) => current.filter((expense) => expense.id !== id));
      return;
    }

    const { error } = await supabase.from('expenses').delete().eq('id', id).eq('user_id', user?.id);

    if (error) {
      console.error('Supabase delete error:', error);
      setExpenseFeedback(`Could not remove expense from the database: ${error.message}`);
      setExpenseFeedbackError(true);
      return;
    }

    setExpenses((current) => current.filter((expense) => expense.id !== id));
    setExpenseFeedback('Expense removed.');
    setExpenseFeedbackError(false);
  };

  const expenseSettlementsForDay = (items) => {
    const balances = Object.fromEntries(participants.map((person) => [person, 0]));

    items.forEach((expense) => {
      const members = expense.splitBetween || participants;
      const shareValue = expense.splitType === 'custom'
        ? members.reduce((acc, person) => {
            acc[person] = Number(expense.customShares?.[person] || 0);
            return acc;
          }, {})
        : members.reduce((acc, person) => {
            acc[person] = Number(expense.amount || 0) / members.length;
            return acc;
          }, {});

      members.forEach((person) => {
        balances[person] -= Number(shareValue[person] || 0);
      });

      balances[expense.paidBy] += Number(expense.amount || 0);
    });

    const creditors = [];
    const debtors = [];

    Object.entries(balances).forEach(([person, value]) => {
      if (value > 0.01) creditors.push({ person, amount: value });
      if (value < -0.01) debtors.push({ person, amount: Math.abs(value) });
    });

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const rows = [];
    let i = 0;
    let j = 0;

    while (i < creditors.length && j < debtors.length) {
      const creditor = creditors[i];
      const debtor = debtors[j];
      const transfer = Math.min(creditor.amount, debtor.amount);

      if (transfer > 0.01) {
        rows.push({
          from: debtor.person,
          to: creditor.person,
          amount: transfer,
        });
      }

      creditor.amount -= transfer;
      debtor.amount -= transfer;
      if (creditor.amount <= 0.01) i += 1;
      if (debtor.amount <= 0.01) j += 1;
    }

    return rows;
  };

  if (!user) {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-card panel">
          <div className="eyebrow">SplitSmart</div>
          <h2>Daily expense ledger</h2>
          <p>Sign in with your username and password to view and manage expenses.</p>

          <form onSubmit={handleLogin} className="auth-form">
            <label>
              <span>Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="username"
                required
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="password"
                required
              />
            </label>

            <button type="submit" className="primary-btn">Sign in</button>
          </form>

          {authMessage && <div className="auth-success">{authMessage}</div>}
          {authError && <div className="auth-error">{authError}</div>}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="frame">
        <header className="topbar">
          <div>
            <div className="eyebrow">GROUP FINANCE / DAILY LEDGER</div>
            <h1 className="brand-dotmark">Broke_Bros</h1>
          </div>
          <div className="topbar-actions">
            <div className="live-pill">{dayLabel(formatDateKey(new Date()))}</div>
            <button type="button" className="circle-btn" aria-label="Add an expense" title="Add an expense" onClick={() => document.getElementById('expense-form')?.scrollIntoView({ behavior: 'smooth' })}>+</button>
            <button type="button" className="circle-btn" aria-label="View daily ledger" title="View daily ledger" onClick={() => document.getElementById('daily-ledger')?.scrollIntoView({ behavior: 'smooth' })}>▤</button>
            <button type="button" className="circle-btn signout-btn" aria-label="Sign out" title="Sign out" onClick={handleSignOut}>⏻</button>
          </div>
        </header>

        <section className="dashboard-intro" aria-label="Dashboard overview">
          <div className="dashboard-copy">
            <div className="greeting">Hi, Welcome {user.username}</div>
            <span className="signal-label"><span className="signal-dot" /> LIVE GROUP DASHBOARD</span>
            <h2>Money, <span>in sync.</span></h2>
            <p>Your shared spending, daily totals, and settlements in one place.</p>
          </div>
          <div className="orbit-mark" aria-hidden="true">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <span className="orbit-core" />
            <span className="orbit-caption">BROKE<br />BROS / 01</span>
          </div>
        </section>

        {expenseFeedback && (
          <div className={`expense-feedback${expenseFeedbackError ? ' is-error' : ''}`} role="status">
            {expenseFeedback}
          </div>
        )}

        <section className="summary-grid">
          <div className="stat-card highlight">
            <span className="label">TOTAL SPENT</span>
            <strong>{money(totalSpent)}</strong>
          </div>
          <div className="stat-card">
            <span className="label">NET BALANCE</span>
            <strong className={Object.values(overallBalances).some((value) => value > 0) ? 'positive' : 'neutral'}>
              {money(Object.values(overallBalances).reduce((sum, value) => sum + value, 0))}
            </strong>
          </div>
        </section>

        <div className="workspace-grid">
          <div className="workspace-sidebar">
            <section className="panel participants-panel">
          <div className="section-head">
            <span>GROUP</span>
            <span className="meta">{participants.length} members</span>
          </div>

          <div className="chips">
            {participants.map((person) => (
              <span key={person} className="chip">{person}</span>
            ))}
          </div>

          <div className="participant-adder">
            <input
              type="text"
              value={newParticipant}
              onChange={(event) => setNewParticipant(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addParticipant())}
              placeholder="Add friend"
            />
            <button type="button" className="secondary-btn" onClick={addParticipant}>Add</button>
          </div>
          </section>

          <form id="expense-form" className="panel form-panel" onSubmit={addExpense}>
          <div className="section-head">
            <span>ADD EXPENSE</span>
            <span className="meta">daily entry</span>
          </div>

          <div className="field-grid">
            <label>
              <span>Title</span>
              <input
                type="text"
                required
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Dinner, groceries..."
              />
            </label>

            <label>
              <span>Category</span>
              <input
                type="text"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              />
            </label>

            <label>
              <span>Amount</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="0"
              />
            </label>

            <label>
              <span>Date</span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              />
            </label>

            <label>
              <span>Paid by</span>
              <select
                value={form.paidBy}
                onChange={(event) => setForm((current) => ({ ...current, paidBy: event.target.value }))}
              >
                {participants.map((person) => (
                  <option key={person} value={person}>{person}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Split</span>
              <select
                value={form.splitType}
                onChange={(event) => setForm((current) => ({ ...current, splitType: event.target.value }))}
              >
                <option value="equal">Equal</option>
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>

          <div className="split-box">
            <div className="split-head">
              <span>Split between</span>
              <span className="meta">{form.splitBetween.length} selected</span>
            </div>

            <div className="split-list">
              {participants.map((person) => (
                <label key={person} className="split-row">
                  <input
                    type="checkbox"
                    checked={form.splitBetween.includes(person)}
                    onChange={(event) => updateSplitParticipant(person, event.target.checked)}
                  />
                  <span>{person}</span>
                </label>
              ))}
            </div>

            {form.splitType === 'custom' && (
              <div className="custom-amounts">
                {form.splitBetween.map((person) => (
                  <label key={person}>
                    <span>{person}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.customShares?.[person] ?? 0}
                      onChange={(event) => {
                        const value = event.target.value;
                        setForm((current) => ({
                          ...current,
                          customShares: {
                            ...current.customShares,
                            [person]: Number(value || 0),
                          },
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

              <button type="submit" className="primary-btn" disabled={isSavingExpense}>
                {isSavingExpense ? 'Saving...' : 'Add Expense'}
              </button>
            </form>

            <section className="panel settlement-panel">
          <div className="section-head">
            <span>SETTLEMENTS</span>
            <span className="meta">net balance</span>
          </div>

          <div className="settlement-list">
            {overallSettle.length === 0 ? (
              <div className="empty-state">Everything is settled.</div>
            ) : (
              overallSettle.map((row) => (
                <div key={`${row.from}-${row.to}`} className="settle-row">
                  <span>{row.from}</span>
                  <span className="arrow">→</span>
                  <span>{row.to}</span>
                  <strong>{money(row.amount)}</strong>
                </div>
              ))
            )}
          </div>
            </section>
          </div>

          <section id="daily-ledger" className="ledger">
          {dailyGroups.length === 0 ? (
            <div className="panel empty-ledger">No expenses yet. Add the first one above.</div>
          ) : (
            dailyGroups.map((group) => (
              <article key={group.date} className="panel day-card">
                <div className="day-head">
                  <div>
                    <div className="day-label">{group.label}</div>
                    <div className="day-date">{prettyDate(group.date)}</div>
                  </div>
                  <div className="day-total">{money(group.total)}</div>
                </div>

                <div className="entry-list">
                  {group.entries.map((expense) => (
                    <div key={expense.id} className="entry-row">
                      <div className="entry-main">
                        <div className="entry-title-row">
                          <span className="entry-title">{expense.title}</span>
                          <button type="button" className="ghost-btn" onClick={() => removeExpense(expense.id)}>Remove</button>
                        </div>
                        <div className="entry-meta">
                          {expense.category} • paid by {expense.paidBy}
                        </div>
                        <div className="entry-meta muted">
                          {expense.splitType === 'equal' ? 'Equal split' : 'Custom split'} • {expense.splitBetween.join(', ')}
                        </div>
                      </div>

                      <div className="entry-amount">
                        <strong>{money(expense.amount)}</strong>
                        <span>{expense.splitType === 'equal' ? `${money(Number(expense.amount || 0) / expense.splitBetween.length)} each` : 'custom share'}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="day-settlement">
                  <div className="settlement-label">Daily settlement</div>
                  {expenseSettlementsForDay(group.entries).length === 0 ? (
                    <div className="settled">Settled</div>
                  ) : (
                    expenseSettlementsForDay(group.entries).map((row) => (
                      <div key={`${group.date}-${row.from}-${row.to}`} className="day-settlement-row">
                        <span>{row.from}</span>
                        <span className="arrow">→</span>
                        <span>{row.to}</span>
                        <strong>{money(row.amount)}</strong>
                      </div>
                    ))
                  )}
                </div>
              </article>
            ))
          )}
          </section>
        </div>
      </div>
    </main>
  );
}
