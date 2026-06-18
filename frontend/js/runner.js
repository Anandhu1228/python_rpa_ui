/* runner.js — Run tab + Logs tab */

let selectedFile  = null;
let currentJobId  = null;
let currentWS     = null;
let logBuffer     = [];      // raw lines (dev view source of truth)
let userEvents    = [];      // structured {_t, ...} events (user view source of truth)
let runStats      = { success: 0, failed: 0, total: 0 };
let allRunsData   = [];
let logViewMode   = 'user';  // 'user' | 'dev'  — current active pane

// ── File handling ───────────────────────────────────────────

function onFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('file-drop-name').textContent = file.name;
  document.getElementById('file-drop').style.borderColor = 'var(--accent)';
  parseAndPreviewFile(file);
}

document.addEventListener('DOMContentLoaded', async () => {
  const drop = document.getElementById('file-drop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.background = 'var(--accent-dim)'; });
    drop.addEventListener('dragleave', () => { drop.style.background = ''; });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.style.background = '';
      const file = e.dataTransfer.files[0];
      if (file) {
        selectedFile = file;
        document.getElementById('file-drop-name').textContent = file.name;
        parseAndPreviewFile(file);
      }
    });
  }

  const savedJobId = sessionStorage.getItem('currentJobId');
  if (savedJobId) {
    viewPastLog(savedJobId, "Restoring Session...");
  }
});

async function parseAndPreviewFile(file) {
  const card  = document.getElementById('csv-preview-card');
  const table = document.getElementById('csv-preview-table');
  const chips = document.getElementById('csv-columns-list');
  const count = document.getElementById('csv-row-count');

  card.classList.remove('hidden');
  table.innerHTML = '<div class="hint">Parsing…</div>';

  try {
    let rows, headers;

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      if (window.XLSX) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        headers = data[0] || [];
        rows    = data.slice(1, 6);
      } else {
        table.innerHTML = '<div class="hint">Excel preview not available in browser (will work when running). Column list only.</div>';
        return;
      }
    } else {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      headers = parseCSVLine(lines[0] || '');
      rows    = lines.slice(1, 6).map(parseCSVLine);
    }

    count.textContent = `${rows.length}+ rows`;
    const displayHeaders = headers.slice(0, 8);
    const extra = headers.length > 8 ? ` (+${headers.length - 8} more)` : '';
    table.innerHTML = `
      <table class="csv-table">
        <thead>
          <tr>${displayHeaders.map(h => `<th>${esc(h)}</th>`).join('')}${extra ? `<th style="color:var(--text3)">${extra}</th>` : ''}</tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>${displayHeaders.map((_, i) => `<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;
    chips.innerHTML = headers.map(h => `<span class="col-chip">${esc(h)}</span>`).join('');
  } catch (e) {
    table.innerHTML = `<div class="hint" style="color:var(--red)">Parse error: ${e.message}</div>`;
  }
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

// ── Start Run ───────────────────────────────────────────────

async function startRun() {
  const recipeId = document.getElementById('run-recipe-select').value;
  if (!recipeId) { alert('Please select a recipe.'); return; }
  if (!selectedFile) { alert('Please upload a data file.'); return; }

  const startRow = parseInt(document.getElementById('run-start').value) || 1;
  const endRowEl = document.getElementById('run-end').value;
  const endRow   = endRowEl ? parseInt(endRowEl) : '';

  const formData = new FormData();
  formData.append('recipe_id', recipeId);
  formData.append('file', selectedFile);
  formData.append('start_row', startRow);
  if (endRow) formData.append('end_row', endRow);

  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  try {
    const result = await API.startRun(formData);
    currentJobId = result.job_id;
    sessionStorage.setItem('currentJobId', currentJobId);

    logBuffer  = [];
    userEvents = [];
    runStats   = { success: 0, failed: 0, total: 0 };

    switchTab('logs');
    document.getElementById('logs-recipe-grid').classList.add('hidden');
    document.getElementById('logs-runs-list').classList.add('hidden');
    document.getElementById('logs-terminal-container').classList.remove('hidden');
    document.getElementById('btn-logs-back').classList.remove('hidden');
    document.getElementById('logs-main-title').textContent = `Running Job`;
    document.getElementById('logs-main-sub').textContent = 'Live output.';
    document.getElementById('log-terminal-title').textContent = `Live Logs: ${currentJobId}`;

    _clearTerminalDiv();
    _clearUserFeed();
    appendDevLog(`Job ${currentJobId} started`, 'log-head');
    appendUserEvent({ _t: 'info', msg: `Job ${currentJobId} started` });
    startLogStream(currentJobId);

  } catch (e) {
    alert('Failed to start run: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Start Run';
  }
}

// ── Human Action / Chat Handoff ─────────────────────────────

function handleRunAction(action) {
  const actionCard = document.getElementById('interactive-action-card');
  if (!action) {
    actionCard.classList.add('hidden');
    return;
  }
  if (action.type === 'captcha') {
    actionCard.classList.remove('hidden');
    document.getElementById('action-content').innerHTML = '';
    const inp = document.getElementById('action-input');
    inp.value = '';
    inp.focus();
    const terminal = document.getElementById('log-terminal');
    terminal.scrollTop = terminal.scrollHeight;
  }
  if (action.type === 'human_input') {
    actionCard.classList.remove('hidden');
    document.getElementById('action-content').innerHTML = '';
    const inp = document.getElementById('action-input');
    inp.value = '';
    inp.placeholder = 'Type your answer here...';
    inp.focus();
    const terminal = document.getElementById('log-terminal');
    terminal.scrollTop = terminal.scrollHeight;
  }
}

async function submitRunAction() {
  const val = document.getElementById('action-input').value.trim();
  if (!val) return;
  try {
    await API.submitRunAction(currentJobId, val);
    document.getElementById('interactive-action-card').classList.add('hidden');
    appendDevLog('Sent response to bot.', 'log-info');
  } catch (e) {
    alert('Failed to send answer: ' + e.message);
  }
}

// ── Log view toggle ─────────────────────────────────────────

function setLogView(mode) {
  logViewMode = mode;
  const btnUser = document.getElementById('log-toggle-user');
  const btnDev  = document.getElementById('log-toggle-dev');
  const devPane  = document.getElementById('log-terminal');
  const userPane = document.getElementById('log-user-feed');

  if (mode === 'user') {
    btnUser.classList.add('active-toggle');
    btnDev.classList.remove('active-toggle');
    userPane.classList.remove('hidden');
    devPane.classList.add('hidden');
    userPane.scrollTop = userPane.scrollHeight;
  } else {
    btnDev.classList.add('active-toggle');
    btnUser.classList.remove('active-toggle');
    devPane.classList.remove('hidden');
    userPane.classList.add('hidden');
    devPane.scrollTop = devPane.scrollHeight;
  }
}

// ── Run History & Log streaming ─────────────────────────────

async function loadRunHistory() {
  const container = document.getElementById('logs-recipe-grid');
  container.classList.remove('hidden');
  document.getElementById('logs-runs-list').classList.add('hidden');
  document.getElementById('logs-terminal-container').classList.add('hidden');
  document.getElementById('btn-logs-back').classList.add('hidden');
  document.getElementById('logs-main-title').textContent = 'Run History & Logs';
  document.getElementById('logs-main-sub').textContent = 'Select a flow to view its past runs.';

  try {
    allRunsData = await API.listRuns();
    if (!allRunsData.length) {
      container.innerHTML = '<div class="empty-state">No run history found.</div>';
      return;
    }

    const grouped = {};
    allRunsData.forEach(r => {
      if (!grouped[r.recipe_name]) grouped[r.recipe_name] = [];
      grouped[r.recipe_name].push(r);
    });

    const html = [];
    for (const [recipeName, runs] of Object.entries(grouped)) {
      const latestRun = runs[0];
      html.push(`
        <div class="recipe-card" style="cursor: pointer; padding: .85rem;" onclick="showRunsForRecipe('${esc(recipeName)}')">
          <div class="row" style="justify-content: space-between;">
            <div class="recipe-card-name" style="font-size: .85rem;">${esc(recipeName)}</div>
            <span class="badge badge-blue">${runs.length} Runs</span>
          </div>
          <div class="recipe-card-desc" style="margin-top: .25rem;">Latest: ${new Date(latestRun.created_at * 1000).toLocaleString()}</div>
        </div>
      `);
    }
    container.innerHTML = html.join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Error loading run history: ${e.message}</div>`;
  }
}

function showRunsForRecipe(recipeName) {
  document.getElementById('logs-recipe-grid').classList.add('hidden');
  const runsList = document.getElementById('logs-runs-list');
  runsList.classList.remove('hidden');
  document.getElementById('logs-terminal-container').classList.add('hidden');
  document.getElementById('btn-logs-back').classList.remove('hidden');
  document.getElementById('logs-main-title').textContent = `${recipeName}`;
  document.getElementById('logs-main-sub').textContent = 'Select a run to view its logs.';

  const runs = allRunsData.filter(r => r.recipe_name === recipeName);

  runsList.innerHTML = runs.map(r => `
    <div class="recipe-card" style="padding: .85rem; margin-bottom: .5rem; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div class="row gap-sm">
          <span class="badge ${r.status === 'done' ? 'badge-green' : (r.status === 'error' ? 'badge-red' : 'badge-blue')}">${r.status}</span>
          <span style="font-family: var(--mono); font-size: .8rem; color: var(--text2);">${r.job_id}</span>
        </div>
        <div style="font-size: .75rem; color: var(--text3); margin-top: .25rem;">${new Date(r.created_at * 1000).toLocaleString()}</div>
      </div>
      <div class="row gap-sm">
        <button class="btn btn-sm btn-primary" onclick="playVideo('${r.job_id}')">▶ Play</button>
        <button class="btn btn-sm btn-ghost" onclick="viewPastLog('${r.job_id}', '${esc(r.recipe_name)}')">View Log</button>
        <button class="btn btn-sm btn-ghost" onclick="downloadLogById('${r.job_id}')">Download</button>
        <button class="btn btn-sm btn-danger" onclick="deletePastLog('${r.job_id}', '${esc(r.recipe_name)}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function deletePastLog(jobId, recipeName) {
  if (!confirm(`Delete log and recording for run ${jobId}?`)) return;
  await API.deleteRun(jobId);
  allRunsData = await API.listRuns();
  const remaining = allRunsData.filter(r => r.recipe_name === recipeName);
  if (remaining.length === 0) {
    backToLogRecipes();
  } else {
    showRunsForRecipe(recipeName);
  }
  if (currentJobId === jobId) {
    document.getElementById('logs-terminal-container').classList.add('hidden');
  }
}

async function deleteCurrentLog() {
  if (!currentJobId) return;
  if (!confirm(`Delete log and recording for run ${currentJobId}?`)) return;
  await API.deleteRun(currentJobId);
  document.getElementById('logs-terminal-container').classList.add('hidden');
  backToLogRecipes();
}

async function viewPastLog(jobId, recipeName) {
  currentJobId = jobId;
  sessionStorage.setItem('currentJobId', currentJobId);
  document.getElementById('log-terminal-title').textContent = `Logs for: ${recipeName} (${jobId})`;

  document.getElementById('logs-recipe-grid').classList.add('hidden');
  document.getElementById('logs-runs-list').classList.add('hidden');
  document.getElementById('logs-terminal-container').classList.remove('hidden');
  document.getElementById('btn-logs-back').classList.remove('hidden');

  showProgressCard(false);
  _clearTerminalDiv();
  _clearUserFeed();
  logBuffer  = [];
  userEvents = [];

  try {
    const res = await API.getLogs(jobId);
    if (res && res.logs) {
      logBuffer = res.logs;
      logBuffer.forEach(line => {
        const ev = _tryParseEvent(line);
        if (ev) {
          userEvents.push(ev);
          appendUserEvent(ev);
        } else {
          appendDevLog(line, classifyLog(line));
        }
      });

      if (res.status === 'running' || res.status === 'pending') {
        startLogStream(jobId);
      } else {
        if (res.summary) {
          showProgressCard(true);
          document.getElementById('progress-label').textContent = res.status === 'done' ? 'Run complete' : 'Run ended with error';
          document.getElementById('progress-bar').style.width = '100%';
          document.getElementById('progress-bar').style.background = res.status === 'done' ? 'var(--green)' : 'var(--red)';
          document.getElementById('progress-pct').textContent = '100%';
          document.getElementById('prog-success').textContent = `${res.summary.success || 0}`;
          document.getElementById('prog-failed').textContent = `${res.summary.failed || 0}`;
        }
      }
    } else {
      appendDevLog('No logs recorded for this run.', 'log-info');
    }
  } catch (e) {
    appendDevLog(`Error fetching logs: ${e.message}`, 'log-err');
  }
}

function startLogStream(jobId) {
  if (currentWS) currentWS.close();

  showProgressCard(true);
  document.getElementById('progress-label').textContent = 'Running…';
  document.getElementById('interactive-action-card').classList.add('hidden');

  currentWS = API.openLogSocket(
    jobId,
    logBuffer.length,
    (line) => {
      logBuffer.push(line);
      const ev = _tryParseEvent(line);
      if (ev) {
        userEvents.push(ev);
        appendUserEvent(ev);
      } else {
        appendDevLog(line, classifyLog(line));
        updateProgressFromLine(line);
      }
    },
    (status, summary) => {
      onRunDone(status, summary);
    },
    (action) => {
      handleRunAction(action);
    }
  );
}

// ── Log parsing ─────────────────────────────────────────────

function _tryParseEvent(line) {
  if (!line || line[0] !== '{') return null;
  try {
    const obj = JSON.parse(line);
    if (obj && obj._t) return obj;
  } catch (e) {}
  return null;
}

function classifyLog(line) {
  if (line.includes('✅') || line.includes('✓'))  return 'log-ok';
  if (line.includes('❌') || line.includes('✗') || line.includes('💥')) return 'log-err';
  if (line.includes('⚠') || line.includes('⚠️'))  return 'log-warn';
  if (line.match(/^[=─]+$/)) return 'log-sep';
  if (line.includes('📊') || line.includes('🚀') || line.includes('📂')) return 'log-head';
  if (line.includes('→'))   return 'log-info';
  return '';
}

function updateProgressFromLine(line) {
  const m = line.match(/\[(\d+)\/(\d+)\]/);
  if (m) {
    const cur   = parseInt(m[1]);
    const total = parseInt(m[2]);
    runStats.total = total;
    const pct = Math.round((cur / total) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-label').textContent = `Processing ${cur} of ${total}…`;
  }
  if (line.includes('✅')) { runStats.success++; document.getElementById('prog-success').textContent = `${runStats.success}`; }
  if (line.includes('❌')) { runStats.failed++;  document.getElementById('prog-failed').textContent  = `${runStats.failed}`; }
}

function onRunDone(status, summary) {
  const label = document.getElementById('progress-label');
  document.getElementById('interactive-action-card').classList.add('hidden');
  if (status === 'done') {
    label.textContent = 'Run complete';
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-bar').style.background = 'var(--green)';
    document.getElementById('progress-pct').textContent = '100%';
  } else {
    label.textContent = 'Run ended with error';
    document.getElementById('progress-bar').style.background = 'var(--red)';
  }

  if (summary) {
    document.getElementById('prog-success').textContent = `${summary.success || 0}`;
    document.getElementById('prog-failed').textContent = `${summary.failed || 0}`;
  }

  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-run').textContent = 'Start Run';
}

// ── Dev terminal (raw log) ──────────────────────────────────

function appendDevLog(text, cls) {
  const terminal = document.getElementById('log-terminal');
  const span = document.createElement('span');
  span.className = 'log-line ' + (cls || '');
  span.textContent = text;
  terminal.appendChild(span);
  terminal.appendChild(document.createTextNode('\n'));
  if (document.getElementById('autoscroll-toggle').checked && logViewMode === 'dev') {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function _clearTerminalDiv() {
  document.getElementById('log-terminal').innerHTML = '';
}

// ── User feed (chat-style) ──────────────────────────────────

function _clearUserFeed() {
  document.getElementById('log-user-feed').innerHTML = '';
}

function appendUserEvent(ev) {
  const feed = document.getElementById('log-user-feed');
  const node = _buildUserEventNode(ev);
  if (!node) return;
  feed.appendChild(node);
  if (document.getElementById('autoscroll-toggle').checked && logViewMode === 'user') {
    feed.scrollTop = feed.scrollHeight;
  }
}

function _buildUserEventNode(ev) {
  const wrap = document.createElement('div');
  wrap.className = 'uf-entry';
  wrap.style.marginBottom = '0.75rem';

  switch (ev._t) {

    case 'start': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-system">▶ Started processing <strong>${ev.total}</strong> record${ev.total !== 1 ? 's' : ''} (rows ${ev.start}–${ev.end})</div>`;
      break;
    }

    case 'row_start': {
      wrap.innerHTML = `<div class="uf-row-header">Row ${ev.row_num} / ${ev.row_total} &mdash; <span class="uf-row-id">${esc(String(ev.row_id))}</span></div>`;
      break;
    }

    case 'navigate': {
      wrap.style.marginLeft = '1.5rem';
      let cleanUrl = ev.url || '';
      if (cleanUrl.length > 75 && cleanUrl.includes('?')) {
        cleanUrl = cleanUrl.split('?')[0] + '?...';
      }
      wrap.innerHTML = `<div class="uf-bubble uf-action">🌐 <strong>${esc(ev.label)}</strong> &mdash; Opened <span class="uf-url">${esc(cleanUrl)}</span></div>`;
      break;
    }

    case 'click': {
      wrap.style.marginLeft = '1.5rem';
      const ctx = ev.context === 'new tab' ? ' (new tab)' : '';
      wrap.innerHTML = `<div class="uf-bubble uf-action">🖱 Clicked <code>${esc(ev.selector)}</code>${ctx}</div>`;
      break;
    }

    case 'new_tab': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-action">🗖 Switched to new tab</div>`;
      break;
    }

    case 'reached': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-ok">✓ <strong>${esc(ev.label)}</strong> completed</div>`;
      break;
    }

    case 'ask': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `
        <div class="uf-bubble uf-question">
          <span class="uf-q-icon">❓</span>
          <span>${esc(ev.question)}</span>
        </div>`;
      break;
    }

    case 'answer': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `
        <div class="uf-answer-row">
          <div class="uf-bubble uf-question" style="opacity:.6;font-size:.8rem;">${esc(ev.question)}</div>
          <div class="uf-bubble uf-reply">✍ Entered: <strong>${esc(ev.answer)}</strong></div>
        </div>`;
      break;
    }

    case 'captcha': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `
        <div class="uf-bubble uf-captcha">
          <div class="uf-captcha-label">🔒 CAPTCHA — please solve:</div>
          <img src="data:image/png;base64,${ev.image_b64}" class="uf-captcha-img">
        </div>`;
      break;
    }

    case 'captcha_answer': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-reply">✍ CAPTCHA answer entered: <strong>${esc(ev.answer)}</strong></div>`;
      break;
    }

    case 'captcha_timeout': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-err">⏱ CAPTCHA timed out — no response received</div>`;
      break;
    }

    case 'row_done': {
      wrap.style.marginLeft = '1.5rem';
      if (ev.success) {
        wrap.innerHTML = `<div class="uf-bubble uf-ok uf-row-result">✅ Row completed successfully</div>`;
      } else {
        wrap.innerHTML = `<div class="uf-bubble uf-err uf-row-result">❌ Row failed</div>`;
      }
      // Add spacing after each row result
      wrap.style.marginBottom = '2.5rem';
      break;
    }

    case 'summary': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `
        <div class="uf-bubble uf-system uf-summary">
          <div style="font-weight:700;margin-bottom:.4rem;">📊 Run Complete</div>
          <div>✅ Success: <strong>${ev.success}</strong> &nbsp; ❌ Failed: <strong>${ev.failed}</strong></div>
          ${ev.failed_ids && ev.failed_ids.length ? `<div style="margin-top:.3rem;font-size:.8rem;color:var(--text2)">Failed: ${ev.failed_ids.map(x => esc(String(x))).join(', ')}</div>` : ''}
        </div>`;
      break;
    }

    case 'info': {
      wrap.style.marginLeft = '1.5rem';
      wrap.innerHTML = `<div class="uf-bubble uf-system">${esc(ev.msg)}</div>`;
      break;
    }

    default:
      return null;
  }

  return wrap;
}

// ── Log terminal UI ─────────────────────────────────────────

function downloadLogs() {
  const text = logBuffer.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rpa-log-${currentJobId || 'run'}.txt`;
  a.click();
}

async function downloadLogById(jobId) {
  try {
    const res = await API.getLogs(jobId);
    const text = (res.logs || []).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rpa-log-${jobId}.txt`;
    a.click();
  } catch (e) {
    alert("Failed to download: " + e.message);
  }
}

function showProgressCard(show) {
  document.getElementById('run-progress-card').classList.toggle('hidden', !show);
}

// ── Video playback ──────────────────────────────────────────

async function playVideo(jobId, tab) {
  const token = localStorage.getItem('rpa_token') || '';
  if (!tab) {
    try {
      const videos = await API._fetch(`/api/run/${jobId}/videos`).then(r => r.json());
      if (videos.length > 1) {
        const tabs = videos.map(v =>
          `<button class="btn btn-sm btn-ghost" onclick="playVideo('${jobId}',${v.tab})" style="margin-right:.3rem">${v.label}</button>`
        ).join('');
        document.getElementById('video-modal-title').innerHTML =
          `Recording: ${jobId} &nbsp; ${tabs}`;
        tab = 1;
      } else {
        document.getElementById('video-modal-title').textContent = `Recording: ${jobId}`;
        tab = 1;
      }
    } catch(e) {
      document.getElementById('video-modal-title').textContent = `Recording: ${jobId}`;
      tab = 1;
    }
  }
  const player = document.getElementById('run-video-player');
  player.src = `/api/run/${jobId}/video?tab=${tab}&token=${token}`;
  document.getElementById('video-overlay').classList.remove('hidden');
  player.play().catch(e => console.warn('Autoplay prevented', e));
}

function closeVideoModal() {
  document.getElementById('video-overlay').classList.add('hidden');
  const player = document.getElementById('run-video-player');
  player.pause();
  player.src = '';
}

function backToLogRecipes() {
  loadRunHistory();
}

// ── Uploads Tab UI ──────────────────────────────────────────

async function loadUploadsList() {
  const container = document.getElementById('uploads-list');
  try {
    const files = await API.listUploads();
    if (!files.length) {
      container.innerHTML = '<div class="empty-state">No files uploaded yet.</div>';
      return;
    }
    container.innerHTML = files.map(f => `
      <div class="recipe-card">
        <div class="recipe-card-name">${esc(f.filename)}</div>
        <div class="recipe-card-desc">Size: ${Math.round(f.size/1024)} KB</div>
        <div class="recipe-card-desc">Flow: <strong>${esc(f.recipe_name)}</strong></div>
        <div class="row gap-sm" style="margin-top:.5rem">
          <span class="badge">Job: ${esc(f.job_id)}</span>
          <span class="badge badge-blue">Status: ${esc(f.job_status)}</span>
        </div>
        <div class="recipe-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="downloadDataFile('${f.filename}')">Download</button>
          <button class="btn btn-sm btn-danger" onclick="deleteUploadFile('${f.filename}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Error loading uploads: ${e.message}</div>`;
  }
}

function downloadDataFile(filename) {
  window.open('/api/uploads/' + filename, '_blank');
}

async function deleteUploadFile(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  await API.deleteUpload(filename);
  loadUploadsList();
}