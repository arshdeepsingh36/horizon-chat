import React, { useState } from 'react';
import { MessageSquare, ArrowRight, Loader2, ShieldCheck, Lock, UserPlus, LogIn } from 'lucide-react';

export default function WhatsAppAuth({ onLogin, apiBaseUrl }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser) {
      setError('Please enter a WhatsApp handle.');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUser)) {
      setError('Handle must be 3–32 letters, numbers, or underscores.');
      return;
    }

    if (password.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed');
        setLoading(false);
        return;
      }

      // Telegram/WhatsApp-style persistent login
      localStorage.setItem('wa_token', data.token);
      localStorage.setItem('wa_user', JSON.stringify(data.user));

      onLogin({ token: data.token, user: data.user });
    } catch (err) {
      console.error(err);
      setError('Unable to connect to WhatsApp Cloud server.');
      setLoading(false);
    }
  };

  return (
    <div className="wa-auth-container">
      <div className="wa-auth-brand">
        <div className="wa-auth-logo-circle">
          <MessageSquare size={38} fill="#FFFFFF" color="#FFFFFF" />
        </div>
        <h1 className="wa-auth-title">Welcome to WhatsApp</h1>
        <p className="wa-auth-subtitle">
          Connect with friends with Telegram-style permanent cloud backup.
        </p>
      </div>

      <div className="wa-auth-box">
        <div className="wa-tab-switch">
          <button
            type="button"
            className={`wa-tab-btn ${!isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(false); setError(''); }}
          >
            <LogIn size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            Sign In
          </button>
          <button
            type="button"
            className={`wa-tab-btn ${isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(true); setError(''); }}
          >
            <UserPlus size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            New Account
          </button>
        </div>

        {error && <div className="wa-error-banner">{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="wa-input-group">
            <label className="wa-input-label">WhatsApp Handle</label>
            <div className="wa-input-wrapper">
              <span className="wa-input-prefix">@</span>
              <input
                type="text"
                className="wa-input-field"
                placeholder="your_handle"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="wa-input-group">
            <label className="wa-input-label">Passphrase</label>
            <div className="wa-input-wrapper">
              <Lock size={15} style={{ color: 'var(--wa-teal)', marginRight: 6 }} />
              <input
                type="password"
                className="wa-input-field"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={loading}
                required
              />
            </div>
          </div>

          <button type="submit" className="wa-btn-primary" disabled={loading} id="wa-auth-submit">
            {loading ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span>CONNECTING...</span>
              </>
            ) : (
              <>
                <span>AGREE & CONTINUE</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="wa-privacy-note">
          <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4, color: 'var(--wa-teal)' }} />
          Chats are saved to your secure cloud database (Telegram-style persistence).
        </p>
      </div>
    </div>
  );
}
