/*
 * Copyright (c) 2026 Patrik Bukovský @ Lilliandris
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Vlastný dočasný súbor databázy - nech testy nezasiahnu do `data/db.json`. Treba ho
// nastaviť PRED prvým `require('../server')`, lebo ten pri načítaní rovno volá `store.load()`.
const dbFile = path.join(os.tmpdir(), `apocalypse-server-test-${crypto.randomUUID()}.json`);
process.env.DB_FILE = dbFile;

const { server } = require('../server');

// Veľmi jednoduchý "cookie jar" - session cookie z `Set-Cookie` si zapamätáme a posielame
// pri ďalších requestoch, aby sme mohli testovať prihláseného aj neprihláseného používateľa.
function makeClient(baseUrl) {
  let cookie = null;
  async function request(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* niektoré odpovede nemajú JSON telo */ }
    return { status: res.status, body: json };
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
  };
}

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dbFile, { force: true });
  delete process.env.DB_FILE;
});

test('neprihlásený používateľ nemá prístup k chráneným API', async () => {
  const client = makeClient(baseUrl);
  const me = await client.get('/api/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user, null);

  const participants = await client.post('/api/participants', { name: 'Test' });
  assert.strictEqual(participants.status, 401);

  const start = await client.post('/api/game/start');
  assert.strictEqual(start.status, 401);
});

test('verejný stav je dostupný bez prihlásenia a obsahuje hru aj účastníkov', async () => {
  const client = makeClient(baseUrl);
  const state = await client.get('/api/state');
  assert.strictEqual(state.status, 200);
  assert.ok(state.body.game);
  assert.strictEqual(state.body.game.status, 'pending');
  assert.ok(Array.isArray(state.body.participants));
});

test('nesprávne prihlasovacie údaje sú odmietnuté, predvolený admin účet funguje', async () => {
  const client = makeClient(baseUrl);
  const wrong = await client.post('/api/login', { username: 'admin', password: 'zle-heslo' });
  assert.strictEqual(wrong.status, 401);

  const ok = await client.post('/api/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.user.role, 'admin');

  const me = await client.get('/api/me');
  assert.strictEqual(me.body.user.username, 'admin');
});

test('admin môže pridať účastníka, riadiť hru a manuálne upraviť čas; vedúci nie', async () => {
  const admin = makeClient(baseUrl);
  await admin.post('/api/login', { username: 'admin', password: 'admin123' });

  const created = await admin.post('/api/participants', { name: 'Zlatko' });
  assert.strictEqual(created.status, 200);
  const participantId = created.body.participant.id;
  assert.strictEqual(created.body.participant.remainingMs, created.body.participant.startingDuration);

  // Pridanie účastníka nesmie samo o sebe odštartovať hru.
  let state = await admin.get('/api/state');
  assert.strictEqual(state.body.game.status, 'pending');

  const started = await admin.post('/api/game/start');
  assert.strictEqual(started.status, 200);
  assert.strictEqual(started.body.game.status, 'running');

  const paused = await admin.post('/api/game/pause');
  assert.strictEqual(paused.body.game.status, 'paused');

  const customMs = 7 * 60 * 1000 + 15 * 1000; // 7:15
  const adjusted = await admin.patch(`/api/participants/${participantId}/remaining`, { remainingMs: customMs });
  assert.strictEqual(adjusted.status, 200);
  assert.strictEqual(adjusted.body.participant.remainingMs, customMs);

  const badInput = await admin.patch(`/api/participants/${participantId}/remaining`, { remainingMs: -10 });
  assert.strictEqual(badInput.status, 400);

  // Vedúci nesmie riadiť hru ani spravovať účastníkov.
  await admin.post('/api/users', { username: 'vedka', password: 'tajneheslo', name: 'Vedka', role: 'leader' });
  const leader = makeClient(baseUrl);
  const leaderLogin = await leader.post('/api/login', { username: 'vedka', password: 'tajneheslo' });
  assert.strictEqual(leaderLogin.status, 200);
  assert.strictEqual(leaderLogin.body.user.role, 'leader');

  const forbiddenStart = await leader.post('/api/game/start');
  assert.strictEqual(forbiddenStart.status, 403);

  const forbiddenAdd = await leader.post('/api/participants', { name: 'Iný' });
  assert.strictEqual(forbiddenAdd.status, 403);

  const forbiddenAdjust = await leader.patch(`/api/participants/${participantId}/remaining`, { remainingMs: 1000 });
  assert.strictEqual(forbiddenAdjust.status, 403);

  await admin.post('/api/game/reset');
});
