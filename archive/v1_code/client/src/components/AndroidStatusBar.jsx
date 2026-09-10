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
    <div className="android-status-bar">
      <div className="status-left">
        <span>{time || '12:00'}</span>
        <span className="wa-status-icon" title="WhatsApp">
          <MessageSquare size={12} fill="#00A884" color="#00A884" />
        </span>
      </div>
      <div className="status-right">
        <Signal size={13} strokeWidth={2.5} />
        <Wifi size={13} strokeWidth={2.5} />
        <Battery size={15} strokeWidth={2.2} />
      </div>
    </div>
  );
}
