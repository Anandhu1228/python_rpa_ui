/* app.js — tab routing, modal, bootstrap */

// ── Tab switching ───────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-tab="${name}"]`);
  if (nav) nav.classList.add('active');

  if (name === 'recipes') loadRecipesList();
  if (name === 'run')     populateRunRecipeSelect();
  if (name === 'flow')    renderRecipeLoginSteps();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    switchTab(item.dataset.tab);
  });
});

// ── Modal ───────────────────────────────────────────────────

let modalSaveCallback = null;

function openModal(title, bodyHTML, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalSaveCallback = onSave;
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalSaveCallback = null;
}

function saveModal() {
  if (modalSaveCallback) modalSaveCallback();
  closeModal();
}

// ── Bootstrap ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Initialize empty renders
  renderLoginSteps();
  renderFlowSteps();
  renderRecipeLoginSteps();

  // Initial tab
  switchTab('inspector');
});

// ── Global keyboard ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
