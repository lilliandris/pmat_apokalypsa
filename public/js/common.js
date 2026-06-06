'use strict';

// Spoločné pomocné funkcie zdieľané medzi všetkými stránkami.

async function apiFetch(url, options) {
  const opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options);
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* prázdna odpoveď */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Chyba ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchMe() {
  const data = await apiFetch('/api/me');
  return data.user;
}

// Presmeruje na login, ak používateľ nie je prihlásený, alebo ak nemá požadovanú rolu
// (ak je requiredRole zadaná). Vráti prihláseného používateľa.
async function requireUser(requiredRole) {
  let user = null;
  try {
    user = await fetchMe();
  } catch (e) { /* ignoruj */ }
  if (!user) {
    window.location.href = '/login';
    return null;
  }
  if (requiredRole && user.role !== requiredRole) {
    window.location.href = user.role === 'admin' ? '/admin' : '/leader';
    return null;
  }
  return user;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatShort(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s}s`;
  return `${m} min ${s}s`;
}

// Plynulý prechod farby z zelenej (veľa času) cez žltú do červenej (málo času).
function barColor(percent) {
  const p = Math.max(0, Math.min(1, percent));
  // 0 -> červená (0, 70%, 56%); 0.5 -> žltá (48, 90%, 56%); 1 -> zelená (140, 65%, 45%)
  let hue;
  if (p >= 0.5) {
    hue = 48 + (140 - 48) * ((p - 0.5) / 0.5);
  } else {
    hue = 0 + (48 - 0) * (p / 0.5);
  }
  const sat = 70 - 14 * p;
  const light = 50 + 6 * p;
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

// Drží offset medzi serverovým a lokálnym časom, aby odpočítavanie bolo presné
// bez ohľadu na to, či je hodina zariadenia nastavená správne.
const ServerClock = {
  offset: 0,
  sync(serverTime) {
    this.offset = serverTime - Date.now();
  },
  now() {
    return Date.now() + this.offset;
  },
};

function connectLiveSocket(onState) {
  const socket = io();
  socket.on('state', (payload) => {
    ServerClock.sync(payload.serverTime);
    onState(payload);
  });
  return socket;
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
  }
  (children || []).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

async function logout() {
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignoruj */ }
  window.location.href = '/login';
}
