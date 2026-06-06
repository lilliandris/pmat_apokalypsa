'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const config = require('./config');
const { calculateDelta } = require('./calculate');

// Cestu k databáze možno nahradiť cez DB_FILE (napr. v testoch, aby nezasahovali do reálnych dát).
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');

let db = {
  users: [],
  participants: [],
  settings: {
    startingMinutes: config.DEFAULT_STARTING_MINUTES,
  },
  game: {
    status: 'pending', // 'pending' | 'running' | 'paused'
    accumulatedMs: 0,
    segmentStartedAt: null,
  },
};

// Staré dáta poznali len absolútny `baseDeathTime` (hra vždy bežala). Prevedieme ich na
// `joinVirtual` tak, aby účastníkom ostal presne ten istý zostávajúci čas ako predtým,
// a hru necháme bežať ďalej (aby sa odpočet neprerušil pod rukami).
function migrateLegacyParticipants(now) {
  let migrated = false;
  db.participants.forEach((p) => {
    if (p.joinVirtual !== undefined) return;
    if (p.baseDeathTime !== undefined) {
      const totalDelta = p.submissions.reduce((sum, s) => sum + s.delta, 0);
      const remainingMs = Math.max(0, (p.baseDeathTime + totalDelta) - now);
      p.joinVirtual = remainingMs - p.startingDuration - totalDelta;
      delete p.baseDeathTime;
      migrated = true;
    } else {
      p.joinVirtual = 0;
    }
  });
  return migrated;
}

function load() {
  let parsed = null;
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      parsed = JSON.parse(raw);
      db = Object.assign(db, parsed);
      if (!db.settings) db.settings = { startingMinutes: config.DEFAULT_STARTING_MINUTES };
    } catch (err) {
      console.error('Nepodarilo sa načítať data/db.json, štartujem s prázdnou databázou:', err.message);
    }
  }

  // `db` má v predvolenom stave svoje vlastné `game`, takže `Object.assign` ho ponechá aj keď
  // v uloženom súbore chýba - zisťujeme preto priamo z načítaných dát, či ide o prvé spustenie.
  if (!parsed || !parsed.game) {
    const now = Date.now();
    const legacy = migrateLegacyParticipants(now);
    // Staré dáta = hra už bežala, tak v nej pokračujeme. Nové inštalácie štartujú v pokoji,
    // kým ju admin výslovne nespustí.
    db.game = legacy
      ? { status: 'running', accumulatedMs: 0, segmentStartedAt: now }
      : { status: 'pending', accumulatedMs: 0, segmentStartedAt: null };
  }

  if (db.users.length === 0) {
    const id = crypto.randomUUID();
    const username = config.ADMIN_USERNAME;
    const password = config.ADMIN_PASSWORD;
    db.users.push({
      id,
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
      name: 'Administrátor',
    });
    save();
    console.log('================================================');
    console.log(' Vytvorený predvolený admin účet:');
    console.log('   používateľské meno: ' + username);
    console.log('   heslo:              ' + password);
    console.log(' Nastav si vlastné v .env (ADMIN_USERNAME / ADMIN_PASSWORD).');
    console.log(' Po prihlásení si v admin paneli vytvor ďalšie účty.');
    console.log('================================================');
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Nepodarilo sa uložiť databázu:', err.message);
  }
}

// ---------- Používatelia (admin / vedúci) ----------

function getUsers() {
  return db.users.map(publicUser);
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, name: u.name };
}

function findUserByUsername(username) {
  return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
}

function findUserById(id) {
  return db.users.find((u) => u.id === id);
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.passwordHash);
}

function createUser({ username, password, name, role }) {
  if (findUserByUsername(username)) {
    return { error: 'Používateľ s týmto menom už existuje.' };
  }
  const user = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: role === 'admin' ? 'admin' : 'leader',
    name: String(name || username).trim(),
  };
  db.users.push(user);
  save();
  return { user: publicUser(user) };
}

function deleteUser(id) {
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return { error: 'Používateľ neexistuje.' };
  if (db.users[idx].role === 'admin' && db.users.filter((u) => u.role === 'admin').length <= 1) {
    return { error: 'Nemôžeš zmazať posledný admin účet.' };
  }
  db.users.splice(idx, 1);
  save();
  return { ok: true };
}

// ---------- Hodiny hry (umožňujú štart/pauzu/reset) ----------
//
// Namiesto reálneho hodinového času počítame s "virtuálnym" časom hry, ktorý plynie len
// kým hra beží (status 'running') a je zmrazený, kým je v stave 'pending' alebo 'paused'.
// Vďaka tomu sa odpočet účastníkov nehýbe, kým ho admin výslovne nespustí alebo ho pozastaví.

function virtualNow(now = Date.now()) {
  if (db.game.status === 'running' && db.game.segmentStartedAt != null) {
    return db.game.accumulatedMs + (now - db.game.segmentStartedAt);
  }
  return db.game.accumulatedMs;
}

function getGameState() {
  return { status: db.game.status };
}

function startGame() {
  if (db.game.status === 'running') return { game: getGameState() };
  const now = Date.now();
  db.game.accumulatedMs = virtualNow(now);
  db.game.segmentStartedAt = now;
  db.game.status = 'running';
  save();
  return { game: getGameState() };
}

function pauseGame() {
  if (db.game.status !== 'running') return { game: getGameState() };
  const now = Date.now();
  db.game.accumulatedMs = virtualNow(now);
  db.game.segmentStartedAt = null;
  db.game.status = 'paused';
  save();
  return { game: getGameState() };
}

// Vráti hru aj všetkých účastníkov do počiatočného stavu - vymaže nahrávky a odpočet
// začne nanovo od nuly, až kým ho admin opäť nespustí. Nevratná akcia (potvrdzuje sa v UI).
function resetGame() {
  db.game = { status: 'pending', accumulatedMs: 0, segmentStartedAt: null };
  db.participants.forEach((p) => {
    p.submissions = [];
    p.joinVirtual = 0;
  });
  save();
  return { game: getGameState() };
}

// ---------- Účastníci (deti) ----------

function computeParticipantState(p, now = Date.now()) {
  const vNow = virtualNow(now);
  const totalDelta = p.submissions.reduce((sum, s) => sum + s.delta, 0);
  const deathVirtual = p.joinVirtual + p.startingDuration + totalDelta;
  const remainingMs = Math.max(0, deathVirtual - vNow);
  const alive = vNow < deathVirtual;
  const percent = p.startingDuration > 0
    ? Math.max(0, Math.min(1, remainingMs / p.startingDuration))
    : 0;
  const lastSubmission = p.submissions.length
    ? p.submissions[p.submissions.length - 1]
    : null;
  return {
    id: p.id,
    name: p.name,
    startingDuration: p.startingDuration,
    remainingMs,
    alive,
    percent,
    lastSubmissionAt: lastSubmission ? lastSubmission.timestamp : null,
    submissionCount: p.submissions.length,
  };
}

function getParticipantsPublic(now = Date.now()) {
  return db.participants
    .map((p) => computeParticipantState(p, now))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk'));
}

function getParticipantFull(id) {
  return db.participants.find((p) => p.id === id);
}

function addParticipant(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Meno účastníka nesmie byť prázdne.' };
  const startingDuration = db.settings.startingMinutes * 60 * 1000;
  const now = Date.now();
  const participant = {
    id: crypto.randomUUID(),
    name: trimmed,
    joinVirtual: virtualNow(now),
    startingDuration,
    createdAt: now,
    submissions: [],
  };
  db.participants.push(participant);
  save();
  return { participant: computeParticipantState(participant, now) };
}

function deleteParticipant(id) {
  const idx = db.participants.findIndex((p) => p.id === id);
  if (idx === -1) return { error: 'Účastník neexistuje.' };
  db.participants.splice(idx, 1);
  save();
  return { ok: true };
}

function renameParticipant(id, name) {
  const p = getParticipantFull(id);
  if (!p) return { error: 'Účastník neexistuje.' };
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Meno účastníka nesmie byť prázdne.' };
  p.name = trimmed;
  save();
  return { participant: computeParticipantState(p) };
}

// Koľko ms ešte musí vedúci čakať, kým bude môcť tomuto účastníkovi znova nahrať prísady.
function cooldownRemaining(participant, now = Date.now()) {
  if (!participant.submissions.length) return 0;
  const last = participant.submissions[participant.submissions.length - 1];
  const elapsed = now - last.timestamp;
  return Math.max(0, config.SUBMISSION_COOLDOWN_MS - elapsed);
}

// Pridanie nahrávky prísad. `force` (len pre admina) obíde kontrolu 1-minútového odstupu -
// slúži na opravu chybných vstupov, nie na bežné nahrávanie.
function addSubmission({ participantId, leaderId, leaderName, ingredientIndexes, force }) {
  const p = getParticipantFull(participantId);
  if (!p) return { error: 'Účastník neexistuje.' };
  if (!Array.isArray(ingredientIndexes) || ingredientIndexes.length === 0) {
    return { error: 'Vyber aspoň jednu prísadu.' };
  }
  const cleanIndexes = [...new Set(ingredientIndexes)]
    .map(Number)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < config.INGREDIENTS.length)
    .sort((a, b) => a - b);
  if (cleanIndexes.length === 0) {
    return { error: 'Neplatný výber prísad.' };
  }

  const now = Date.now();
  if (!force) {
    const remaining = cooldownRemaining(p, now);
    if (remaining > 0) {
      return { error: 'Tomuto účastníkovi ešte nemožno nahrať - musí počkať aspoň minútu.', cooldownRemaining: remaining };
    }
  }

  const submission = {
    id: crypto.randomUUID(),
    leaderId,
    leaderName,
    ingredientIndexes: cleanIndexes,
    delta: calculateDelta(cleanIndexes),
    timestamp: now,
  };
  p.submissions.push(submission);
  save();
  return { submission, participant: computeParticipantState(p, now) };
}

// Oprava/zmazanie chybnej nahrávky - len pre admina. Prepočíta sa celkový čas účastníka.
function deleteSubmission(participantId, submissionId) {
  const p = getParticipantFull(participantId);
  if (!p) return { error: 'Účastník neexistuje.' };
  const idx = p.submissions.findIndex((s) => s.id === submissionId);
  if (idx === -1) return { error: 'Nahrávka neexistuje.' };
  p.submissions.splice(idx, 1);
  save();
  return { participant: computeParticipantState(p) };
}

function editSubmission(participantId, submissionId, ingredientIndexes) {
  const p = getParticipantFull(participantId);
  if (!p) return { error: 'Účastník neexistuje.' };
  const submission = p.submissions.find((s) => s.id === submissionId);
  if (!submission) return { error: 'Nahrávka neexistuje.' };
  const cleanIndexes = [...new Set(ingredientIndexes)]
    .map(Number)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < config.INGREDIENTS.length)
    .sort((a, b) => a - b);
  if (cleanIndexes.length === 0) return { error: 'Neplatný výber prísad.' };
  submission.ingredientIndexes = cleanIndexes;
  submission.delta = calculateDelta(cleanIndexes);
  submission.editedAt = Date.now();
  save();
  return { participant: computeParticipantState(p) };
}

function getSubmissionHistory(participantId) {
  const p = getParticipantFull(participantId);
  if (!p) return null;
  return p.submissions.slice().reverse();
}

// Manuálne nastavenie zostávajúceho času na presnú hodnotu - napr. keď admin vie, že odpočet
// nesedí so skutočnosťou. Posunie len referenčný bod účastníka (joinVirtual), históriu
// nahrávok nemení a ďalej rešpektuje prípadné budúce úpravy/zmazania nahrávok.
function setParticipantRemaining(participantId, remainingMs) {
  const p = getParticipantFull(participantId);
  if (!p) return { error: 'Účastník neexistuje.' };
  const ms = Number(remainingMs);
  if (!Number.isFinite(ms) || ms < 0) {
    return { error: 'Zadaj platný zostávajúci čas (kladné číslo).' };
  }
  const now = Date.now();
  const totalDelta = p.submissions.reduce((sum, s) => sum + s.delta, 0);
  p.joinVirtual = virtualNow(now) + ms - p.startingDuration - totalDelta;
  save();
  return { participant: computeParticipantState(p, now) };
}

// ---------- Nastavenia ----------

function getSettings() {
  return { ...db.settings };
}

function updateSettings({ startingMinutes }) {
  const minutes = Number(startingMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { error: 'Štartovací čas musí byť kladné číslo (v minútach).' };
  }
  db.settings.startingMinutes = minutes;
  save();
  return { settings: getSettings() };
}

module.exports = {
  load,
  // users
  getUsers,
  findUserByUsername,
  findUserById,
  verifyPassword,
  createUser,
  deleteUser,
  publicUser,
  // participants
  getParticipantsPublic,
  getParticipantFull,
  addParticipant,
  deleteParticipant,
  renameParticipant,
  cooldownRemaining,
  addSubmission,
  deleteSubmission,
  editSubmission,
  getSubmissionHistory,
  setParticipantRemaining,
  computeParticipantState,
  // settings
  getSettings,
  updateSettings,
  // hra (štart/pauza/reset)
  getGameState,
  startGame,
  pauseGame,
  resetGame,
};
