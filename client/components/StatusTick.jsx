/**
 * StatusTick Component
 * Release 3.2.3 - Real-Time Message Receipt Indicators
 * Sent: Single gray tick (✓)
 * Delivered: Double gray tick (✓✓)
 * Seen: Double blue tick (✓✓ in #007AFF)
 */

import React from 'react';

export const StatusTick = React.memo(function StatusTick({ status }) {
  const isSeen = status === 'seen';
  const isDelivered = status === 'delivered';

  // Sent -> Single tick
  if (status === 'sent') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: '#9CA3AF',
          fontSize: '12px',
          lineHeight: 1,
          marginLeft: '4px'
        }}
        title="Sent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  // Delivered -> Double gray tick
  if (isDelivered) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: '#9CA3AF',
          fontSize: '12px',
          lineHeight: 1,
          marginLeft: '4px'
        }}
        title="Delivered"
      >
        <svg width="16" height="14" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 6 7 17 2 12" />
          <polyline points="26 6 15 17 12 14" />
        </svg>
      </span>
    );
  }

  // Seen -> Double blue tick (#007AFF)
  if (isSeen) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: '#007AFF',
          fontSize: '12px',
          lineHeight: 1,
          marginLeft: '4px'
        }}
        title="Seen"
      >
        <svg width="16" height="14" viewBox="0 0 28 24" fill="none" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 6 7 17 2 12" />
          <polyline points="26 6 15 17 12 14" />
        </svg>
      </span>
    );
  }

  return null;
});

export default StatusTick;
