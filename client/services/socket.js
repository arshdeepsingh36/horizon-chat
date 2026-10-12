/**
 * Socket.IO Client Service
 * Release 3.2.3 - Real-Time Socket Connection & Lifecycle
 */

import { io } from 'socket.io-client';
import api from './api.js';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
  }

  connect() {
    const token = api.getToken();
    if (!token) {
      console.warn('[SOCKET] Cannot connect: No auth token found');
      return null;
    }

    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = io(SOCKET_URL, {
      auth: { token },
      query: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log('[SOCKET CONNECTED]', this.socket.id);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[SOCKET CONNECT ERROR]', err.message);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[SOCKET DISCONNECTED]', reason);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    if (!this.socket) {
      return this.connect();
    }
    return this.socket;
  }

  emit(event, data, callback) {
    const s = this.getSocket();
    if (s) {
      s.emit(event, data, callback);
    }
  }

  on(event, handler) {
    const s = this.getSocket();
    if (s) {
      s.on(event, handler);
    }
  }

  off(event, handler) {
    const s = this.getSocket();
    if (s) {
      s.off(event, handler);
    }
  }
}

export const socketService = new SocketService();
export default socketService;
