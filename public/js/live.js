'use strict';

(function init() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const clockEl = document.getElementById('clock');
  const banner = document.getElementById('game-banner');
  const container = document.querySelector('.container');
  const topbar = document.querySelector('.topbar');
  const hideBarBtn = document.getElementById('hide-bar-btn');

  // ---------- Skrytie horného panelu (návrat klávesou Esc) ----------

  function hideTopbar() {
    topbar.classList.add('hidden-bar');
    layoutGrid();
  }

  function showTopbar() {
    topbar.classList.remove('hidden-bar');
    layoutGrid();
  }

  if (hideBarBtn) hideBarBtn.addEventListener('click', hideTopbar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && topbar.classList.contains('hidden-bar')) showTopbar();
  });

  // id -> { data, els: {card, bar, time, sub, skull} }
  const cards = new Map();

  // ---------- Rozloženie mriežky tak, aby sa na obrazovku zmestili úplne všetci -----------
  // (len na počítači - na mobile necháme pôvodné správanie so scrollovaním).

  const DESKTOP_QUERY = '(min-width: 641px)';

  function layoutGrid() {
    const count = cards.size;
    const isDesktop = window.matchMedia(DESKTOP_QUERY).matches;

    if (!isDesktop || count === 0) {
      grid.classList.remove('fit-screen');
      grid.style.gridTemplateColumns = '';
      grid.style.gridTemplateRows = '';
      grid.style.height = '';
      return;
    }

    grid.classList.add('fit-screen');

    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const rect = grid.getBoundingClientRect();
    const bottomPad = container ? parseFloat(getComputedStyle(container).paddingBottom) || 0 : 0;
    const availW = rect.width;
    const availH = Math.max(0, window.innerHeight - rect.top - bottomPad);

    // Vyskúšaj všetky možné počty stĺpcov a vyber ten, pri ktorom sú výsledné bunky najväčšie
    // (a teda najlepšie využijú dostupný priestor bez toho, aby čokoľvek pretieklo mimo obrazovku).
    let bestCols = 1;
    let bestScore = -Infinity;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const cardW = (availW - (cols - 1) * gap) / cols;
      const cardH = (availH - (rows - 1) * gap) / rows;
      if (cardW <= 0 || cardH <= 0) continue;
      const score = Math.min(cardW, cardH);
      if (score > bestScore) {
        bestScore = score;
        bestCols = cols;
      }
    }

    const rows = Math.ceil(count / bestCols);
    grid.style.gridTemplateColumns = `repeat(${bestCols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    grid.style.height = availH + 'px';
  }

  window.addEventListener('resize', layoutGrid);

  let payload = { serverTime: Date.now(), game: { status: 'pending' }, participants: [] };

  const GAME_BANNER_TEXT = {
    pending: '⏳ Hra ešte nezačala - odpočet sa spustí, hneď ako ju admin odštartuje.',
    paused: '⏸ Hra je pozastavená - odpočet je dočasne zastavený.',
  };

  function renderBanner() {
    if (!banner) return;
    const text = GAME_BANNER_TEXT[payload.game.status];
    if (!text) {
      banner.classList.add('hidden');
      return;
    }
    banner.textContent = text;
    banner.className = 'live-banner ' + payload.game.status;
  }

  function buildCard(p) {
    const fill = el('div', { class: 'p-fill' });
    const time = el('div', { class: 'p-time' });
    const sub = el('div', { class: 'p-sub' });
    const skull = el('div', { class: 'skull', text: '💀' });
    const card = el('div', { class: 'p-card' }, [
      fill,
      el('div', { class: 'p-name', text: p.name }),
      time,
      sub,
      skull,
    ]);
    return { card, els: { card, fill, time, sub, skull } };
  }

  function rebuildGrid(participants) {
    const ids = new Set(participants.map((p) => p.id));

    // Odstráň karty účastníkov, ktorí už neexistujú.
    for (const [id, entry] of cards.entries()) {
      if (!ids.has(id)) {
        entry.els.card.remove();
        cards.delete(id);
      }
    }

    // Priebežne pridaj/aktualizuj a zoraď podľa mena (server posiela už zoradené).
    participants.forEach((p) => {
      let entry = cards.get(p.id);
      if (!entry) {
        entry = buildCard(p);
        cards.set(p.id, entry);
      }
      entry.data = p;
      grid.appendChild(entry.els.card);
      if (entry.els.card.querySelector('.p-name').textContent !== p.name) {
        entry.els.card.querySelector('.p-name').textContent = p.name;
      }
    });

    empty.classList.toggle('hidden', participants.length > 0);
  }

  function tick() {
    const now = ServerClock.now();
    const running = payload.game.status === 'running';
    const elapsed = running ? now - payload.serverTime : 0;
    cards.forEach(({ data, els }) => {
      const remaining = running ? Math.max(0, data.remainingMs - elapsed) : data.remainingMs;
      const percent = data.startingDuration > 0
        ? Math.max(0, Math.min(1, remaining / data.startingDuration))
        : 0;
      const isDead = remaining <= 0;

      els.card.classList.toggle('dead', isDead);
      els.card.classList.toggle('low', !isDead && percent <= 0.15);

      if (!isDead) {
        els.fill.style.width = (percent * 100).toFixed(2) + '%';
        els.fill.style.backgroundColor = barColor(percent);
        els.time.textContent = formatDuration(remaining);
        els.sub.textContent = 'do konca';
      }
    });

    if (clockEl) {
      const d = new Date(now);
      const pad = (n) => String(n).padStart(2, '0');
      clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    requestAnimationFrame(tick);
  }

  connectLiveSocket((newPayload) => {
    payload = newPayload;
    renderBanner();
    rebuildGrid(payload.participants);
    layoutGrid();
  });

  requestAnimationFrame(tick);
})();
