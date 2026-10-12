/**
 * AdminDashboardScreen Component
 * Release 3.2.3 - Superuser System Stats & User Management Dashboard
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Shield, Users, MessageSquare, Activity, ArrowLeft, RefreshCw, KeyRound, CheckCircle, XCircle } from 'lucide-react';

export function AdminDashboardScreen({ onNavigate }) {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Password reset modal state
  const [resetModalUser, setResetModalUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [modalFeedback, setModalFeedback] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/admin/stats');
      if (res.success) {
        setStats(res.stats);
        setUsers(res.users);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch admin stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchDashboardData();
    }
  }, [isAdmin, fetchDashboardData]);

  // Toggle active/deactive status
  const handleToggleStatus = async (targetUser) => {
    const nextStatus = !targetUser.is_active;
    try {
      const res = await api.patch(`/api/admin/users/${targetUser.id}/status`, { isActive: nextStatus });
      if (res.success) {
        setUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, is_active: nextStatus } : u));
      }
    } catch (err) {
      alert(err.message || 'Failed to update user status');
    }
  };

  // Forced admin password reset
  const handleAdminResetPassword = async (e) => {
    e.preventDefault();
    if (!resetModalUser || !newPassword) return;

    setActionLoading(true);
    setModalFeedback('');
    try {
      const res = await api.post('/api/admin/users/reset-password', {
        username: resetModalUser.username,
        newPassword
      });
      if (res.success) {
        setModalFeedback('Password updated successfully!');
        setTimeout(() => {
          setResetModalUser(null);
          setNewPassword('');
          setModalFeedback('');
        }, 1200);
      }
    } catch (err) {
      setModalFeedback(err.message || 'Reset failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#F87171' }}>
        Access Denied: Superuser access required.
      </div>
    );
  }

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0A0F1D',
        color: '#F8FAFC',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        padding: '24px 32px'
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            style={{
              background: '#1E293B',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} /> Back to Chats
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={24} color="#F59E0B" />
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Superuser Admin Dashboard</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchDashboardData}
          disabled={loading}
          style={{
            background: '#0284C7',
            border: 'none',
            borderRadius: '8px',
            color: '#FFFFFF',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #EF4444', color: '#FCA5A5', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridToTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ ...iconContainerStyle, backgroundColor: '#0284C7' }}>
              <Users size={22} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>Total Users</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#38BDF8' }}>
                {stats?.totalUsers ?? '...'}
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ ...iconContainerStyle, backgroundColor: '#10B981' }}>
              <MessageSquare size={22} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>Total Messages</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#34D399' }}>
                {stats?.totalMessages ?? '...'}
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ ...iconContainerStyle, backgroundColor: '#F59E0B' }}>
              <Activity size={22} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>Live Socket Connections</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#FBBF24' }}>
                {stats?.activeSockets ?? '...'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Management Section */}
      <div style={{ backgroundColor: '#131C2E', border: '1px solid #1E293B', borderRadius: '14px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>User Management</h2>
          <input
            type="text"
            placeholder="Search username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              backgroundColor: '#0F172A',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#F8FAFC',
              fontSize: '13px',
              width: '220px'
            }}
          />
        </div>

        {/* Users Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1E293B', color: '#94A3B8' }}>
                <th style={{ padding: '10px 12px' }}>User ID</th>
                <th style={{ padding: '10px 12px' }}>Username</th>
                <th style={{ padding: '10px 12px' }}>Role</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Last Seen</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #1A2438' }}>
                  <td style={{ padding: '12px' }}>#{u.id}</td>
                  <td style={{ padding: '12px', fontWeight: 600, color: '#F1F5F9' }}>@{u.username}</td>
                  <td style={{ padding: '12px' }}>
                    <span
                      style={{
                        backgroundColor: u.is_admin ? 'rgba(245, 158, 11, 0.2)' : 'rgba(100, 116, 139, 0.2)',
                        color: u.is_admin ? '#FBBF24' : '#94A3B8',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}
                    >
                      {u.is_admin ? 'SUPERUSER' : 'USER'}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span
                      style={{
                        backgroundColor: u.is_active ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: u.is_active ? '#34D399' : '#F87171',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {u.is_active ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: '#94A3B8' }}>
                    {u.last_seen ? new Date(u.last_seen).toLocaleString() : 'Never'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setResetModalUser(u);
                          setNewPassword('');
                          setModalFeedback('');
                        }}
                        style={{
                          background: 'none',
                          border: '1px solid #F59E0B',
                          color: '#FBBF24',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <KeyRound size={13} /> Reset Pwd
                      </button>

                      {Number(u.id) !== Number(user?.id) && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          style={{
                            background: u.is_active ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            border: `1px solid ${u.is_active ? '#EF4444' : '#10B981'}`,
                            color: u.is_active ? '#F87171' : '#34D399',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admin Reset Password Modal */}
      {resetModalUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setResetModalUser(null)}
        >
          <div
            style={{
              backgroundColor: '#131C2E',
              border: '1px solid #334155',
              borderRadius: '14px',
              padding: '24px',
              width: '100%',
              maxWidth: '380px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '17px' }}>
              Reset Password for @{resetModalUser.username}
            </h3>

            {modalFeedback && (
              <div style={{ color: '#38BDF8', fontSize: '13px', marginBottom: '12px' }}>
                {modalFeedback}
              </div>
            )}

            <form onSubmit={handleAdminResetPassword}>
              <input
                type="password"
                required
                placeholder="Enter new password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#F8FAFC',
                  fontSize: '13px',
                  marginBottom: '16px',
                  boxSizing: 'border-box'
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  style={{
                    background: '#1E293B',
                    border: '1px solid #334155',
                    color: '#94A3B8',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{
                    background: '#F59E0B',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '8px 14px',
                    fontWeight: 600,
                    cursor: actionLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {actionLoading ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  backgroundColor: '#131C2E',
  border: '1px solid #1E293B',
  borderRadius: '14px',
  padding: '18px 20px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
};

const iconContainerStyle = {
  width: '46px',
  height: '46px',
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

export default AdminDashboardScreen;
