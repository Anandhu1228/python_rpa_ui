/* runner.js — Run tab + Logs tab */

let selectedFile = null;
let currentJobId  = null;
let currentWS     = null;
let logBuffer     = [];
let runStats      = { success: 0, failed: 0, total: 0 };

// ── File handling ───────────────────────────────────────────

function onFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('file-drop-name').textContent = file.name;
  document.getElementById('file-drop').style.borderColor = 'var(--accent)';
  parseAndPreviewFile(file);
}

// Drag-and-drop
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

  // Check if there is an active job running to auto-attach
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
      // Read xlsx via SheetJS if available, else show note
      if (window.XLSX) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        headers = data[0] || [];
        rows    = data.slice(1, 6);
      } else {
        table.innerHTML = '<div class="hint">Excel preview not available in browser (will work when running). Column list only.</div>';
        // Read first line via text is not possible for xlsx — skip preview
        return;
      }
    } else {
      // CSV — read as text
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      headers = parseCSVLine(lines[0] || '');
      rows    = lines.slice(1, 6).map(parseCSVLine);
    }

    count.textContent = `${rows.length}+ rows`;

    // Build preview table (max 5 rows, max 8 cols)
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
    sessionStorage.setItem('currentJobId', currentJobId); // SAVE FOR PERSISTENCE

    logBuffer = [];
    runStats  = { success: 0, failed: 0, total: 0 };

    document.getElementById('log-terminal-title').textContent = `Live Logs: ${currentJobId}`;
    clearLogs();
    appendLog(`Job ${currentJobId} started`, 'log-head');
    appendLog('', '');
    switchTab('logs');
    startLogStream(currentJobId);

  } catch (e) {
    alert('Failed to start run: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Start Run';
  }
}

// ── Run History & Log streaming ─────────────────────────────

async function loadRunHistory() {
  const container = document.getElementById('run-history-list');
  try {
    const runs = await API.listRuns();
    if (!runs.length) {
      container.innerHTML = '<div class="empty-state">No run history found.</div>';
      return;
    }
    container.innerHTML = runs.map(r => `
      <div class="recipe-card" style="cursor: pointer; padding: .85rem;" onclick="viewPastLog('${r.job_id}', '${esc(r.recipe_name)}')">
        <div class="row" style="justify-content: space-between;">
           <div class="recipe-card-name" style="font-size: .85rem;">${esc(r.recipe_name)}</div>
           <span class="badge ${r.status === 'done' ? 'badge-green' : (r.status === 'error' ? 'badge-red' : 'badge-blue')}">${r.status}</span>
        </div>
        <div class="recipe-card-url" style="margin-top: .25rem;">ID: ${r.job_id}</div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Error loading run history: ${e.message}</div>`;
  }
}

async function viewPastLog(jobId, recipeName) {
  currentJobId = jobId;
  sessionStorage.setItem('currentJobId', currentJobId);
  document.getElementById('log-terminal-title').textContent = `Logs for: ${recipeName} (${jobId})`;
  showProgressCard(false); // Default hide until we know status
  clearLogs();

  try {
    const res = await API.getLogs(jobId);
    if (res && res.logs) {
      logBuffer = res.logs;
      logBuffer.forEach(line => appendLog(line, classifyLog(line)));
      
      // If it is actively running, attach websocket
      if (res.status === 'running' || res.status === 'pending') {
         startLogStream(jobId);
      } else {
         // It is completed. Don't add fake duplicate summaries, just show progress bar state
         if (res.summary) {
            showProgressCard(true);
            document.getElementById('progress-label').textContent = res.status === 'done' ? 'Run complete' : 'Run ended with error';
            document.getElementById('progress-bar').style.width = '100%';
            document.getElementById('progress-bar').style.background = res.status === 'done' ? 'var(--green)' : 'var(--red)';
            document.getElementById('progress-pct').textContent = '100%';
            document.getElementById('prog-success').textContent = `${res.summary.success}`;
            document.getElementById('prog-failed').textContent = `${res.summary.failed}`;
         }
      }
    } else {
      appendLog('No logs recorded for this run.', 'log-info');
    }
  } catch (e) {
    appendLog(`Error fetching logs: ${e.message}`, 'log-err');
  }
}

function startLogStream(jobId) {
  if (currentWS) currentWS.close();

  showProgressCard(true);
  document.getElementById('progress-label').textContent = 'Running…';

  currentWS = API.openLogSocket(
    jobId,
    (line) => {
      // Only append if it's new (avoids duplicating lines if we just fetched from history)
      if (!logBuffer.includes(line)) {
          logBuffer.push(line);
          appendLog(line, classifyLog(line));
      }
      updateProgressFromLine(line);
    },
    (status, summary) => {
      onRunDone(status, summary);
    }
  );
}

function classifyLog(line) {
  if (line.includes('✅') || line.includes('✓'))  return 'log-ok';
  if (line.includes('❌') || line.includes('✗') || line.includes('💥')) return 'log-err';
  if (line.includes('⚠'))  return 'log-warn';
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
  if (status === 'done') {
    label.textContent = 'Run complete';
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-bar').style.background = 'var(--green)';
    document.getElementById('progress-pct').textContent = '100%';
  } else {
    label.textContent = 'Run ended with error';
    document.getElementById('progress-bar').style.background = 'var(--red)';
  }

  // Safely update counters from summary without duplicating log lines
  if (summary) {
    document.getElementById('prog-success').textContent = `${summary.success || 0}`;
    document.getElementById('prog-failed').textContent = `${summary.failed || 0}`;
  }

  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-run').textContent = 'Start Run';
}

// ── Log terminal UI ─────────────────────────────────────────

function appendLog(text, cls) {
  const terminal = document.getElementById('log-terminal');
  const span = document.createElement('span');
  span.className = 'log-line ' + (cls || '');
  span.textContent = text;
  terminal.appendChild(span);
  terminal.appendChild(document.createTextNode('\n'));
  if (document.getElementById('autoscroll-toggle').checked) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function clearLogs() {
  document.getElementById('log-terminal').innerHTML = '';
  logBuffer = [];
}

function downloadLogs() {
  const text = logBuffer.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rpa-log-${currentJobId || 'run'}.txt`;
  a.click();
}

function showProgressCard(show) {
  document.getElementById('run-progress-card').classList.toggle('hidden', !show);
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