import { api } from '../api.js';

export function renderLogin(onSuccess) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page-center">
      <div class="login-card fade-up">
        <div class="login-logo">
          <div class="logo-badge">⬆</div>
          <h1>yt2gd</h1>
          <p>Sign in to continue</p>
        </div>

        <form id="login-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input id="username" class="form-control" type="text"
              placeholder="Enter your username" autocomplete="username" required />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input id="password" class="form-control" type="password"
              placeholder="Enter your password" autocomplete="current-password" required />
          </div>

          <div id="login-error" class="alert alert-error" style="display:none; margin-bottom:16px;"></div>

          <button id="login-btn" type="submit" class="btn btn-primary btn-block">
            Sign In
          </button>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const btn = document.getElementById('login-btn');
  const errBox = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      const data = await api.login(username, password);
      onSuccess(data.username);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'flex';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}
