/* flow.js — Flow Builder tab */

let flowSteps = [];           // array of step objects
let editingRecipeId = null;   // when loading an existing recipe to edit

// ── Step management ─────────────────────────────────────────

function addFlowStep() {
  const id = 'step_' + Date.now();
  flowSteps.push({
    _id: id,
    step_id: id,
    label: 'New Step',
    url: '',
    field_mappings: [],
    submit_selector: 'button[type="submit"]',
    wait_for_url: '',
    wait_for_selector: '',
    skip_if_no_data: false,
    _open: true,
  });
  renderFlowSteps();
}

function removeFlowStep(id) {
  flowSteps = flowSteps.filter(s => s._id !== id);
  renderFlowSteps();
}

function toggleStep(id) {
  const s = flowSteps.find(s => s._id === id);
  if (s) { s._open = !s._open; renderFlowSteps(); }
}

function updateStep(id, key, val) {
  const s = flowSteps.find(s => s._id === id);
  if (s) s[key] = val;
}

function moveStep(id, dir) {
  const idx = flowSteps.findIndex(s => s._id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= flowSteps.length) return;
  [flowSteps[idx], flowSteps[newIdx]] = [flowSteps[newIdx], flowSteps[idx]];
  renderFlowSteps();
}

// ── In-Flow Inspection ──────────────────────────────────────

async function inspectStepInFlow(stepId) {
  const step = flowSteps.find(s => s._id === stepId);
  if (!step.url) { alert('Please enter a URL for this step first.'); return; }
  
  const btn = document.getElementById(`btn-ins-${stepId}`);
  const oldText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;"></span> Inspecting...';
  btn.disabled = true;

  try {
    // Format recipe login steps to match what the API expects
    const loginPayload = recipeLoginSteps.map(s => ({
      url: s.url,
      fields: s.fields.map(f => ({
        selector: f.selector,
        field_type: f.field_type,
        literal_value: f.literal_value
      })),
      submit_selector: s.submit_selector,
      wait_for_url: s.wait_for_url
    }));

    const result = await API.inspect(step.url, loginPayload);
    
    // Convert inspection result to field mappings
    const mappings = [];
    
    for (const f of (result.inputs || [])) {
      if (f.type === 'hidden') continue;
      const selector = f.name ? `input[name="${f.name}"]` : (f.id ? `#${f.id}` : '');
      if (!selector) continue;
      let ft = f.type;
      if (!['text','password','email','tel','number','radio','checkbox'].includes(ft)) ft = 'text';
      mappings.push({ _id: Date.now() + Math.random(), selector, field_type: ft, radio_name: ft === 'radio' ? (f.name || '') : '', source: 'csv_column', csv_column: '', literal_value: '', label: f.placeholder || f.name || selector, value_map: [] });
    }
    for (const s of (result.selects || [])) {
      const selector = s.name ? `select[name="${s.name}"]` : (s.id ? `#${s.id}` : '');
      if (!selector) continue;
      mappings.push({ _id: Date.now() + Math.random(), selector, field_type: 'select', source: 'csv_column', csv_column: '', literal_value: '', label: s.name || selector, value_map: [] });
    }
    for (const t of (result.textareas || [])) {
      const selector = t.name ? `textarea[name="${t.name}"]` : (t.id ? `#${t.id}` : '');
      if (!selector) continue;
      mappings.push({ _id: Date.now() + Math.random(), selector, field_type: 'textarea', source: 'csv_column', csv_column: '', literal_value: '', label: t.placeholder || t.name || selector, value_map: [] });
    }

    // Append to step
    step.field_mappings.push(...mappings);
    renderFlowSteps();
    
  } catch (e) {
    alert('Inspection failed: ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = oldText; btn.disabled = false; }
  }
}

// ── Mapping management ──────────────────────────────────────

function addMapping(stepId) {
  const s = flowSteps.find(s => s._id === stepId);
  if (!s) return;
  s.field_mappings.push({
    _id: Date.now() + Math.random(),
    selector: '',
    field_type: 'text',
    radio_name: '',
    source: 'csv_column',
    csv_column: '',
    literal_value: '',
    label: '',
    value_map: [],
  });
  renderFlowSteps();
}

function removeMapping(stepId, mid) {
  const s = flowSteps.find(s => s._id === stepId);
  if (s) { s.field_mappings = s.field_mappings.filter(m => m._id !== mid); renderFlowSteps(); }
}

function updateMapping(stepId, mid, key, val) {
  const s = flowSteps.find(s => s._id === stepId);
  if (!s) return;
  const m = s.field_mappings.find(m => m._id === mid);
  if (m) m[key] = val;
  // re-render only if source changes (to show/hide columns)
  if (key === 'source' || key === 'field_type') renderFlowSteps();
}

// ── Value Map management ────────────────────────────────────

function addValueMap(stepId, mappingId) {
  const s = flowSteps.find(s => s._id === stepId);
  const m = s.field_mappings.find(m => m._id === mappingId);
  if (m) {
    if (!m.value_map) m.value_map = [];
    m.value_map.push({ _id: Date.now() + Math.random(), from_val: '', to_val: '' });
    renderFlowSteps();
  }
}

function updateValueMap(stepId, mappingId, vmId, key, val) {
  const s = flowSteps.find(s => s._id === stepId);
  const m = s.field_mappings.find(m => m._id === mappingId);
  if (m && m.value_map) {
    const vm = m.value_map.find(v => v._id === vmId);
    if (vm) vm[key] = val;
  }
}

function removeValueMap(stepId, mappingId, vmId) {
  const s = flowSteps.find(s => s._id === stepId);
  const m = s.field_mappings.find(m => m._id === mappingId);
  if (m && m.value_map) {
    m.value_map = m.value_map.filter(v => v._id !== vmId);
    renderFlowSteps();
  }
}

// ── Recipe login steps (in flow builder) ───────────────────

let recipeLoginSteps = [];

function addRecipeLoginStep() {
  recipeLoginSteps.push({
    _id: Date.now(),
    url: '',
    fields: [],
    submit_selector: 'button[type="submit"]',
    wait_for_url: '',
  });
  renderRecipeLoginSteps();
}

function removeRecipeLoginStep(id) {
  recipeLoginSteps = recipeLoginSteps.filter(s => s._id !== id);
  renderRecipeLoginSteps();
}

function addRecipeLoginField(stepId) {
  const s = recipeLoginSteps.find(s => s._id === stepId);
  if (s) s.fields.push({ selector: '', field_type: 'text', source: 'literal', literal_value: '', label: '' });
  renderRecipeLoginSteps();
}

function updateRecipeLoginStep(id, key, val) {
  const s = recipeLoginSteps.find(s => s._id === id);
  if (s) s[key] = val;
}

function updateRecipeLoginField(stepId, fi, key, val) {
  const s = recipeLoginSteps.find(s => s._id === stepId);
  if (s && s.fields[fi]) s.fields[fi][key] = val;
}

function removeRecipeLoginField(stepId, fi) {
  const s = recipeLoginSteps.find(s => s._id === stepId);
  if (s) { s.fields.splice(fi, 1); renderRecipeLoginSteps(); }
}

function renderRecipeLoginSteps() {
  const container = document.getElementById('recipe-login-steps');
  if (!recipeLoginSteps.length) {
    container.innerHTML = '<p class="hint" style="padding:.5rem 0">No login steps — add one if the site requires authentication before running the flow.</p>';
    return;
  }
  container.innerHTML = recipeLoginSteps.map((step, si) => `
    <div class="login-step-card">
      <div class="row">
        <span class="badge badge-blue">Login ${si + 1}</span>
        <span style="font-weight:600;flex:1">${step.url || 'Login Step'}</span>
        <button class="btn btn-sm btn-danger" onclick="removeRecipeLoginStep(${step._id})">✕</button>
      </div>
      <div class="form-grid" style="margin-top:.75rem">
        <div class="form-group">
          <label>URL</label>
          <input class="input" type="url" value="${esc(step.url)}"
            onchange="updateRecipeLoginStep(${step._id},'url',this.value)" placeholder="https://…/login/">
        </div>
        <div class="form-group">
          <label>Submit selector</label>
          <input class="input" value="${esc(step.submit_selector)}"
            onchange="updateRecipeLoginStep(${step._id},'submit_selector',this.value)"
            placeholder='button[type="submit"]'>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label>Wait for URL to contain</label>
          <input class="input" value="${esc(step.wait_for_url)}"
            onchange="updateRecipeLoginStep(${step._id},'wait_for_url',this.value)"
            placeholder="/dashboard/">
        </div>
      </div>
      <div class="step-fields" style="margin-top:.75rem">
        <div style="font-size:.8rem;font-weight:600;color:var(--text2);margin-bottom:.5rem">Credential Fields</div>
        ${step.fields.map((f, fi) => `
          <div class="login-field-row" style="grid-template-columns:1fr 80px 1fr 36px">
            <input class="input" placeholder='Selector e.g. [name="identifier"]'
              value="${esc(f.selector)}"
              onchange="updateRecipeLoginField(${step._id},${fi},'selector',this.value)">
            <select class="input" onchange="updateRecipeLoginField(${step._id},${fi},'field_type',this.value)">
              <option value="text" ${f.field_type==='text'?'selected':''}>text</option>
              <option value="password" ${f.field_type==='password'?'selected':''}>password</option>
            </select>
            <input class="input" placeholder="Value (literal)"
              value="${esc(f.literal_value)}"
              type="${f.field_type==='password'?'password':'text'}"
              onchange="updateRecipeLoginField(${step._id},${fi},'literal_value',this.value)">
            <button class="btn btn-sm btn-danger" onclick="removeRecipeLoginField(${step._id},${fi})">✕</button>
          </div>
        `).join('')}
        <button class="btn btn-sm btn-ghost" onclick="addRecipeLoginField(${step._id})" style="margin-top:.35rem">+ Add Field</button>
      </div>
    </div>
  `).join('');
}

// ── Render flow steps ───────────────────────────────────────

function renderFlowSteps() {
  const container = document.getElementById('flow-steps-list');
  if (!flowSteps.length) {
    container.innerHTML = '<div class="empty-state">No steps yet. Click "+ Add Step" to begin.</div>';
    return;
  }

  container.innerHTML = flowSteps.map((step, si) => `
    <div class="flow-step" id="fstep-${step._id}">
      <div class="flow-step-header" onclick="toggleStep('${step._id}')">
        <div class="step-num">${si + 1}</div>
        <div style="flex:1;min-width:0">
          <div class="step-label">${esc(step.label || 'Unnamed Step')}</div>
          <div class="step-url">${esc(step.url || '(no URL)')}</div>
        </div>
        <span class="badge">${step.field_mappings.length} fields</span>
        <div class="row gap-sm" onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-ghost" onclick="moveStep('${step._id}',-1)" title="Move up" ${si===0?'disabled':''}>↑</button>
          <button class="btn btn-sm btn-ghost" onclick="moveStep('${step._id}',1)"  title="Move down" ${si===flowSteps.length-1?'disabled':''}>↓</button>
          <button class="btn btn-sm btn-danger" onclick="removeFlowStep('${step._id}')">✕</button>
        </div>
      </div>
      <div class="flow-step-body ${step._open ? 'open' : ''}">
        <div class="form-grid" style="margin-bottom:1rem">
          <div class="form-group">
            <label>Step Label</label>
            <input class="input" value="${esc(step.label)}"
              onchange="updateStep('${step._id}','label',this.value)">
          </div>
          <div class="form-group">
            <label>URL to navigate to</label>
            <div class="row gap-sm">
              <input class="input flex-1" type="url" value="${esc(step.url)}"
                placeholder="Leave blank to stay on current page"
                onchange="updateStep('${step._id}','url',this.value)">
              <button id="btn-ins-${step._id}" class="btn btn-primary btn-sm" onclick="inspectStepInFlow('${step._id}')">🔍 Auto-Extract Fields</button>
            </div>
          </div>
          <div class="form-group">
            <label>Submit selector</label>
            <input class="input" value="${esc(step.submit_selector)}"
              placeholder='button[type="submit"]'
              onchange="updateStep('${step._id}','submit_selector',this.value)">
          </div>
          <div class="form-group">
            <label>Wait for URL to contain</label>
            <input class="input" value="${esc(step.wait_for_url)}"
              placeholder="/dashboard/"
              onchange="updateStep('${step._id}','wait_for_url',this.value)">
          </div>
          <div class="form-group">
            <label>Wait for selector (optional)</label>
            <input class="input" value="${esc(step.wait_for_selector||'')}"
              placeholder=".success-message"
              onchange="updateStep('${step._id}','wait_for_selector',this.value)">
          </div>
          <div class="form-group" style="justify-content:flex-end;padding-top:1.4rem">
            <label class="toggle-label">
              <input type="checkbox" ${step.skip_if_no_data?'checked':''}
                onchange="updateStep('${step._id}','skip_if_no_data',this.checked)">
              Skip if no CSV data
            </label>
          </div>
        </div>

        <div style="margin-bottom:.5rem;font-size:.82rem;font-weight:600;color:var(--text2)">Field Mappings</div>
        <div style="display:grid;grid-template-columns:180px 120px 1fr auto auto;gap:.35rem;margin-bottom:.35rem;padding:0 .1rem">
          <span style="font-size:.73rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Selector</span>
          <span style="font-size:.73rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Field Type</span>
          <span style="font-size:.73rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">CSV Column / Literal Value</span>
          <span></span>
          <span></span>
        </div>

        ${step.field_mappings.map(m => renderMappingRow(step._id, m)).join('')}

        <button class="btn btn-sm btn-ghost" onclick="addMapping('${step._id}')" style="margin-top:.5rem">+ Add Field</button>
      </div>
    </div>
  `).join('');
}

function renderMappingRow(stepId, m) {
  const ftypes = ['text','password','email','tel','number','textarea','select','radio','checkbox','click'];
  
  let valueMapHtml = '';
  if (m.value_map && m.value_map.length > 0) {
    valueMapHtml = `<div style="grid-column:1/-1; padding: .5rem; background: var(--bg); border-radius: var(--radius-sm); margin-bottom:.5rem;">
      <div style="font-size:.75rem; color:var(--text3); margin-bottom:.3rem;">Value Mapping (If CSV matches 'From', replace with 'To')</div>
      ${m.value_map.map(vm => `
        <div class="row gap-sm" style="margin-bottom:.3rem">
          <input class="input" style="font-size:.8rem" placeholder="From (e.g. Male)" value="${esc(vm.from_val)}" onchange="updateValueMap('${stepId}',${m._id},${vm._id},'from_val',this.value)">
          <span style="color:var(--text3)">→</span>
          <input class="input" style="font-size:.8rem" placeholder="To (e.g. male)" value="${esc(vm.to_val)}" onchange="updateValueMap('${stepId}',${m._id},${vm._id},'to_val',this.value)">
          <button class="btn btn-sm btn-danger" onclick="removeValueMap('${stepId}',${m._id},${vm._id})">✕</button>
        </div>
      `).join('')}
    </div>`;
  }

  return `
    <div class="mapping-row" id="mrow-${m._id}">
      <input class="input" placeholder='[name="field"] or #id'
        value="${esc(m.selector)}"
        title="${esc(m.label||m.selector)}"
        onchange="updateMapping('${stepId}',${m._id},'selector',this.value)">
      <select class="input" onchange="updateMapping('${stepId}',${m._id},'field_type',this.value)">
        ${ftypes.map(t => `<option value="${t}" ${m.field_type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      ${renderMappingValue(stepId, m)}
      <button class="btn btn-sm btn-ghost" onclick="addValueMap('${stepId}',${m._id})" title="Add inline mapping">🔀</button>
      <button class="btn btn-sm btn-danger" onclick="removeMapping('${stepId}',${m._id})">✕</button>
    </div>
    ${m.field_type === 'radio' ? `
    <div style="grid-column:1/-1;padding-left:.5rem;margin-bottom:.3rem;margin-top:-.25rem">
      <div style="font-size:.75rem;color:var(--text3);margin-bottom:.2rem">Radio name attribute:</div>
      <input class="input" style="width:200px;font-size:.8rem" placeholder='e.g. gender'
        value="${esc(m.radio_name||'')}"
        onchange="updateMapping('${stepId}',${m._id},'radio_name',this.value)">
    </div>` : ''}
    ${valueMapHtml}
  `;
}

function renderMappingValue(stepId, m) {
  if (m.source === 'literal') {
    const isPass = m.field_type === 'password';
    return `
      <div class="row gap-sm" style="min-width:0">
        <select class="input" style="width:90px;flex-shrink:0" onchange="updateMapping('${stepId}',${m._id},'source',this.value)">
          <option value="csv_column">CSV col</option>
          <option value="literal" selected>Literal</option>
        </select>
        <input class="input flex-1" type="${isPass?'password':'text'}" placeholder="literal value"
          value="${esc(m.literal_value)}"
          onchange="updateMapping('${stepId}',${m._id},'literal_value',this.value)">
      </div>
    `;
  }
  // csv_column
  return `
    <div class="row gap-sm" style="min-width:0">
      <select class="input" style="width:90px;flex-shrink:0" onchange="updateMapping('${stepId}',${m._id},'source',this.value)">
        <option value="csv_column" selected>CSV col</option>
        <option value="literal">Literal</option>
      </select>
      <input class="input flex-1" placeholder="CSV header name"
        value="${esc(m.csv_column)}"
        onchange="updateMapping('${stepId}',${m._id},'csv_column',this.value)">
    </div>
  `;
}

// ── Save / Load / Clear ─────────────────────────────────────

async function saveRecipe() {
  const name = document.getElementById('recipe-name').value.trim();
  if (!name) { alert('Please enter a recipe name.'); return; }

  const recipe = buildRecipePayload();

  try {
    let result;
    if (editingRecipeId) {
      result = await API.updateRecipe(editingRecipeId, recipe);
    } else {
      result = await API.saveRecipe(recipe);
      editingRecipeId = result.recipe_id;
    }
    const st = document.getElementById('save-status');
    st.textContent = `✓ Saved as "${result.name}" (${result.recipe_id})`;
    setTimeout(() => { st.textContent = ''; }, 4000);
    loadRecipesList();
    populateRunRecipeSelect();
  } catch (e) {
    alert('Save error: ' + e.message);
  }
}

function buildRecipePayload() {
  const cleanLoginSteps = recipeLoginSteps.map(s => ({
    url: s.url,
    fields: (s.fields || []).map(f => ({
      selector: f.selector,
      field_type: f.field_type || 'text',
      source: 'literal',
      literal_value: f.literal_value || '',
    })),
    submit_selector: s.submit_selector,
    wait_for_url: s.wait_for_url,
  }));

  const cleanFlow = flowSteps.map(s => ({
    step_id: s.step_id || s._id,
    label: s.label,
    url: s.url,
    field_mappings: (s.field_mappings || []).map(m => ({
      selector: m.selector,
      field_type: m.field_type,
      radio_name: m.radio_name || '',
      source: m.source || 'csv_column',
      csv_column: m.csv_column || '',
      literal_value: m.literal_value || '',
      label: m.label || m.selector,
      value_map: (m.value_map || []).map(v => ({ from_val: v.from_val, to_val: v.to_val }))
    })),
    submit_selector: s.submit_selector || '',
    wait_for_url: s.wait_for_url || '',
    wait_for_selector: s.wait_for_selector || '',
    skip_if_no_data: !!s.skip_if_no_data,
  }));

  return {
    name: document.getElementById('recipe-name').value.trim(),
    description: document.getElementById('recipe-desc').value.trim(),
    base_url: document.getElementById('recipe-base-url').value.trim(),
    flow: cleanFlow,
    login_steps: cleanLoginSteps,
    delay: {
      between_records_ms: parseInt(document.getElementById('d-records').value) || 800,
      between_fields_ms:  parseInt(document.getElementById('d-fields').value)  || 100,
      between_steps_ms:   parseInt(document.getElementById('d-steps').value)   || 300,
      char_delay_ms:      parseInt(document.getElementById('d-char').value)    || 0,
      page_load_timeout_ms: parseInt(document.getElementById('d-page').value)  || 15000,
      action_timeout_ms:    parseInt(document.getElementById('d-action').value)|| 8000,
    },
  };
}

function loadRecipeIntoFlow(recipe) {
  editingRecipeId = recipe.recipe_id;
  document.getElementById('recipe-name').value    = recipe.name || '';
  document.getElementById('recipe-desc').value    = recipe.description || '';
  document.getElementById('recipe-base-url').value= recipe.base_url || '';

  const d = recipe.delay || {};
  document.getElementById('d-records').value = d.between_records_ms ?? 800;
  document.getElementById('d-fields').value  = d.between_fields_ms  ?? 100;
  document.getElementById('d-steps').value   = d.between_steps_ms   ?? 300;
  document.getElementById('d-char').value    = d.char_delay_ms      ?? 0;
  document.getElementById('d-page').value    = d.page_load_timeout_ms ?? 15000;
  document.getElementById('d-action').value  = d.action_timeout_ms  ?? 8000;

  recipeLoginSteps = (recipe.login_steps || []).map((s, i) => ({
    ...s, _id: Date.now() + i,
    fields: (s.fields || []).map(f => ({ ...f })),
  }));
  renderRecipeLoginSteps();

  flowSteps = (recipe.flow || []).map((s, si) => ({
    ...s,
    _id: s.step_id || ('step_' + Date.now() + si),
    _open: false,
    field_mappings: (s.field_mappings || []).map(m => ({
      ...m, 
      _id: Date.now() + Math.random(),
      value_map: m.value_map || [] 
    })),
  }));
  renderFlowSteps();
  switchTab('flow');
}

function clearFlow() {
  if (!confirm('Clear all flow steps?')) return;
  flowSteps = [];
  recipeLoginSteps = [];
  editingRecipeId = null;
  document.getElementById('recipe-name').value = '';
  document.getElementById('recipe-desc').value = '';
  document.getElementById('recipe-base-url').value = '';
  renderFlowSteps();
  renderRecipeLoginSteps();
}