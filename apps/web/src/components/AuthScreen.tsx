import React, { useState } from 'react';
import { apiClient, ApiError } from '../services/api';
import { User } from '../types';
import { LanguageSwitcher, useI18n } from '../i18n';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void | Promise<void>;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/30 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[0%] right-[0%] w-[40%] h-[40%] bg-emerald-200/30 rounded-full blur-[100px]"></div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl p-6 sm:p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-white relative z-10 animate-in fade-in zoom-in-95 duration-300">
        <div className="flex justify-end -mt-2 -mr-2 mb-2">
          <LanguageSwitcher compact />
        </div>
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4 shadow-lg shadow-slate-200">
            S
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tighter">SyncPath</h1>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mt-2">{t('Team Roadmap Platform')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {mode === 'signup' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor="auth-email" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">{t('Email')}</label>
              <input
                id="auth-email"
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
                placeholder="you@example.com"
              />
            </div>
          )}
          <div>
            <label htmlFor="auth-username" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">{t('Username')}</label>
            <input
              id="auth-username"
              autoComplete="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
              placeholder={t('Enter username')}
            />
          </div>
          <div>
            <label htmlFor="auth-password" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">{t('Password')}</label>
            <input
              id="auth-password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
              placeholder={mode === 'signup' ? t('At least 8 characters') : t('Enter password')}
            />
          </div>

          {mode === 'signup' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label htmlFor="auth-confirm-password" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">{t('Confirm Password')}</label>
              <input
                id="auth-confirm-password"
                autoComplete="new-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
                placeholder={t('Confirm password')}
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-500 text-xs font-bold rounded-xl text-center border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60 disabled:hover:scale-100"
          >
            {submitting
              ? t('Working…')
              : mode === 'login'
                ? t('Sign In')
                : t('Create Account')}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setConfirmPassword('');
            }}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
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
