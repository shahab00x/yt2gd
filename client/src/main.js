import './style.css';
import { api } from './api.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSettings } from './views/settings.js';

let currentUser = null;

function navigate(view) {
  if (view === 'logout') {
    currentUser = null;
    renderLogin((username) => {
      currentUser = username;
      navigate('dashboard');
    });
    return;
  }
  if (view === 'dashboard') {
    renderDashboard(currentUser, navigate);
    return;
  }
  if (view === 'settings') {
    renderSettings(currentUser, navigate);
    return;
  }
}

// On load, check if there is an existing session
(async () => {
  try {
    const data = await api.me();
    currentUser = data.username;
    navigate('dashboard');
  } catch {
    // Not authenticated — show login
    renderLogin((username) => {
      currentUser = username;
      navigate('dashboard');
    });
  }
})();
