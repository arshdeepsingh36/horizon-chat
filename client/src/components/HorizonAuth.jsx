import React, { useState } from 'react';
import { Lightbulb, ArrowRight, Loader2 } from 'lucide-react';

export default function HorizonAuth({ onLogin, apiBaseUrl }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connectingColdStart, setConnectingColdStart] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser) {
      setError('Please enter a username.');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUser)) {
      setError('Username must be 3–32 alphanumeric characters.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    const coldTimer = setTimeout(() => {
      setConnectingColdStart(true);
    }, 1500);

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password })
      });

      clearTimeout(coldTimer);
      setConnectingColdStart(false);

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed');
        setLoading(false);
        return;
      }

      localStorage.setItem('horizon_token', data.token);
      localStorage.setItem('horizon_user', JSON.stringify(data.user));

      onLogin({ token: data.token, user: data.user });
    } catch (err) {
      clearTimeout(coldTimer);
      setConnectingColdStart(false);
      console.error(err);
      setError('Unable to reach server. Please check your network connection.');
      setLoading(false);
    }
  };

  return (
    <div className="horizon-auth-view">
      {/* Cold Start Non-blocking Top Banner */}
      {connectingColdStart && (
        <div className="horizon-cold-banner" role="status">
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Connecting to server instance (~30s on cold start)...</span>
        </div>
      )}

      {/* Top Sunset Bulb Vector Icon */}
      <div className="horizon-auth-top">
        <div className="sunset-bulb-icon">
          <Lightbulb size={34} strokeWidth={2.4} />
        </div>
        <h1 className="horizon-auth-title">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h1>
        <p className="horizon-auth-subtitle">
          {isRegister ? 'Join Horizon Chat in seconds' : 'Sign in to access your cloud-synced chats'}
        </p>
      </div>

      {/* Form (activity_login.xml) */}
      <form onSubmit={handleSubmit} className="horizon-auth-form" noValidate>
        {error && <div className="horizon-error-banner">{error}</div>}

        <input
          id="etUsername"
          type="text"
          className="horizon-input-field"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={loading}
          required
        />

        <input
          id="etPassword"
          type="password"
          className="horizon-input-field"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={loading}
          required
        />

        <button
          type="submit"
          className="horizon-btn-primary"
          disabled={loading}
          id="btnLogin"
        >
          {loading ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              <span>SIGNING IN...</span>
            </>
          ) : (
            <>
              <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>

      {/* Bottom Inline Toggle */}
      <button
        type="button"
        id="btnCreateAccount"
        className="horizon-toggle-link"
        onClick={() => {
          setIsRegister(!isRegister);
          setError('');
        }}
      >
        {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
      </button>
    </div>
  );
}
