'use strict';

(async function init() {
  const user = await requireUser('admin');
  if (!user) return;

  document.getElementById('user-name').textContent = `${user.name} · admin`;
  document.getElementById('logout-btn').addEventListener('click', logout);

  let cfg = { ingredients: [], cooldownMs: 60000 };
  try { cfg = await apiFetch('/api/config'); } catch (e) { /* defaults postačia */ }

  let state = { participants: [], settings: { startingMinutes: 60 }, game: { status: 'pending' }, serverTime: Date.now() };

  // Zostávajúci čas účastníka teraz - ak hra beží, dopočíta plynutie od posledného stavu zo servera.
  function remainingFor(p) {
    if (!p) return 0;
    if (state.game.status !== 'running') return p.remainingMs;
    const elapsed = ServerClock.now() - state.serverTime;
    return Math.max(0, p.remainingMs - elapsed);
  }

  // ---------- Riadenie hry ----------

  const gameStatusTag = document.getElementById('game-status-tag');
  const gameStartBtn = document.getElementById('game-start-btn');
  const gamePauseBtn = document.getElementById('game-pause-btn');
  const gameResetBtn = document.getElementById('game-reset-btn');
  const gameMsg = document.getElementById('game-msg');

  const GAME_STATUS_INFO = {
    pending: { text: '⏳ Hra ešte nezačala', style: 'color:#ffd76e; border-color: rgba(255,215,110,0.4); background: rgba(255,215,110,0.08);' },
    running: { text: '▶ Hra beží', style: 'color:#8cf0bb; border-color: rgba(61,220,132,0.4); background: rgba(61,220,132,0.08);' },
    paused: { text: '⏸ Hra je pozastavená', style: 'color:#ff9a9a; border-color: rgba(225,80,80,0.3); background: rgba(225,80,80,0.08);' },
  };

  function renderGameControls() {
    const status = state.game.status;
    const info = GAME_STATUS_INFO[status] || GAME_STATUS_INFO.pending;
    gameStatusTag.textContent = info.text;
    gameStatusTag.setAttribute('style', info.style);
    gameStartBtn.textContent = status === 'paused' ? '▶ Pokračovať' : '▶ Štart';
    gameStartBtn.disabled = status === 'running';
    gamePauseBtn.disabled = status !== 'running';
  }

  gameStartBtn.addEventListener('click', async () => {
    gameStartBtn.disabled = true;
    gameMsg.classList.add('hidden');
    try {
      await apiFetch('/api/game/start', { method: 'POST' });
    } catch (err) {
      showMsg(gameMsg, 'error', err.message || 'Nepodarilo sa spustiť hru.');
      renderGameControls();
    }
  });

  gamePauseBtn.addEventListener('click', async () => {
    gamePauseBtn.disabled = true;
    gameMsg.classList.add('hidden');
    try {
      await apiFetch('/api/game/pause', { method: 'POST' });
    } catch (err) {
      showMsg(gameMsg, 'error', err.message || 'Nepodarilo sa pozastaviť hru.');
      renderGameControls();
    }
  });

  gameResetBtn.addEventListener('click', async () => {
    if (!confirm('Naozaj chceš resetovať celú hru? Všetkým účastníkom sa vymaže história nahrávok a odpočet sa vráti na začiatok - táto akcia sa nedá vrátiť späť.')) return;
    gameResetBtn.disabled = true;
    gameMsg.classList.add('hidden');
    try {
      await apiFetch('/api/game/reset', { method: 'POST' });
      showMsg(gameMsg, 'success', '✓ Hra bola resetovaná na začiatok.');
    } catch (err) {
      showMsg(gameMsg, 'error', err.message || 'Resetovanie zlyhalo.');
    } finally {
      gameResetBtn.disabled = false;
    }
  });

  // ---------- Taby ----------

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === 'tab-' + tab);
      });
    });
  });

  function showMsg(elm, type, text) {
    elm.className = 'msg ' + type;
    elm.textContent = text;
    elm.classList.remove('hidden');
  }

  // ---------- Účastníci ----------

  const newNameInput = document.getElementById('new-name');
  const addParticipantBtn = document.getElementById('add-participant-btn');
  const addParticipantMsg = document.getElementById('add-participant-msg');
  const tbody = document.getElementById('participants-tbody');
  const participantsEmpty = document.getElementById('participants-empty');

  async function addParticipant() {
    const name = newNameInput.value.trim();
    if (!name) return;
    addParticipantBtn.disabled = true;
    addParticipantMsg.classList.add('hidden');
    try {
      await apiFetch('/api/participants', { method: 'POST', body: { name } });
      newNameInput.value = '';
      showMsg(addParticipantMsg, 'success', `✓ Účastník „${name}“ bol pridaný a odpočet mu začal bežať.`);
    } catch (err) {
      showMsg(addParticipantMsg, 'error', err.message || 'Nepodarilo sa pridať účastníka.');
    } finally {
      addParticipantBtn.disabled = false;
    }
  }
  addParticipantBtn.addEventListener('click', addParticipant);
  newNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addParticipant(); });

  const rowMap = new Map(); // id -> { tr, nameCell, statusCell, timeCell }

  function buildRow(p) {
    const nameCell = el('td', {});
    const nameSpan = el('span', { text: p.name, style: 'cursor:pointer; border-bottom: 1px dashed var(--border);', title: 'Klikni pre premenovanie' });
    nameSpan.addEventListener('click', () => startRename(p.id, nameCell, nameSpan));
    nameCell.appendChild(nameSpan);

    const statusCell = el('td', {});
    const timeCell = el('td', {});

    const historyBtn = el('button', { class: 'btn', text: 'História / oprava', style: 'padding:6px 12px; font-size:0.8rem;' });
    historyBtn.addEventListener('click', () => openHistory(p.id));

    const deleteBtn = el('button', { class: 'btn btn-danger', text: 'Zmazať', style: 'padding:6px 12px; font-size:0.8rem; margin-left:6px;' });
    deleteBtn.addEventListener('click', () => deleteParticipant(p.id, p.name));

    const actionsCell = el('td', {}, [historyBtn, deleteBtn]);
    const tr = el('tr', {}, [nameCell, statusCell, timeCell, actionsCell]);
    return { tr, nameCell, nameSpan, statusCell, timeCell };
  }

  function startRename(id, nameCell, nameSpan) {
    const current = nameSpan.textContent;
    const input = el('input', { type: 'text', value: current, style: 'max-width:220px; display:inline-block;' });
    input.value = current;
    nameCell.innerHTML = '';
    nameCell.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    async function commit() {
      if (done) return;
      done = true;
      const newName = input.value.trim();
      if (newName && newName !== current) {
        try {
          await apiFetch(`/api/participants/${id}`, { method: 'PATCH', body: { name: newName } });
        } catch (err) {
          alert(err.message || 'Premenovanie zlyhalo.');
        }
      }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { done = true; renderParticipants(); }
    });
  }

  async function deleteParticipant(id, name) {
    if (!confirm(`Naozaj natrvalo zmazať účastníka „${name}“ vrátane celej histórie?`)) return;
    try {
      await apiFetch(`/api/participants/${id}`, { method: 'DELETE' });
    } catch (err) {
      alert(err.message || 'Zmazanie zlyhalo.');
    }
  }

  function renderParticipants() {
    const ids = new Set(state.participants.map((p) => p.id));
    for (const [id, entry] of rowMap.entries()) {
      if (!ids.has(id)) { entry.tr.remove(); rowMap.delete(id); }
    }
    state.participants.forEach((p) => {
      let entry = rowMap.get(p.id);
      if (!entry) {
        entry = buildRow(p);
        rowMap.set(p.id, entry);
      }
      if (entry.nameSpan.textContent !== p.name) entry.nameSpan.textContent = p.name;
      tbody.appendChild(entry.tr);
    });
    participantsEmpty.classList.toggle('hidden', state.participants.length > 0);
    refreshParticipantTimes();
  }

  function refreshParticipantTimes() {
    const running = state.game.status === 'running';
    const elapsed = running ? ServerClock.now() - state.serverTime : 0;
    rowMap.forEach((entry, id) => {
      const p = state.participants.find((x) => x.id === id);
      if (!p) return;
      const remaining = running ? Math.max(0, p.remainingMs - elapsed) : p.remainingMs;
      const dead = remaining <= 0;
      entry.statusCell.innerHTML = '';
      entry.statusCell.appendChild(
        dead
          ? el('span', { class: 'tag', text: '💀 mŕtvy', style: 'color:#fff; border-color:#444;' })
          : el('span', { class: 'tag', text: '🟢 nažive', style: 'color:#8cf0bb; border-color: rgba(61,220,132,0.4);' })
      );
      entry.timeCell.textContent = dead ? '—' : formatDuration(remaining);
    });
  }

  // ---------- Vedúci a účty ----------

  const newUserName = document.getElementById('new-user-name');
  const newUsername = document.getElementById('new-username');
  const newPassword = document.getElementById('new-password');
  const newRole = document.getElementById('new-role');
  const addUserBtn = document.getElementById('add-user-btn');
  const addUserMsg = document.getElementById('add-user-msg');
  const usersTbody = document.getElementById('users-tbody');

  async function addUser() {
    const username = newUsername.value.trim();
    const password = newPassword.value;
    const name = newUserName.value.trim() || username;
    const role = newRole.value;
    if (!username || !password) {
      showMsg(addUserMsg, 'error', 'Vyplň aspoň prihlasovacie meno a heslo.');
      return;
    }
    addUserBtn.disabled = true;
    try {
      await apiFetch('/api/users', { method: 'POST', body: { username, password, name, role } });
      newUserName.value = '';
      newUsername.value = '';
      newPassword.value = '';
      newRole.value = 'leader';
      showMsg(addUserMsg, 'success', `✓ Účet „${username}“ bol vytvorený.`);
      await loadUsers();
    } catch (err) {
      showMsg(addUserMsg, 'error', err.message || 'Nepodarilo sa vytvoriť účet.');
    } finally {
      addUserBtn.disabled = false;
    }
  }
  addUserBtn.addEventListener('click', addUser);

  async function loadUsers() {
    let data;
    try { data = await apiFetch('/api/users'); } catch (e) { return; }
    usersTbody.innerHTML = '';
    data.users.forEach((u) => {
      const deleteBtn = el('button', { class: 'btn btn-danger', text: 'Zmazať', style: 'padding:6px 12px; font-size:0.8rem;' });
      deleteBtn.addEventListener('click', async () => {
        if (u.id === user.id) { alert('Nemôžeš zmazať sám seba.'); return; }
        if (!confirm(`Naozaj zmazať účet „${u.username}“?`)) return;
        try {
          await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
          await loadUsers();
        } catch (err) { alert(err.message || 'Zmazanie zlyhalo.'); }
      });
      const tr = el('tr', {}, [
        el('td', { text: u.name }),
        el('td', { text: u.username }),
        el('td', {}, [el('span', { class: 'tag ' + u.role, text: u.role === 'admin' ? 'Admin' : 'Vedúci' })]),
        el('td', {}, [deleteBtn]),
      ]);
      usersTbody.appendChild(tr);
    });
  }
  loadUsers();

  // ---------- Nastavenia ----------

  const startingMinutesInput = document.getElementById('starting-minutes');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const settingsMsg = document.getElementById('settings-msg');

  saveSettingsBtn.addEventListener('click', async () => {
    const minutes = Number(startingMinutesInput.value);
    settingsMsg.classList.add('hidden');
    if (!Number.isFinite(minutes) || minutes <= 0) {
      showMsg(settingsMsg, 'error', 'Zadaj kladné číslo minút.');
      return;
    }
    saveSettingsBtn.disabled = true;
    try {
      await apiFetch('/api/settings', { method: 'POST', body: { startingMinutes: minutes } });
      showMsg(settingsMsg, 'success', '✓ Štartovací čas bol uložený. Platí pre nových účastníkov pridaných odteraz.');
    } catch (err) {
      showMsg(settingsMsg, 'error', err.message || 'Uloženie zlyhalo.');
    } finally {
      saveSettingsBtn.disabled = false;
    }
  });

  // ---------- História / opravy ----------

  const historyOverlay = document.getElementById('history-overlay');
  const historyTitle = document.getElementById('history-title');
  const historyList = document.getElementById('history-list');
  let historyParticipantId = null;
  document.getElementById('history-close-btn').addEventListener('click', () => {
    historyOverlay.classList.add('hidden');
    historyParticipantId = null;
  });

  async function openHistory(participantId) {
    const p = state.participants.find((x) => x.id === participantId);
    historyParticipantId = participantId;
    historyTitle.textContent = `História nahrávok — ${p ? p.name : ''}`;
    historyOverlay.classList.remove('hidden');
    historyList.innerHTML = '<p class="muted">Načítavam…</p>';
    initManualTimeForm(p);
    await renderHistory(participantId);
  }

  // ---------- Manuálna úprava zostávajúceho času ----------

  const manualTimeCurrent = document.getElementById('manual-time-current');
  const manualTimeMinutes = document.getElementById('manual-time-minutes');
  const manualTimeSeconds = document.getElementById('manual-time-seconds');
  const manualTimeSaveBtn = document.getElementById('manual-time-save-btn');
  const manualTimeMsg = document.getElementById('manual-time-msg');

  function initManualTimeForm(p) {
    manualTimeMsg.classList.add('hidden');
    const remaining = remainingFor(p);
    manualTimeCurrent.textContent = p ? formatDuration(remaining) : '—';
    const totalSeconds = Math.floor(remaining / 1000);
    manualTimeMinutes.value = Math.floor(totalSeconds / 60);
    manualTimeSeconds.value = totalSeconds % 60;
  }

  function refreshManualTimeCurrent() {
    if (historyOverlay.classList.contains('hidden') || !historyParticipantId) return;
    const p = state.participants.find((x) => x.id === historyParticipantId);
    manualTimeCurrent.textContent = p ? formatDuration(remainingFor(p)) : '—';
  }

  manualTimeSaveBtn.addEventListener('click', async () => {
    if (!historyParticipantId) return;
    const minutes = Number(manualTimeMinutes.value);
    const seconds = Number(manualTimeSeconds.value);
    manualTimeMsg.classList.add('hidden');
    if (!Number.isInteger(minutes) || minutes < 0 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
      showMsg(manualTimeMsg, 'error', 'Zadaj platný čas - minúty (≥ 0) a sekundy (0 - 59).');
      return;
    }
    const remainingMs = (minutes * 60 + seconds) * 1000;
    manualTimeSaveBtn.disabled = true;
    try {
      await apiFetch(`/api/participants/${historyParticipantId}/remaining`, {
        method: 'PATCH',
        body: { remainingMs },
      });
      showMsg(manualTimeMsg, 'success', '✓ Zostávajúci čas bol nastavený.');
    } catch (err) {
      showMsg(manualTimeMsg, 'error', err.message || 'Úprava zlyhala.');
    } finally {
      manualTimeSaveBtn.disabled = false;
    }
  });

  async function renderHistory(participantId) {
    let data;
    try {
      data = await apiFetch(`/api/participants/${participantId}/history`);
    } catch (err) {
      historyList.innerHTML = '';
      historyList.appendChild(el('p', { class: 'msg error', text: err.message || 'Nepodarilo sa načítať históriu.' }));
      return;
    }
    historyList.innerHTML = '';
    if (data.history.length === 0) {
      historyList.appendChild(el('p', { class: 'muted', text: 'Tomuto účastníkovi ešte nikto nič nenahral.' }));
      return;
    }
    data.history.forEach((s) => {
      historyList.appendChild(buildHistoryEntry(participantId, s));
    });
  }

  function buildHistoryEntry(participantId, s) {
    const date = new Date(s.timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    const sign = s.delta >= 0 ? '+' : '−';
    const deltaStr = `${sign}${formatShort(Math.abs(s.delta))}`;
    const ingredientNames = s.ingredientIndexes.map((i) => cfg.ingredients[i] || `#${i}`).join(', ');

    const wrap = el('div', { class: 'card', style: 'margin-bottom:10px; padding:14px;' });
    const header = el('div', { class: 'row', style: 'align-items:center; margin-bottom:6px;' }, [
      el('div', {}, [
        el('strong', { text: timeStr }),
        el('span', { class: 'muted', text: `  ·  nahral: ${s.leaderName}  ·  zmena: ${deltaStr}` + (s.editedAt ? '  ·  (opravené)' : '') }),
      ]),
    ]);
    const ingredientsLine = el('div', { class: 'muted', text: `Prísady: ${ingredientNames}`, style: 'margin-bottom:10px; font-size:0.85rem;' });

    const editBtn = el('button', { class: 'btn', text: '✏️ Opraviť výber', style: 'padding:6px 12px; font-size:0.8rem;' });
    const deleteBtn = el('button', { class: 'btn btn-danger', text: '🗑 Zmazať', style: 'padding:6px 12px; font-size:0.8rem; margin-left:6px;' });

    const editArea = el('div', { class: 'hidden', style: 'margin-top:10px;' });

    editBtn.addEventListener('click', () => {
      editArea.classList.toggle('hidden');
      if (editArea.childElementCount === 0) buildEditArea(editArea, participantId, s);
    });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Naozaj zmazať túto nahrávku? Čas účastníka sa prepočíta.')) return;
      try {
        await apiFetch(`/api/participants/${participantId}/submissions/${s.id}`, { method: 'DELETE' });
        await renderHistory(participantId);
      } catch (err) { alert(err.message || 'Zmazanie zlyhalo.'); }
    });

    wrap.appendChild(header);
    wrap.appendChild(ingredientsLine);
    wrap.appendChild(editBtn);
    wrap.appendChild(deleteBtn);
    wrap.appendChild(editArea);
    return wrap;
  }

  function buildEditArea(container, participantId, submission) {
    const selected = new Set(submission.ingredientIndexes);
    const grid = el('div', { class: 'ingredient-grid' });
    cfg.ingredients.forEach((name, idx) => {
      const btn = el('div', { class: 'ingredient-btn' + (selected.has(idx) ? ' selected' : ''), text: name });
      btn.addEventListener('click', () => {
        if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
        btn.classList.toggle('selected', selected.has(idx));
      });
      grid.appendChild(btn);
    });
    const saveBtn = el('button', { class: 'btn btn-primary', text: 'Uložiť opravu' });
    const msg = el('div', { class: 'msg hidden' });
    saveBtn.addEventListener('click', async () => {
      if (selected.size === 0) {
        msg.className = 'msg error';
        msg.textContent = 'Vyber aspoň jednu prísadu.';
        return;
      }
      saveBtn.disabled = true;
      try {
        await apiFetch(`/api/participants/${participantId}/submissions/${submission.id}`, {
          method: 'PATCH',
          body: { ingredientIndexes: Array.from(selected) },
        });
        await renderHistory(participantId);
      } catch (err) {
        msg.className = 'msg error';
        msg.textContent = err.message || 'Uloženie zlyhalo.';
        saveBtn.disabled = false;
      }
    });
    container.appendChild(grid);
    container.appendChild(saveBtn);
    container.appendChild(msg);
  }

  // ---------- Živé dáta ----------

  let settingsLoaded = false;

  connectLiveSocket((payload) => {
    state = payload;
    if (!settingsLoaded) {
      startingMinutesInput.value = state.settings.startingMinutes;
      settingsLoaded = true;
    }
    renderGameControls();
    renderParticipants();
  });

  setInterval(() => {
    refreshParticipantTimes();
    refreshManualTimeCurrent();
  }, 1000);
})();
