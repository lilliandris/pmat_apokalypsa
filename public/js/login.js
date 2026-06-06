'use strict';

(async function init() {
  // Ak je používateľ už prihlásený, presmeruj ho rovno na jeho panel.
  try {
    const user = await fetchMe();
    if (user) {
      window.location.href = user.role === 'admin' ? '/admin' : '/leader';
      return;
    }
  } catch (e) { /* nie je prihlásený, pokračuj na login */ }

  const form = document.getElementById('login-form');
  const errorMsg = document.getElementById('error-msg');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Prihlasujem...';
    try {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const data = await apiFetch('/api/login', { method: 'POST', body: { username, password } });
      window.location.href = data.user.role === 'admin' ? '/admin' : '/leader';
    } catch (err) {
      errorMsg.textContent = err.message || 'Prihlásenie zlyhalo.';
      errorMsg.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Prihlásiť sa';
    }
  });
})();
