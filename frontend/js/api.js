/* api.js — thin wrapper around backend endpoints */

const API = {
  BASE: '',   // same origin

  async _fetch(endpoint, options = {}) {
    const token = localStorage.getItem('rpa_token');
    if (token) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    const r = await fetch(API.BASE + endpoint, options);
    if (r.status === 401) {
      localStorage.removeItem('rpa_token');
      if (window.showAuthScreen) window.showAuthScreen();
      throw new Error('Session expired. Please log in.');
    }
    return r;
  },

  async checkAuth() {
    const r = await fetch(`${API.BASE}/api/auth/status`);
    return r.json();
  },
  async login(payload) {
    const r = await fetch(`${API.BASE}/api/auth/login`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Login failed'); }
    return r.json();
  },
  async signup(payload) {
    const r = await fetch(`${API.BASE}/api/auth/signup`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Signup failed'); }
    return r.json();
  },
  async resetPassword(payload) {
    const r = await fetch(`${API.BASE}/api/auth/reset`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Reset failed'); }
    return r.json();
  },
  async getSecurityQuestion(username) {
    const r = await fetch(`${API.BASE}/api/auth/question?username=${encodeURIComponent(username)}`);
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'User not found'); }
    return r.json();
  },
  async logout() {
    const token = localStorage.getItem('rpa_token');
    if (token) await fetch(`${API.BASE}/api/auth/logout?token=${token}`, { method: 'POST' });
    localStorage.removeItem('rpa_token');
    window.location.reload();
  },

  async inspect(url, loginSteps = []) {
    const r = await this._fetch(`/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, login_steps: loginSteps }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || 'Inspect failed');
    }
    return r.json();
  },

  async saveRecipe(recipe) {
    const r = await this._fetch(`/api/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || 'Save failed');
    }
    return r.json();
  },

  async updateRecipe(id, recipe) {
    const r = await this._fetch(`/api/recipes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if (!r.ok) throw new Error('Update failed');
    return r.json();
  },

  async listRecipes() {
    const r = await this._fetch(`/api/recipes`);
    return r.json();
  },

  async getRecipe(id) {
    const r = await this._fetch(`/api/recipes/${id}`);
    return r.json();
  },

  async deleteRecipe(id) {
    await this._fetch(`/api/recipes/${id}`, { method: 'DELETE' });
  },

  async startRun(formData) {
    const r = await this._fetch(`/api/run`, {
      method: 'POST',
      body: formData,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || 'Run failed to start');
    }
    return r.json();
  },

  async submitRunAction(jobId, response) {
    const r = await this._fetch(`/api/run/${jobId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response })
    });
    if (!r.ok) throw new Error('Failed to send action');
    return r.json();
  },

  async listRuns() {
    const r = await this._fetch(`/api/run`);
    return r.json();
  },

  async getRunStatus(jobId) {
    const r = await this._fetch(`/api/run/${jobId}`);
    return r.json();
  },

  async getLogs(jobId, since = 0) {
    const r = await this._fetch(`/api/run/${jobId}/logs?since=${since}`);
    return r.json();
  },

  async deleteRun(jobId) {
    await this._fetch(`/api/run/${jobId}`, { method: 'DELETE' });
  },

  openLogSocket(jobId, startLine, onLine, onDone, onAction) {
    const token = localStorage.getItem('rpa_token') || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/run/${jobId}/logs?start=${startLine}&token=${token}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'log')  onLine(msg.line);
      if (msg.type === 'done') onDone(msg.status, msg.summary);
      if (msg.type === 'error') onDone('error', { error: msg.msg });
      if (msg.type === 'action') onAction(msg.action);
    };
    ws.onerror = () => onDone('error', { error: 'WebSocket error' });
    return ws;
  },

  async listUploads() {
    const r = await this._fetch(`/api/uploads`);
    return r.json();
  },

  async deleteUpload(filename) {
    await this._fetch(`/api/uploads/${filename}`, { method: 'DELETE' });
  }
};