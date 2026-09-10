import React, { useState, useEffect } from 'react';
import { Wifi, Battery, MessageSquare, Signal } from 'lucide-react';

export default function AndroidStatusBar() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="horizon-status-bar">
      <div className="horizon-status-left">
        <span>{time || '12:00'}</span>
        <span style={{ display: 'flex', alignItems: 'center' }} title="Horizon Chat">
          <MessageSquare size={12} fill="var(--color-accent-amber)" color="var(--color-accent-amber)" />
        </span>
      </div>
      <div className="horizon-status-right">
        <Signal size={13} strokeWidth={2.5} />
        <Wifi size={13} strokeWidth={2.5} />
        <Battery size={15} strokeWidth={2.2} />
      </div>
    </div>
  );
}
