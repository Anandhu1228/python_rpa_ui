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
  if (name === 'uploads') loadUploadsList();
  if (name === 'logs')    loadRunHistory();
  
  sessionStorage.setItem('activeTab', name);
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

// ── Bootstrap & Auth ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Theme init
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const newTheme = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
    });
  }

  // Initialize empty renders
  renderLoginSteps();
  renderFlowSteps();
  renderRecipeLoginSteps();

  // Auth Check
  if (!localStorage.getItem('rpa_token')) {
     window.showAuthScreen();
  } else {
     document.getElementById('logout-btn').classList.remove('hidden');
     const savedTab = sessionStorage.getItem('activeTab') || 'inspector';
     switchTab(savedTab);
  }
});

// ── Global keyboard ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Auth Views ──────────────────────────────────────────────

window.showAuthScreen = async function() {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('logout-btn').classList.add('hidden');
    try {
        const status = await API.checkAuth();
        if (status.has_users) {
            renderLogin();
        } else {
            renderSignup();
        }
    } catch(e) {
        console.error("Auth check failed", e);
    }
};

window.renderLogin = function() {
    document.getElementById('auth-title').textContent = "Login to RPA Studio";
    document.getElementById('auth-body').innerHTML = `
        <input id="auth-user" class="input" placeholder="Username" style="margin-bottom: .5rem;">
        <input id="auth-pass" type="password" class="input" placeholder="Password" style="margin-bottom: .5rem;">
        <a href="#" onclick="renderForgot()" style="font-size: .8rem; color: var(--accent);">Forgot Password?</a>
    `;
    document.getElementById('auth-footer').innerHTML = `
        <button class="btn btn-primary" onclick="doLogin()">Login</button>
    `;
};

window.renderSignup = function() {
    document.getElementById('auth-title').textContent = "Welcome! Create Admin Account";
    document.getElementById('auth-body').innerHTML = `
        <input id="auth-user" class="input" placeholder="Username" style="margin-bottom: .5rem;">
        <input id="auth-pass" type="password" class="input" placeholder="Password" style="margin-bottom: .5rem;">
        <input id="auth-pin" type="password" class="input" placeholder="Security PIN (e.g. 1234)" style="margin-bottom: .5rem;" title="External key used for password resets">
        <input id="auth-q" class="input" placeholder="Security Question (e.g. First pet's name?)" style="margin-bottom: .5rem;">
        <input id="auth-a" type="password" class="input" placeholder="Security Answer" style="margin-bottom: .5rem;">
    `;
    document.getElementById('auth-footer').innerHTML = `
        <button class="btn btn-primary" onclick="doSignup()">Create Account</button>
    `;
};

window.renderForgot = function() {
    document.getElementById('auth-title').textContent = "Reset Password";
    document.getElementById('auth-body').innerHTML = `
        <input id="auth-user" class="input" placeholder="Username" style="margin-bottom: .5rem;">
        <button class="btn btn-sm btn-ghost" onclick="fetchQuestion()" style="margin-bottom: .5rem;">Get Question</button>
        <div id="q-text" style="font-size:.85rem; margin-bottom:.5rem; color:var(--text2);"></div>
        <input id="auth-a" type="password" class="input hidden" placeholder="Security Answer" style="margin-bottom: .5rem;">
        <input id="auth-pin" type="password" class="input hidden" placeholder="Security PIN" style="margin-bottom: .5rem;">
        <input id="auth-new" type="password" class="input hidden" placeholder="New Password" style="margin-bottom: .5rem;">
    `;
    document.getElementById('auth-footer').innerHTML = `
        <button class="btn btn-ghost" onclick="renderLogin()">Cancel</button>
        <button class="btn btn-primary hidden" id="btn-reset" onclick="doReset()">Reset Password</button>
    `;
};

window.fetchQuestion = async function() {
    const u = document.getElementById('auth-user').value;
    if(!u) return alert("Enter username");
    try {
        const res = await API.getSecurityQuestion(u);
        document.getElementById('q-text').textContent = "Q: " + res.question;
        document.getElementById('auth-a').classList.remove('hidden');
        document.getElementById('auth-pin').classList.remove('hidden');
        document.getElementById('auth-new').classList.remove('hidden');
        document.getElementById('btn-reset').classList.remove('hidden');
    } catch(e) { alert(e.message); }
};

window.doSignup = async function() {
    const payload = {
        username: document.getElementById('auth-user').value,
        password: document.getElementById('auth-pass').value,
        security_pin: document.getElementById('auth-pin').value,
        security_question: document.getElementById('auth-q').value,
        security_answer: document.getElementById('auth-a').value
    };
    try {
        await API.signup(payload);
        alert("Account created. Please log in.");
        renderLogin();
    } catch(e) { alert(e.message); }
};

window.doLogin = async function() {
    const payload = {
        username: document.getElementById('auth-user').value,
        password: document.getElementById('auth-pass').value
    };
    try {
        const res = await API.login(payload);
        localStorage.setItem('rpa_token', res.token);
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        const savedTab = sessionStorage.getItem('activeTab') || 'inspector';
        switchTab(savedTab);
    } catch(e) { alert(e.message); }
};

window.doReset = async function() {
    const payload = {
        username: document.getElementById('auth-user').value,
        security_pin: document.getElementById('auth-pin').value,
        security_answer: document.getElementById('auth-a').value,
        new_password: document.getElementById('auth-new').value
    };
    try {
        await API.resetPassword(payload);
        alert("Password reset! Please log in with your new password.");
        renderLogin();
    } catch(e) { alert(e.message); }
};