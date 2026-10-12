/**
 * Auth Context
 * Release 3.2.3 - User Identity, Roles, and Direct Password Reset Workflow
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api.js';
import socketService from '../services/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(api.getToken());
  const [loading, setLoading] = useState(true);

  // Initialize identity from saved token
  useEffect(() => {
    async function loadCurrentUser() {
      const storedToken = api.getToken();
      if (!storedToken) {
        setLoading(false);
        return;
      }

      try {
        const res = await api.get('/api/auth/me');
        if (res.success && res.user) {
          setUser(res.user);
          setToken(storedToken);
          socketService.connect();
        } else {
          api.setToken(null);
          setUser(null);
          setToken(null);
        }
      } catch (err) {
        console.warn('[AUTH CONTEXT] Failed to restore session:', err.message);
        api.setToken(null);
        setUser(null);
        setToken(null);
      } finally {
        setLoading(false);
      }
    }

    loadCurrentUser();
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password });
    if (res.success && res.token && res.user) {
      api.setToken(res.token);
      setToken(res.token);
      setUser(res.user);
      socketService.connect();
      return res.user;
    }
    throw new Error(res.error || 'Login failed');
  };

  const register = async (username, password) => {
    const res = await api.post('/api/auth/register', { username, password });
    if (res.success && res.token && res.user) {
      api.setToken(res.token);
      setToken(res.token);
      setUser(res.user);
      socketService.connect();
      return res.user;
    }
    throw new Error(res.error || 'Registration failed');
  };

  /**
   * DIRECT UNVERIFIED PASSWORD RESET:
   * Accepts username and newPassword. No verification code required.
   */
  const directResetPassword = async (username, newPassword) => {
    const res = await api.post('/api/auth/reset-password', { username, newPassword });
    if (res.success) {
      return res.message;
    }
    throw new Error(res.error || 'Password reset failed');
  };

  const logout = () => {
    api.setToken(null);
    socketService.disconnect();
    setUser(null);
    setToken(null);
  };

  const value = {
    user,
    token,
    loading,
    isAuthenticated: Boolean(user && token),
    isAdmin: Boolean(user && user.is_admin),
    login,
    register,
    directResetPassword,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
