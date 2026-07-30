import { LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { isAllowedDashboardEmail, isSupabaseAuthConfigured, supabase } from '../lib/supabase';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  // Only "loading" when there is actually a session to check: both values are module-level
  // constants read from import.meta.env, so this never needs correcting in the effect below.
  const [loading, setLoading] = useState(() => Boolean(supabase) && isSupabaseAuthConfigured);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const client = supabase;

    if (!client || !isSupabaseAuthConfigured) {
      return;
    }

    void client.auth.getSession().then(({ data }) => {
      const currentSession = data.session;

      if (currentSession && !isAllowedDashboardEmail(currentSession.user.email)) {
        void client.auth.signOut();
        setAuthMessage('This account is not allowed to view the dashboard.');
        setSession(null);
      } else {
        setSession(currentSession);
      }

      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession && !isAllowedDashboardEmail(nextSession.user.email)) {
        void client.auth.signOut();
        setAuthMessage('This account is not allowed to view the dashboard.');
        setSession(null);
        return;
      }

      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const client = supabase;

    if (!client) {
      setAuthMessage('Supabase auth is not configured.');
      return;
    }

    setSubmitting(true);
    setAuthMessage('');

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthMessage(error.message);
    } else if (!isAllowedDashboardEmail(data.user.email)) {
      await client.auth.signOut();
      setAuthMessage('This account is not allowed to view the dashboard.');
    } else {
      setSession(data.session);
    }

    setSubmitting(false);
  }

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <RefreshCw aria-hidden="true" size={22} />
          <h1>StackVitals</h1>
          <p>Checking private dashboard session.</p>
        </div>
      </main>
    );
  }

  if (!supabase || !isSupabaseAuthConfigured) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <LockKeyhole aria-hidden="true" size={26} />
          <h1>StackVitals</h1>
          <p>Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_DASHBOARD_ALLOWED_EMAIL` before deployment.</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={handleSignIn}>
          <LockKeyhole aria-hidden="true" size={26} />
          <h1>StackVitals</h1>
          <p className="brand-subtitle">Stack Status Hub</p>
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {authMessage && <p className="auth-message">{authMessage}</p>}
          <button className="refresh-button" disabled={submitting} type="submit">
            <LockKeyhole aria-hidden="true" size={16} />
            {submitting ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </main>
    );
  }

  const client = supabase;

  if (!client) {
    return null;
  }

  return (
    <>
      <div className="session-bar">
        <span>{session.user.email}</span>
        <button className="table-action-button" type="button" onClick={() => void client.auth.signOut()}>
          <LogOut aria-hidden="true" size={14} />
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}
