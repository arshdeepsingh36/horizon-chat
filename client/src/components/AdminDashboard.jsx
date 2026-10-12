import React, { useState, useEffect } from 'react';
import {
  Shield,
  ArrowLeft,
  Users,
  MessageSquare,
  Activity,
  Trash2,
  KeyRound,
  CheckCircle,
  XCircle,
  RefreshCw,
  Search,
  AlertTriangle,
  Loader2,
  Clock
} from 'lucide-react';

export default function AdminDashboard({ user, token, apiBaseUrl, onBack }) {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalMessages: 0,
    activeConnections: 0
  });
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Password reset modal
  const [resetUserTarget, setResetUserTarget] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // Purge modal
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeHours, setPurgeHours] = useState(24);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [statsRes, usersRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/admin/stats`, { headers }),
        fetch(`${apiBaseUrl}/api/admin/users`, { headers })
      ]);

      if (!statsRes.ok || !usersRes.ok) {
        throw new Error('Failed to fetch administrator data. Access denied or server error.');
      }

      const statsData = await statsRes.json();
      const usersData = await usersRes.json();

      setStats(statsData);
      setUsers(Array.isArray(usersData) ? usersData : []);
    } catch (err) {
      console.error('[ADMIN FETCH ERROR]', err);
      setError(err.message || 'Error loading dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleUserStatus = async (targetUser) => {
    setActionLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const nextStatus = !targetUser.isActive;
      const res = await fetch(`${apiBaseUrl}/api/admin/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user status');

      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, isActive: nextStatus } : u))
      );
      setSuccessMsg(`User @${targetUser.username} is now ${nextStatus ? 'ACTIVE' : 'DEACTIVATED'}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdminResetPassword = async (e) => {
    e.preventDefault();
    if (!resetUserTarget || newPasswordInput.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users/${resetUserTarget.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword: newPasswordInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      setSuccessMsg(`Password reset successfully for @${resetUserTarget.username}.`);
      setResetUserTarget(null);
      setNewPasswordInput('');
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerPurge = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/purge-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ hours: Number(purgeHours) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purge failed');

      setSuccessMsg(data.message || `Purged ${data.deletedCount} messages.`);
      setShowPurgeModal(false);
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    return (
      (u.username || '').toLowerCase().includes(q) ||
      (u.displayName || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="horizon-chat-list-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0B1120' }}>
      {/* Top Header */}
      <div className="horizon-toolbar" style={{ background: '#162238', borderBottom: '1px solid rgba(245, 158, 11, 0.25)' }}>
        <button
          className="horizon-dock-clip"
          onClick={onBack}
          title="Back to Chats"
          style={{ marginRight: '8px' }}
        >
          <ArrowLeft size={19} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <Shield size={20} color="#F59E0B" />
          <span className="horizon-toolbar-title" style={{ fontSize: '17px' }}>Admin Dashboard</span>
        </div>
        <button
          className="horizon-dock-clip"
          onClick={fetchData}
          disabled={loading}
          title="Refresh Stats"
        >
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Main Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && (
          <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #EF4444', color: '#FCA5A5', fontSize: '13px' }}>
            {error}
          </div>
        )}
        {successMsg && (
          <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', color: '#6EE7B7', fontSize: '13px' }}>
            {successMsg}
          </div>
        )}

        {/* System Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <Users size={18} color="#F59E0B" style={{ margin: '0 auto 4px' }} />
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F8FAFC' }}>{stats.totalUsers}</div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Total Users</div>
          </div>
          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <Activity size={18} color="#10B981" style={{ margin: '0 auto 4px' }} />
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F8FAFC' }}>{stats.activeConnections}</div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Active Sockets</div>
          </div>
          <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
            <MessageSquare size={18} color="#38BDF8" style={{ margin: '0 auto 4px' }} />
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#F8FAFC' }}>{stats.totalMessages}</div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Total Messages</div>
          </div>
        </div>

        {/* Media & Chat Oversight / Purge Trigger Card */}
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '14px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={16} color="#F59E0B" />
              <span>24h Post-Seen Ephemeral Purge</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>
              Automated worker runs every 60s. Trigger manual purge of DB records and Cloudflare R2 files.
            </div>
          </div>
          <button
            onClick={() => setShowPurgeModal(true)}
            style={{
              background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Trash2 size={14} />
            <span>Purge Now</span>
          </button>
        </div>

        {/* User Management Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
              User Management ({filteredUsers.length})
            </div>
          </div>

          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94A3B8' }} />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: '#1E293B',
                color: '#F8FAFC',
                fontSize: '13px',
                outline: 'none'
              }}
            />
          </div>

          {/* User List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredUsers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94A3B8', fontSize: '13px' }}>
                No users found.
              </div>
            ) : (
              filteredUsers.map((u) => (
                <div
                  key={u.id}
                  style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        background: u.isAdmin ? 'linear-gradient(135deg, #F59E0B, #EA580C)' : '#334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: '#fff',
                        flexShrink: 0
                      }}
                    >
                      {(u.username || 'U').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          @{u.username}
                        </span>
                        {u.isAdmin && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(245, 158, 11, 0.2)', color: '#F59E0B', borderRadius: '4px', fontWeight: 700 }}>
                            ADMIN
                          </span>
                        )}
                        <span style={{ fontSize: '10px', padding: '1px 6px', background: u.isActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', color: u.isActive ? '#10B981' : '#EF4444', borderRadius: '4px', fontWeight: 600 }}>
                          {u.isActive ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                        Messages: {u.messageCount || 0} • {u.online ? '🟢 Online' : '⚪ Offline'}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setResetUserTarget(u)}
                      title="Reset User Password"
                      style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        color: '#F59E0B',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <KeyRound size={13} />
                      <span>Reset</span>
                    </button>

                    <button
                      onClick={() => handleToggleUserStatus(u)}
                      disabled={actionLoading}
                      title={u.isActive ? 'Deactivate User' : 'Activate User'}
                      style={{
                        background: u.isActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        border: `1px solid ${u.isActive ? '#EF4444' : '#10B981'}`,
                        color: u.isActive ? '#EF4444' : '#10B981',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px'
                      }}
                    >
                      {u.isActive ? <XCircle size={13} /> : <CheckCircle size={13} />}
                      <span>{u.isActive ? 'Deactivate' : 'Activate'}</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Password Reset Modal */}
      {resetUserTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#1E293B', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)', padding: '20px', width: '100%', maxWidth: '360px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#F8FAFC', marginBottom: '8px' }}>
              Reset Password for @{resetUserTarget.username}
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '14px' }}>
              Enter a new secure password (minimum 6 characters).
            </div>
            <form onSubmit={handleAdminResetPassword}>
              <input
                type="password"
                placeholder="New Password"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0F172A',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  marginBottom: '16px',
                  outline: 'none'
                }}
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setResetUserTarget(null);
                    setNewPasswordInput('');
                  }}
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#94A3B8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || newPasswordInput.length < 6}
                  style={{ background: '#F59E0B', border: 'none', color: '#000', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}
                >
                  {actionLoading ? 'Saving...' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Purge Modal */}
      {showPurgeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#1E293B', borderRadius: '14px', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '20px', width: '100%', maxWidth: '380px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#EF4444', marginBottom: '8px' }}>
              <AlertTriangle size={20} />
              <div style={{ fontSize: '16px', fontWeight: 700 }}>Trigger Manual Message Purge</div>
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '14px' }}>
              This will permanently delete all messages seen older than the specified hours, purge associated attachments in Cloudflare R2, and drop them from active client feeds.
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#F8FAFC', display: 'block', marginBottom: '6px' }}>
                Age threshold (Hours post-seen):
              </label>
              <input
                type="number"
                min="1"
                max="720"
                value={purgeHours}
                onChange={(e) => setPurgeHours(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0F172A',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#94A3B8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTriggerPurge}
                disabled={actionLoading}
                style={{ background: '#EF4444', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}
              >
                {actionLoading ? 'Purging...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
