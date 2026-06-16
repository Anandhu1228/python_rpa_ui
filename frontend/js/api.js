/* api.js — thin wrapper around backend endpoints */

const API = {
  BASE: '',   // same origin

  async inspect(url, loginSteps = []) {
    const r = await fetch(`${API.BASE}/api/inspect`, {
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
    const r = await fetch(`${API.BASE}/api/recipes`, {
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
    const r = await fetch(`${API.BASE}/api/recipes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if (!r.ok) throw new Error('Update failed');
    return r.json();
  },

  async listRecipes() {
    const r = await fetch(`${API.BASE}/api/recipes`);
    return r.json();
  },

  async getRecipe(id) {
    const r = await fetch(`${API.BASE}/api/recipes/${id}`);
    return r.json();
  },

  async deleteRecipe(id) {
    await fetch(`${API.BASE}/api/recipes/${id}`, { method: 'DELETE' });
  },

  async startRun(formData) {
    const r = await fetch(`${API.BASE}/api/run`, {
      method: 'POST',
      body: formData,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || 'Run failed to start');
    }
    return r.json();
  },

  async getRunStatus(jobId) {
    const r = await fetch(`${API.BASE}/api/run/${jobId}`);
    return r.json();
  },

  async getLogs(jobId, since = 0) {
    const r = await fetch(`${API.BASE}/api/run/${jobId}/logs?since=${since}`);
    return r.json();
  },

  openLogSocket(jobId, onLine, onDone) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/run/${jobId}/logs`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'log')  onLine(msg.line);
      if (msg.type === 'done') onDone(msg.status, msg.summary);
      if (msg.type === 'error') onDone('error', { error: msg.msg });
    };
    ws.onerror = () => onDone('error', { error: 'WebSocket error' });
    return ws;
  },

  async listUploads() {
    const r = await fetch(`${API.BASE}/api/uploads`);
    return r.json();
  },

  async deleteUpload(filename) {
    await fetch(`${API.BASE}/api/uploads/${filename}`, { method: 'DELETE' });
  }
};