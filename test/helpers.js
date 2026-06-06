'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// `store.js` drží svoju databázu v module-level premennej a číta cestu k súboru z DB_FILE.
// Aby testy nikdy nezasiahli do reálnych dát (`data/db.json`), pre každý test vytvoríme
// vlastný dočasný súbor a modul znovu načítame s prepísanou cestou.
function freshStore() {
  const dbFile = path.join(os.tmpdir(), `apocalypse-test-${crypto.randomUUID()}.json`);
  process.env.DB_FILE = dbFile;
  delete require.cache[require.resolve('../store')];
  const store = require('../store');
  store.load();
  return { store, dbFile };
}

function cleanupStore(dbFile) {
  fs.rmSync(dbFile, { force: true });
  delete process.env.DB_FILE;
  delete require.cache[require.resolve('../store')];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { freshStore, cleanupStore, sleep };
