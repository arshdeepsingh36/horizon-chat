/**
 * AppNavigator Component
 * Release 3.2.3 - Navigation Container with Role-Guarded View Switching
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import LoginScreen from '../screens/LoginScreen.jsx';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen.jsx';
import ChatScreen from '../screens/ChatScreen.jsx';
import AdminDashboardScreen from '../screens/AdminDashboardScreen.jsx';

export function AppNavigator() {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const [currentRoute, setCurrentRoute] = useState('login'); // 'login' | 'forgot-password' | 'chat' | 'admin'

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0A0F1D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#38BDF8',
          fontSize: '15px',
          fontWeight: 500,
          fontFamily: 'Inter, system-ui, sans-serif'
        }}
      >
        Initializing Horizon Chat...
      </div>
    );
  }

  // Unauthenticated Stack
  if (!isAuthenticated) {
    if (currentRoute === 'forgot-password') {
      return <ForgotPasswordScreen onNavigate={setCurrentRoute} />;
    }
    return <LoginScreen onNavigate={setCurrentRoute} />;
  }

  // Authenticated Stack
  if (currentRoute === 'admin' && isAdmin) {
    return <AdminDashboardScreen onNavigate={setCurrentRoute} />;
  }

  return <ChatScreen onNavigate={setCurrentRoute} />;
}

export default AppNavigator;
