import React, { useState } from 'react';
import { apiClient, ApiError } from '../services/api';
import { User } from '../types';
import { LanguageSwitcher, useI18n } from '../i18n';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void | Promise<void>;
  initialMode?: 'login' | 'signup';
  sharedAccess?: boolean;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, initialMode = 'login', sharedAccess = false }) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError(t('Passwords do not match.'));
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError(t('Please enter a valid email address.'));
        return;
      }
    }

    setSubmitting(true);
    try {
      const session =
        mode === 'login'
          ? await apiClient.login({ username, password })
          : await apiClient.register({ email, username, password });
      await onAuthSuccess(toUser(session.user));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || t('Authentication failed.'));
      } else {
        setError(
          err instanceof Error ? err.message : t('Authentication failed.')
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sp-auth-shell relative flex min-h-screen items-center justify-center px-5 py-10">
      <div className="sp-auth-panel relative z-10 w-full max-w-[420px] rounded-2xl border p-6 backdrop-blur-2xl sm:p-9">
        <div className="flex justify-end -mt-2 -mr-2 mb-3">
          <LanguageSwitcher compact />
        </div>
        <div className="text-center mb-7">
          <div className="sp-brand-mark flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-medium mx-auto mb-4" aria-hidden="true">
            S
          </div>
          <h1 className="sp-heading text-2xl font-semibold tracking-tight">SyncPath</h1>
          <p className="sp-metadata mt-2 text-sm">{t('Team Roadmap Platform')}</p>
          {sharedAccess && <p className="mt-4 rounded-xl bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-700">{t('Register or sign in to view shared content. You can view only.')}</p>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor="auth-email" className="mb-2 block text-xs font-medium text-slate-600">{t('Email')}</label>
              <input
                id="auth-email"
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="sp-auth-input h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors"
                placeholder="you@example.com"
              />
            </div>
          )}
          <div>
            <label htmlFor="auth-username" className="mb-2 block text-xs font-medium text-slate-600">{t('Username')}</label>
            <input
              id="auth-username"
              autoComplete="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="sp-auth-input h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors"
              placeholder={t('Enter username')}
            />
          </div>
          <div>
            <label htmlFor="auth-password" className="mb-2 block text-xs font-medium text-slate-600">{t('Password')}</label>
            <input
              id="auth-password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="sp-auth-input h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors"
              placeholder={mode === 'signup' ? t('At least 8 characters') : t('Enter password')}
            />
          </div>

          {mode === 'signup' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor="auth-confirm-password" className="mb-2 block text-xs font-medium text-slate-600">{t('Confirm Password')}</label>
              <input
                id="auth-confirm-password"
                autoComplete="new-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="sp-auth-input h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors"
                placeholder={t('Confirm password')}
              />
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 bg-red-50 text-red-600 text-xs leading-5 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="sp-button-primary min-h-11 w-full text-sm font-medium disabled:opacity-60"
          >
            {submitting
              ? t('Working…')
              : mode === 'login'
                ? t('Sign In')
                : t('Create Account')}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setConfirmPassword('');
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {mode === 'login' ? t('Need an account?') : t('Already have an account?')}
          </button>

        </div>
      </div>
    </div>
  );
};

function toUser(apiUser: {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
}): User {
  return {
    id: apiUser.id,
    username: apiUser.username,
    email: apiUser.email,
    displayName: apiUser.displayName ?? undefined,
    role: 'admin'
  };
}

export default AuthScreen;
