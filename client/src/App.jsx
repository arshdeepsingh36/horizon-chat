/**
 * Main Application Root
 * Release 3.2.3 - Unified Auth & Chat Context Providers with Role-Guarded Navigator
 */

import React from 'react';
import { AuthProvider } from '../context/AuthContext.jsx';
import { ChatProvider } from '../context/ChatContext.jsx';
import AppNavigator from '../navigation/AppNavigator.jsx';
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <AppNavigator />
      </ChatProvider>
    </AuthProvider>
  );
}
