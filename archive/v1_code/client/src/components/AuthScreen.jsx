import React, { useState } from 'react';
import { Shield, Lock, AlertTriangle, ArrowRight, UserPlus, LogIn, Loader2 } from 'lucide-react';

export default function AuthScreen({ onAuthenticated, apiBaseUrl }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isWakingUp, setIsWakingUp] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUser = username.trim();
    if (!cleanUser) {
      setError('Please enter a username.');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUser)) {
      setError('Username must be 3–32 characters (letters, numbers, underscores only).');
      return;
    }

    if (password.length < 8) {
      setError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError('Passphrases do not match.');
      return;
    }

    setLoading(true);
    // Cold start detector: if request takes > 1.5s
    const coldTimer = setTimeout(() => {
      setIsWakingUp(true);
    }, 1500);

    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password })
      });

      clearTimeout(coldTimer);
      setIsWakingUp(false);

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed. Please check your credentials.');
        setLoading(false);
        return;
      }

      // Memory-only authentication: hand token to parent App state
      onAuthenticated({
        token: data.token,
        user: data.user
      });
    } catch (err) {
      clearTimeout(coldTimer);
      setIsWakingUp(false);
      console.error('[Auth error]', err);
      setError('Unable to reach server. Please ensure the backend is running.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        {/* Header & Logo */}
        <div className="auth-header">
          <div className="auth-logo">
            <Shield size={28} strokeWidth={2.2} />
          </div>
          <h1 className="display-lg auth-title">EPHEMERAL CHAT</h1>
          <p className="auth-subtitle">Zero-Footprint In-Memory Messaging</p>
        </div>

        {/* Cold Start Indicator */}
        {isWakingUp && (
          <div className="cold-start-banner" role="status" aria-live="polite">
            <span>Server instance is spinning up (~30s on cold start). Please wait...</span>
            <div className="cold-start-progress"></div>
          </div>
        )}

        {/* Segmented Switcher */}
        <div className="tab-switcher" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={`tab-button ${!isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(false); setError(''); }}
          >
            <LogIn size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={`tab-button ${isRegister ? 'active' : ''}`}
            onClick={() => { setIsRegister(true); setError(''); }}
          >
            <UserPlus size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            Create Identity
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="auth-error" role="alert">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              Username Handle
            </label>
            <div className="input-container">
              <span className="input-prefix">@</span>
              <input
                id="username"
                type="text"
                className="text-input has-prefix"
                placeholder="alex_dev"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Passphrase
            </label>
            <input
              id="password"
              type="password"
              className="text-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              required
              disabled={loading}
            />
          </div>

          {isRegister && (
            <div className="form-group animate-fade-in">
              <label className="form-label" htmlFor="confirmPassword">
                Confirm Passphrase
              </label>
              <input
                id="confirmPassword"
                type="password"
                className="text-input"
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                required
                disabled={loading}
              />
            </div>
          )}

          <button
            type="submit"
            className="primary-cta"
            disabled={loading}
            id="auth-submit-btn"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                <span>CONNECTING...</span>
              </>
            ) : (
              <>
                <span>ENTER SECURE ROOM</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Ephemeral Disclaimer Card */}
        <div className="disclaimer-card">
          <AlertTriangle size={18} className="disclaimer-icon" />
          <p className="disclaimer-text">
            <strong>Zero Persistence Notice:</strong> Messages are held in RAM only. Closing this tab or refreshing permanently wipes all records. No email or phone is stored—forgotten passphrases cannot be recovered.
          </p>
        </div>
      </div>
    </div>
  );
}
