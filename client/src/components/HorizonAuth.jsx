import React, { useState } from 'react';
import { Lightbulb, ArrowRight, Loader2, KeyRound, CheckCircle2 } from 'lucide-react';

export default function HorizonAuth({ onLogin, apiBaseUrl }) {
  // mode: 'login' | 'register' | 'forgot'
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [connectingColdStart, setConnectingColdStart] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser) {
      setError('Please enter a username.');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUser)) {
      setError('Username must be 3–32 alphanumeric characters.');
      return;
    }

    if (mode === 'forgot') {
      if (!generatedCode) {
        // Step 1: Request Reset Code
        setLoading(true);
        try {
          const res = await fetch(`${apiBaseUrl}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: cleanUser })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to request reset code');

          if (data.resetToken) {
            setGeneratedCode(data.resetToken);
            setResetToken(data.resetToken);
            setSuccessMsg(`Reset code generated: ${data.resetToken}. Enter your new password below.`);
          } else {
            setGeneratedCode('SENT');
            setSuccessMsg('If an account exists, a reset code was generated. Enter it below.');
          }
        } catch (err) {
          setError(err.message || 'Error processing request');
        } finally {
          setLoading(false);
        }
        return;
      } else {
        // Step 2: Set New Password
        if (!resetToken.trim()) {
          setError('Please enter the reset code.');
          return;
        }
        if (newPassword.length < 6) {
          setError('New password must be at least 6 characters.');
          return;
        }
        setLoading(true);
        try {
          const res = await fetch(`${apiBaseUrl}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: cleanUser,
              token: resetToken.trim(),
              newPassword
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to reset password');

          setSuccessMsg('Password has been reset successfully! You can now sign in.');
          setMode('login');
          setPassword('');
          setGeneratedCode('');
          setResetToken('');
          setNewPassword('');
        } catch (err) {
          setError(err.message || 'Error resetting password');
        } finally {
          setLoading(false);
        }
        return;
      }
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
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
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
          {mode === 'register' ? 'Create Account' : (mode === 'forgot' ? 'Reset Password' : 'Welcome Back')}
        </h1>
        <p className="horizon-auth-subtitle">
          {mode === 'register'
            ? 'Join Horizon Chat in seconds'
            : (mode === 'forgot'
              ? 'Recover your account with a secure reset code'
              : 'Sign in to access your cloud-synced chats')}
        </p>
      </div>

      {/* Form (activity_login.xml) */}
      <form onSubmit={handleSubmit} className="horizon-auth-form" noValidate>
        {error && <div className="horizon-error-banner">{error}</div>}
        {successMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10B981',
              color: '#6EE7B7',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        <input
          id="etUsername"
          type="text"
          className="horizon-input-field"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          autoCapitalize="none"
          autoCorrect="off"
          disabled={loading || (mode === 'forgot' && !!generatedCode)}
          required
        />

        {mode !== 'forgot' ? (
          <>
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
            {mode === 'login' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-6px', marginBottom: '4px' }}>
                <button
                  type="button"
                  id="btnForgotPassword"
                  onClick={() => {
                    setMode('forgot');
                    setError('');
                    setSuccessMsg('');
                    setGeneratedCode('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#F59E0B',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 0'
                  }}
                >
                  Forgot Password?
                </button>
              </div>
            )}
          </>
        ) : (
          generatedCode && (
            <>
              <input
                id="etResetToken"
                type="text"
                className="horizon-input-field"
                placeholder="6-Digit Reset Code"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                disabled={loading}
                required
              />
              <input
                id="etNewPassword"
                type="password"
                className="horizon-input-field"
                placeholder="New Password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                required
              />
            </>
          )
        )}

        <button
          type="submit"
          className="horizon-btn-primary"
          disabled={loading}
          id="btnLogin"
        >
          {loading ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              <span>PLEASE WAIT...</span>
            </>
          ) : mode === 'forgot' ? (
            <>
              <span>{generatedCode ? 'Update Password' : 'Get Reset Code'}</span>
              <KeyRound size={18} />
            </>
          ) : (
            <>
              <span>{mode === 'register' ? 'Create Account' : 'Sign In'}</span>
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>

      {/* Bottom Inline Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
        {mode === 'forgot' ? (
          <button
            type="button"
            className="horizon-toggle-link"
            onClick={() => {
              setMode('login');
              setError('');
              setSuccessMsg('');
              setGeneratedCode('');
            }}
          >
            Back to Sign In
          </button>
        ) : (
          <button
            type="button"
            id="btnCreateAccount"
            className="horizon-toggle-link"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setError('');
              setSuccessMsg('');
            }}
          >
            {mode === 'register' ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
          </button>
        )}
      </div>
    </div>
  );
}
