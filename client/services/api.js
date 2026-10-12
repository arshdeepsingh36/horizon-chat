/**
 * API Service Client
 * Release 3.2.3 - Request Interceptors, Token Injection & Error Handling
 */

const BASE_URL = import.meta.env.VITE_API_URL || '';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('horizon_auth_token') || null;
    this.requestInterceptors = [];
    this.responseInterceptors = [];
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('horizon_auth_token', token);
    } else {
      localStorage.removeItem('horizon_auth_token');
    }
  }

  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('horizon_auth_token');
    }
    return this.token;
  }

  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(data.error || `HTTP error ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      console.error(`[API ERROR] [${options.method || 'GET'} ${endpoint}]`, err.message);
      throw err;
    }
  }

  get(endpoint, headers = {}) {
    return this.request(endpoint, { method: 'GET', headers });
  }

  post(endpoint, body = {}, headers = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      headers
    });
  }

  patch(endpoint, body = {}, headers = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers
    });
  }

  delete(endpoint, headers = {}) {
    return this.request(endpoint, { method: 'DELETE', headers });
  }
}

export const api = new ApiService();
export default api;
