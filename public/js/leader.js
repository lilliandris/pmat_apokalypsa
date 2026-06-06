'use strict';

(async function init() {
  const user = await requireUser();
  if (!user) return;

  document.getElementById('user-name').textContent = `${user.name} · ${user.role === 'admin' ? 'admin' : 'vedúci'}`;
  document.getElementById('logout-btn').addEventListener('click', logout);

  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('search-results');
  const selectedBox = document.getElementById('selected-box');
  const spName = document.getElementById('sp-name');
  const spTime = document.getElementById('sp-time');
  const clearBtn = document.getElementById('clear-selection-btn');
  const cooldownBanner = document.getElementById('cooldown-banner');
  const ingredientsCard = document.getElementById('ingredients-card');
  const ingredientGrid = document.getElementById('ingredient-grid');
  const selectionCount = document.getElementById('selection-count');
  const uploadBtn = document.getElementById('upload-btn');
  const uploadMsg = document.getElementById('upload-msg');

  let cfg = { ingredients: [], cooldownMs: 60000 };
  let state = { participants: [], game: { status: 'pending' }, serverTime: Date.now() };

  // Zostávajúci čas účastníka - pokiaľ hra beží, dopočíta plynutie od posledného stavu zo servera;
  // ak je pozastavená alebo ešte nezačala, čas je zmrazený presne na hodnote zo servera.
  function remainingFor(p) {
    if (state.game.status !== 'running') return p.remainingMs;
    const elapsed = ServerClock.now() - state.serverTime;
    return Math.max(0, p.remainingMs - elapsed);
  }
  let selectedId = null;
  let selectedIngredients = new Set();
  let activeResultIndex = -1;
  let forceOverride = false;

  try {
    cfg = await apiFetch('/api/config');
  } catch (e) { /* defaults postačia */ }

  buildIngredientGrid();

  // ---------- Vyhľadávanie účastníka ----------

  function currentMatches() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return [];
    return state.participants
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }

  function renderSearchResults() {
    const matches = currentMatches();
    searchResults.innerHTML = '';
    activeResultIndex = -1;
    if (matches.length === 0) {
      searchResults.classList.add('hidden');
      return;
    }
    matches.forEach((p, idx) => {
      const remaining = remainingFor(p);
      const dead = remaining <= 0;
      const row = el('div', { class: 'search-result' + (dead ? ' dead' : ''), 'data-id': p.id }, [
        el('span', { class: 'sr-name', text: p.name }),
        el('span', { class: 'sr-time', text: dead ? '💀 mŕtvy' : formatDuration(remaining) }),
      ]);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectParticipant(p.id);
      });
      searchResults.appendChild(row);
    });
    searchResults.classList.remove('hidden');
  }

  searchInput.addEventListener('input', renderSearchResults);
  searchInput.addEventListener('focus', renderSearchResults);
  searchInput.addEventListener('blur', () => {
    setTimeout(() => searchResults.classList.add('hidden'), 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    const rows = Array.from(searchResults.querySelectorAll('.search-result'));
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeResultIndex = Math.min(rows.length - 1, activeResultIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeResultIndex = Math.max(0, activeResultIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeResultIndex >= 0 ? activeResultIndex : 0;
      const id = rows[idx].getAttribute('data-id');
      selectParticipant(id);
      return;
    } else if (e.key === 'Escape') {
      searchResults.classList.add('hidden');
      return;
    } else {
      return;
    }
    rows.forEach((r, i) => r.classList.toggle('active', i === activeResultIndex));
  });

  function selectParticipant(id) {
    selectedId = id;
    searchInput.value = '';
    searchResults.classList.add('hidden');
    selectedBox.classList.remove('hidden');
    ingredientsCard.style.display = '';
    selectedIngredients.clear();
    forceOverride = false;
    renderIngredientGrid();
    updateSelectedInfo();
    searchInput.blur();
  }

  clearBtn.addEventListener('click', () => {
    selectedId = null;
    selectedBox.classList.add('hidden');
    ingredientsCard.style.display = 'none';
    cooldownBanner.classList.remove('visible');
    searchInput.focus();
  });

  // ---------- Prísady ----------

  function buildIngredientGrid() {
    ingredientGrid.innerHTML = '';
    cfg.ingredients.forEach((name, idx) => {
      const btn = el('div', { class: 'ingredient-btn', text: name, role: 'button', tabindex: '0' });
      btn.addEventListener('click', () => toggleIngredient(idx));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIngredient(idx); }
      });
      ingredientGrid.appendChild(btn);
    });
  }

  function renderIngredientGrid() {
    const buttons = ingredientGrid.querySelectorAll('.ingredient-btn');
    buttons.forEach((btn, idx) => btn.classList.toggle('selected', selectedIngredients.has(idx)));
    selectionCount.textContent = `Vybraných: ${selectedIngredients.size}`;
    refreshUploadState();
  }

  function toggleIngredient(idx) {
    if (selectedIngredients.has(idx)) selectedIngredients.delete(idx);
    else selectedIngredients.add(idx);
    renderIngredientGrid();
  }

  // ---------- Stav vybraného účastníka / čakacia doba ----------

  function getSelectedParticipant() {
    if (!selectedId) return null;
    return state.participants.find((p) => p.id === selectedId) || null;
  }

  function cooldownRemainingFor(p) {
    if (!p || !p.lastSubmissionAt) return 0;
    return Math.max(0, cfg.cooldownMs - (ServerClock.now() - p.lastSubmissionAt));
  }

  function updateSelectedInfo() {
    const p = getSelectedParticipant();
    if (!p) {
      // účastník medzitým zmazaný
      clearBtn.click();
      return;
    }
    const remaining = remainingFor(p);
    const dead = remaining <= 0;
    spName.textContent = p.name;
    spTime.textContent = dead ? '💀 už nie je nažive' : `Zostáva: ${formatDuration(remaining)}`;
    selectedBox.classList.toggle('dead', dead);

    refreshUploadState();
  }

  function refreshUploadState() {
    const p = getSelectedParticipant();
    uploadMsg.classList.add('hidden');

    if (!p) {
      uploadBtn.disabled = true;
      cooldownBanner.classList.remove('visible');
      return;
    }

    const dead = remainingFor(p) <= 0;
    const cooldown = cooldownRemainingFor(p);
    const isAdmin = user.role === 'admin';

    if (dead) {
      cooldownBanner.classList.remove('visible');
      uploadBtn.disabled = true;
      uploadBtn.textContent = '⬆ Nahrať';
    } else if (cooldown > 0 && !(isAdmin && forceOverride)) {
      cooldownBanner.classList.add('visible');
      let msg = `⏳ Tomuto účastníkovi sa nedávno už nahrávalo - počkaj ešte ${formatShort(cooldown)}, kým bude možné nahrať znova.`;
      if (isAdmin) {
        msg += ' Ako admin môžeš čakaciu dobu obísť (napr. pri oprave chybného vstupu).';
      }
      cooldownBanner.innerHTML = '';
      cooldownBanner.appendChild(document.createTextNode(msg));
      if (isAdmin) {
        const overrideBtn = el('button', {
          class: 'btn btn-danger',
          text: forceOverride ? 'Obídenie čakacej doby: zapnuté ✓' : 'Obísť čakaciu dobu',
          style: 'margin-left:10px; padding:6px 12px; font-size:0.82rem;',
          onclick: () => { forceOverride = !forceOverride; refreshUploadState(); },
        });
        cooldownBanner.appendChild(overrideBtn);
      }
      uploadBtn.disabled = selectedIngredients.size === 0 || !(isAdmin && forceOverride);
      uploadBtn.textContent = (isAdmin && forceOverride) ? '⬆ Nahrať (s obídením čakacej doby)' : '⬆ Nahrať';
    } else {
      cooldownBanner.classList.remove('visible');
      uploadBtn.disabled = selectedIngredients.size === 0;
      uploadBtn.textContent = '⬆ Nahrať';
    }
  }

  uploadBtn.addEventListener('click', async () => {
    const p = getSelectedParticipant();
    if (!p || selectedIngredients.size === 0) return;
    uploadBtn.disabled = true;
    uploadMsg.classList.add('hidden');
    try {
      await apiFetch('/api/submissions', {
        method: 'POST',
        body: {
          participantId: p.id,
          ingredientIndexes: Array.from(selectedIngredients),
          force: user.role === 'admin' && forceOverride,
        },
      });
      uploadMsg.className = 'msg success';
      uploadMsg.textContent = `✓ Úspešne nahraté pre účastníka „${p.name}“.`;
      selectedIngredients.clear();
      forceOverride = false;
      renderIngredientGrid();
      updateSelectedInfo();
    } catch (err) {
      uploadMsg.className = 'msg error';
      uploadMsg.textContent = err.message || 'Nahrávanie zlyhalo.';
      refreshUploadState();
    }
  });

  // ---------- Živé dáta ----------

  connectLiveSocket((payload) => {
    state = payload;
    if (selectedId) updateSelectedInfo();
  });

  setInterval(() => {
    if (selectedId) updateSelectedInfo();
    if (!searchResults.classList.contains('hidden')) renderSearchResults();
  }, 1000);
})();
