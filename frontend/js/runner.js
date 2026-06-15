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
document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('file-drop');
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
  btn.textContent = '⏳ Starting…';

  try {
    const result = await API.startRun(formData);
    currentJobId = result.job_id;
    logBuffer = [];
    runStats  = { success: 0, failed: 0, total: 0 };

    clearLogs();
    appendLog(`🚀 Job ${currentJobId} started`, 'log-head');
    appendLog('', '');
    switchTab('logs');
    startLogStream(currentJobId);

  } catch (e) {
    alert('Failed to start run: ' + e.message);
    btn.disabled = false;
    btn.textContent = '▶ Start Run';
  }
}

// ── Log streaming ───────────────────────────────────────────

function startLogStream(jobId) {
  if (currentWS) currentWS.close();

  showProgressCard(true);
  document.getElementById('progress-label').textContent = 'Running…';

  currentWS = API.openLogSocket(
    jobId,
    (line) => {
      logBuffer.push(line);
      appendLog(line, classifyLog(line));
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
  if (line.includes('✅')) { runStats.success++; document.getElementById('prog-success').textContent = `✅ ${runStats.success}`; }
  if (line.includes('❌')) { runStats.failed++;  document.getElementById('prog-failed').textContent  = `❌ ${runStats.failed}`; }
}

function onRunDone(status, summary) {
  const label = document.getElementById('progress-label');
  if (status === 'done') {
    label.textContent = '✅ Run complete';
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-bar').style.background = 'var(--green)';
    document.getElementById('progress-pct').textContent = '100%';
    appendLog('', '');
    appendLog('✅ Run completed.', 'log-ok');
  } else {
    label.textContent = '❌ Run ended with error';
    document.getElementById('progress-bar').style.background = 'var(--red)';
    appendLog('❌ Run ended with error.', 'log-err');
  }

  if (summary) {
    if (summary.success !== undefined) {
      appendLog(`   Success: ${summary.success}  |  Failed: ${summary.failed}`, 'log-head');
    }
    if (summary.failed_ids && summary.failed_ids.length) {
      appendLog(`   Failed IDs: ${summary.failed_ids.join(', ')}`, 'log-err');
    }
  }

  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-run').textContent = '▶ Start Run';
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
