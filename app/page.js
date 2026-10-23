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

export default function Home() {
  const [participants, setParticipants] = useState(DEFAULT_PARTICIPANTS);
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState(createDefaultForm(DEFAULT_PARTICIPANTS));
  const [newParticipant, setNewParticipant] = useState('');
  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session: currentSession }, error } = await supabase.auth.getSession();
      if (!error) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      }
      setIsReady(true);
    };

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setExpenses([]);
      return;
    }

    const fetchExpenses = async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase fetch error:', error);
        setExpenses([]);
        return;
      }

      const rows = (data || []).map(mapSupabaseExpense);
      setExpenses(rows);
    };

    fetchExpenses();
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

  const handleMagicLink = async (event) => {
    event.preventDefault();
    setAuthMessage('');
    setAuthError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError('Please enter your email address.');
      return;
    }

    const redirectUrl = `${window.location.origin}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      setAuthError(error.message || 'Unable to sign in.');
      return;
    }

    setAuthMessage('Magic link sent. Check your email and click the sign-in link.');
    setEmail('');
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setExpenses([]);
  };

  const addExpense = async (event) => {
    event.preventDefault();
    if (!user) return;

    const amount = Number(form.amount || 0);
    if (!form.title.trim() || !amount || !form.paidBy) return;

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

    const { data, error } = await supabase.from('expenses').insert(payload).select().single();

    if (error) {
      console.error('Supabase insert error:', error);
      return;
    }

    setExpenses((current) => [mapSupabaseExpense(data), ...current]);
    setForm((current) => ({
      ...createDefaultForm(participants),
      paidBy: current.paidBy,
      splitBetween: [...participants],
      customShares: Object.fromEntries((participants || []).map((person) => [person, 0])),
      date: current.date,
    }));
  };

  const removeExpense = async (id) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id).eq('user_id', user?.id);

    if (error) {
      console.error('Supabase delete error:', error);
      return;
    }

    setExpenses((current) => current.filter((expense) => expense.id !== id));
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
          <p>Sign in with your email to view and manage expenses.</p>

          <form onSubmit={handleMagicLink} className="auth-form">
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <button type="submit" className="primary-btn">Send magic link</button>
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
            <div className="eyebrow">DAILY LEDGER</div>
            <h1>SplitSmart</h1>
          </div>
          <div className="topbar-actions">
            <div className="live-pill">{dayLabel(formatDateKey(new Date()))}</div>
            <button type="button" className="secondary-btn small-btn" onClick={handleSignOut}>Sign out</button>
          </div>
        </header>

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

        <form className="panel form-panel" onSubmit={addExpense}>
          <div className="section-head">
            <span>ADD EXPENSE</span>
            <span className="meta">daily entry</span>
          </div>

          <div className="field-grid">
            <label>
              <span>Title</span>
              <input
                type="text"
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
                min="0"
                step="0.01"
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

          <button type="submit" className="primary-btn">Add Expense</button>
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

        <section className="ledger">
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
    </main>
  );
}
