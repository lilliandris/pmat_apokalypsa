/*
 * Copyright (c) 2026 Patrik Bukovský @ Lilliandris
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { freshStore, cleanupStore, sleep } = require('./helpers');

test('pridanie účastníka nespustí hru a dá mu plný štartovací čas', () => {
  const { store, dbFile } = freshStore();
  try {
    assert.strictEqual(store.getGameState().status, 'pending');
    const { participant } = store.addParticipant('  Janko  ');
    assert.strictEqual(participant.name, 'Janko');
    assert.strictEqual(participant.remainingMs, participant.startingDuration);
    assert.strictEqual(participant.alive, true);
    assert.strictEqual(store.getGameState().status, 'pending', 'pridanie prvého účastníka nesmie odštartovať hru');
  } finally {
    cleanupStore(dbFile);
  }
});

test('kým je hra v stave pending, odpočet účastníka neplynie', async () => {
  const { store, dbFile } = freshStore();
  try {
    const { participant } = store.addParticipant('Anička');
    const before = store.computeParticipantState(store.getParticipantFull(participant.id)).remainingMs;
    await sleep(80);
    const after = store.computeParticipantState(store.getParticipantFull(participant.id)).remainingMs;
    assert.strictEqual(after, before);
  } finally {
    cleanupStore(dbFile);
  }
});

test('štart hry rozbehne odpočet, pauza ho presne zmrazí a reset vráti plný čas', async () => {
  const { store, dbFile } = freshStore();
  try {
    const { participant } = store.addParticipant('Karol');
    const id = participant.id;

    store.startGame();
    assert.strictEqual(store.getGameState().status, 'running');
    await sleep(80);
    const runningRemaining = store.computeParticipantState(store.getParticipantFull(id)).remainingMs;
    assert.ok(runningRemaining < participant.remainingMs, 'počas behu hry sa má zostávajúci čas znižovať');

    store.pauseGame();
    assert.strictEqual(store.getGameState().status, 'paused');
    const pausedAt = store.computeParticipantState(store.getParticipantFull(id)).remainingMs;
    await sleep(80);
    const stillPaused = store.computeParticipantState(store.getParticipantFull(id)).remainingMs;
    assert.strictEqual(stillPaused, pausedAt, 'počas pauzy sa zostávajúci čas nesmie meniť');

    store.startGame();
    await sleep(40);
    const resumedRemaining = store.computeParticipantState(store.getParticipantFull(id)).remainingMs;
    assert.ok(resumedRemaining < pausedAt, 'po opätovnom štarte má odpočet pokračovať tam, kde sa zastavil');

    store.resetGame();
    assert.strictEqual(store.getGameState().status, 'pending');
    const afterReset = store.computeParticipantState(store.getParticipantFull(id));
    assert.strictEqual(afterReset.remainingMs, afterReset.startingDuration);
    assert.strictEqual(afterReset.submissionCount, 0);
  } finally {
    cleanupStore(dbFile);
  }
});

test('manuálna úprava nastaví presný zostávajúci čas a odmietne neplatný vstup', () => {
  const { store, dbFile } = freshStore();
  try {
    const { participant } = store.addParticipant('Beta');
    const target = 12 * 60 * 1000 + 34 * 1000; // 12:34

    const ok = store.setParticipantRemaining(participant.id, target);
    assert.strictEqual(ok.participant.remainingMs, target);

    const negative = store.setParticipantRemaining(participant.id, -5);
    assert.ok(negative.error, 'záporný čas musí byť odmietnutý');

    const nonsense = store.setParticipantRemaining(participant.id, 'abc');
    assert.ok(nonsense.error, 'nečíselný vstup musí byť odmietnutý');

    const missing = store.setParticipantRemaining('neexistujuce-id', 1000);
    assert.ok(missing.error, 'neexistujúci účastník musí vrátiť chybu');
  } finally {
    cleanupStore(dbFile);
  }
});

test('nahrávka prísad pridá čas, rešpektuje odstup medzi nahrávkami a admin ho môže obísť cez force', () => {
  const { store, dbFile } = freshStore();
  try {
    const { participant } = store.addParticipant('Gama');
    store.startGame();

    const first = store.addSubmission({
      participantId: participant.id,
      leaderId: 'leader-1',
      leaderName: 'Vedúci Jano',
      ingredientIndexes: [0, 1],
    });
    assert.ok(first.submission);
    assert.strictEqual(first.submission.delta, 60 * 1000);

    const blocked = store.addSubmission({
      participantId: participant.id,
      leaderId: 'leader-1',
      leaderName: 'Vedúci Jano',
      ingredientIndexes: [2],
    });
    assert.ok(blocked.error, 'druhá nahrávka tesne po prvej musí byť zablokovaná odstupom');
    assert.ok(blocked.cooldownRemaining > 0);

    const forced = store.addSubmission({
      participantId: participant.id,
      leaderId: 'admin-1',
      leaderName: 'Admin',
      ingredientIndexes: [3],
      force: true,
    });
    assert.ok(forced.submission, 'admin môže odstup obísť pomocou force');
    assert.strictEqual(forced.participant.submissionCount, 2);
  } finally {
    cleanupStore(dbFile);
  }
});

test('addSubmission odmietne prázdny alebo neplatný výber prísad', () => {
  const { store, dbFile } = freshStore();
  try {
    const { participant } = store.addParticipant('Delta');

    const empty = store.addSubmission({
      participantId: participant.id,
      leaderId: 'leader-1',
      leaderName: 'Vedúci',
      ingredientIndexes: [],
    });
    assert.ok(empty.error);

    const invalid = store.addSubmission({
      participantId: participant.id,
      leaderId: 'leader-1',
      leaderName: 'Vedúci',
      ingredientIndexes: [999],
    });
    assert.ok(invalid.error);
  } finally {
    cleanupStore(dbFile);
  }
});
