
import React, { useState } from 'react';
import { authService } from '../services/authService';
import { User } from '../types';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    if (mode === 'login') {
      const user = authService.login(username, password);
      if (user) {
        onAuthSuccess(user);
      } else {
        setError('Invalid username or password.');
      }
    } else {
      const result = authService.register(username, password);
      if (result.success && result.user) {
        onAuthSuccess(result.user);
      } else {
        setError(result.message || 'Registration failed.');
      }
    }
  };

  const handleGuest = () => {
    onAuthSuccess(authService.guestLogin());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/30 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[0%] right-[0%] w-[40%] h-[40%] bg-emerald-200/30 rounded-full blur-[100px]"></div>
      </div>

      <div className="bg-white/80 backdrop-blur-xl p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-white relative z-10 animate-in fade-in zoom-in-95 duration-300">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4 shadow-lg shadow-slate-200">
            S
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tighter">SyncPath</h1>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Team Roadmap Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
             <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Username</label>
             <input 
               type="text" 
               required
               value={username}
               onChange={e => setUsername(e.target.value)}
               className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
               placeholder="Enter username"
             />
          </div>
          <div>
             <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Password</label>
             <input 
               type="password" 
               required
               value={password}
               onChange={e => setPassword(e.target.value)}
               className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
               placeholder="Enter password"
             />
          </div>

          {mode === 'signup' && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Confirm Password</label>
              <input 
                type="password" 
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none font-bold text-slate-700 transition-all"
                placeholder="Confirm password"
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
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between">
          <button 
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setConfirmPassword(''); }}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
          </button>

          <button 
            type="button"
            onClick={handleGuest}
            className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
          >
            Continue as Guest <i className="fas fa-arrow-right ml-1"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
