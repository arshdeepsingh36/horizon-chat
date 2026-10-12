/**
 * useSocket Hook
 * Release 3.2.3 - Socket Connection and Event Lifecycle Management
 */

import { useEffect, useRef } from 'react';
import socketService from '../services/socket.js';

export function useSocket(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!event || !handler) return;

    const eventListener = (...args) => {
      if (handlerRef.current) {
        handlerRef.current(...args);
      }
    };

    socketService.on(event, eventListener);

    return () => {
      socketService.off(event, eventListener);
    };
  }, [event]);
}

export default useSocket;
