'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');

const config = require('./config');
const store = require('./store');

store.load();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
});

app.use(express.json());
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// ---------- Pomocné funkcie ----------

function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  const user = store.findUserById(req.session.userId);
  return user ? store.publicUser(user) : null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Nie si prihlásený.' });
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Na túto akciu nemáš oprávnenie.' });
    }
    next();
  };
}

function broadcastState() {
  io.emit('state', buildStatePayload());
}

function buildStatePayload() {
  return {
    serverTime: Date.now(),
    settings: store.getSettings(),
    game: store.getGameState(),
    participants: store.getParticipantsPublic(),
  };
}

// ---------- Stránky ----------

const PAGES = {
  '/': 'live.html',
  '/live': 'live.html',
  '/login': 'login.html',
  '/admin': 'admin.html',
  '/leader': 'leader.html',
};

Object.entries(PAGES).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

// ---------- Auth API ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findUserByUsername(username || '');
  if (!user || !store.verifyPassword(user, password || '')) {
    return res.status(401).json({ error: 'Nesprávne meno alebo heslo.' });
  }
  req.session.userId = user.id;
  res.json({ user: store.publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

// ---------- Verejné dáta (pre live tabuľu aj panely) ----------

app.get('/api/config', (req, res) => {
  res.json({
    ingredients: config.INGREDIENTS,
    cooldownMs: config.SUBMISSION_COOLDOWN_MS,
  });
});

app.get('/api/state', (req, res) => {
  res.json(buildStatePayload());
});

// ---------- Účastníci (admin spravuje, vedúci/admin nahrávajú) ----------

app.post('/api/participants', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.addParticipant(req.body && req.body.name);
  if (result.error) return res.status(400).json({ error: result.error });
  broadcastState();
  res.json(result);
});

app.patch('/api/participants/:id', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.renameParticipant(req.params.id, req.body && req.body.name);
  if (result.error) return res.status(400).json({ error: result.error });
  broadcastState();
  res.json(result);
});

app.delete('/api/participants/:id', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.deleteParticipant(req.params.id);
  if (result.error) return res.status(404).json({ error: result.error });
  broadcastState();
  res.json(result);
});

app.get('/api/participants/:id/history', requireAuth, requireRole('admin'), (req, res) => {
  const history = store.getSubmissionHistory(req.params.id);
  if (!history) return res.status(404).json({ error: 'Účastník neexistuje.' });
  res.json({ history, ingredients: config.INGREDIENTS });
});

app.patch('/api/participants/:pid/submissions/:sid', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.editSubmission(req.params.pid, req.params.sid, (req.body && req.body.ingredientIndexes) || []);
  if (result.error) return res.status(400).json({ error: result.error });
  broadcastState();
  res.json(result);
});

app.patch('/api/participants/:id/remaining', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.setParticipantRemaining(req.params.id, req.body && req.body.remainingMs);
  if (result.error) return res.status(400).json({ error: result.error });
  broadcastState();
  res.json(result);
});

app.delete('/api/participants/:pid/submissions/:sid', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.deleteSubmission(req.params.pid, req.params.sid);
  if (result.error) return res.status(404).json({ error: result.error });
  broadcastState();
  res.json(result);
});

// ---------- Nahrávanie prísad (vedúci aj admin) ----------

app.post('/api/submissions', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'leader') {
    return res.status(403).json({ error: 'Na túto akciu nemáš oprávnenie.' });
  }
  const { participantId, ingredientIndexes, force } = req.body || {};
  const result = store.addSubmission({
    participantId,
    leaderId: req.user.id,
    leaderName: req.user.name,
    ingredientIndexes,
    force: !!force && req.user.role === 'admin',
  });
  if (result.error) {
    return res.status(409).json(result);
  }
  broadcastState();
  res.json(result);
});

// Aktuálny stav čakacej doby pre konkrétneho účastníka (na rýchle prekreslenie tlačidla).
app.get('/api/participants/:id/cooldown', requireAuth, (req, res) => {
  const p = store.getParticipantFull(req.params.id);
  if (!p) return res.status(404).json({ error: 'Účastník neexistuje.' });
  res.json({ cooldownRemaining: store.cooldownRemaining(p) });
});

// ---------- Správa používateľov (len admin) ----------

app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ users: store.getUsers() });
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Meno a heslo sú povinné.' });
  }
  const result = store.createUser({ username, password, name, role });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Nemôžeš zmazať sám seba.' });
  }
  const result = store.deleteUser(req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// ---------- Riadenie hry: štart / pauza / reset (len admin) ----------

app.post('/api/game/start', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.startGame();
  broadcastState();
  res.json(result);
});

app.post('/api/game/pause', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.pauseGame();
  broadcastState();
  res.json(result);
});

app.post('/api/game/reset', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.resetGame();
  broadcastState();
  res.json(result);
});

// ---------- Nastavenia (len admin) ----------

app.post('/api/settings', requireAuth, requireRole('admin'), (req, res) => {
  const result = store.updateSettings(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  broadcastState();
  res.json(result);
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  socket.emit('state', buildStatePayload());
});

const PORT = process.env.PORT || 3000;

// Pri spustení priamo (`node server.js`) naštartujeme HTTP server na PORT. Pri importovaní
// modulu (napr. v testoch cez `require('./server')`) necháme spustenie na volajúcom -
// ten si zvyčajne vyberie náhodný voľný port (`server.listen(0, ...)`).
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server beží na http://localhost:${PORT}`);
    console.log(`  Live tabuľa:   http://localhost:${PORT}/live`);
    console.log(`  Prihlásenie:   http://localhost:${PORT}/login`);
  });
}

module.exports = { app, server, io };
